# Gallium search discovery

Research covered browser automation for AI agents, local Chrome automation, existing Chrome sessions, MCP browser automation, and browser automation with human takeover. These are search intents found in public search and product documentation. Search volume was outside this audit.

| Intent | What the site answers |
| --- | --- |
| Automate web tasks with an AI agent | What Gallium does, a fixture demo, and how to connect the CLI and MCP server |
| Use an existing Chrome session | How the separate bridge and configured account procedure work |
| Verify a browser task finished | What Gallium checks for a signed-in change and the evidence a public lookup returns |
| Take over when a task needs a person | How pause, durable ownership, and handback work |

Playwright MCP offers browser automation tools, Puppeteer provides a browser-control library, and Stagehand offers browser primitives for AI workflows. Gallium's site explains its combination of an existing Chrome session, direct requests when applicable, independent verification for configured changes, and durable handoff. [Playwright MCP](https://playwright.dev/mcp/introduction) · [Puppeteer](https://pptr.dev/) · [Stagehand](https://www.browserbase.com/stagehand)

The site uses static HTML, one H1, crawlable links, a canonical URL, a social image, and JSON-LD that reflects the product. The sitemap lists the canonical homepage. The project provides `llms.txt` with links to evidence and capability boundaries. [Google Search Essentials](https://developers.google.com/search/docs/essentials) · [Google AI features guidance](https://developers.google.com/search/docs/appearance/ai-features)

Run `python3 scripts/check-site.py` to check links, structured data, the canonical, and crawl files. On the shared Pages host, crawlers read robots rules from `/robots.txt` at the origin. The project sitemap and `llms.txt` are served under `/gallium/`. Indexing, search position, and AI citations require subsequent observations.
