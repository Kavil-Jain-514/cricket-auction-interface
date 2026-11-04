// @vitest-environment node
import { describe, expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { SponsorBand } from "./SponsorBand";

const LOGO = "https://res.cloudinary.com/demo/image/upload/acme.png";

describe("SponsorBand", () => {
  test("shows each sponsor's name above its logo, with the name as alt and title", () => {
    const html = renderToString(<SponsorBand sponsors={[{ name: "Acme Steel", logoUrl: LOGO }]} />);
    const caption = html.indexOf(">Acme Steel</");
    expect(caption).toBeGreaterThan(-1);
    expect(caption).toBeLessThan(html.indexOf("<img"));
    expect(html).toContain('title="Acme Steel"');
    expect(html).toContain('alt="Acme Steel logo"');
  });

  test("escapes sponsor names", () => {
    const name = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const html = renderToString(<SponsorBand sponsors={[{ name, logoUrl: LOGO }]} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  test("a sponsor without a logo gets a monogram, not the name twice", () => {
    const html = renderToString(<SponsorBand sponsors={[{ name: "Bright Lights" }]} />);
    expect(html.match(/Bright Lights</g)).toHaveLength(1);
    expect(html).toContain(">BL<");
  });

  test("a blank name shows no caption and never 'undefined'", () => {
    const html = renderToString(<SponsorBand sponsors={[{ name: "  ", logoUrl: LOGO }]} />);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("<p");
    expect(html).toContain('alt="Sponsor logo"');
  });

  test("renders nothing without sponsors", () => {
    expect(renderToString(<SponsorBand sponsors={[]} />)).toBe("");
  });
});
