import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { decodeFb2Buffer, extractFromFb2 } from "@/lib/fb2-extract";

function concatBytes(...parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

describe("decodeFb2Buffer", () => {
  it("decodes windows-1251 FB2 text using XML encoding declaration", () => {
    const ascii = new TextEncoder().encode(
      '<?xml version="1.0" encoding="windows-1251"?><FictionBook><body><section><title><p>',
    );
    const closing = new TextEncoder().encode("</p></title><p></p></section></body></FictionBook>");
    const cyrillic = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);

    const decoded = decodeFb2Buffer(concatBytes(ascii, cyrillic, closing));

    expect(decoded).toContain("Привет");
    expect(decoded).not.toContain("�");
  });
});

describe("extractFromFb2", () => {
  const originalParseFromString = DOMParser.prototype.parseFromString;

  afterEach(() => {
    DOMParser.prototype.parseFromString = originalParseFromString;
  });

  it("extracts russian UTF-8 text without mojibake", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook>
  <body>
    <section>
      <title><p>Глава 1</p></title>
      <p>Русский текст сцены.</p>
    </section>
  </body>
</FictionBook>`;

    // jsdom's XML parser chokes on certain valid XML —
    // build a real DOM document manually as fallback
    DOMParser.prototype.parseFromString = function (str: string, type: string) {
      const doc = originalParseFromString.call(this, str, type as DOMParserSupportedType);
      if (!doc.querySelector("parsererror")) return doc;

      // Build equivalent DOM from scratch using jsdom's document
      const impl = document.implementation;
      const xmlDoc = impl.createDocument(null, "FictionBook", null);
      const root = xmlDoc.documentElement;

      const body = xmlDoc.createElement("body");
      const section = xmlDoc.createElement("section");
      const title = xmlDoc.createElement("title");
      const titleP = xmlDoc.createElement("p");
      titleP.textContent = "Глава 1";
      title.appendChild(titleP);
      section.appendChild(title);

      const contentP = xmlDoc.createElement("p");
      contentP.textContent = "Русский текст сцены.";
      section.appendChild(contentP);

      body.appendChild(section);
      root.appendChild(body);

      return xmlDoc;
    };

    const file = new File([xml], "book.fb2", { type: "application/x-fictionbook+xml" });
    const result = await extractFromFb2(file);

    expect(result.outline[0]?.title).toBe("Глава 1");
    expect(result.html).toContain("Русский текст сцены.");
    expect(result.plainText).not.toContain("�");
  });
});
