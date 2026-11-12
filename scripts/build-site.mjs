import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';
import MarkdownIt from 'markdown-it';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/site');
const siteUrl = 'https://davidjbeveridge.github.io/gallium/';
const repo = 'https://github.com/davidjbeveridge/gallium';
const sourceBase = repo + '/blob/main/';
const sourcePath = new URL(sourceBase).pathname;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const aliases = new Map([
  ['README.md', { slug: 'readme', label: 'Project overview' }],
  ['AGENTS.md', { slug: 'contributors', label: 'Contributor instructions' }],
  ['THIRD_PARTY_NOTICES.md', { slug: 'third-party-notices' }],
  ['.agents/product-marketing.md', { slug: 'product-marketing' }],
  ['skills/web-operator/SKILL.md', { slug: 'skill', label: 'Gallium agent skill' }],
]);
const documents = new Map(tracked.filter(path => path.endsWith('.md')).map(source => {
  const alias = aliases.get(source);
  const slug = alias?.slug ?? source.replace(/^docs\//, '').slice(0, -3).toLowerCase();
  return [source, { source, path: 'docs/' + slug + '.html', label: alias?.label }];
}));
const docsIndex = 'docs/index.html';
const pages = [docsIndex, ...[...documents.values()].map(doc => doc.path)];
if (new Set(pages).size !== pages.length) throw new Error('Documentation URLs must be unique.');

const markdown = new MarkdownIt({ html: false });
markdown.renderer.rules.table_open = () => '<div class="doc-table" tabindex="0"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';
const escape = markdown.utils.escapeHtml;
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const href = (from, to) => encodePath(posix.relative(posix.dirname(from), to));
const directoryHref = (from, index) => href(from, index).replace(/index\.html$/, '') || './';
const canonical = path => new URL(path.replace(/(^|\/)index\.html$/, '$1'), siteUrl).href;

function rewriteLink(link, doc) {
  if (link.startsWith('#')) return link;
  const destination = new URL(link, sourceBase + encodePath(doc.source));
  if (!destination.href.startsWith(sourceBase)) return link;
  const target = decodeURIComponent(destination.pathname.slice(sourcePath.length));
  const suffix = destination.search + destination.hash;
  const article = documents.get(target);
  if (article) return href(doc.path, article.path) + suffix;
  if (target.startsWith('site/')) return href(doc.path, target.slice(5)) + suffix;
  if (tracked.some(path => path.startsWith(target.replace(/\/$/, '') + '/'))) {
    return repo + '/tree/main/' + encodePath(target) + suffix;
  }
  return destination.href;
}

function plainText(token) {
  return (token.children ?? []).filter(child => child.type === 'text' || child.type === 'code_inline')
    .map(child => child.content).join('');
}

function renderDocument(doc) {
  let source = readFileSync(resolve(root, doc.source), 'utf8');
  if (doc.source.startsWith('skills/')) source = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const env = {};
  const tokens = markdown.parse(source, env);
  const headings = [];
  const slugger = new GithubSlugger();
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open') {
      const title = plainText(tokens[index + 1]);
      const id = slugger.slug(title);
      token.attrSet('id', id);
      headings.push({ title, id, level: token.tag });
    }
    for (const child of token.children ?? []) {
      const attr = child.type === 'link_open' ? 'href' : child.type === 'image' ? 'src' : null;
      if (attr) child.attrSet(attr, rewriteLink(child.attrGet(attr), doc));
    }
  }
  const hasTitle = tokens[0]?.tag === 'h1';
  const label = doc.label ?? headings[0]?.title ?? doc.source;
  const title = hasTitle ? markdown.renderer.render(tokens.slice(0, 3), markdown.options, env) : '<h1>' + escape(label) + '</h1>';
  const intro = tokens.filter((token, index) => token.type === 'inline' && tokens[index - 1]?.type === 'paragraph_open')
    .map(plainText).find(text => text.length >= 60);
  const description = intro ? intro.split(/(?<=\.)\s/)[0].slice(0, 160) : label + ' for Gallium.';
  const sections = headings.filter(heading => heading.level === 'h2');
  const toc = sections.length ? `<details class="doc-toc"><summary>On this page</summary>
    <ul>${sections.map(section => `<li><a href="#${escape(section.id)}">${escape(section.title)}</a></li>`).join('')}</ul>
  </details>` : '';
  const body = markdown.renderer.render(tokens.slice(hasTitle ? 3 : 0), markdown.options, env);
  return { label, description, content: title + toc + body };
}

function page(path, title, description, content, source) {
  const home = directoryHref(path, 'index.html');
  const docs = directoryHref(path, docsIndex);
  const url = canonical(path);
  const sourceLink = source ? `<a class="doc-source" href="${sourceBase + encodePath(source)}">View Markdown on GitHub</a>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} | Gallium</title>
  <meta name="description" content="${escape(description)}">
  <meta name="theme-color" content="#11181c">
  <meta property="og:title" content="${escape(title)} | Gallium">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${url}">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="${home}mark.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${home}styles.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="top">
    <div class="shell nav">
      <a class="brand" href="${home}"><img src="${home}mark.svg" alt="" width="26" height="26">Gallium</a>
      <nav aria-label="Main"><a href="${home}#install">Quickstart</a><a href="${docs}"${source ? '' : ' aria-current="page"'}>Docs</a></nav>
      <a class="source-link" href="${repo}">GitHub <span aria-hidden="true">↗</span></a>
    </div>
  </header>
  <main id="main" class="measure doc-page">
    ${source ? `<a class="doc-parent text-link" href="${docs}">All documentation</a>` : ''}
    ${content}
    ${sourceLink}
  </main>
  <footer class="shell footer"><a href="${home}">Gallium homepage</a></footer>
</body>
</html>
`;
}

function write(path, content) {
  const destination = resolve(output, path);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, content);
}

rmSync(output, { recursive: true, force: true });
cpSync(resolve(root, 'site'), output, { recursive: true });
for (const doc of documents.values()) {
  Object.assign(doc, renderDocument(doc));
  write(doc.path, page(doc.path, doc.label, doc.description, doc.content, doc.source));
}
const list = [...documents.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));
write(docsIndex, page(docsIndex, 'Documentation', 'Install Gallium, configure the router, and use the skill with your agent.',
  `<h1>Gallium documentation</h1>
  <nav class="doc-topics" aria-label="Common tasks">
    <a href="guide.html#run">Install and bootstrap</a>
    <a href="guide.html#configure-the-router">Configure the router</a>
    <a href="guide.html#use-with-an-agent">Use with an agent</a>
    <a href="guide.html#connect-chrome">Connect Chrome</a>
  </nav>
  <h2>All docs</h2>
  <ul class="doc-index">${list.map(doc => `<li><a href="${href(docsIndex, doc.path)}">${escape(doc.label)}</a></li>`).join('')}</ul>`));
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['index.html', ...pages].map(path => `  <url><loc>${escape(canonical(path))}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`Built the Gallium site and ${documents.size} documentation pages in dist/site.`);
