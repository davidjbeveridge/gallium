# Current state

## Objective and release boundary

Web Operator accepts delegated tasks through MCP and a routing skill. One local service owns the shared Chrome connection. Jev supplies typed judgments through OpenRouter; code selects routes, coordinates execution, and verifies outcomes.

This release covers unfamiliar public-document retrieval and configured authenticated workflows. It does not promise universal site automation.

## Canonical plan and decisions

| Work | Decision | Reason and acceptance |
| --- | --- | --- |
| Goal-level internal routing | Finished | web_task selects configured procedures internally and handles public HTTPS information tasks without recipes. |
| Public reconnaissance | Finished, bounded | Unauthenticated HTTPS, pinned public IPv4 resolution, document-size limits, typed applicability and evidence selection. Returns the source passage and hash. |
| Scheduling | Finished | Independent HTTP work overlaps. Chrome and operations sharing an account serialize. Queued operations reject changed ownership epochs. |
| Shared Chrome | Finished | Default MCP and CLI clients use the same service and installed profile. No browser download or implicit profile launch. |
| Controlled restart and upgrades | Finished | Source/config fingerprints detect mismatched clients. service-restart refuses active work and preserves durable ownership. |
| Authentication handoff | Existing mechanism qualified | Verified debugger detach, persistent ownership, and explicit handback pass. Real Bitwarden login remains unqualified; SMTP2GO stays paused pending handback. |
| Automatic mutation/API discovery | Shelved | Effect and retry semantics cannot be inferred reliably from a page alone. Use configured procedures for authenticated tasks and writes. |
| Broad dynamic-site browser exploration | Shelved | The current compact recipe executor is qualified. General exploration needs separate task-success and account-binding evidence. |
| Alternate browsers and broad native automation | Shelved | No demonstrated benefit against the installed Chrome path. |
| Learned route ranking | Shelved | Fixed route preference is understandable; collect representative performance evidence before learning a policy. |
| Fake typing mistakes and incidental mouse jitter | Shelved | Additional latency and error surface without demonstrated task-success benefit. |
| Automatic takeover of crashed service state | Shelved | An unreachable leftover socket fails closed. Controlled restart covers normal updates; crash recovery requires operator inspection. |

## Verification

- TypeScript and 84 tests passed, including HTTP concurrency, shared browser serialization, restart preserving human ownership, and public-address restrictions.
- Real MCP tasks retrieved supporting passages from RFC 1149 and RFC 2324 without site recipes. Unsupported public deletion intent returned CONFIGURED_PROCEDURE_REQUIRED.
- Installed CLI-to-service task retrieved RFC 1149 delay/throughput evidence. Its receipt survived service-restart.
- Earlier live qualification verified VS Code and TypeScript license metadata through GitHub, a public page through existing Chrome, and cross-client fixture pause/resume.
- Cumulative Jev evaluation, including unsuccessful trials, reported 30 calls and $0.000927402 against the authorized $2 budget. Model typesafe/jev-1.14-20261014 through OpenRouter System One.
- Raw test artifacts remain in ignored work/. The journal stores task fingerprints, state, hashes, and usage metadata; public page bodies are returned to the caller rather than persisted.
- Latest published predecessor 60ef671 passed GitHub Actions 41695925165. The current release still requires publication and the clean browser gate.

## Operational boundaries

Public reads cover bounded excerpts of static HTTPS documents. Redirects, private destinations, unsupported formats, oversized responses, missing evidence, and dynamic-page requirements return explicit errors or capability codes. evidence_found establishes passage provenance; semantic relevance is a Jev judgment.

Existing configured procedures retain account checks, independent result verification, uncertain-write reconciliation, and persistent human control. No standalone UI is part of the product.
