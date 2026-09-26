import { describe, expect, it } from "vitest";
import { cleanIsbn, isbn10To13, isbn13To10, isValidIsbn10, isValidIsbn13, looksLikeIsbn, normalizeIsbn } from "./isbn";

describe("ISBN utilities", () => {
  it("validates check digits", () => {
    expect(isValidIsbn13("9780439023481")).toBe(true);
    expect(isValidIsbn13("9780439023482")).toBe(false);
    expect(isValidIsbn10("0439023483")).toBe(true);
    expect(isValidIsbn10("080442957X")).toBe(true);
    expect(isValidIsbn10("0439023484")).toBe(false);
  });

  it("converts between ISBN-10 and ISBN-13", () => {
    expect(isbn10To13("0439023483")).toBe("9780439023481");
    expect(isbn13To10("9780439023481")).toBe("0439023483");
    expect(isbn13To10("9791032305690")).toBeNull(); // 979 prefixes have no ISBN-10
  });

  it("normalises messy input, preferring ISBN-13", () => {
    expect(cleanIsbn("978-0-439-02348-1")).toBe("9780439023481");
    expect(normalizeIsbn("0-439-02348-3")).toEqual({ isbn13: "9780439023481", isbn10: "0439023483" });
    expect(normalizeIsbn("not an isbn")).toEqual({ isbn13: null, isbn10: null });
    expect(looksLikeIsbn("978 0439023481")).toBe(true);
    expect(looksLikeIsbn("the hobbit")).toBe(false);
  });
});
