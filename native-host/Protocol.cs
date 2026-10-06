using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace PdfCopilot {
    internal static class Json {
        internal static Dictionary<string, object> Obj(params object[] fields) {
            var value = new Dictionary<string, object>();
            for (int i = 0; i < fields.Length; i += 2) value.Add((string)fields[i], fields[i + 1]);
            return value;
        }
        internal static object Get(IDictionary<string, object> value, string key) {
            object found; return value != null && value.TryGetValue(key, out found) ? found : null;
        }
        internal static Dictionary<string, object> Map(object value) { return value as Dictionary<string, object>; }
        internal static string Str(object value) { return value as string ?? ""; }
        internal static string Text(IDictionary<string, object> value, string key) { return Str(Get(value, key)); }
        internal static IEnumerable<object> Items(object value) {
            var items = value as IEnumerable;
            if (items != null && !(value is string) && !(value is IDictionary))
                foreach (object item in items) yield return item;
        }
        internal static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024, RecursionLimit = 64 }; }
        internal static Dictionary<string, object> Parse(string value) {
            var parsed = Map(Serializer().DeserializeObject(value));
            if (parsed == null) throw new InvalidDataException("Expected a JSON object.");
            return parsed;
        }
        internal static string Encode(object value) { return Serializer().Serialize(value); }
    }

    // Chromium native messaging uses an unsigned 32-bit little-endian byte count.
    internal sealed class NativeFrames {
        internal const int MaxInput = 12 * 1024 * 1024;
        internal const int MaxOutput = 1024 * 1024;
        private readonly Stream input, output;
        private readonly object outputLock = new object();
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        internal NativeFrames(Stream input, Stream output) { this.input = input; this.output = output; }
        private static bool ReadExactly(Stream stream, byte[] buffer, bool allowEof) {
            int at = 0;
            while (at < buffer.Length) {
                int count = stream.Read(buffer, at, buffer.Length - at);
                if (count == 0) {
                    if (allowEof && at == 0) return false;
                    throw new InvalidDataException("Truncated native message.");
                }
                at += count;
            }
            return true;
        }
        internal Dictionary<string, object> Read() {
            var header = new byte[4];
            if (!ReadExactly(input, header, true)) return null;
            uint length = (uint)(header[0] | header[1] << 8 | header[2] << 16 | header[3] << 24);
            if (length == 0 || length > MaxInput) throw new InvalidDataException("Native message exceeds the allowed size.");
            var bytes = new byte[(int)length]; ReadExactly(input, bytes, false);
            try { return Json.Parse(Utf8.GetString(bytes)); }
            finally { Array.Clear(bytes, 0, bytes.Length); }
        }
        internal void Write(object value) {
            byte[] bytes = Utf8.GetBytes(Json.Encode(value));
            if (bytes.Length >= MaxOutput) throw new InvalidDataException("Native response exceeds the browser limit.");
            byte[] header = { (byte)bytes.Length, (byte)(bytes.Length >> 8), (byte)(bytes.Length >> 16), (byte)(bytes.Length >> 24) };
            lock (outputLock) { output.Write(header, 0, 4); output.Write(bytes, 0, bytes.Length); output.Flush(); }
        }
    }

    internal sealed class ClientRequest {
        internal string Id, Type, TargetId, Model, Effort, Text, CallId;
        internal bool PdfTools, PdfVision;
        internal DocumentBudget PdfLimits = new DocumentBudget();
        internal readonly List<object> History = new List<object>();
        internal readonly List<string> Images = new List<string>();
        internal static ClientRequest Parse(Dictionary<string, object> value) {
            var allowed = new HashSet<string> { "id", "type", "targetId", "model", "effort", "text", "history", "images", "pdfTools", "pdfVision", "pdfLimits", "callId" };
            foreach (string key in value.Keys) if (!allowed.Contains(key)) throw new InvalidDataException("Unsupported request field.");
            var req = new ClientRequest { Id = Json.Text(value, "id"), Type = Json.Text(value, "type"), TargetId = Json.Text(value, "targetId"), Model = Json.Text(value, "model"), Effort = Json.Text(value, "effort"), Text = Json.Text(value, "text") };
            if (req.Id.Length < 1 || req.Id.Length > 128 || req.Id.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("Invalid request ID.");
            if (!new HashSet<string> { "status", "models", "chat", "cancel", "tool-result" }.Contains(req.Type)) throw new InvalidDataException("Unsupported message type.");
            foreach (string key in new[] { "pdfTools", "pdfVision" }) if (value.ContainsKey(key) && !(value[key] is bool)) throw new InvalidDataException("Invalid PDF capability flag.");
            req.PdfTools = Json.Get(value, "pdfTools") is bool && (bool)Json.Get(value, "pdfTools");
            req.PdfVision = Json.Get(value, "pdfVision") is bool && (bool)Json.Get(value, "pdfVision");
            if (value.ContainsKey("pdfLimits")) {
                if (req.Type != "chat" || !req.PdfTools) throw new InvalidDataException("PDF resource limits require a PDF chat.");
                req.PdfLimits = DocumentBudget.Parse(value["pdfLimits"]);
            }
            req.CallId = Json.Text(value, "callId");
            if (req.Type != "chat" && (value.ContainsKey("pdfTools") || value.ContainsKey("pdfVision"))) throw new InvalidDataException("PDF tools require a chat.");
            if (req.Type == "tool-result" && (req.CallId.Length < 1 || req.CallId.Length > 128 || req.TargetId.Length < 1 || req.TargetId.Length > 128 || req.Text.Length > 100000)) throw new InvalidDataException("Invalid PDF tool response.");
            if (req.Type != "tool-result" && value.ContainsKey("callId")) throw new InvalidDataException("Unexpected tool response ID.");
            if (req.Model.Length > 160 || req.Model.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) throw new InvalidDataException("Invalid model.");
            if (req.Effort != "" && !new HashSet<string> { "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra" }.Contains(req.Effort)) throw new InvalidDataException("Invalid reasoning effort.");
            if (req.Text.Length > 512000) throw new InvalidDataException("Text is too long.");
            foreach (string key in new[] { "targetId", "model", "effort", "text" })
                if (value.ContainsKey(key) && !(value[key] is string)) throw new InvalidDataException("Invalid text field.");
            foreach (string key in new[] { "history", "images" })
                if (value.ContainsKey(key) && !(value[key] is object[])) throw new InvalidDataException("Invalid attachment/history list.");
            int historyChars = 0;
            foreach (object item in Json.Items(Json.Get(value, "history"))) {
                var turn = Json.Map(item); string role = Json.Text(turn, "role"), content = Json.Text(turn, "content");
                if (turn == null || turn.Count != 2 || (role != "user" && role != "assistant") || !(Json.Get(turn, "content") is string)) throw new InvalidDataException("Invalid conversation history.");
                historyChars += content.Length;
                if (req.History.Count >= 40 || historyChars > 512000) throw new InvalidDataException("Conversation history is too long.");
                req.History.Add(Json.Obj("role", role, "content", content));
            }
            int imageChars = 0;
            foreach (object item in Json.Items(Json.Get(value, "images"))) {
                string image = Json.Str(item); int comma = image.IndexOf(',');
                if (comma < 1 || !new HashSet<string> { "data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64" }.Contains(image.Substring(0, comma))) throw new InvalidDataException("Only inline PNG, JPEG, or WebP images are accepted.");
                if (image.Length > 4 * 1024 * 1024 || req.Images.Count >= 14) throw new InvalidDataException("Image is too large.");
                byte[] decoded;
                try { decoded = Convert.FromBase64String(image.Substring(comma + 1)); }
                catch (FormatException) { throw new InvalidDataException("Invalid image encoding."); }
                if (decoded.Length == 0) throw new InvalidDataException("Empty image.");
                Array.Clear(decoded, 0, decoded.Length);
                imageChars += image.Length;
                if (imageChars > 8 * 1024 * 1024) throw new InvalidDataException("Image attachments are too large.");
                req.Images.Add(image);
            }
            if (req.Type == "chat" && req.Text.Trim().Length == 0 && req.Images.Count == 0) throw new InvalidDataException("A chat needs text or an image.");
            if (req.Type == "cancel" && (req.TargetId.Length < 1 || req.TargetId.Length > 128)) throw new InvalidDataException("A cancellation needs a target ID.");
            return req;
        }
    }
}
