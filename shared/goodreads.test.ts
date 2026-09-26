import { describe, expect, it } from "vitest";
import { importRowSchema } from "./schemas";
import {
  goodreadsReviewToText,
  mapGoodreadsBinding,
  mapGoodreadsRating,
  mapGoodreadsShelf,
  parseCsv,
  parseGoodreadsCsv,
  parseGoodreadsDate,
  unwrapGoodreadsValue,
} from "./goodreads";

const HEADER =
  "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, commas and newlines inside fields, BOM and CRLF", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "line1\nline2"],
    ]);
  });
});

describe("Goodreads field mapping", () => {
  it("unwraps spreadsheet-safe ISBNs and parses dates", () => {
    expect(unwrapGoodreadsValue('="0439023483"')).toBe("0439023483");
    expect(unwrapGoodreadsValue('=""')).toBe("");
    expect(parseGoodreadsDate("2024/3/2")).toBe("2024-03-02");
    expect(parseGoodreadsDate("")).toBeNull();
    expect(parseGoodreadsDate("March 2024")).toBeNull();
  });

  it("maps shelves, ratings and bindings", () => {
    expect(mapGoodreadsShelf("read")).toBe("finished");
    expect(mapGoodreadsShelf("currently-reading")).toBe("reading");
    expect(mapGoodreadsShelf("to-read")).toBe("tbr");
    expect(mapGoodreadsShelf("did-not-finish")).toBe("abandoned");
    expect(mapGoodreadsShelf("favorites")).toBe("tbr");
    expect([5, 4, 3, 2, 1, 0].map((n) => mapGoodreadsRating(String(n)))).toEqual(["loved", "liked", "mixed", "disliked", "hated", null]);
    expect(mapGoodreadsBinding("Kindle Edition")).toBe("ebook");
    expect(mapGoodreadsBinding("Mass Market Paperback")).toBe("paperback");
    expect(mapGoodreadsBinding("Audible Audio")).toBe("audiobook");
    expect(mapGoodreadsBinding("Hardcover")).toBe("hardcover");
  });

  it("converts review HTML to plain text", () => {
    expect(goodreadsReviewToText("Loved it.<br/><br/>Would <i>re-read</i> &amp; recommend")).toBe("Loved it.\n\nWould re-read & recommend");
  });
});

describe("parseGoodreadsCsv", () => {
  it("produces rows that satisfy the server's import schema", () => {
    const csv = `${HEADER}
2767052,"The Hunger Games (The Hunger Games, #1)",Suzanne Collins,"Collins, Suzanne",,"=""0439023483""","=""9780439023481""",5,4.33,Scholastic Press,Hardcover,374,2008,2008,2024/03/02,2024/02/01,"favorites",,read,"Great<br/>book",true,"my note",1,0
3,"Book With Only ISBN10",Jane Doe,"Doe, Jane","Co Author, Another Person","=""0439023483""","=""""",0,0,,Paperback,,,1999,,2024/01/05,to-read,,to-read,,,,0,0
4,,No Title,,,,,,,,,,,,,,,,read,,,,,
`;
    const result = parseGoodreadsCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toEqual([{ line: 4, title: "", message: "Missing title" }]);
    const [hg, second] = result.rows;
    expect(hg).toMatchObject({
      goodreadsId: "2767052",
      title: "The Hunger Games (The Hunger Games, #1)",
      authors: ["Suzanne Collins"],
      isbn13: "9780439023481",
      isbn10: "0439023483",
      status: "finished",
      dateRead: "2024-03-02",
      sentiment: "loved",
      review: "Great\nbook",
      containsSpoilers: true,
      privateNotes: "my note",
      format: "hardcover",
      pageCount: 374,
      shelves: ["favorites"],
    });
    expect(second).toMatchObject({ authors: ["Jane Doe", "Co Author", "Another Person"], isbn13: "9780439023481", status: "tbr", sentiment: null, publishedYear: 1999 });
    for (const row of result.rows) expect(importRowSchema.safeParse(row).success).toBe(true);
    expect(result.stats).toMatchObject({ finished: 1, tbr: 1, reviews: 1 });
  });

  it("rejects files that are not Goodreads exports", () => {
    const result = parseGoodreadsCsv("name,email\nx,y\n");
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.message).toMatch(/does not look like a Goodreads/);
  });

  it("strips control characters from imported text", () => {
    const csv = `${HEADER}\n1,"Bad\u0007Title",Auth\u0000or,,,,,0,0,,,,,,,,,,read,,,,,\n`;
    const [row] = parseGoodreadsCsv(csv).rows;
    expect(row?.title).toBe("BadTitle");
    expect(row?.authors).toEqual(["Author"]);
    expect(importRowSchema.safeParse(row).success).toBe(true);
  });
});
