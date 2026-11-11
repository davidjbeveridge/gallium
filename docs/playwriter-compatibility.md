# Gallium Chrome bridge compatibility

## Qualified in the isolated Chrome fixture

On 2026-11-02, Chrome 156.0.8078.76 passed the real SDK/extension workflow, trusted input and user activation checks, duplicate prevention, verified per-extension debugger detach, restart during human control, explicit handback without another action, and cookie/CSRF browser requests. Another extension's actual iframe caused an explicit conflict without being removed. The full gate is `npm run test:browser`.

The approved personal Chrome installation also passed the loopback fixture save, debugger detach, and resume through MCP. Bitwarden, 1Password, LastPass, native dialogs, and macOS physical input remain unqualified.

## Build

`npm ci && npm run build:extension` downloads a pinned, hash-checked upstream source archive and applies `docs/patches/playwriter-preserve-extensions.patch`. `extension/control.ts` adds the local control protocol. The builder also disables unexpected automatic reattachment. Upstream's public development identity is retained because the pinned relay allows that extension origin. No private signing key is present.

The build lives in `dist/extension`. Keep this path stable after installation. Building does not install the extension or change a Chrome profile. Optional Playwriter SDK dependencies are pinned in `package-lock.json`; no browser is downloaded.

## Personal-profile installation gate

The unpacked bridge grants debugger and website access. After the user approves that concrete permission change, load the built folder from Chrome's extensions page. Preserve existing tabs and extensions. Start the fixture, enable only the fixture tab through the bridge icon, then test save, takeover, detached password-manager interaction, reattachment, account validation, and handback.

Do not set the private `preserveExtensionsVerified` flag based on the upstream version alone or a different extension build. It remains false in shipped examples and in a new installation.

## Authentication

The engine revokes its control epoch before pausing, stops queued typing between characters, waits for live execution to quiesce, and uses a fixed local bridge method to detach matching enabled tabs. The extension removes its tab tracking before detaching, which suppresses reattachment. It then verifies that its own debugger command is rejected. The durable journal records whether detach succeeded. `detach_required` is not permission to enter credentials.

During handoff, the engine does not observe the page. Explicit Resume reattaches previously paused tabs only if their origin still matches, and retains human ownership when any bridge step fails. The next operation revalidates account and checks the goal before acting.

Command-Shift-Y detaches through the extension independently of the model; MCP web_control is the complete durable runtime pause path. The shortcut alone does not update the SQLite ownership journal when no worker is executing.

Existing sessions come first. Password managers are optional; no vault unlock or credential lookup occurs merely to run the plugin. Physical approvals, CAPTCHA, or unavailable devices remain handoffs. Never inspect cookies, password fields, vault contents, or OTP values to prove compatibility.

## Distribution

The source is public. The patched extension is a local development build, not a store-approved extension. Its permissions come from pinned Playwriter plus `tabs` for exact-origin control. No existing browser integration is disabled by installation.
