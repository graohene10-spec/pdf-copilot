using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

namespace PdfCopilot {
    internal sealed class DocumentBudget {
        internal int Calls = 12, Images = 5, Characters = 24000;
        internal int EncodedCharacters { get { return Math.Min(3 * 1024 * 1024, Characters * 4 + Calls * 50000); } }
        internal static DocumentBudget Parse(object value) {
            var result = new DocumentBudget();
            var map = Json.Map(value);
            if (map == null) throw new InvalidDataException("Invalid PDF resource limits.");
            foreach (string key in map.Keys) if (key != "calls" && key != "images" && key != "characters") throw new InvalidDataException("Unknown PDF resource limit.");
            result.Calls = Number(map, "calls", 0, 60, result.Calls);
            result.Images = Number(map, "images", 0, 10, result.Images);
            result.Characters = Number(map, "characters", 1000, 120000, result.Characters);
            return result;
        }
        private static int Number(Dictionary<string, object> map, string key, int min, int max, int fallback) {
            if (!map.ContainsKey(key)) return fallback;
            object value = map[key];
            if (!(value is int) || (int)value < min || (int)value > max) throw new InvalidDataException("Invalid PDF resource limit.");
            return (int)value;
        }
    }
    internal sealed class PendingDocumentCall {
        internal object RpcId;
        internal string Token, Tool;
        internal readonly ManualResetEvent Ready = new ManualResetEvent(false);
    }
    internal static class DocumentTools {
        internal static bool Allowed(string name, bool vision) {
            return name == "pdf_info" || name == "pdf_search" || name == "pdf_read" || (vision && name == "pdf_view");
        }
        private static object Integer(bool nullable) { return Json.Obj("type", nullable ? (object)new[] { "integer", "null" } : "integer"); }
        private static object String(bool nullable) { return Json.Obj("type", nullable ? (object)new[] { "string", "null" } : "string"); }
        private static object Spec(string name, string description, Dictionary<string, object> properties) {
            var required = new List<string>(properties.Keys);
            return Json.Obj("type", "function", "name", name, "description", description, "inputSchema", Json.Obj("type", "object", "properties", properties, "required", required, "additionalProperties", false));
        }
        internal static object[] Specs(bool vision) {
            var specs = new List<object>();
            specs.Add(Spec("pdf_info", "Read the current PDF metadata and paginated outline. Physical PDF pages are 1-based, not printed page labels.", Json.Obj("outline_offset", Integer(true))));
            specs.Add(Spec("pdf_search", "Search locally for terms, phrases or equation numbers. Check coverage and next_page; partial search cannot establish absence. Return evidence IDs for citation.", Json.Obj("query", String(false), "start_page", Integer(true), "end_page", Integer(true), "next_page", Integer(true))));
            specs.Add(Spec("pdf_read", "Read at most 3 physical PDF pages or surrounding paragraphs of a returned block_id. Cite the supplied sourceId as [sourceId]. Formula text may be incomplete.", Json.Obj("start_page", Integer(false), "end_page", Integer(true), "block_id", String(true))));
            if (vision) specs.Add(Spec("pdf_view", "View a PDF page or a local crop identified by a returned block_id. Images remain in memory. Use to verify formulas, figures or scanned pages.", Json.Obj("page", Integer(false), "block_id", String(true))));
            return specs.ToArray();
        }
        internal static void CheckArguments(string name, Dictionary<string, object> args) {
            if (args == null || Json.Encode(args).Length > 8192) throw new InvalidDataException("Invalid PDF tool arguments.");
            var keys = new HashSet<string>(name == "pdf_info" ? new[] { "outline_offset" } : name == "pdf_search" ? new[] { "query", "start_page", "end_page", "next_page" } : name == "pdf_read" ? new[] { "start_page", "end_page", "block_id" } : new[] { "page", "block_id" });
            foreach (string key in args.Keys) if (!keys.Contains(key)) throw new InvalidDataException("Unknown PDF tool argument.");
        }
    }
}
