using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace PdfCopilot {
    internal sealed class AntigravityClient : IDisposable {
        private readonly NativeFrames frames;
        private readonly string configured;
        private readonly object setup = new object();
        private string work, activeId, version = "";
        private readonly Stopwatch uptime = Stopwatch.StartNew();
        private readonly Timer expiry;
        private const int IdleMs = 15 * 60 * 1000;
        private long lastRequest;
        private int requests;
        private bool changing, disposed;
        private Connection connection;
        private ManualResetEvent cancelled;
        private readonly Stopwatch clock = new Stopwatch();
        private const string ToolError = "Antigravity attempted a tool action. PDF Copilot stopped this conversation.";

        internal AntigravityClient(string configured, NativeFrames frames) {
            this.configured = configured; this.frames = frames;
            expiry = new Timer(ExpireIdle, null, Timeout.Infinite, Timeout.Infinite);
        }
        private static string ExistingExe(string candidate) {
            try {
                if (!String.IsNullOrEmpty(candidate) && Path.IsPathRooted(candidate) && Path.GetPathRoot(candidate).Length > 2 &&
                    candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(candidate)) return Path.GetFullPath(candidate);
            } catch (ArgumentException) { }
            return null;
        }
        private string Discover() {
            if (configured != "") return ExistingExe(configured);
            // The reader is usually launched from Explorer, whose environment predates a PATH entry added by a later
            // install (the agy installer adds one). Also read the PATH stored for the user and the machine.
            var paths = new List<string> { Environment.GetEnvironmentVariable("PATH") };
            foreach (var target in new[] { EnvironmentVariableTarget.User, EnvironmentVariableTarget.Machine }) {
                try { paths.Add(Environment.ExpandEnvironmentVariables(Environment.GetEnvironmentVariable("PATH", target) ?? "")); } catch (System.Security.SecurityException) { }
            }
            foreach (string dir in String.Join(Path.PathSeparator.ToString(), paths).Split(Path.PathSeparator)) {
                if (dir.Trim().Length == 0) continue;
                try { string exe = ExistingExe(Path.Combine(dir.Trim().Trim('"'), "agy.exe")); if (exe != null) return exe; } catch (ArgumentException) { }
            }
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var dirs = new[] { Path.Combine(local, "Programs", "AntigravityCLI"), Path.Combine(local, "AntigravityCLI"), Path.Combine(profile, "AntigravityCLI"), Path.Combine(profile, ".local", "bin") };
            foreach (string dir in dirs) { string exe = ExistingExe(Path.Combine(dir, "agy.exe")); if (exe != null) return exe; }
            return null;
        }
        private static void CheckDirectory(string path) {
            var dir = new DirectoryInfo(path);
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Unsafe Antigravity directory.");
        }
        private static void DeleteEntry(string path) {
            FileAttributes attr = File.GetAttributes(path);
            if ((attr & FileAttributes.Directory) == 0) { File.Delete(path); return; }
            if ((attr & FileAttributes.ReparsePoint) == 0) foreach (string child in Directory.GetFileSystemEntries(path)) DeleteEntry(child);
            Directory.Delete(path, false);
        }
        private static void CleanWorkspace(string path) {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0) {
                string manifest = Path.Combine(path, "sessions");
                if (File.Exists(manifest) && (File.GetAttributes(manifest) & FileAttributes.ReparsePoint) == 0)
                    foreach (string id in File.ReadLines(manifest)) CleanRecords(id);
            }
            DeleteEntry(path);
        }
        private void EnsureWorkspace() {
            if (work != null) return;
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (String.IsNullOrEmpty(local) || !Path.IsPathRooted(local) || Path.GetPathRoot(local).Length <= 2) throw new IOException("Missing local application directory.");
            string parent = Path.GetFullPath(Path.Combine(local, "PdfCopilot", "antigravity"));
            string own;
            using (var host = Process.GetCurrentProcess()) own = Path.Combine(parent, "work-" + host.Id);
            CheckDirectory(parent); Directory.CreateDirectory(parent);
            foreach (string path in Directory.GetDirectories(parent, "work-*")) {
                string name = Path.GetFileName(path); int pid;
                if (!Int32.TryParse(name.Substring(5), out pid) || pid <= 0 || name != "work-" + pid) continue;
                try { using (Process.GetProcessById(pid)) { } }
                catch (ArgumentException) {
                    try { CleanWorkspace(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                }
            }
            CheckDirectory(own);
            if (Directory.Exists(own)) CleanWorkspace(own);
            string hooks = Path.Combine(own, ".agents"), agents = Path.Combine(hooks, "agents");
            Directory.CreateDirectory(agents);
            // The outer shell only sees ASCII tokens. The inner PowerShell literal preserves the exact Unicode executable path.
            string script = "& '" + Assembly.GetExecutingAssembly().Location.Replace("'", "''") + "' --deny-tool; exit $LASTEXITCODE";
            string command = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var hook = Json.Obj("type", "command", "command", command, "timeout", 10);
            File.WriteAllText(Path.Combine(hooks, "hooks.json"), Json.Encode(Json.Obj("kaizhi-no-tools", Json.Obj("PreToolUse", new[] { Json.Obj("matcher", "*", "hooks", new[] { hook }) }))), new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(agents, "kaizhi-reader.md"), "---\nname: kaizhi-reader\ndescription: Answers questions about the text it is given. Has no tools.\nmainAgent: true\nsubagent: false\ntools: []\n---\nYou are a reading assistant. Answer only from the text in the conversation. You have no tools.\n", new UTF8Encoding(false));
            work = own;
        }
        private static void CleanRecords(string id) {
            Guid guid;
            if (!Guid.TryParseExact(id, "D", out guid)) return;
            string profile = Environment.GetEnvironmentVariable("USERPROFILE");
            if (String.IsNullOrEmpty(profile) || !Path.IsPathRooted(profile)) return;
            foreach (string sub in new[] { "conversations", "brain", "annotations" }) try {
                string root = Path.GetFullPath(Path.Combine(profile, ".gemini", "antigravity-kaizhi", sub));
                CheckDirectory(Path.GetDirectoryName(root)); CheckDirectory(root);
                if (Directory.Exists(root)) foreach (string path in Directory.GetFileSystemEntries(root, id + "*")) {
                    string name = Path.GetFileName(path);
                    if (name == id || name.StartsWith(id + ".", StringComparison.OrdinalIgnoreCase)) DeleteEntry(path);
                }
            } catch { }
        }
        private Connection Acquire(string exe) {
            Connection previous;
            lock (setup) {
                while (changing && !disposed) Monitor.Wait(setup);
                if (disposed) throw new ObjectDisposedException("AntigravityClient");
                if (connection != null && connection.Alive) { requests++; return connection; }
                changing = true; previous = connection; connection = null;
            }
            Connection fresh = null;
            try {
                if (previous != null && !StopConnection(previous)) throw new InvalidOperationException("The previous Antigravity process is still exiting.");
                EnsureWorkspace();
                if (exe == null) throw new InvalidOperationException("Antigravity CLI is not installed.");
                fresh = new Connection(exe, work, frames);
                var init = fresh.Call("initialize", Json.Obj("protocolVersion", 1, "clientCapabilities", Json.Obj("fs", Json.Obj("readTextFile", false, "writeTextFile", false), "terminal", false), "clientInfo", Json.Obj("name", "pdf_copilot", "version", "0.3.0")));
                if (!Object.Equals(Json.Get(init, "protocolVersion"), 1)) throw new InvalidOperationException("Unsupported Antigravity ACP version.");
                lock (setup) {
                    if (disposed) throw new ObjectDisposedException("AntigravityClient");
                    version = Json.Text(Json.Map(Json.Get(init, "agentInfo")), "version");
                    connection = fresh; fresh = null; requests++; return connection;
                }
            } finally {
                if (fresh != null) StopConnection(fresh);
                lock (setup) { changing = false; ScheduleExpiry(); Monitor.PulseAll(setup); }
            }
        }
        private bool StopConnection(Connection current) {
            if (current.StopAndWait()) return true;
            // Keep ownership after a timed-out kill so a second child cannot start alongside it.
            lock (setup) if (!disposed) { connection = current; lastRequest = uptime.ElapsedMilliseconds; }
            return false;
        }
        private void ScheduleExpiry() {
            if (disposed || changing || connection == null) return;
            long due = connection.NextExpiry;
            if (requests == 0 && due == Int64.MaxValue) due = lastRequest + IdleMs;
            expiry.Change(due == Int64.MaxValue ? Timeout.Infinite : (int)Math.Max(0, due - uptime.ElapsedMilliseconds), Timeout.Infinite);
        }
        private void Release() {
            lock (setup) {
                requests--; lastRequest = uptime.ElapsedMilliseconds; ScheduleExpiry(); Monitor.PulseAll(setup);
            }
        }
        private void ExpireIdle(object state) {
            Connection current; List<Session> expired; bool stop;
            lock (setup) {
                if (disposed || changing || connection == null) return;
                current = connection;
                long now = uptime.ElapsedMilliseconds;
                expired = current.TakeExpired(now);
                stop = requests == 0 && current.NextExpiry == Int64.MaxValue && lastRequest + IdleMs <= now;
                if (stop) { changing = true; connection = null; } else requests++;
            }
            try {
                foreach (Session entry in expired) current.Close(entry);
                if (stop) StopConnection(current);
            } finally {
                lock (setup) {
                    if (stop) changing = false; else requests--;
                    ScheduleExpiry(); Monitor.PulseAll(setup);
                }
            }
        }
        internal object Metadata(string type) {
            string exe = Discover();
            var status = Json.Obj("installed", exe != null, "version", version, "loggedIn", false, "path", exe ?? "");
            if (type == "status" && exe == null) return status;
            Connection current = Acquire(exe);
            try {
                Session ready = current.MetadataSession(work, uptime);
                if (type == "models") return ready.Models;
                if (type == "warm") return Json.Obj();
                status["version"] = version; status["loggedIn"] = true; return status;
            } catch (LoginRequired) {
                if (type != "status") throw;
                status["version"] = version; return status;
            } finally { Release(); }
        }
        internal void PrepareChat(ClientRequest req) {
            if (req.PdfTools) throw new InvalidOperationException("PDF_TOOLS_UNAVAILABLE: Antigravity does not support PDF tools.");
            lock (setup) { activeId = req.Id; cancelled = new ManualResetEvent(false); clock.Restart(); }
        }
        internal object Chat(ClientRequest req) {
            Connection current = null; Session entry = null;
            bool reused, completed = false, stopped;
            try {
                current = Acquire(Discover());
                while (true) {
                    entry = current.Take(req, work, uptime.ElapsedMilliseconds, cancelled, out reused);
                    try {
                        object usage = current.Prompt(entry, req, clock, reused, cancelled);
                        completed = true;
                        return Json.Obj("firstMs", entry.FirstMs, "answerMs", entry.AnswerMs, "totalMs", clock.ElapsedMilliseconds, "engine", "antigravity " + version, "usage", usage, "reused", reused);
                    } catch (SessionMissing) {
                        if (!reused || entry.FirstMs >= 0 || cancelled.WaitOne(0)) throw;
                        current.Close(entry); entry = null;
                    }
                }
            } finally {
                lock (setup) { stopped = cancelled.WaitOne(0); activeId = null; cancelled.Dispose(); cancelled = null; }
                if (current != null) try {
                    if (entry != null) {
                        if (completed && !stopped && req.SessionKey != null) current.Remember(entry, req, uptime.ElapsedMilliseconds);
                        else current.Close(entry);
                    }
                } finally { Release(); }
                if (current != null && current.ToolViolation) throw new InvalidOperationException(ToolError);
                if (stopped) throw new OperationCanceledException();
                if (completed && !current.Alive) throw new IOException("Antigravity connection closed.");
            }
        }
        internal bool Cancel(string id) {
            lock (setup) {
                if (id != activeId) return false;
                cancelled.Set(); return true;
            }
        }
        public void Dispose() {
            Connection current; bool idle;
            lock (setup) {
                disposed = true; expiry.Dispose();
                if (cancelled != null) cancelled.Set();
                current = connection; connection = null; idle = requests == 0; Monitor.PulseAll(setup);
            }
            if (current != null) {
                if (idle) foreach (Session entry in current.TakeExpired(Int64.MaxValue)) current.Close(entry);
                current.StopAndWait();
            }
            var wait = Stopwatch.StartNew();
            lock (setup) while (changing || requests > 0) {
                int remaining = 5000 - (int)wait.ElapsedMilliseconds;
                if (remaining <= 0 || !Monitor.Wait(setup, remaining)) return;
            }
            if (work != null) try { CheckDirectory(Path.GetDirectoryName(work)); CleanWorkspace(work); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }

        private sealed class Session {
            internal string Id, Key, Head, ModelId, RequestId;
            internal Stopwatch Clock;
            internal long FirstMs = -1, AnswerMs = -1, LastUsed;
            private readonly HashSet<string> modelIds = new HashSet<string>();
            internal readonly List<object> Models = new List<object>();
            internal Session(string sessionId, Dictionary<string, object> result) {
                Id = sessionId;
                string[] order = { "low", "medium", "high", "xhigh", "max" };
                var groups = new Dictionary<string, Dictionary<string, object>>();
                foreach (object item in Json.Items(Json.Get(Json.Map(Json.Get(result, "models")), "availableModels"))) {
                    var model = Json.Map(item); string id = Json.Text(model, "modelId"), name = Json.Text(model, "name"), effort = "";
                    if (id == "" || !modelIds.Add(id)) continue;
                    int dash = id.LastIndexOf('-');
                    if (dash > 0 && Array.IndexOf(order, id.Substring(dash + 1)) >= 0) {
                        effort = id.Substring(dash + 1); id = id.Substring(0, dash);
                        string suffix = " (" + effort + ")";
                        if (name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - suffix.Length);
                    }
                    Dictionary<string, object> row;
                    if (effort == "" || !groups.TryGetValue(id, out row)) {
                        row = Json.Obj("id", id, "name", name, "efforts", new List<string>(), "defaultEffort", "", "vision", true, "tiers", new object[0]);
                        Models.Add(row); if (effort != "") groups.Add(id, row);
                    }
                    if (effort != "") ((List<string>)row["efforts"]).Add(effort);
                }
                foreach (var row in groups.Values) {
                    var efforts = (List<string>)row["efforts"]; efforts.Sort(delegate(string a, string b) { return Array.IndexOf(order, a).CompareTo(Array.IndexOf(order, b)); });
                    row["defaultEffort"] = efforts.Contains("medium") ? "medium" : efforts[0];
                }
            }
            internal string ModelFor(ClientRequest req) {
                string variant = req.Model + "-" + req.Effort;
                return req.Effort != "" && modelIds.Contains(variant) ? variant : req.Model;
            }
        }

        private sealed class Connection {
            private readonly NativeFrames frames;
            private readonly Process child;
            private readonly ProcessJob job;
            private readonly Thread reader;
            private readonly object gate = new object(), writeGate = new object();
            private readonly Dictionary<int, Dictionary<string, object>> replies = new Dictionary<int, Dictionary<string, object>>();
            private readonly Dictionary<string, Session> sessions = new Dictionary<string, Session>();
            private readonly List<Session> idle = new List<Session>();
            private readonly Dictionary<string, long> deadlines = new Dictionary<string, long>();
            private readonly Stopwatch uptime = Stopwatch.StartNew();
            private readonly Timer watchdog;
            private bool closed;
            internal volatile bool ToolViolation;
            private Session chatting;
            private int sequence;
            internal bool Alive { get { lock (gate) return !closed && !child.HasExited; } }
            internal long NextExpiry { get { lock (gate) return idle.Count == 0 ? Int64.MaxValue : idle[0].LastUsed + IdleMs; } }
            internal Connection(string exe, string work, NativeFrames frames) {
                this.frames = frames;
                var info = new ProcessStartInfo(exe, "acp --sandbox --app-data-dir antigravity-kaizhi --agent kaizhi-reader") { WorkingDirectory = work, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = new UTF8Encoding(false, true) };
                // Framework flushes Console.InputEncoding's preamble into redirected stdin before exposing its BaseStream.
                if (Console.InputEncoding.GetPreamble().Length != 0) Console.InputEncoding = new UTF8Encoding(false);
                // agy reaches Google through the proxy named in these variables. An app launched from Explorer can miss ones
                // the user set later, so fill the gaps from the stored user and machine values (set on this process: see CodexClient).
                foreach (string name in new[] { "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY" }) {
                    if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable(name))) continue;
                    try {
                        string stored = Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User);
                        if (String.IsNullOrEmpty(stored)) stored = Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.Machine);
                        if (!String.IsNullOrEmpty(stored)) Environment.SetEnvironmentVariable(name, stored, EnvironmentVariableTarget.Process);
                    } catch (System.Security.SecurityException) { }
                }
                child = Process.Start(info);
                try {
                    job = new ProcessJob(child);
                    child.BeginErrorReadLine();
                    watchdog = new Timer(CheckTools, null, Timeout.Infinite, Timeout.Infinite);
                    reader = new Thread(Read) { IsBackground = true, Name = "Antigravity ACP" }; reader.Start();
                } catch { if (job != null) job.Dispose(); else try { child.Kill(); } catch { } child.Dispose(); throw; }
            }
            private Session Open(string work) {
                var result = Call("session/new", Json.Obj("cwd", work, "mcpServers", new object[0]));
                string id = Json.Text(result, "sessionId");
                if (id == "" || id.IndexOfAny(new[] { '\r', '\n' }) >= 0) throw new InvalidOperationException("Antigravity returned an invalid session ID.");
                try {
                    var entry = new Session(id, result);
                    lock (gate) {
                        CheckOpen();
                        File.AppendAllText(Path.Combine(work, "sessions"), id + "\n");
                        sessions.Add(id, entry);
                    }
                    return entry;
                } catch { CloseId(id); throw; }
            }
            internal List<Session> TakeExpired(long now) {
                lock (gate) {
                    var expired = idle.FindAll(s => s.LastUsed + IdleMs <= now);
                    idle.RemoveRange(0, expired.Count); return expired;
                }
            }
            internal Session MetadataSession(string work, Stopwatch timer) {
                foreach (Session expired in TakeExpired(timer.ElapsedMilliseconds)) Close(expired);
                lock (gate) {
                    CheckOpen();
                    if (chatting != null) return chatting;
                    if (idle.Count > 0) return idle[idle.Count - 1];
                }
                Session entry = Open(work);
                lock (gate) {
                    CheckOpen();
                    if (chatting == null && idle.Count == 0) { entry.LastUsed = timer.ElapsedMilliseconds; idle.Add(entry); return entry; }
                }
                Close(entry); return entry;
            }
            internal Session Take(ClientRequest req, string work, long now, ManualResetEvent cancel, out bool reused) {
                foreach (Session expired in TakeExpired(now)) Close(expired);
                Session entry, retire = null;
                lock (gate) {
                    CheckOpen();
                    entry = req.SessionKey == null ? null : idle.Find(s => s.Key == req.SessionKey);
                    reused = entry != null && entry.Head == req.SessionBase && entry.ModelId == entry.ModelFor(req);
                    if (entry != null) idle.Remove(entry);
                    if (!reused) {
                        retire = entry;
                        entry = idle.Find(s => s.Key == null);
                        if (entry != null) idle.Remove(entry);
                        else if (req.SessionKey != null && idle.Count == 4) { retire = idle[0]; idle.RemoveAt(0); }
                    }
                }
                if (retire != null) Close(retire);
                if (entry != null) return entry;
                if (cancel.WaitOne(0)) throw new OperationCanceledException();
                return Open(work);
            }
            internal void Remember(Session entry, ClientRequest req, long now) {
                Session retire = null;
                lock (gate) {
                    CheckOpen();
                    chatting = null; entry.RequestId = null;
                    if (idle.Count == 4) { retire = idle[0]; idle.RemoveAt(0); }
                    entry.Key = req.SessionKey; entry.Head = req.SessionNext; entry.LastUsed = now; idle.Add(entry);
                }
                if (retire != null) Close(retire);
            }
            internal void Close(Session entry) {
                lock (gate) {
                    if (chatting == entry) chatting = null;
                    entry.RequestId = null; idle.Remove(entry);
                }
                CloseId(entry.Id);
                lock (gate) if (!closed) sessions.Remove(entry.Id);
            }
            private void CloseId(string id) {
                if (Alive) try { Call("session/close", Json.Obj("sessionId", id)); } catch { }
                CleanRecords(id);
            }
            internal object Prompt(Session entry, ClientRequest req, Stopwatch watch, bool reused, ManualResetEvent cancel) {
                lock (gate) { CheckOpen(); chatting = entry; entry.RequestId = req.Id; entry.Clock = watch; entry.FirstMs = entry.AnswerMs = -1; }
                if (cancel.WaitOne(0)) throw new OperationCanceledException();
                if (!reused) {
                    entry.ModelId = entry.ModelFor(req);
                    if (entry.ModelId != "") Call("session/set_model", Json.Obj("sessionId", entry.Id, "modelId", entry.ModelId));
                }
                string text = reused || req.History.Count == 0 ? "Reader's message:\n" + req.Text : req.PromptText();
                var prompt = new List<object> { Json.Obj("type", "text", "text", text) };
                foreach (string image in req.Images) {
                    int semi = image.IndexOf(';'); prompt.Add(Json.Obj("type", "image", "mimeType", image.Substring(5, semi - 5), "data", image.Substring(image.IndexOf(',') + 1)));
                }
                var result = Call("session/prompt", Json.Obj("sessionId", entry.Id, "prompt", prompt), cancel);
                lock (gate) {
                    while (!closed && deadlines.Count > 0) Monitor.Wait(gate);
                    CheckOpen();
                    entry.RequestId = null;
                }
                string reason = Json.Text(result, "stopReason");
                if (reason == "cancelled") throw new OperationCanceledException();
                if (reason != "end_turn") throw new InvalidOperationException("Antigravity stopped: " + (reason == "" ? "missing stopReason" : reason) + ".");
                return Json.Get(result, "usage");
            }
            private void Send(Dictionary<string, object> msg) {
                msg["jsonrpc"] = "2.0"; byte[] bytes = Encoding.UTF8.GetBytes(Json.Encode(msg) + "\n");
                lock (writeGate) { var stream = child.StandardInput.BaseStream; stream.Write(bytes, 0, bytes.Length); stream.Flush(); }
            }
            internal Dictionary<string, object> Call(string method, Dictionary<string, object> parameters, ManualResetEvent cancel = null) {
                int id;
                lock (gate) { CheckOpen(); id = ++sequence; replies.Add(id, null); }
                string sessionId = Json.Text(parameters, "sessionId");
                Timer deadline = null; RegisteredWaitHandle registration = null;
                try {
                    lock (writeGate) {
                        if (cancel != null) {
                            if (cancel.WaitOne(0)) throw new OperationCanceledException();
                            // Arm the deadline independently of stdin: even the cancellation write can block.
                            deadline = new Timer(delegate {
                                lock (gate) if (Waiting(id)) Stop();
                            }, null, Timeout.Infinite, Timeout.Infinite);
                            registration = ThreadPool.RegisterWaitForSingleObject(cancel, delegate {
                                lock (gate) { if (!Waiting(id)) return; deadline.Change(3000, Timeout.Infinite); }
                                try { Send(Json.Obj("method", "session/cancel", "params", Json.Obj("sessionId", sessionId))); }
                                catch { lock (gate) if (Waiting(id)) Stop(); }
                            }, null, Timeout.Infinite, true);
                        }
                        Send(Json.Obj("id", id, "method", method, "params", parameters));
                    }
                    var wait = Stopwatch.StartNew();
                    Dictionary<string, object> reply;
                    lock (gate) {
                        while ((reply = replies[id]) == null) {
                            CheckOpen();
                            int ms = cancel != null ? Timeout.Infinite : Math.Max(0, 30000 - (int)wait.ElapsedMilliseconds);
                            if (!Monitor.Wait(gate, ms)) throw new InvalidOperationException("Antigravity timed out during " + method + ".");
                        }
                        CheckOpen();
                    }
                    var error = Json.Map(Json.Get(reply, "error"));
                    if (error != null) {
                        string message = Json.Text(error, "message"), code = Convert.ToString(Json.Get(error, "code"));
                        object data = Json.Get(error, "data");
                        string extra = data as string ?? Json.Text(Json.Map(data), "details");
                        if (extra == "") extra = Json.Text(Json.Map(data), "message");
                        if (extra != "") message += " " + extra;
                        if (message.Length > 4096) message = message.Substring(0, 4096);
                        string detail = message.ToLowerInvariant().Replace('_', ' ').Replace('-', ' ');
                        if (method == "session/new" && (code == "401" || detail == "unauthorized" || Regex.IsMatch(detail,
                            @"\b(401 unauthorized|auth(?:entication)? (?:required|failed)|unauthenticated|not (?:authenticated|logged in|signed in)|(?:log ?in|sign ?in) required|(?:please|must|need to) (?:log ?in|sign ?in)|agy (?:auth )?login)\b"))) throw new LoginRequired();
                        string errorText = "Antigravity rejected " + method + " (code " + code + "): " + message;
                        if (method == "session/prompt") {
                            string subject = message.ToLowerInvariant().Replace(sessionId.ToLowerInvariant(), "").Replace('_', ' ').Replace('-', ' ');
                            if (Regex.IsMatch(subject, @"\b(?:unknown|invalid|expired|missing|no(?: such| active)?) (?:session|conversation)\b|\b(?:session|conversation)(?: id)?[\s:'""]*(?:(?:was|is|has) )?(?:not found|does not exist|doesn't exist|expired)\b")) throw new SessionMissing(errorText);
                        }
                        throw new InvalidOperationException(errorText);
                    }
                    var result = Json.Map(Json.Get(reply, "result"));
                    if (result == null) throw new IOException("Invalid ACP result.");
                    return result;
                } finally {
                    lock (gate) replies.Remove(id);
                    if (registration != null) registration.Unregister(null);
                    if (deadline != null) deadline.Dispose();
                }
            }
            private bool Waiting(int id) {
                Dictionary<string, object> reply;
                return !closed && replies.TryGetValue(id, out reply) && reply == null;
            }
            private void CheckOpen() {
                if (ToolViolation) throw new InvalidOperationException(ToolError);
                if (closed) throw new IOException("Antigravity connection closed.");
            }
            private void Read() {
                try {
                    string line;
                    while ((line = CodexClient.ReadBoundedLine(child.StandardOutput, 16 * 1024 * 1024)) != null) {
                        var msg = Json.Parse(line); string method = Json.Text(msg, "method"); object id = Json.Get(msg, "id"); var p = Json.Map(Json.Get(msg, "params"));
                        if (method != "" && id != null) Respond(method, id, p);
                        else if (method == "session/update") Update(p);
                        else if (method == "" && id != null) lock (gate) {
                            if (id is int && Waiting((int)id)) { replies[(int)id] = msg; Monitor.PulseAll(gate); }
                        }
                    }
                } catch { }
                finally {
                    string[] ids;
                    lock (gate) {
                        if (!closed && deadlines.Count > 0) ToolViolation = true;
                        Stop(); idle.Clear(); chatting = null;
                        ids = new List<string>(sessions.Keys).ToArray(); sessions.Clear();
                    }
                    child.WaitForExit(5000);
                    foreach (string id in ids) CleanRecords(id);
                }
            }
            private void Respond(string method, object id, Dictionary<string, object> p) {
                if (method != "session/request_permission") { Send(Json.Obj("id", id, "error", Json.Obj("code", -32601, "message", "Unsupported method."))); return; }
                var outcome = Json.Obj("outcome", "cancelled");
                foreach (object item in Json.Items(Json.Get(p, "options"))) {
                    var option = Json.Map(item); string choice = Json.Text(option, "optionId");
                    if (Json.Text(option, "kind") == "reject_once" && choice != "") { outcome = Json.Obj("outcome", "selected", "optionId", choice); break; }
                }
                Send(Json.Obj("id", id, "result", Json.Obj("outcome", outcome)));
            }
            private void Update(Dictionary<string, object> p) {
                var update = Json.Map(Json.Get(p, "update")); string kind = Json.Text(update, "sessionUpdate");
                if (kind == "tool_call" || kind == "tool_call_update") {
                    lock (gate) {
                        if (closed) return;
                        string status = Json.Text(update, "status"), id = Json.Text(p, "sessionId") + "\0" + Json.Text(update, "toolCallId");
                        if (status == "completed") { StopTool(); return; }
                        CheckTools(null);
                        if (closed) return;
                        if (status == "in_progress" && !deadlines.ContainsKey(id)) deadlines.Add(id, uptime.ElapsedMilliseconds + 500);
                        if (status == "failed") deadlines.Remove(id);
                        ScheduleCheck(); Monitor.PulseAll(gate);
                    }
                    return;
                }
                if (kind != "agent_message_chunk" && kind != "agent_thought_chunk") return;
                var content = Json.Map(Json.Get(update, "content"));
                if (Json.Text(content, "type") != "text") return;
                string text = Json.Text(content, "text"), target;
                lock (gate) {
                    Session entry;
                    if (closed || !sessions.TryGetValue(Json.Text(p, "sessionId"), out entry) || entry.RequestId == null || text == "") return;
                    target = entry.RequestId;
                    if (entry.FirstMs < 0) entry.FirstMs = entry.Clock.ElapsedMilliseconds;
                    if (kind == "agent_message_chunk" && entry.AnswerMs < 0) entry.AnswerMs = entry.Clock.ElapsedMilliseconds;
                }
                for (int at = 0; at < text.Length;) {
                    int count = Math.Min(32768, text.Length - at);
                    if (at + count < text.Length && Char.IsHighSurrogate(text[at + count - 1])) count--;
                    frames.Write(Json.Obj("id", target, "event", kind == "agent_message_chunk" ? "delta" : "reasoning", "text", text.Substring(at, count))); at += count;
                }
            }
            private void ScheduleCheck() {
                long first = long.MaxValue; foreach (long due in deadlines.Values) first = Math.Min(first, due);
                watchdog.Change(first == long.MaxValue ? Timeout.Infinite : (int)Math.Max(0, first - uptime.ElapsedMilliseconds), Timeout.Infinite);
            }
            private void CheckTools(object state) {
                lock (gate) {
                    if (closed) return;
                    foreach (long due in deadlines.Values) if (uptime.ElapsedMilliseconds >= due) { StopTool(); return; }
                    ScheduleCheck();
                }
            }
            private void StopTool() { ToolViolation = true; Stop(); }
            private void Stop() { closed = true; job.Dispose(); Monitor.PulseAll(gate); }
            internal bool StopAndWait() {
                lock (gate) Stop();
                watchdog.Dispose();
                if (!child.WaitForExit(5000)) return false;
                if (reader.Join(5000)) child.Dispose();
                return true;
            }
        }
        private sealed class LoginRequired : InvalidOperationException { internal LoginRequired() : base("Antigravity requires login.") { } }
        private sealed class SessionMissing : InvalidOperationException { internal SessionMissing(string message) : base(message) { } }
    }
}
