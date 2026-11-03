# Validation

2026-11-02, Node 26.12.1, macOS, installed Chrome 156.0.8078.76.

## Executed

- TypeScript checks (`npm run typecheck`).
- Full Node suite (`npm test`): 79 passing tests, including real stdio MCP child processes, real loopback HTTP, durable ownership/leases, uncertain effects, input cancellation, provider validation,.
- Real SDK + patched extension + Chrome gate (`npm run test:browser`).
- Installed CLI launcher and doctor, private configuration, Codex MCP registration, installed stdio MCP operation, routing-skill discovery.
- GitHub Actions clean Linux checkout/install/audit/check/build/browser gate passed: run 41531437604.
- `npm audit`: zero reported vulnerabilities after pinned transitive dependency overrides; the Chrome gate was rerun against that dependency graph.

## Browser gate assertions

1. Save through real Chrome pointer/keyboard input; independently read the server's business result.
2. Repeat the same operation ID without another save.
3. Observe trusted input events and qualifying user activation.
4. Pause; verify that this extension can no longer issue a debugger command.
5. Complete the task through the independent test connection during human ownership.
6. Restart the engine; verify it stays paused.
7. Inject a real second-extension iframe; reattachment fails explicitly, preserves the iframe, and retains human ownership.
8. Remove only the test fixture overlay; explicitly resume and verify completion with zero new actions.
9. Execute the same business update through a browser request requiring an HttpOnly cookie and CSRF header. A plain Node request to the protected endpoint gets 401.
10. Close the operator without closing the existing test tab.

The latest executable evidence is generated as `work/browser-evidence.json`. The gate took about two seconds locally; that includes fixture startup/interaction but is not a benchmark against another tool or model.

## Remaining qualification

The approved bridge was installed in personal Chrome. The installed MCP verified a loopback fixture save with two actions, paused to human ownership with verified debugger detachment, and resumed to agent ownership. Real password-manager interaction remains unqualified. No real vault, credential, paid model, physical-device approval, native dialog, generic website discovery, or production write was used. No existing integration has been disabled. A fixture pass cannot establish those capabilities.

The development dependency tree measured approximately 156 MiB; the built extension approximately 332 KiB. No clean-machine installed footprint or model cost has been claimed.


## Internal routing and shared service

The task-controller release passes 81 local tests. The live MCP qualification used two clients and confirmed one shared service PID. Jev selected configured procedures for two public GitHub license checks and a public Chrome page check. Unsupported deletion intent was rejected. A fixture browser scope paused through one client and resumed through the other. The installed default MCP entry also verified a fixture write.

Observed Jev provider usage, including failed trials, totaled 23 calls and $0.000422142. The evaluated model was typesafe/jev-1.14-20261014 through OpenRouter System One. These are qualification observations, not a general performance benchmark. Unfamiliar website exploration remains pending.


## Bounded public tasks and scheduling release

TypeScript and 84 tests pass. Two unfamiliar public-document tasks went through MCP without recipes: RFC 1149 carrier information and RFC 2324 status 418 semantics. Returned passages matched their source documents. A deletion request was rejected before fetching. The installed task entry also retrieved RFC 1149 delay/throughput evidence and preserved its receipt across service restart.

Executable scheduling tests confirm overlapping independent HTTP reads and serialized browser reads. Restart tests confirm human ownership survives. Public destination validation rejects loopback, private, reserved, credential-bearing, and non-HTTPS targets.

Cumulative provider-reported usage is 30 Jev calls and $0.000927402. These are qualification results, not a general latency benchmark. Static-document evidence extraction is bounded and its semantic relevance remains model-assessed.

## Recipe-free dynamic exploration

`npm run check`: 92 tests and TypeScript passed. `npm run test:exploration` is an opt-in paid live MCP gate using the configured router and existing shared Chrome. It found Bob Marley’s quote on page 4 of Quotes to Scrape’s JavaScript edition, and clicked Start then waited for Hello World on The Internet dynamic-loading example. Both returned rechecked live-DOM evidence through the same service PID. No site recipes or extra browser profiles were created.

The initial quotes trial exposed missing generic containers; the final implementation includes them. Dynamic auth and CAPTCHA workflows are not qualified by these public tests. Task-owned tabs close on completion or stop.
