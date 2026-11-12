# Gallium product positioning

Document version v2

Last updated 2026-11-12

## Product

Use Gallium in place of your agent's default browser skill. The skill hands a goal to the local engine through MCP or the CLI. The engine can read a public document over HTTPS or use the live page in desktop Chrome. For an account you've configured, it can run a procedure and check the saved result. A public lookup comes back with a passage and source URL.

The project is distributed as source on GitHub. The fixture demo runs locally with Git and Node.js 24 or later. Live public goals use a configured Jev router through OpenRouter. Browser routes use the Gallium bridge for desktop Chrome.

## Audience

Write first for developers and people who already ask agents to do work on the web. They want a fact they can check, a change they can confirm, or the chance to finish a step in their own browser. Someone new to MCP should understand the examples before reaching the setup section.

## Problem and alternatives

With browser primitives, the calling agent has to choose what to click and when to wait. It also has to work out whether the page saved a change. For a straightforward lookup, opening a browser can be extra work.

The alternatives a developer would consider are their agent's built-in browser tools, a Playwright-based integration, a script against a known API, or doing the work by hand. Compare the level of control and the work required from the caller. Avoid unmeasured speed and reliability comparisons.

## Differentiation

- A single task request can cover a direct HTTPS read or several page actions. A public lookup can move to Chrome if the fetched text lacks the answer. Inside Chrome, Gallium decides from visible controls and checks the passage against the page.
- For configured goals, Jev judges which procedures fit. Code prefers a direct request, then a request inside the Chrome session, then page interaction. The preference order is fixed and the selected procedure stays with its operation ID.
- A separate read verifies a configured change. If the effect is uncertain, Gallium checks current state before trying the write again. A human pause survives a restart.

## Use cases

- Quote a line from a public guide. Gallium can fetch the text directly over HTTPS and return the passage with its URL.
- Find information on a public site that loads after a click or a search. Show the recorded quote and dynamic loading runs. The calling agent makes one task request, and Gallium handles the steps in Chrome.
- Change a display name on a configured account and check the saved value. Show the local fixture's verified save and skipped duplicate.
- Pause a configured workflow to finish a step yourself. Show how a pause survives restart and how Gallium checks the result after handback.

## Fit and switching

People can try the local fixture from their terminal. To use Gallium by default, add the skill to the project and tell the agent to use it for web tasks in the project's instructions. Setting up the engine adds the CLI and, with Codex installed, the MCP server. Live public tasks need the model router. Signed-in work needs an account-bound procedure, and live page work needs the separately enabled Chrome bridge.

For a general-purpose browser or an arbitrary signed-in workflow with no configuration, set expectations with the supported task types and the setup guide. Explain what data goes to the model provider when it is used.

## Language and voice

“Like Chromium, but fluid.” is the line people remember. Fluid means switching routes when the job needs it. Make that concrete with a lookup whose answer appears in Chrome or a save that Gallium checks by reading back the value. Use “read the page,” “open Chrome,” “check the save,” and “take over.” Use “procedure,” “scope,” and “operation ID” where the reader needs those terms to configure the engine.

Keep the copy plain, technically specific, and a little dry. Keep the chromium joke in the demos. Explain efficiency through direct reads, a single task request, and skipped duplicate saves. Show how fallback to Chrome and human handoff keep supported tasks moving. Use those behaviors as proof. The live page changes the next decision within a task. Route ranking across tasks is fixed.

## Proof and conversion

The public examples include the RFC 2324 lookup, the Bob Marley quote on page four of the JavaScript edition of Quotes to Scrape, and the dynamic loading page that returns “Hello World!” after Start. The local demo verifies Ada's name and skips a duplicate save. It holds a pause through restart and verifies the human-completed change with zero additional actions. The real Chrome test checks the server state and debugger detachment. [Validation report](../VALIDATION.md)

The page should get an interested reader to the install commands. The walkthrough and local fixture let them see what they would be installing. No conversion baseline has been collected.

## Changelog

- v2 (2026-11-12) Explained how to use Gallium as the default browser skill and grounded the benefits in specific use cases and demo results.
- v1 (2026-11-12) Recorded the fluid positioning, supported uses, proof, and install paths.
