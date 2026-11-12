# Task benchmarks

These measurements compare ways to check a product before buying and to save a profile name. The shop and profiles are disposable loopback fixtures. Each measured trial reached the expected answer or saved state. The browser-only rows use scripted Chrome controls as a baseline for the browser path. They measure the browser steps and verification without any agent deliberation time.

## Shopping reads

Nine measured trials per path. The direct requests and Chrome actions had two warmups. Chrome was already running. Its timed paths include navigation, the click, any wait, and verification. The browser-only pickup time measures the Chrome segment of the full chain. The curl paths include the process, request, and verification.

| Task | Path | Median |
| --- | --- | --- |
| Check charger price and stock | curl reads the documented public catalog | 10.03 ms |
| Check charger price and stock | Chrome opens the product and reads the result after a click | 14.87 ms |
| Find a pickup window | Chrome opens pickup options and verifies the rendered window | 13.25 ms |
| Find a pickup window | curl HTML check, Chrome inspection, redacted HAR-style observation, and verified curl retry | 33.15 ms |
| Find a pickup window | Repeat the documented public GET with curl | 10.12 ms |

The catalog answer was a 65 W USB-C charger at $29.99 USD, in stock. The pickup answer was today from 4:00–6:00 PM at Denver Central. The trace retained only the method, path, and status of the fixture's documented public GET. The retry was a fresh read of that endpoint. The full diagnostic path took longer than reading the result in Chrome. The retry-only row shows the cost once the endpoint is known.

The curl and trace rows are separate host-side workflows. Gallium's own direct HTTP route uses the engine's fetch adapter. The trace is a manual diagnostic in this comparison.

## Profile form and session request

Seven measured trials per path after one warmup. The profile page was open and reset before each timer. All paths checked the saved name and exactly one write. The Jev row includes the OpenRouter call and the selected procedure. Jev chose the configured session request in every measured trial.

| Task | Path | Median |
| --- | --- | --- |
| Save a display name | Scripted Chrome form | 54.6 ms |
| Save a display name | Configured Playwriter form | 523.3 ms |
| Save a display name | Configured request inside the signed-in tab | 145.4 ms |
| Save a display name | Jev route selection and the session request | 371.2 ms |
| Save a name on a separate profile with no procedure | Scripted Chrome form | 64.0 ms |
| Save a name on a separate profile with no procedure | Gallium capability check, then the same scripted browser path | 57.6 ms |

For the last row, Gallium returned `CAPABILITY_REQUIRED` before a write. The harness stood in for the host agent and completed the known fixture form. The host owns that decision. It should check the result of a possibly completed write before retrying. The two fallback rows use the same browser steps, and the small difference between them is specific to this run.

The Jev run made eight model calls including warmup. OpenRouter reported $0.000212688 in total usage. The routing interface is adapted from Jev Ultrafast. [Third-party notices](../THIRD_PARTY_NOTICES.md#jev-ultrafast-license)

## Reproduce the runs

Measured on November 12, 2026 on an Apple M5 Mac with macOS 26.2, Chrome 157.0.8103.51, and Node 26.12.1. Fixture startup, browser launch, bridge setup, and teardown are outside the timers. Each run opens a separate disposable Chrome profile. The profile runner copies the bridge into a temporary directory and uses a separate loopback relay.

```sh
npm ci
npm run benchmark:reads
npm run build:extension
npm run benchmark:profile
```

Use `npm run benchmark:profile -- --jev` to include the configured OpenRouter Jev router. That option uses the existing model credential and incurs the provider's usage charge. The default profile benchmark runs locally. [Read harness](../scripts/benchmark-reads.mjs) · [Profile harness](../scripts/benchmark-profile.ts)
