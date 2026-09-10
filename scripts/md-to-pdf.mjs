// md-to-pdf.mjs — render one of the docs/*.md files as a readable PDF.
//
//   node scripts/md-to-pdf.mjs docs/packing-features-guide.md
//   node scripts/md-to-pdf.mjs docs/packing-features-guide.md outputs/guide.pdf
//
// Deliberately dependency-free apart from Playwright, which is already here:
// `marked` is imported by the older training generators but is not installed,
// and adding a Markdown toolchain to render one document is not worth the
// lockfile churn. The subset below is the subset docs/*.md actually uses —
// headings, rules, GFM tables, nested lists, block quotes, and inline
// emphasis / code / links.
//
// The browser is the Edge or Chrome already on the machine, driven through
// Playwright with an explicit executablePath, matching
// scripts/generate-system-overview-training.mjs. No browser download.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ── Markdown ────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inline formatting. Code spans are extracted first and restored last, so a
 * `**` inside `code` is never read as emphasis.
 */
function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = escapeHtml(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // Two trailing spaces is Markdown's hard break; every other newline inside a
  // paragraph is just wrapping, and joins with a space.
  out = out.replace(/ {2}\n/g, "<br>").replace(/\n/g, " ");
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^-{3,}\s*$/;
const ORDERED = /^(\d+)\.\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** A table row split into cells: `| a | b |` -> ["a", "b"]. */
function cells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isDelimiterRow(line) {
  return /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

/** How far a continuation line under a list marker has to be indented. */
function indentOf(line) {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

function dedent(lines, width) {
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(width)));
}

/**
 * Blocks, in the order they have to be tried. Lists collect their own
 * indented continuation lines and render them by recursion, which is what
 * keeps a table nested under a numbered step inside that step.
 */
function render(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    // Table: a header row followed by a |---|---| delimiter.
    if (line.includes("|") && index + 1 < lines.length && isDelimiterRow(lines[index + 1])) {
      const head = cells(line);
      index += 2;
      const body = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        body.push(cells(lines[index]));
        index += 1;
      }
      html.push(
        "<table><thead><tr>" +
        head.map((cell) => `<th>${inline(cell)}</th>`).join("") +
        "</tr></thead><tbody>" +
        body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("") +
        "</tbody></table>",
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])[1]);
        index += 1;
      }
      html.push(`<blockquote>${render(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = BULLET.exec(line);
    if (ordered || bullet) {
      const tag = ordered ? "ol" : "ul";
      const marker = ordered ? ORDERED : BULLET;
      const items = [];
      while (index < lines.length) {
        const match = marker.exec(lines[index]);
        if (!match) break;
        const first = ordered ? match[2] : match[1];
        const continuationIndent = lines[index].indexOf(first);
        const owned = [first];
        index += 1;
        // Everything indented under this marker belongs to this item,
        // blank lines included, until a line returns to column zero.
        while (index < lines.length) {
          const next = lines[index];
          if (next.trim() === "") {
            const following = lines[index + 1];
            if (following === undefined || indentOf(following) < continuationIndent) break;
            owned.push("");
            index += 1;
            continue;
          }
          if (indentOf(next) < continuationIndent) break;
          owned.push(next);
          index += 1;
        }
        const body = [owned[0], ...dedent(owned.slice(1), continuationIndent)].join("\n");
        // A one-line item stays a plain <li>; anything richer is recursed so
        // its tables and sub-lists survive.
        // A blank line between two items is a loose list, not the end of one.
        while (
          index + 1 < lines.length && lines[index].trim() === "" && marker.test(lines[index + 1])
        ) index += 1;
        items.push(
          owned.length === 1
            ? `<li>${inline(owned[0])}</li>`
            : `<li>${render(body).replace(/^<p>/, "<p class=\"lead\">")}</li>`,
        );
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // Paragraph: runs until a blank line or the start of another block.
    const paragraph = [];
    while (index < lines.length) {
      const next = lines[index];
      if (
        next.trim() === "" || HEADING.test(next) || RULE.test(next) || QUOTE.test(next) ||
        ORDERED.test(next) || BULLET.test(next) ||
        (next.includes("|") && isDelimiterRow(lines[index + 1] ?? ""))
      ) break;
      // A hard break is kept as the two trailing spaces `inline` looks for.
      paragraph.push(next.trim() + (/ {2}$/.test(next) ? "  " : ""));
      index += 1;
    }
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join("\n"))}</p>`);
  }

  return html.join("\n");
}

// ── Page ────────────────────────────────────────────────────────────────────

const CSS = `
  @page { size: Letter; margin: 18mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 10.5pt/1.55 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: #16303d;
    -webkit-print-color-adjust: exact;
  }
  h1 {
    font-size: 22pt; line-height: 1.2; margin: 0 0 4pt;
    color: #0b2434; letter-spacing: -0.01em;
  }
  h2 {
    font-size: 14pt; margin: 20pt 0 6pt; padding-top: 8pt;
    color: #0b2434; border-top: 2px solid #0f9d96;
    break-after: avoid; page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt; margin: 14pt 0 4pt; color: #087b76;
    break-after: avoid; page-break-after: avoid;
  }
  p { margin: 0 0 7pt; }
  a { color: #087b76; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #d7e2e6; margin: 14pt 0; }
  strong { color: #0b2434; }
  code {
    font-family: "Cascadia Mono", Consolas, monospace; font-size: 9.5pt;
    background: #eff7f7; border: 1px solid #d7e2e6; border-radius: 3px;
    padding: 0 3px; white-space: nowrap;
  }
  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin: 0 0 4pt; break-inside: avoid; page-break-inside: avoid; }
  li > p { margin: 0 0 5pt; }
  li > p.lead { margin-bottom: 5pt; }
  blockquote {
    margin: 8pt 0; padding: 7pt 10pt;
    background: #fff3df; border-left: 3px solid #f47c20;
    break-inside: avoid; page-break-inside: avoid;
  }
  blockquote p { margin: 0 0 4pt; }
  blockquote p:last-child { margin-bottom: 0; }
  table {
    width: 100%; border-collapse: collapse; margin: 6pt 0 10pt;
    font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid;
  }
  th {
    text-align: left; background: #123247; color: #fff;
    padding: 5pt 7pt; font-weight: 600; font-size: 9pt;
  }
  td { padding: 5pt 7pt; border-bottom: 1px solid #d7e2e6; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f7fbfb; }
  /* The title block: everything above the first rule. */
  body > p:first-of-type { color: #667985; }
`;

const HEADER = `
  <div style="width:100%;font:7pt 'Segoe UI',Arial,sans-serif;color:#667985;padding:0 16mm;">
    <span style="float:left">Warehouse Wizard</span>
    <span style="float:right">__TITLE__</span>
  </div>`;

const FOOTER = `
  <div style="width:100%;font:7pt 'Segoe UI',Arial,sans-serif;color:#667985;padding:0 16mm;">
    <span style="float:left">__DATE__</span>
    <span style="float:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/md-to-pdf.mjs <input.md> [output.pdf]");
    process.exit(1);
  }
  const inputPath = path.resolve(root, input);
  const outputPath = path.resolve(
    root,
    process.argv[3] ?? path.join("outputs", `${path.basename(inputPath, ".md")}.pdf`),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const markdown = fs.readFileSync(inputPath, "utf8");
  const title = (/^#\s+(.*)$/m.exec(markdown)?.[1] ?? path.basename(inputPath, ".md")).trim();
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${CSS}</style></head><body>${render(markdown)}</body></html>`;
  // The HTML is a printing intermediate, not an artifact: it goes to the OS
  // temp directory so it cannot be mistaken for a document to commit.
  const htmlPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "ww-md-pdf-")),
    `${path.basename(outputPath, ".pdf")}.html`,
  );
  fs.writeFileSync(htmlPath, html);

  const executablePath = BROWSERS.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("No Chrome or Edge found to print with.");

  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.pdf({
    path: outputPath,
    format: "Letter",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: HEADER.replace("__TITLE__", escapeHtml(title)),
    footerTemplate: FOOTER.replace("__DATE__", escapeHtml(date)),
    margin: { top: "20mm", right: "16mm", bottom: "16mm", left: "16mm" },
  });
  await browser.close();

  console.log(JSON.stringify({ source: input, html: htmlPath, pdf: outputPath }, null, 2));
}

await main();
