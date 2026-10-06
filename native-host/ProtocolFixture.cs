using System;
using System.Collections.Generic;
using System.Threading;

namespace PdfCopilot {
    // In-process deterministic app-server fixture. Explicit test CLI only; never uses the network.
    internal static class ProtocolFixture {
        private static readonly object Gate = new object();
        private static bool cancelled;
        private static void Emit(object value) { lock (Gate) { Console.WriteLine(Json.Encode(value)); Console.Out.Flush(); } }
        internal static int Run(string mode) {
            Console.InputEncoding = System.Text.Encoding.UTF8; Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            string line; int documentPage = 1;
            while ((line = Console.ReadLine()) != null) {
                var message = Json.Parse(line); object id = Json.Get(message, "id"); string method = Json.Text(message, "method");
                var parameters = Json.Map(Json.Get(message, "params")); object result = Json.Obj();
                if (method == "" && Convert.ToString(id).StartsWith("fixture-pdf-call", StringComparison.Ordinal)) {
                    var toolResult = Json.Map(Json.Get(message, "result"));
                    if (toolResult == null) return 8;
                    if (mode == "document-five-images" && Json.Get(toolResult, "success") is bool && (bool)Json.Get(toolResult, "success") && documentPage < 5) {
                        EmitDocumentImage(++documentPage); continue;
                    }
                    Emit(Json.Obj("method", "item/agentMessage/delta", "params", Json.Obj("threadId", "fixture-thread", "delta", "已读取原文 [Sfixture-1]。")));
                    Emit(Json.Obj("method", "turn/completed", "params", Json.Obj("threadId", "fixture-thread", "turn", Json.Obj("id", "fixture-turn", "status", "completed")))); continue;
                }
                if (method == "initialize") result = Json.Obj("userAgent", "protocol-fixture");
                else if (method == "initialized") continue;
                else if (method == "config/read") result = Json.Obj("config", Json.Obj("mcp_servers", Json.Obj("example", Json.Obj("enabled", true)), "features", Json.Obj("shell_tool", false, "plugins", false), "plugins", Json.Obj("example", Json.Obj("enabled", true))));
                else if (method == "account/read") {
                    if (mode == "status-failed") { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32000, "message", "credential_must_not_be_forwarded"))); continue; }
                    result = Json.Obj("account", Json.Obj("type", "chatgpt"), "requiresOpenaiAuth", true);
                }
                else if (method == "model/list") result = Json.Obj("data", new[] { Json.Obj("id", "fixture", "model", "fixture-model", "displayName", "Fixture Model", "hidden", false, "supportedReasoningEfforts", new[] { Json.Obj("reasoningEffort", "low"), Json.Obj("reasoningEffort", "high") }, "defaultReasoningEffort", "low", "inputModalities", new[] { "text", "image" }) }, "nextCursor", null);
                else if (method == "thread/start") {
                    if (mode == "document-unsupported" && Json.Get(parameters, "dynamicTools") != null) { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32602, "message", "dynamicTools not supported"))); continue; }
                    var config = Json.Map(Json.Get(parameters, "config")); var features = Json.Map(Json.Get(config, "features")); var servers = Json.Map(Json.Get(config, "mcp_servers"));
                    bool safe = Json.Text(parameters, "sandbox") == "read-only" && Json.Text(parameters, "approvalPolicy") == "never" && (bool)Json.Get(parameters, "ephemeral") && !(bool)Json.Get(features, "shell_tool") && !(bool)Json.Get(Json.Map(Json.Get(servers, "example")), "enabled");
                    foreach (string feature in CodexClient.DisabledFeatures) safe &= Json.Get(features, feature) is bool && !(bool)Json.Get(features, feature);
                    safe &= Json.Get(features, "code_mode_host") is bool && (bool)Json.Get(features, "code_mode_host");
                    safe &= Json.Get(parameters, "environments") != null && !Json.Items(Json.Get(parameters, "environments")).GetEnumerator().MoveNext();
                    if (!safe) { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32000, "message", "Unsafe fixture configuration."))); continue; }
                    result = Json.Obj("thread", Json.Obj("id", "fixture-thread", "ephemeral", mode != "ephemeral-refused"), "sandbox", Json.Obj("type", mode == "sandbox-refused" ? "dangerFullAccess" : "readOnly", "networkAccess", false), "approvalPolicy", "never");
                } else if (method == "turn/start") {
                    var sandbox = Json.Map(Json.Get(parameters, "sandboxPolicy"));
                    if (Json.Text(sandbox, "type") != "readOnly" || (bool)Json.Get(sandbox, "networkAccess")) return 5;
                    if (Json.Get(parameters, "environments") == null || Json.Items(Json.Get(parameters, "environments")).GetEnumerator().MoveNext()) return 5;
                    if (mode == "lost-child") return 6;
                    result = Json.Obj("turn", Json.Obj("id", "fixture-turn", "status", "inProgress"));
                    Emit(Json.Obj("id", id, "result", result));
                    if (mode == "tool") Emit(Json.Obj("method", "item/commandExecution/requestApproval", "id", "fixture-approval", "params", Json.Obj("threadId", "fixture-thread")));
                    else if (mode == "tool-event") Emit(Json.Obj("method", "item/started", "params", Json.Obj("threadId", "fixture-thread", "item", Json.Obj("type", "fileChange"))));
                    else if (mode == "hanging") Emit(Json.Obj("method", "item/reasoning/summaryTextDelta", "params", Json.Obj("threadId", "fixture-thread", "delta", "Fixture waiting.")));
                    else if (mode.StartsWith("document-", StringComparison.Ordinal) && mode != "document-unsupported") {
                        if (mode == "document-five-images") { EmitDocumentImage(documentPage); continue; }
                        string tool = mode == "document-unknown" ? "shell" : mode == "document-image" ? "pdf_view" : "pdf_search";
                        var args = tool == "pdf_view" ? Json.Obj("page", 2, "block_id", null) : Json.Obj("query", "definition", "start_page", null, "end_page", null, "next_page", null);
                        Emit(Json.Obj("method", "item/started", "params", Json.Obj("threadId", "fixture-thread", "item", Json.Obj("type", "dynamicToolCall", "tool", tool))));
                        Emit(Json.Obj("method", "item/tool/call", "id", "fixture-pdf-call", "params", Json.Obj("threadId", mode == "document-foreign" ? "other-thread" : "fixture-thread", "turnId", "fixture-turn", "callId", "upstream-call", "tool", tool, "arguments", args)));
                    }
                    else {
                        Emit(Json.Obj("method", "item/agentMessage/delta", "params", Json.Obj("threadId", "other-thread", "delta", "MUST NOT BE FORWARDED")));
                        Emit(Json.Obj("method", "item/agentMessage/delta", "params", Json.Obj("threadId", "fixture-thread", "delta", "你好，PDF。")));
                        Emit(Json.Obj("method", "turn/completed", "params", Json.Obj("threadId", "fixture-thread", "turn", Json.Obj("id", "fixture-turn", "status", "completed"))));
                    }
                    continue;
                } else if (method == "turn/interrupt") {
                    cancelled = true;
                    Emit(Json.Obj("method", "turn/completed", "params", Json.Obj("threadId", "fixture-thread", "turn", Json.Obj("id", "fixture-turn", "status", "interrupted"))));
                } else if (method == "thread/unsubscribe") result = Json.Obj("status", "unsubscribed");
                else if (Json.Get(message, "error") != null) return 0;
                else { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32601, "message", "Unknown fixture method."))); continue; }
                Emit(Json.Obj("id", id, "result", result));
            }
            return cancelled ? 0 : 0;
        }
        private static void EmitDocumentImage(int page) {
            Emit(Json.Obj("method", "item/tool/call", "id", "fixture-pdf-call-" + page, "params", Json.Obj("threadId", "fixture-thread", "turnId", "fixture-turn", "callId", "upstream-" + page, "tool", "pdf_view", "arguments", Json.Obj("page", page, "block_id", null))));
        }
    }
}
