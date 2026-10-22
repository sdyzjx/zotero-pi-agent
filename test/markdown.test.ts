import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarkdown } from "../src/shared/markdown.ts";

const md = createMarkdown((tex, display) => `[${display ? "D" : "I"}:${tex}]`);

test("inline $ math", () => {
  assert.equal(md.renderInline("Euler: $e^{i\\pi}+1=0$."), "Euler: [I:e^{i\\pi}+1=0].");
});

test("currency is not math", () => {
  assert.equal(md.renderInline("costs $5 and $10 today"), "costs $5 and $10 today");
});

test("\\( \\) and \\[ \\] delimiters", () => {
  assert.equal(md.renderInline("x is \\(a_i\\) here"), "x is [I:a_i] here");
  assert.match(md.render("\\[\n\\sum_i x_i\n\\]"), /\[D:\\sum_i x_i\]/);
});

test("$$ block math across lines", () => {
  const html = md.render("before\n\n$$\nE = mc^2\n$$\n\nafter");
  assert.match(html, /\[D:E = mc\^2\]/);
  assert.match(html, /<p>after<\/p>/);
});

test("unclosed math while streaming renders as text", () => {
  assert.match(md.render("$$\nE = mc"), /\$\$/);
});

test("raw HTML is escaped", () => {
  assert.match(md.render("<img src=x onerror=alert(1)>"), /&lt;img/);
});

test("page links pass validation", () => {
  assert.match(md.renderInline("[p. 5](page:5)"), /href="page:5"/);
  assert.doesNotMatch(md.renderInline("[x](javascript:alert(1))"), /href=/);
});
