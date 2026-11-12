"""Check the files GitHub Pages publishes and their public references."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from subprocess import check_output
from urllib.parse import unquote, urljoin, urlsplit
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "dist" / "site"
URL = "https://davidjbeveridge.github.io/gallium/"
REPO = "https://github.com/davidjbeveridge/gallium"


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.links = []
        self.source = None
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
        if tag == "a" and attrs.get("class") == "doc-source":
            self.source = attrs["href"]
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


def canonical(path):
    relative = path.relative_to(SITE).as_posix()
    return urljoin(URL, relative.removesuffix("index.html") if path.name == "index.html" else relative)


assert (SITE / "index.html").is_file(), "Run npm run build:site first."
pages = {}
for path in SITE.rglob("*.html"):
    page = Page()
    page.feed(path.read_text())
    url = canonical(path)
    assert page.headings == 1, path
    assert page.metadata["canonical"] == page.metadata["og:url"] == url, path
    assert page.metadata["description"], path
    assert "noindex" not in (page.metadata.get("robots") or ""), path
    if "og:image" in page.metadata:
        page.links.append(page.metadata["og:image"])
    pages[url] = page


def check_link(link, context):
    if link.startswith(f"{REPO}/blob/main/"):
        target = ROOT / unquote(urlsplit(link).path.split("/blob/main/", 1)[1])
        assert target.is_file(), (context, link)
        return
    if link.startswith(REPO + "#"):
        fragment = urlsplit(link).fragment
        assert fragment in pages[URL + "docs/readme.html"].ids, (context, link)
        return
    resolved = urljoin(context, link)
    if not resolved.startswith(URL):
        return
    route = urlsplit(resolved)
    target = SITE / unquote(route.path.removeprefix(urlsplit(URL).path))
    if target.is_dir():
        target /= "index.html"
    assert target.is_file(), (context, link)
    if route.fragment and target.suffix == ".html":
        assert unquote(route.fragment) in pages[canonical(target)].ids, (context, link)


for url, page in pages.items():
    for link in page.links:
        check_link(link, url)

tracked_docs = set(check_output(["git", "ls-files", "-z", "--", "*.md"], cwd=ROOT, text=True).split("\0")) - {""}
doc_sources = [unquote(page.source.removeprefix(f"{REPO}/blob/main/")) for page in pages.values() if page.source]
assert len(doc_sources) == len(tracked_docs) and set(doc_sources) == tracked_docs
docs_url = URL + "docs/"
index_links = {urljoin(docs_url, link) for link in pages[docs_url].links}
assert set(pages) - {URL, docs_url} <= index_links, "The docs index must link to every article."

apps = [node for node in pages[URL].schema["@graph"] if node["@type"] == "SoftwareApplication"]
assert len(apps) == 1 and apps[0]["name"] == "Gallium" and apps[0]["url"] == URL
assert apps[0]["softwareVersion"] == json.loads((ROOT / "package.json").read_text())["version"]
sitemap = ElementTree.parse(SITE / "sitemap.xml")
locations = [node.text for node in sitemap.findall(".//{*}loc")]
assert len(locations) == len(pages) and set(locations) == set(pages)
assert f"Sitemap: {URL}sitemap.xml" in (SITE / "robots.txt").read_text()
llms = (SITE / "llms.txt").read_text()
assert llms.startswith("# Gallium\n")
for link in re.findall(r"\]\((https://[^)\s]+)\)", llms):
    check_link(link, URL + "llms.txt")
print(f"Gallium Pages checked {len(pages)} pages, their links, anchors, metadata, and crawl files.")
