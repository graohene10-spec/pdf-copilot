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
            string line;
            while ((line = Console.ReadLine()) != null) {
                var message = Json.Parse(line); object id = Json.Get(message, "id"); string method = Json.Text(message, "method");
                var parameters = Json.Map(Json.Get(message, "params")); object result = Json.Obj();
                if (method == "initialize") result = Json.Obj("userAgent", "protocol-fixture");
                else if (method == "initialized") continue;
                else if (method == "config/read") result = Json.Obj("config", Json.Obj("mcp_servers", Json.Obj("example", Json.Obj("enabled", true)), "features", Json.Obj("shell_tool", false, "plugins", false), "plugins", Json.Obj("example", Json.Obj("enabled", true))));
                else if (method == "account/read") {
                    if (mode == "status-failed") { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32000, "message", "credential_must_not_be_forwarded"))); continue; }
                    result = Json.Obj("account", Json.Obj("type", "chatgpt"), "requiresOpenaiAuth", true);
                }
                else if (method == "model/list") result = Json.Obj("data", new[] { Json.Obj("id", "fixture", "model", "fixture-model", "displayName", "Fixture Model", "hidden", false, "supportedReasoningEfforts", new[] { Json.Obj("reasoningEffort", "low"), Json.Obj("reasoningEffort", "high") }, "defaultReasoningEffort", "low", "inputModalities", new[] { "text", "image" }) }, "nextCursor", null);
                else if (method == "thread/start") {
                    var config = Json.Map(Json.Get(parameters, "config")); var features = Json.Map(Json.Get(config, "features")); var servers = Json.Map(Json.Get(config, "mcp_servers"));
                    bool safe = Json.Text(parameters, "sandbox") == "read-only" && Json.Text(parameters, "approvalPolicy") == "never" && (bool)Json.Get(parameters, "ephemeral") && !(bool)Json.Get(features, "shell_tool") && !(bool)Json.Get(Json.Map(Json.Get(servers, "example")), "enabled");
                    if (!safe) { Emit(Json.Obj("id", id, "error", Json.Obj("code", -32000, "message", "Unsafe fixture configuration."))); continue; }
                    result = Json.Obj("thread", Json.Obj("id", "fixture-thread", "ephemeral", mode != "ephemeral-refused"), "sandbox", Json.Obj("type", mode == "sandbox-refused" ? "dangerFullAccess" : "readOnly", "networkAccess", false), "approvalPolicy", "never");
                } else if (method == "turn/start") {
                    var sandbox = Json.Map(Json.Get(parameters, "sandboxPolicy"));
                    if (Json.Text(sandbox, "type") != "readOnly" || (bool)Json.Get(sandbox, "networkAccess")) return 5;
                    if (mode == "lost-child") return 6;
                    result = Json.Obj("turn", Json.Obj("id", "fixture-turn", "status", "inProgress"));
                    Emit(Json.Obj("id", id, "result", result));
                    if (mode == "tool") Emit(Json.Obj("method", "item/commandExecution/requestApproval", "id", "fixture-approval", "params", Json.Obj("threadId", "fixture-thread")));
                    else if (mode == "tool-event") Emit(Json.Obj("method", "item/started", "params", Json.Obj("threadId", "fixture-thread", "item", Json.Obj("type", "fileChange"))));
                    else if (mode == "hanging") Emit(Json.Obj("method", "item/reasoning/summaryTextDelta", "params", Json.Obj("threadId", "fixture-thread", "delta", "Fixture waiting.")));
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
    }
}
