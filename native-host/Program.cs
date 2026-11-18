using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading;

namespace PdfCopilot {
    internal static class Program {
        private static int Main(string[] args) {
            if (args.Length > 0 && args[0] == "--fake-app-server") return ProtocolFixture.Run(args.Length > 1 ? args[1] : "normal");
            if (args.Length > 0 && args[0] == "--self-test") return SelfTest();
            try {
                string testMode = null, codexPath = null;
                bool verifyDocumentTools = args.Length == 1 && args[0] == "--verify-document-tools";
                bool verifyIsolation = args.Length == 1 && (args[0] == "--verify-isolation" || verifyDocumentTools);
                var configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "host-config.json");
                Dictionary<string, object> config = File.Exists(configPath) ? Json.Parse(File.ReadAllText(configPath)) : Json.Obj();
                if (args.Length > 0 && args[0] == "--test-server") {
                    if (args.Length != 2) throw new InvalidDataException("Invalid protocol test arguments.");
                    testMode = args[1]; codexPath = Assembly.GetExecutingAssembly().Location;
                } else {
                    if (args.Length > 0 && args[0].StartsWith("chrome-extension://", StringComparison.Ordinal)) {
                        bool allowed = false;
                        foreach (object origin in Json.Items(Json.Get(config, "allowedOrigins"))) if (Json.Str(origin) == args[0]) allowed = true;
                        if (!allowed) throw new InvalidOperationException("This extension is not registered with PDF Copilot.");
                    } else if (args.Length > 0 && !verifyIsolation) throw new InvalidDataException("Unsupported host arguments.");
                    codexPath = Json.Text(config, "codexPath");
                    if (codexPath == "") codexPath = DiscoverCodex();
                    // Keep the native connection available for useful status diagnostics even
                    // after a configured executable is moved or removed. No process is launched
                    // until CodexClient validates the absolute Windows executable path.
                }
                var frames = new NativeFrames(Console.OpenStandardInput(), Console.OpenStandardOutput());
                using (var client = new CodexClient(codexPath, frames, testMode)) {
                    if (verifyIsolation) {
                        client.VerifyIsolation(verifyDocumentTools); Console.WriteLine("Codex ephemeral/read-only/no-environment" + (verifyDocumentTools ? "/PDF-tools" : "") + " handshake passed; no inference was started."); return 0;
                    }
                    while (true) {
                        Dictionary<string, object> message;
                        try { message = frames.Read(); }
                        catch { Console.Error.WriteLine("PDF Copilot: invalid native message; connection closed."); return 2; }
                        if (message == null) return 0;
                        ClientRequest request;
                        try { request = ClientRequest.Parse(message); }
                        catch (InvalidDataException e) { frames.Write(Json.Obj("id", SafeId(message), "ok", false, "error", e.Message)); continue; }
                        if (request.Type == "cancel") {
                            bool cancelled = client.Cancel(request.TargetId);
                            frames.Write(Json.Obj("id", request.Id, "ok", true, "result", Json.Obj("cancelled", cancelled))); continue;
                        }
                        if (request.Type == "tool-result") {
                            try { client.CompleteDocumentTool(request); frames.Write(Json.Obj("id", request.Id, "ok", true, "result", Json.Obj())); }
                            catch (InvalidOperationException e) { frames.Write(Json.Obj("id", request.Id, "ok", false, "error", e.Message)); }
                            continue;
                        }
                        if (request.Type == "chat") {
                            try { client.PrepareChat(request.Id); }
                            catch (InvalidOperationException e) { frames.Write(Json.Obj("id", request.Id, "event", "error", "error", e.Message)); continue; }
                        }
                        ThreadPool.QueueUserWorkItem(delegate(object state) {
                            var req = (ClientRequest)state;
                            try {
                                if (req.Type == "chat") {
                                    client.Chat(req); frames.Write(Json.Obj("id", req.Id, "event", "done"));
                                    // Prepare the next conversation of the same kind right away: follow-up questions start without the set-up wait.
                                    try { client.Warm(req.Model, req.PdfTools, req.PdfVision); } catch { }
                                }
                                else if (req.Type == "warm") { client.Warm(req.Model, req.PdfTools, req.PdfVision); frames.Write(Json.Obj("id", req.Id, "ok", true, "result", Json.Obj())); }
                                else frames.Write(Json.Obj("id", req.Id, "ok", true, "result", req.Type == "status" ? client.Status() : client.Models()));
                            } catch (Exception e) {
                                string error = e is InvalidOperationException || e is FileNotFoundException ? e.Message : "The Codex helper could not complete this request. Check the Codex installation and reconnect.";
                                try { frames.Write(req.Type == "chat" ? Json.Obj("id", req.Id, "event", "error", "error", error) : Json.Obj("id", req.Id, "ok", false, "error", error)); } catch { }
                            }
                        }, request);
                    }
                }
            } catch (Exception e) {
                // Before a browser connection is available, diagnostics are generic and contain no data.
                Console.Error.WriteLine("PDF Copilot: " + (e is FileNotFoundException || e is InvalidOperationException ? e.Message : "Could not initialize native helper."));
                return 1;
            }
        }
        private static string SafeId(Dictionary<string, object> message) {
            string id = Json.Text(message, "id"); return id.Length <= 128 ? id : "";
        }
        // Candidates: the engine bundled with the Codex desktop app, then every codex.exe on PATH. The newest version wins.
        // Codex keeps on-disk caches (the model list among them) that an older engine cannot read once a newer one has
        // written them, so an older engine refetches on every conversation; the newest installed one is the one that wrote them.
        private static string DiscoverCodex() {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string[] roots = new string[] {
                Path.Combine(local, "OpenAI", "Codex"), Path.Combine(local, "Programs", "Codex"), Path.Combine(local, "Programs", "OpenAI Codex"),
                Path.Combine(local, "Programs", "OpenAI", "Codex"), Path.Combine(programs, "OpenAI", "Codex"), Path.Combine(programs, "Codex")
            };
            var candidates = new List<string>();
            foreach (string root in roots) CollectCodex(root, 0, false, candidates);
            candidates.Sort(delegate(string a, string b) { return File.GetLastWriteTimeUtc(b).CompareTo(File.GetLastWriteTimeUtc(a)); });
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string directory in path.Split(Path.PathSeparator)) {
                try {
                    string candidate = Path.Combine(directory.Trim('"'), "codex.exe");
                    if (!Path.IsPathRooted(candidate) || !File.Exists(candidate)) continue;
                    candidate = Path.GetFullPath(candidate);
                    bool known = false;
                    foreach (string seen in candidates) if (String.Equals(seen, candidate, StringComparison.OrdinalIgnoreCase)) known = true;
                    if (!known) candidates.Add(candidate);
                } catch { }
            }
            string best = null; Version bestVersion = null; int probed = 0;
            foreach (string candidate in candidates) {
                if (probed++ >= 5) break;
                Version found = ProbeVersion(candidate);
                if (found != null && (bestVersion == null || found > bestVersion)) { best = candidate; bestVersion = found; }
            }
            if (best != null) return best;
            return candidates.Count > 0 ? candidates[0] : null;
        }
        private static Version ProbeVersion(string path) {
            try {
                var info = new System.Diagnostics.ProcessStartInfo(path, "--version") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                using (var child = System.Diagnostics.Process.Start(info)) {
                    if (!child.WaitForExit(4000)) { try { child.Kill(); } catch { } return null; }
                    Version parsed;
                    return CodexVersion.TryParse(child.StandardOutput.ReadToEnd().Trim(), out parsed) ? parsed : null;
                }
            } catch { return null; }
        }
        // Only accept codex.exe below a bin / resources / vendor directory: the desktop app's own window
        // executable may also be named Codex.exe and must never be started as the command-line engine.
        private static void CollectCodex(string directory, int depth, bool inside, List<string> found) {
            try {
                if (depth > 6 || found.Count >= 32 || !Directory.Exists(directory)) return;
                if (inside) { string candidate = Path.Combine(directory, "codex.exe"); if (File.Exists(candidate)) found.Add(candidate); }
                foreach (string child in Directory.GetDirectories(directory)) {
                    string name = Path.GetFileName(child).ToLowerInvariant();
                    CollectCodex(child, depth + 1, inside || name == "bin" || name == "resources" || name == "vendor", found);
                }
            } catch { }
        }
        private static int SelfTest() {
            try {
                using (var stream = new MemoryStream()) {
                    var frames = new NativeFrames(stream, stream); frames.Write(Json.Obj("id", "汉字", "type", "status")); stream.Position = 0;
                    if (Json.Text(frames.Read(), "id") != "汉字") throw new Exception();
                }
                ClientRequest.Parse(Json.Obj("id", "test", "type", "chat", "text", "你好", "images", new[] { "data:image/png;base64,iVBORw==" }));
                bool rejected = false;
                try { ClientRequest.Parse(Json.Obj("id", "test", "type", "shell", "command", "anything")); } catch (InvalidDataException) { rejected = true; }
                if (!rejected) throw new Exception();
                if (!CodexVersion.IsCompatible("codex-cli 0.159.2-alpha.1+build.7") || !CodexVersion.IsCompatible("codex-cli 0.160.0+windows.1") || CodexVersion.IsCompatible("codex-cli 0.149.1") || CodexVersion.IsCompatible("codex-cli unknown")) throw new Exception();
                Console.WriteLine("PDF Copilot native helper self-test passed."); return 0;
            } catch { Console.Error.WriteLine("PDF Copilot native helper self-test failed."); return 3; }
        }
    }
}
