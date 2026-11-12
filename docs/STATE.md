# Current state

## Objective and release boundary

Gallium accepts delegated tasks through MCP and a routing skill. One local service owns the shared Chrome connection. Jev supplies typed judgments through OpenRouter; code selects routes, coordinates execution, and verifies outcomes.

This release covers unfamiliar public-document retrieval, dynamic public-site exploration, and configured authenticated workflows. It does not promise universal site automation.

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
| Dynamic-site browser exploration | Implemented and live-qualified | Core controller fallback and direct UI route. Observed controls, internal Jev judgments, same-origin navigation, loading waits, live evidence verification, one shared Chrome queue. No site recipes. |
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
- Published implementation 92d5c2d passed GitHub Actions 41697756492, including clean install, audit, type/unit checks, extension build, and the real Chrome gate. Installed MCP registration and skill are refreshed.

## Operational boundaries

Public reads cover bounded excerpts of static HTTPS documents and live dynamic pages. Dynamic exploration uses a task-owned tab, 12 observations and a 60-second deadline. It supports links, buttons judged read-only, disclosures, tabs, and GET search fields. Search currently submits the user goal as the query. Cross-origin navigation, iframe controls, infinite scrolling, and authenticated mutations are not generalized. Challenge/auth pages stop and close the task-owned tab; this is not a credential handoff flow. Redirects, private destinations, unsupported formats, oversized responses, missing evidence, and exhausted exploration return explicit errors or capability codes. evidence_found establishes passage provenance; semantic relevance is a Jev judgment.

Existing configured procedures retain account checks, independent result verification, uncertain-write reconciliation, and persistent human control. No standalone UI is part of the product.

## Dynamic exploration correction

Shelving unfamiliar-site exploration contradicted the core use case. It is now an internal route, with no host-selected tool or site recipe. The static HTTP fast path remains.

- TypeScript and 92 tests pass, including unknown effects, invented targets, changing evidence, loading, challenge stop, and loop termination.
- Real CLI and MCP tasks found Bob Marley’s quote after three next-page interactions on the JavaScript Quotes to Scrape site, and clicked Start then waited for Hello World on The Internet dynamic-loading example. MCP checks confirmed one shared service PID throughout.
- Initial live trial exposed missing generic text containers; extraction was corrected and the task passed. An explicit UI request initially failed the informational-intent test; the intent now distinguishes display interaction from consequential effects.
- SMTP2GO remains untouched and paused. No password-manager qualification is claimed.

Opt-in reproducible live MCP gate: `npm run test:exploration` (uses the configured paid router and existing Chrome). Both tasks passed with one service PID. Production dependency audit reports zero vulnerabilities.

Cumulative reported Jev spend after this qualification: 79 calls, $0.003675168 of the authorized $2, including failed trials.

## Naming research — 2026-11-10

Recommend **Webstint** (a stint is a defined spell of work); **Tabtrot** is a more playful option that suggests Chrome more strongly. Suggested descriptor: “Delegate web tasks. Get verified results.” The owner subsequently selected **Gallium**.

- Public web searches for the exact, spaced and hyphenated forms alongside browser automation, agent and MCP terms surfaced no similar projects for either finalist. GitHub repository name searches and the official MCP Registry returned no matches; the exact npm and PyPI package lookups returned 404. Verisign’s `.com` registry returned 404 for both domains at the time of the check. This was a public collision screen, not trademark clearance.
- Set aside Errandry (Errand is already a browser agent), Webgofer (Gofer is already an agent for delegated tasks), WebChore (WebChoreArena is a browser agent benchmark), and WebRunner and Browserhand (existing browser automation projects).

## Gallium launch

The owner selected Gallium. The GitHub repository and public package, CLI, MCP, bridge display, and routing skill use that name. Existing operation IDs, MCP tool names, bridge protocol, configuration, and durable state are compatible. The legacy CLI alias remains available.

- [Product website](https://davidjbeveridge.github.io/gallium/) is built from `site/`. The main-branch workflow publishes it after the full runtime, browser, and site checks.
- [Brand system](brand.md) records the shared README and website assets. [Search discovery](discovery.md) records the query research, crawl checks, and search visibility limits.
- The local demo verified a save, rejected a repeat, preserved a pause across restart, and verified a task completed during handoff with zero extra actions. The full 92-test suite and static site checks passed locally.
- The checkout now lives at `~/src/gallium`. A link from the former directory keeps the existing unpacked extension and CLI alias reachable. Gallium's installer and MCP initialization were checked against the original config and state. The legacy global MCP registration and duplicate skill link were retired locally.
- Pages deployment and the real Chrome fixture passed in [run 43109328325](https://github.com/davidjbeveridge/gallium/actions/runs/43109328325). Browser viewport and live HTTP evidence are summarized in [validation](../VALIDATION.md).

## Elemental redesign preview

- The preview uses a split G and drop mark, a graphite and platinum palette, and a period-four element strip. It gives installation the primary call to action. The command clones and installs from this repository. Codex registration is optional when the Codex CLI is absent.
- Chrome checked the layout at 320, 390, 820, 1024, and 1440 pixels. Clipboard contents and status, FAQ disclosure, video playback, manual pause, offscreen pause, and the reduced-motion still passed. The 92-test runtime suite and static site checks passed.
- Astra reviewed the renders twice. The second review gave the install path 9/10, composition and legibility 8.5/10, and brand distinction 8/10. It identified unrealistic compression in the local melt. The fallback was then revised to enter a growing pool and was checked for playback. It has not received a new independent visual score.
- The approved square Arial Ga tile is now used in the navigation, favicon, hero still, six-second local loop, and social card. Static site checks passed. The new hero still is prepared as a Flow reference. The old pending Flow render uses the previous mark and was left unsubmitted. The redesign remains local.

## Final elemental release

- Google Flow generated one eight-second Omni 1.2 Flash clip from the approved square Ga tile for 24 credits. The site serves the silent WebM, with the approved still for reduced motion. The deterministic loop remains reproducible from its source.
- All 92 unit tests passed. The extension built locally. The local browser fixture detected two bridge connections, so the isolated CI browser gate is the release check.

## Full-bleed site hero

The existing Gallium melt plays behind the hero with a staggered text entrance and a corner pause control. Mobile keeps the tile in frame above the text. Reduced motion uses the still and skips video loading. The silent H.264 MP4 backs up WebM.

Verified in isolated Chrome at 320, 390, 820, 1024, and 1440 px, including clipboard contents, pause, offscreen suspension, reduced motion, and actual MP4 playback with WebM blocked. All 92 project tests passed.

Mobile follow-up: the melt sits behind the headline, with the copy button visible sooner and commands wrapping within the card. Verified the rendered phone layout and reran the isolated Chrome hero checks.

Hero loop follow-up: the existing clip reverses before the Ga tile leaves the frame. Both video formats return to the opening pose and loop with the mark visible throughout.

Hero motion and layout follow-up: Astra recommended a forward one-shot that settles on the tile, with matched transition frames required for any future intro and steady-state pair. The site uses a 4.8-second edit of the original Flow shot, holds the last frame, and offers replay. Separate copy and media regions remove the mask, with stacked art on phones and natural headline wrapping. Verified Chrome layout at 320–1440 px, end and replay, reduced motion, both codecs, and 92 project tests.

Hero resting state: the one-shot dissolves to its intact opening frame, with a subtle CSS perspective tilt on fine-pointer devices. The video and still feather into the hero on all four edges. Verified the completed transition, pointer response, replay, reduced motion, and both codecs in Chrome at phone through desktop widths. All 92 project tests passed.

Periodic table: the ImageGen concept informed a graphite slab with cyan element cells, amber chromium, and a raised Gallium tile. The site renders all 118 numbered elements as HTML, with the two detached series and a CSS 3D scroll reveal. Reduced motion keeps the board flat. Verified placement, unique atomic numbers, reveal, and responsive rendering in Chrome from 320 to 1440 px. All 92 project tests passed. Jacques inspection found no repository-local DESIGN.md or manifest to validate.

Reflective hero: restored the full eight-second Flow source through the liquid-only frame. A beveled WebGL tile rises from the held pool and reflects procedural studio lights as the pointer changes its orientation. The intact poster remains the reduced-motion and WebGL fallback. Verified the rendered rise, pointer-dependent output, replay, both codecs, and responsive layout in Chrome. All 92 project tests passed.

## Task-engine positioning and architecture site

The homepage now leads with Gallium as a standalone web task engine. The current browser adapter is desktop Chrome. The examples distinguish public HTTPS, live exploration, and configured verification. The architecture describes fixed preference among eligible procedures, in-run feedback, durable state, and verified handoff. Learned route ranking remains research. An Astra source review grounded the claims. The README introduction, social card, metadata, and llms.txt match the page.

Verified all 92 project tests, type checking, and site metadata. The published fixture excerpt matched a fresh local demo. Chrome checks passed at 320, 390, 760, 761, 820, 1024, and 1440 px, including pointer and keyboard example selection, three command copy actions, the MCP example, FAQ, hero replay, reduced motion, and static content with JavaScript disabled.

## Material-driven site motion

The periodic table fills a graphite stage with the hero’s silver lighting. Scroll changes its angle, a mouse moves the light, and a selected tile rises from the board. All 118 original symbols, numbers, and positions remain available. Cells support keyboard navigation and the labeled picker supports narrow touch screens. Reduced motion uses a flat, selectable table. The task traces draw their path, the architecture diagram animates once and links to its details, and setup and disclosure controls give immediate feedback.

Xenia’s source-bound before/after preservation check passed all 19 checks. Isolated Chrome verified 320–1440 px, pointer lighting, scroll pose, lifted selection, touch emulation, keyboard navigation, detached-series details, diagram links, clipboard, hero replay, reduced motion, and the static fallback. Type checking, all 92 tests, and site checks passed.

## Flat surfaces and centered chrome hero

The Xenia critique found that the old pool read as a pedestal and repeated gradients and borders weakened the visual hierarchy. The site now uses flat surfaces, with motion tied to the task trace, the architecture flow, and the periodic table’s raised selection. The mobile architecture diagram reads from top to bottom. All 118 element positions are unchanged.

A single WebGL Ga tile melts in place over 4.2 seconds. Two raised chrome streams carry moving reflections from the top edge down both sides and into the bottom edge. The lettering holds position while the frame flows. The tile turns with the pointer, pause and replay are available, rendering suspends offscreen, and a matching WebP still covers reduced motion and unavailable WebGL.

Verified 17 Xenia preservation checks, the material bounds at neutral and extreme poses, and the interactive page in isolated Chrome at 320–1440 px. Pause, replay during pointer motion, touch selection, keyboard navigation, clipboard, reduced motion, unavailable WebGL, and the static page passed. Type checking, all 92 tests, and site checks passed.

The final hover check measured 4.86:1 contrast for the atomic number on an unselected tile.

For the stronger melt, isolated Chrome playback at 320, 390, and 1440 px reached the same pose it started from. Captured frames confirmed visible edge flow and stable lettering through the melt. The pointer, pause, replay, and fallback checks, all 92 tests, and the static site check passed.

## Fluid positioning and install

“Like Chromium, but fluid.” leads the site and social card. The [positioning guide](../.agents/product-marketing.md) grounds that line in route changes during a task. The single-column page replaces the element picker with a Ga walkthrough of the recorded RFC lookup, the Chrome quote lookup, and the local verified save. The Cr disclosure carries the chromium aside.

The `npx skills add davidjbeveridge/gallium --skill gallium` path installs the routing skill in an agent's project. Engine setup provides the CLI and MCP server. A clean Codex project install found the skill under `.agents/skills/gallium`. Isolated Chrome checked the single-column layout from 320 to 1440 px, mouse, touch and keyboard walkthrough selection, all five exact clipboard payloads, and clipboard fallback. Reduced motion and the static page passed. The local fixture verified the save, skipped the duplicate, and retained the pause across restart. All 92 tests, type checking, and the site check passed.
