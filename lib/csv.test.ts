// @vitest-environment node
import { describe, expect, test } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  test("joins rows with CRLF and quotes only when needed", () => {
    expect(toCsv([["Name", "Email"], ["Asha", "asha@test.com"]])).toBe("Name,Email\r\nAsha,asha@test.com");
  });

  test("quotes commas, quotes and line breaks", () => {
    expect(toCsv([['Rao, "Ravi"', "line\nbreak"]])).toBe('"Rao, ""Ravi""","line\nbreak"');
  });

  test("neutralises spreadsheet formulas", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", "+1", "-1", "@a"]])).toBe('"\'=HYPERLINK(""x"")",\'+1,\'-1,\'@a');
  });

  test("writes missing values as empty cells", () => {
    expect(toCsv([["a", undefined, "c"]])).toBe("a,,c");
  });
});
