# Gallium product positioning

Document version v1

Last updated 2026-11-12

## Product

Gallium is a local web task engine for AI agents. An agent gives it a goal through MCP or the CLI. Gallium can read a public document over HTTPS, use the live page in desktop Chrome when it needs to, or run a procedure for a configured account. A public lookup comes back with a passage and source URL. For a configured change, the procedure specifies how to check the result.

The project is distributed as source on GitHub. The fixture demo runs locally with Git and Node.js 24 or later. Live public goals use a configured Jev router through OpenRouter. Browser routes use the Gallium bridge for desktop Chrome.

## Audience

Write first for developers and people who already ask agents to do work on the web. They want a fact they can check, a change they can confirm, or the chance to finish a step in their own browser. Someone new to MCP should understand the examples before reaching the setup section.

## Problem and alternatives

With browser primitives, the calling agent has to choose what to click and when to wait. It also has to work out whether the page saved a change. For a straightforward lookup, opening a browser can be extra work.

The alternatives a developer would consider are their agent's built-in browser tools, a Playwright-based integration, a script against a known API, or doing the work by hand. Compare the level of control and the work required from the caller. Avoid unmeasured speed and reliability comparisons.

## Differentiation

- The caller supplies a goal. A public lookup can start with HTTPS and move to Chrome if the fetched text lacks the answer. Inside Chrome, Gallium decides from visible controls and checks the passage against the page.
- For configured goals, Jev judges which procedures fit. Code prefers a direct request, then a request inside the Chrome session, then page interaction. The preference order is fixed and the selected procedure stays with its operation ID.
- A separate read verifies a configured change. If the effect is uncertain, Gallium checks current state before trying the write again. A human pause survives a restart.

## Fit and switching

People can try the local fixture with their existing terminal. The skill can be added to the project where an agent works. Setting up the engine adds the CLI and, with Codex installed, the MCP server. Live public tasks need the model router. Signed-in work needs an account-bound procedure, and live page work needs the separately enabled Chrome bridge.

For a general-purpose browser or an arbitrary signed-in workflow with no configuration, set expectations with the supported task types and the setup guide. Explain what data goes to the model provider when it is used.

## Language and voice

“Like Chromium, but fluid.” is the line people remember. Fluid means switching routes when the job needs it. Make that concrete with a lookup whose answer appears in Chrome or a save that Gallium checks by reading back the value. Use “read the page,” “open Chrome,” “check the save,” and “take over.” Use “procedure,” “scope,” and “operation ID” where the reader needs those terms to configure the engine.

Keep the copy plain, technically specific, and a little dry. Keep the chromium joke in the product walkthrough. Skip slogans about autonomy, superlatives, and claims about learning across runs. The live page changes the next decision within a task. Route ranking across tasks is fixed.

## Proof and conversion

The public examples in [the validation report](../VALIDATION.md) include the RFC 2324 lookup and the Bob Marley quote on page four of the JavaScript edition of Quotes to Scrape. The local demo verifies Ada's name, skips a duplicate, and preserves a pause through restart. Real Chrome tests check the saved server state and debugger detachment. There are no published comparative benchmarks or customer testimonials.

The page should get an interested reader to the install commands. The walkthrough and local fixture let them see what they would be installing. No conversion baseline has been collected.

## Changelog

- v1 (2026-11-12) Recorded the fluid positioning, supported uses, proof, and install paths.
