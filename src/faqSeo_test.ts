import assert from "node:assert/strict";
import fs from "node:fs";

const pages = ["frontend-v1/index.html", "bankr/index.html"];

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleFaqs(html: string) {
  return [...html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
    .map((match) => ({ question: decode(match[1]), answer: decode(match[2]) }));
}

function faqSchema(html: string) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const script of scripts) {
    const value = JSON.parse(script[1]);
    const nodes = value["@graph"] ?? [value];
    const faq = nodes.find((node: any) => node["@type"] === "FAQPage");
    if (faq) {
      return faq.mainEntity.map((entry: any) => ({
        question: entry.name,
        answer: entry.acceptedAnswer.text
      }));
    }
  }
  throw new Error("FAQPage schema not found");
}

for (const page of pages) {
  const html = fs.readFileSync(page, "utf8");
  const visible = visibleFaqs(html);
  const structured = faqSchema(html);
  assert.equal(visible.length, 30, `${page} must contain exactly 30 visible FAQs`);
  assert.equal((html.match(/class="faq-group"/g) ?? []).length, 6, `${page} must contain six FAQ groups`);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/, `${page} FAQs must start collapsed`);
  assert.deepEqual(structured, visible, `${page} FAQPage JSON-LD must match visible FAQ copy exactly`);
}

console.log("FAQ SEO/AEO parity contract passed.");
