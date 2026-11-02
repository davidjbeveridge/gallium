# Web Operator

Local CLI/MCP plugin for verified web operations, browser-session requests, and human takeover. Node 24+. Reuses installed Chrome; no downloaded browser, Docker, Python environment, or required model service.

Version 0.2 completes a real Chrome workflow: UI save → independent verification → duplicate prevention → debugger detach → human completion → runtime restart → explicit handback with zero additional actions. The same engine performs a cookie-authenticated, CSRF-protected request inside Chrome. A second extension's actual iframe is preserved when attachment conflicts.

**This is a working recipe-based vertical slice. General website discovery, real password-manager qualification, native dialogs, and live navigator benchmarks remain open.** See [validation](VALIDATION.md) and [current state](docs/STATE.md).

## Run

```sh
node --version                     # 24 or newer
npm ci
npm run check
npm run demo
npm run build:extension
npm run test:browser               # installed Chrome; disposable test profile
npm run install:local
web-operator ui                   # http://127.0.0.1:8788
```

The installer preserves an existing `~/.config/web-operator/config.json`, creates a private durable state directory under `~/Library/Application Support/WebOperator`, installs the `web-operator` command and routing skill, and registers the stdio MCP server with Codex. New chats load the server. The launcher can find a newer installed Node when the shell default is older.

Start the harmless local service separately with `npm run fixture`. The installed configuration offers four operations:

| Recipe | Route |
| --- | --- |
| `set-name` | Persistent local fixture; no Chrome needed |
| `save-profile-api` | Portable loopback HTTP |
| `save-profile` | Chrome pointer/keyboard UI |
| `save-browser-request` | Signed-in Chrome request with CSRF acquisition |

```sh
web-operator act --recipe set-name --operation example-001 --input '{"name":"Ada"}'
web-operator status --operation example-001
web-operator pause --scope demo
web-operator resume --scope demo
```

Repeat the same operation ID and inputs after interruption. A changed task needs a new ID. Credentials are never recipe inputs.

## Connect Chrome

The local compatibility extension is built into `dist/extension`. Installing it into a personal Chrome profile is a separate, explicit permission step because it grants debugger and website access. It is not installed by the CLI installer.

After approving installation, load that folder through Chrome's **Load unpacked** control. Open `http://127.0.0.1:8787/profile`, then click the bridge extension to enable that tab. Only enable `playwriter.preserveExtensionsVerified` in the private configuration after checking the installed build. Use the local panel's Take over and Resume controls to qualify the actual profile. [Compatibility details](docs/playwriter-compatibility.md).

The extension is pinned to Playwriter `bf2b96717e2b36ee9781d260d4ed8a7228f47c48`, with a SHA-256 checked source archive. It preserves other extensions' iframes, disables automatic reattachment after unexpected detach, and exposes a local detach/resume protocol. The test checks detachment by verifying that this extension can no longer send a debugger command; another independent debugger may still exist.

## Tools and control

| Tool | Behavior |
| --- | --- |
| `web_status` | Discover recipes and inspect durable state |
| `web_read` | Fresh observation of a configured recipe |
| `web_act` | Bounded observe/choose/execute/verify run |
| `web_control` | Pause, explicitly resume, or cancel a scope |

The panel works independently of the navigator. Human ownership survives restart. Browser scopes report `detach_required` until detachment is verified; `handed_off` means work has quiesced and the bridge released its debugger. Resume keeps human ownership until reattachment succeeds, then a reissued operation verifies account and goal before acting.

The extension's Command-Shift-Y shortcut detaches the current origin's enabled tabs. Use the panel's **Take over** for the complete durable runtime ownership transition. Dictation/Fn/Globe shortcuts are never used.

A possibly completed write remains unresolved until verified. It cannot be repeated by switching to another route or changing operation IDs. Local journaling does not guarantee exactly-once effects at arbitrary services. Provider idempotency and conditional writes should be used where supported.

## Configure routes and models

Recipes are trusted local configuration with an exact origin/account, declared nonsecret inputs, allowed actions, and an independent business-result predicate. Start with the files under `examples/`. API and UI routes for one account/origin share one scope, lease, control epoch, and cooldown.

`browser-request` uses the HTTP contract plus the browser account selector. Its requests run inside the existing page with same-origin credentials. An optional `browser.csrf` selector/attribute/header acquires the current token entirely inside Chrome. Only configured scalar account/goal fields leave the browser; cookies and CSRF values do not. Cross-origin endpoints, redirects, secret verification fields, and portable credential headers are rejected.

Deterministic recipes need no model call. `examples/navigators.json` configures Jev-style TypeSafe or an OpenAI-compatible structured-output navigator. Model, endpoint, key environment variable, and request budget are configurable. The navigator selects an observed candidate; it cannot invent selectors, execute code, grant authority, or establish success by saying DONE. Explicit business inputs provide field text; the host remains the supervisor.

Optional `playwriter.inputPolicy` supports `{"mode":"natural","maxOverheadMs":400}` for bounded typing bursts. Ownership is checked before every character. Pacing is independent of planning and provides no claim of physical-human equivalence or bot-detection acceptance.

## Development and distribution

`npm run check` runs TypeScript checks and the full local suite. `npm run test:browser` is an explicit integration gate using the installed Chrome executable and a disposable profile. It refuses a conflicting relay rather than killing another process. Set `CHROME_EXECUTABLE` on other platforms. Diagnostic test evidence stays under ignored `work/`.

The portable package contains `plugin.json`, `mcp.json`, and `skills/`, following [OpenAI's plugin packaging documentation](https://developers.openai.com/plugins/build/plugins). The local installer registers the same runtime directly. Public source distribution is not a Chrome Web Store or OpenAI directory approval.

The measured development installation uses approximately 156 MiB for dependencies and 332 KiB for the compatibility extension on this Mac. That includes development dependencies and optional SDK components; it is not a clean-machine production footprint or a latency benchmark. Core fixture/HTTP execution has no third-party runtime dependencies.

[Architecture roadmap](docs/build-plan.md) · [Validation](VALIDATION.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
