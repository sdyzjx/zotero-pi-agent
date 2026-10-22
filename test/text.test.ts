import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCharIndex, detectHeadings, findQuote, getRangeRects, searchPages, sliceWithHint, type PdfChar } from "../src/core/text.ts";

/** Build fake PDF chars: one char per glyph, lines split by "\n", 6pt wide glyphs. */
function makeChars(text: string): PdfChar[] {
  const chars: PdfChar[] = [];
  const lines = text.split("\n");
  lines.forEach((line, li) => {
    const y = 700 - li * 14;
    let x = 72;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === " ") {
        if (chars.length) chars[chars.length - 1].spaceAfter = true;
        x += 3;
        continue;
      }
      chars.push({ c, u: c, rect: [x, y, x + 6, y + 10], inlineRect: [72, y - 1, 540, y + 11] });
      x += 6;
    }
    if (chars.length && li < lines.length - 1) chars[chars.length - 1].lineBreakAfter = true;
  });
  return chars;
}

test("findQuote matches across line breaks and hyphenation", () => {
  const chars = makeChars("We propose a novel atten-\ntion mechanism that scales\nlinearly with sequence length.");
  const m = findQuote(chars, "a novel attention mechanism that scales linearly");
  assert.ok(m, "should match");
  const [s, e] = m!;
  assert.equal(chars[s].c, "a");
  assert.equal(chars[e].c, "y");
  const rects = getRangeRects(chars, s, e);
  assert.equal(rects.length, 3, "one rect per line");
});

test("findQuote normalizes quotes, dashes and ligatures", () => {
  const chars = makeChars("the “best” result—overall ﬁne");
  assert.ok(findQuote(chars, 'the "best" result-overall fine'));
});

test("findQuote fuzzy match tolerates small differences in the middle", () => {
  const chars = makeChars("Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task");
  const m = findQuote(chars, "Our model achieves 28.4 BLEU on WMT 2014 English-to-German translation task");
  assert.ok(m);
});

test("findQuote returns null when absent", () => {
  const chars = makeChars("completely different content here");
  assert.equal(findQuote(chars, "transformer architecture"), null);
});

test("buildCharIndex drops whitespace", () => {
  const idx = buildCharIndex(makeChars("a b\nc"));
  assert.equal(idx.text, "abc");
  assert.deepEqual(idx.map, [0, 1, 2]);
});

test("detectHeadings finds numbered and common section titles", () => {
  const pages = [
    "Attention Is All You Need\nAbstract\nThe dominant sequence transduction models are based on complex networks.\n1 Introduction\nRecurrent neural networks have been established.",
    "3.1 Encoder and Decoder Stacks\nThe encoder is composed of a stack.\nFigure 1: The Transformer architecture.\nReferences\n[1] Ba et al.",
  ];
  const titles = detectHeadings(pages).map((h) => h.title);
  assert.ok(titles.includes("Abstract"));
  assert.ok(titles.includes("1 Introduction"));
  assert.ok(titles.includes("3.1 Encoder and Decoder Stacks"));
  assert.ok(titles.includes("References"));
  assert.ok(!titles.some((t) => t.startsWith("Figure")));
});

test("searchPages finds phrases and multi-term windows with page numbers", () => {
  const pages = ["intro text about attention", "the scaled dot-product attention computes softmax of QK", "unrelated"];
  const hits = searchPages(pages, "dot-product attention");
  assert.equal(hits[0].page, 1);
  const multi = searchPages(pages, "softmax scaled");
  assert.equal(multi[0].page, 1);
});

test("sliceWithHint reports next offset", () => {
  const text = "a".repeat(100) + "\n" + "b".repeat(100);
  const s = sliceWithHint(text, 0, 120);
  assert.equal(s.nextOffset, 100);
  const rest = sliceWithHint(text, s.nextOffset!, 500);
  assert.equal(rest.nextOffset, null);
});
