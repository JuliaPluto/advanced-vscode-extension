import type { CellResultData } from "@plutojl/rainbow";
import { terminalPresentation } from "../terminalPresentation.ts";
import {
  htmlEscape,
  scriptJson,
  terminalOutputHtml,
  TRANSPORT_DECODER_JS,
} from "../terminalOutputHtml.ts";
import { toTransport } from "../outputKind.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff,
]);

describe("terminalPresentation", () => {
  it("prints a text/plain byte body as its text", () => {
    expect(
      terminalPresentation({ mime: "text/plain", body: utf8("<svg") }, true)
    ).toEqual({
      kind: "text",
      text: "<svg",
    });
  });

  it("never prints raw bytes", () => {
    const shown = terminalPresentation(
      { mime: "application/octet-stream", body: png },
      true
    );
    expect(shown).toEqual({
      kind: "text",
      label: "Output: application/octet-stream",
      text: "(9 bytes, not shown in the terminal)",
    });
  });

  it("prints a string body only when its mime is text", () => {
    expect(
      terminalPresentation({ mime: "application/pdf", body: "%PDF-1.4" }, true)
    ).toEqual({
      kind: "text",
      label: "Output: application/pdf",
      text: "(8 bytes, not shown in the terminal)",
    });
  });

  it("opens images and HTML in the webview when it can", () => {
    for (const output of [
      { mime: "image/png", body: png },
      { mime: "image/svg+xml", body: utf8("<svg/>") },
      { mime: "text/html", body: "<b>x</b>" },
    ]) {
      expect(terminalPresentation(output, true)).toEqual({ kind: "webview" });
    }
  });

  it("describes images without a webview, and ones rainbow cannot draw", () => {
    expect(
      terminalPresentation({ mime: "image/png", body: png }, false)
    ).toMatchObject({
      label: "Image: image/png",
      text: "(9 bytes, not shown in the terminal)",
    });
    expect(
      terminalPresentation({ mime: "image/webp", body: png }, true)
    ).toMatchObject({
      kind: "text",
      label: "Image: image/webp",
    });
  });

  it("prints JSON mimes rainbow cannot render instead of opening a webview", () => {
    expect(
      terminalPresentation(
        { mime: "application/vnd.plotly.v1+json", body: utf8('{"data":[]}') },
        true
      )
    ).toEqual({
      kind: "text",
      label: "Output: application/vnd.plotly.v1+json",
      text: '{"data":[]}',
    });
  });

  it("strips HTML to text without a webview", () => {
    expect(
      terminalPresentation(
        { mime: "text/html", body: "<p>a &amp; b</p><br>c" },
        false
      )
    ).toEqual({ kind: "text", label: "HTML Output", text: "a & b\n\nc" });
  });

  it("prints tree objects as JSON", () => {
    const body = { type: "Array", elements: [[1, ["2", "text/plain"]]] };
    expect(
      terminalPresentation(
        { mime: "application/vnd.pluto.tree+object", body },
        true
      )
    ).toEqual({
      kind: "text",
      label: "Output: application/vnd.pluto.tree+object",
      text: JSON.stringify(body, null, 2),
    });
  });

  it("prints an error message with its Julia frames", () => {
    const shown = terminalPresentation(
      {
        mime: "application/vnd.pluto.stacktrace+object",
        body: {
          msg: "boom",
          stacktrace: [
            {
              call: "error(s::String)",
              file: "error.jl",
              line: 35,
              from_c: false,
            },
            { call: "jl_apply", file: "julia.h", line: 1, from_c: true },
            {
              call: "top-level scope",
              file: "t70.jl#==#abc",
              line: 1,
              from_c: false,
            },
          ],
        },
      },
      true
    );
    expect(shown).toEqual({
      kind: "text",
      label: "Error",
      text: "boom\n  error(s::String) @ error.jl:35\n  top-level scope @ t70.jl#==#abc:1",
    });
  });

  it("shows nothing for an empty output", () => {
    expect(
      terminalPresentation({ mime: "text/plain", body: null }, true)
    ).toBeUndefined();
    expect(terminalPresentation(undefined, true)).toBeUndefined();
  });
});

describe("terminal output webview page", () => {
  const options = {
    cspSource: "vscode-webview://abc",
    cssUri: 'https://file+.vscode-resource/ext"dir/dist/renderer.css',
    rainbowVersion: "0.6.21",
  };
  const result = (output: unknown) =>
    ({ cell_id: "c1", output }) as unknown as CellResultData;
  const sentIn = (page: string) =>
    JSON.parse(/const sent = (.*);\n/.exec(page)![1]);

  it("keeps a body containing </script> inside the script", () => {
    const attack = "</script><img src=x onerror=alert(1)><!-- \u2028\u2029 &";
    const page = terminalOutputHtml(
      result({ mime: "text/html", body: attack }),
      options
    );
    expect(page.match(/<\/script>/gi)).toHaveLength(1);
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<!-- ");
    expect(page).not.toMatch(/[\u2028\u2029]/);
    expect(sentIn(page).output.body).toBe(attack);
  });

  it("escapes the mime and the stylesheet URI into the HTML", () => {
    const page = terminalOutputHtml(
      result({ mime: '<b onmouseover="x">', body: "x" }),
      options
    );
    expect(page).toContain("MIME: &lt;b onmouseover=&quot;x&quot;&gt;");
    expect(page).toContain(
      'href="https://file+.vscode-resource/ext&quot;dir/dist/renderer.css"'
    );
  });

  it("delivers image bytes the inline decoder restores byte for byte", () => {
    const page = terminalOutputHtml(
      result({ mime: "image/png", body: png }),
      options
    );
    const fromTransport = new Function(`return ${TRANSPORT_DECODER_JS}`)();
    const output = fromTransport(sentIn(page).output);
    expect(output.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(output.body)).toEqual(Array.from(png));
  });

  it("decodes nested byte stand-ins like fromTransport", () => {
    const fromTransport = new Function(`return ${TRANSPORT_DECODER_JS}`)();
    const tree = toTransport({
      mime: "application/vnd.pluto.tree+object",
      body: { type: "Array", elements: [[1, [png, "image/png"]]] },
    });
    const back = fromTransport(JSON.parse(scriptJson(tree)));
    expect(Array.from(back.body.elements[0][1][0])).toEqual(Array.from(png));
  });

  it("produces script JSON that parses back to the value", () => {
    const value = { a: "</script>", b: "\u2028", c: "&<>" };
    expect(JSON.parse(scriptJson(value))).toEqual(value);
    expect(htmlEscape(`<a href="x">'&`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;"
    );
  });
});
