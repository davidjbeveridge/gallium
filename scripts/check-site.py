"""Check the files GitHub Pages publishes and their public references."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
URL = "https://davidjbeveridge.github.io/gallium/"
REPO = "https://github.com/davidjbeveridge/gallium"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.metadata = {}
        self.headings = 0
        self.in_schema = False
        self.schema = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, attrs["id"]
            self.ids.add(attrs["id"])
        if tag == "h1":
            self.headings += 1
        if tag == "meta":
            self.metadata[attrs.get("property") or attrs.get("name")] = attrs.get("content")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.metadata["canonical"] = attrs["href"]
        if tag in {"a", "link", "img"}:
            self.links.append(attrs.get("href") or attrs["src"])
        if tag == "script":
            if "src" in attrs:
                self.links.append(attrs["src"])
            self.in_schema = attrs.get("type") == "application/ld+json"
        if tag == "video":
            self.links.extend((attrs["data-motion-src"], attrs["data-motion-fallback"]))

    def handle_data(self, data):
        if self.in_schema:
            self.schema = json.loads(data)

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_schema = False


page = Page()
page.feed((SITE / "index.html").read_text())
assert page.headings == 1
assert page.metadata["canonical"] == page.metadata["og:url"] == URL
assert page.metadata["description"]
assert "noindex" not in (page.metadata.get("robots") or "")
page.links.append(page.metadata["og:image"])
for link in page.links:
    if link.startswith(f"{REPO}/blob/main/"):
        target = ROOT / unquote(urlsplit(link).path.split("/blob/main/", 1)[1])
        assert target.is_file(), link
    elif link.startswith(REPO + "#"):
        fragment = urlsplit(link).fragment
        headings = (ROOT / "README.md").read_text().splitlines()
        assert any(line.lower().lstrip("# ").replace(" ", "-") == fragment for line in headings), link
    elif link.startswith(URL):
        assert (SITE / (link.removeprefix(URL) or "index.html")).is_file(), link
    elif not urlsplit(link).netloc:
        route = urlsplit(link)
        assert not route.path.startswith("/"), link
        assert (SITE / route.path).exists(), link
        if route.fragment:
            assert route.fragment in page.ids, link

apps = [node for node in page.schema["@graph"] if node["@type"] == "SoftwareApplication"]
assert len(apps) == 1 and apps[0]["name"] == "Gallium" and apps[0]["url"] == URL
assert apps[0]["softwareVersion"] == json.loads((ROOT / "package.json").read_text())["version"]
sitemap = ElementTree.parse(SITE / "sitemap.xml")
assert [node.text for node in sitemap.findall(".//{*}loc")] == [URL]
assert f"Sitemap: {URL}sitemap.xml" in (SITE / "robots.txt").read_text()
assert (SITE / "llms.txt").read_text().startswith("# Gallium\n")
print("Gallium Pages links, canonical metadata, structured data, and crawl files passed.")
