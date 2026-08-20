import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeHtmlAttribute, escapeXmlAttribute } from "../src/utils/html.js";

void test("escapeHtmlAttribute escapes markup and quote entities with the HTML5 numeric apostrophe", () => {
    assert.strictEqual(
        escapeHtmlAttribute(`<tag attr="a & b" title='c'>`),
        "&lt;tag attr=&quot;a &amp; b&quot; title=&#39;c&#39;&gt;"
    );
    assert.strictEqual(escapeHtmlAttribute("plain text"), "plain text");
});

void test("escapeXmlAttribute escapes markup and quote entities with the XML named apostrophe", () => {
    assert.strictEqual(
        escapeXmlAttribute(`<tag attr="a & b" title='c'>`),
        "&lt;tag attr=&quot;a &amp; b&quot; title=&apos;c&apos;&gt;"
    );
    assert.strictEqual(escapeXmlAttribute("plain text"), "plain text");
});
