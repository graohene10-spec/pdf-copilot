# Windows Codex helper

This optional Native Messaging host lets PDF Copilot use an existing **Codex CLI login**. It never reads authentication files, copies tokens, exposes a local HTTP port, or saves document/image attachments. If `account/read` reports no account, run `codex login` with the same Windows user and the configured Windows Codex executable. The desktop app can use a different authentication configuration; an open desktop chat alone does not prove that a newly started CLI app-server has a reusable login.

The executable targets .NET Framework 4.x, which is part of supported Windows installations. No .NET SDK, npm runtime, NuGet package, or always-running service is needed on the user's machine. The build script uses the Windows .NET Framework compiler. Codex itself is a separate prerequisite; **Codex CLI 0.159.2 or newer** is this helper's verified compatibility baseline. Official prerelease/build suffixes such as `0.159.2-alpha.1` and `0.160.0+build.7` are recognized by their numeric baseline; the runtime permission/ephemeral checks still apply.

An older CLI and the desktop app can coexist at different paths. The helper uses its configured absolute executable path, which may differ from what `codex --version` in another terminal resolves. Connection diagnostics therefore report the **actual configured path and version**. Version incompatibility does not imply that the user is logged out. Update that executable or reinstall with `-CodexPath` pointing to the intended current executable, then reconnect the helper.

Codex 0.149.1 was investigated using its own generated experimental JSON schemas: it already has `thread/start.ephemeral` and both `thread/start.environments` and `turn/start.environments`; the latter explicitly describes an empty list as disabling environment access. Its schema bundle does not expose this helper's `thread/unsubscribe` lifecycle API, and the complete restricted lifecycle was not verified against that version. Consequently this release keeps its 0.159.2 baseline instead of assuming compatibility from a few matching fields. No real inference was used for this investigation.

## Build and install

From the project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-host.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-host.ps1 -ExtensionId YOUR_32_LETTER_EXTENSION_ID
```

The release installer automatically reads its bundled `extension-id.txt`; the source installer also accepts `dist/extension-id.txt` after a build. An explicit `-ExtensionId` takes precedence. Find a store/custom-build extension ID in `edge://extensions` or `chrome://extensions`. IDs contain exactly 32 lowercase letters from `a` through `p`. The default installs for Edge and Chrome for the current Windows user, without administrator privileges. Optional parameters:

- `-Browser Edge` or `-Browser Chrome` registers only that browser.
- `-CodexPath 'C:\path\to\codex.exe'` selects the actual Windows executable; `.cmd` shims and WSL executables are not accepted.
- `-EdgeExtensionId ... -ChromeExtensionId ...` allows distinct store IDs in addition to the required primary ID.
- `-WhatIf` previews filesystem/registry changes.

The host manifest and small configuration file are stored in `%LOCALAPPDATA%\PdfCopilot\NativeHost`. They contain only executable paths and exact extension origins. Registration uses `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.pdfcopilot.codex` and `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.pdfcopilot.codex`. The helper additionally checks the browser-supplied origin against its local allowlist.

To remove only this helper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall-host.ps1
```

Re-run installation after changing extension IDs or moving/updating a configured Codex executable. Do not run the helper directly for normal use: the browser controls its lifetime and communicates using length-prefixed binary frames.

## Connection protocol

Host name: `com.pdfcopilot.codex`. Browser requests:

```js
{ id, type: 'status' }
{ id, type: 'models' }
{ id, type: 'chat', model, effort, text,
  history: [{ role: 'user' | 'assistant', content: 'text' }],
  images: ['data:image/png;base64,...'], pdfTools: true, pdfVision: true,
  pdfLimits: { calls: 12, images: 5, characters: 24000 } }
{ id, type: 'tool-result', targetId: 'running-chat-id', callId,
  text: 'JSON evidence', images: ['data:image/jpeg;base64,...'] }
{ id, type: 'cancel', targetId: 'running-chat-id' }
```

Metadata/cancellation responses are `{ id, ok: true, result }` or `{ id, ok: false, error }`. A chat streams `{ id, event: 'delta', text }`, optional public reasoning summaries using `event: 'reasoning'`, then `event: 'done'`; failure uses `{ id, event: 'error', error }`. Cancellation ends the chat with `done`; its separate acknowledgement contains `result.cancelled`. There is one active chat per native connection. Use separate connections for simultaneous independent conversations.

`pdfTools` / `pdfVision` are optional and omitted for normal chat. PDF mode registers only `pdf_info`, `pdf_search`, `pdf_read`, and, for vision models, `pdf_view`. A server request becomes `{ id: chatId, event: 'tool', callId: opaqueToken, tool, arguments }`. The browser checks the current document and returns in-memory evidence via `tool-result`; no path, URL, shell, or arbitrary tool is accepted. Tokens bind to one chat/thread/turn and are consumed once. `pdfLimits` contains the remaining call/image budget and the configured body-character budget: calls 0–60, images 0–10, characters 1,000–120,000. Unknown or invalid fields are rejected. Without that field the host defaults to 12 calls / 5 tool images / 24,000 body characters. The browser also enforces evidence pages, text and image limits, counting the automatically supplied current page before forwarding remaining budgets. Each pending call times out after 45 seconds without blocking stdout. Encoded tool output has a separate metadata allowance derived from the budget and capped at 3 MiB characters; tool-image strings are bounded to 768,000 characters per allowed image. Cancel/disconnect releases pending calls. The extension observes rejected `tool-result` replies using their own request IDs instead of waiting for timeout.

An unsupported request field or rejected dynamic-tool registration triggers a compatibility marker before inference. The extension then asks for a bounded JSON reading plan, performs the same local retrieval and submits the evidence for the answer. Authentication, permission checks and network failures are not treated as tool incompatibility.

`status.result` is `{ version, path, compatible, requiredVersion, loggedIn, authType, diagnostic }`. `path` is the configured absolute local executable path for troubleshooting; `version` is its recognized `codex --version` output, or `null` when unavailable/unrecognized. `requiredVersion` is `"0.159.2"`; `compatible` is `true` for a recognized supported version, `false` for a recognized older version, and `null` when the executable is missing, the version check times out/fails, or its output cannot be recognized. The UI must not treat `null` as an older version. `loggedIn` is `null` when compatibility or connectivity prevents checking authentication; it is `false` only after a successful account check reports no account. `diagnostic` is `null` on a successful check, otherwise a safe human-readable explanation. A status response keeps `ok: true` for these diagnosable states so the UI can display the path/version without confusing an installation/upgrade problem with a login problem. The helper does not launch app-server for an incompatible or unknown version.

`models.result` contains `{ id, name, efforts, defaultEffort, vision }`; IDs are actual callable model names, not catalog row IDs. No user email, account identifier, raw upstream error body, credential, or upstream log is forwarded. The local path in status is intended only for the extension's troubleshooting UI; it is not document context and should never be included in model requests.

Requests are limited to 12 MiB before allocation; individual image data URLs to 4 MiB; total image strings to 8 MiB; 14 images per frame (allows compatible planned retrieval plus existing attachments); 512,000 current text characters and 40 history messages / 512,000 history characters. The chat UI still limits manual Codex attachments to four. PNG/JPEG/WebP inline base64 is accepted. URLs and local image paths are rejected. Native output is always below Chromium's 1 MiB per-message limit. Invalid/truncated framing closes the connection, while invalid supported-size messages return an error.

## Isolation and data lifetime

Each chat starts a fresh `ephemeral: true` thread and sends prior **text** conversation explicitly as quoted context. Images from prior turns are intentionally not retained by the helper. The returned ephemeral flag is checked before starting inference. On completion the host unsubscribes, with `thread_unload_delay_secs=0`; protocol failure or browser disconnection tears down the child process. A Windows job object kills descendants even when the helper itself exits unexpectedly.

Both `thread/start` and `turn/start` send `environments: []`. In the verified protocol this disables access to executor environments. This is necessary because Codex 0.159.2 does **not** have a universal `toolsDisabled` field and the model catalog can still advertise `apply_patch`. The apply-patch handler resolves an executor environment before touching its filesystem; an empty environment list cannot supply one. As additional controls, the helper disables shell/code mode, plugins/apps, hooks, browsing/computer use, local image viewing, workspace dependencies, image generation, multi-agent features, tool suggestions, goals/worktrees, memories, web search, project instructions, and notifications. It disables every inherited MCP/plugin entry explicitly and applies a read-only sandbox with network access off. Only allowlisted dynamic PDF tool calls for the active chat are forwarded; other server-initiated action/approval/credential requests are refused. Unexpected tool-item notifications stop the child process. Notification rejection is defense in depth; it is not claimed to be a general pre-execution permission boundary.

PDF tool mode enables `code_mode_host` as the communication transport: current Codex also routes direct dynamic tools through it. `code_mode`, shell tools and executor environments stay disabled. Real Codex 0.160.0 successfully read synthetic page evidence and returned its citation using this configuration; tool registration alone had succeeded with the host disabled but execution had failed. No personal PDF was sent. The dynamic tool surface is experimental and remains subject to version changes.

The helper uses an empty private temporary working directory and preserves the existing `CODEX_HOME` for Codex-owned authentication. Project instruction discovery is disabled. It does not write image files, chat logs, or prompts. Telemetry prompt/response logging and exporters are disabled; subprocess diagnostics are drained without forwarding or writing them. Runtime memory, Windows paging/crash dumps, browser storage, and the model provider's retention policies remain outside a literal “no byte can ever reach disk” guarantee.

Verified sources:

- [App-server protocol and initialization](https://learn.chatgpt.com/docs/app-server)
- [Native Messaging protocol and registration](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Codex tool registration](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs)
- [Apply-patch environment resolution](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch.rs)
- The installed CLI-generated `ThreadStartParams`, `TurnStartParams`, model/account, and unsubscribe schemas were also checked against version 0.159.2 during development. The generated research schemas are not shipped.

## Verify without paid inference

```powershell
native-host\bin\PdfCopilotHost.exe --self-test
node --test tests\native-host.test.mjs
# Optional: account/model metadata only, no turn/start:
$env:PDF_COPILOT_REAL_CODEX_SMOKE = '1'
node --test --test-name-pattern='installed Codex metadata smoke' tests\native-host.test.mjs
# Real ephemeral thread creation/unsubscribe, also no turn/start:
native-host\bin\PdfCopilotHost.exe --verify-isolation
native-host\bin\PdfCopilotHost.exe --verify-document-tools
```

The deterministic fixture exercises framing, UTF-8, metadata filtering, image transport, ephemeral enforcement, cancellation, disconnect cleanup, PDF-tool result binding, rejected non-PDF requests, and process failure. `--test-server` and `--fake-app-server` are explicit test-only command-line entry points; browser messages cannot enable them. `node scripts/context-native-smoke.mjs` is an explicit real-inference check using tiny synthetic evidence and a logged-in account; it consumes a small amount of quota. See the QA report for validation limits.
