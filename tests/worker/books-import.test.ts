import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseGoodreadsCsv } from "../../shared/goodreads";
import { as, createMember, installFetchMock, json, type Member } from "./helpers";

let alice: Member;

beforeAll(async () => {
  installFetchMock();
  alice = await createMember("books_a");
  vi.restoreAllMocks();
});
afterEach(() => vi.restoreAllMocks());

const olSearch = {
  docs: [
    {
      key: "/works/OL27482W",
      title: "The Hobbit",
      author_name: ["J.R.R. Tolkien"],
      first_publish_year: 1937,
      editions: { docs: [{ key: "/books/OL51709286M", title: "The Hobbit", isbn: ["9780395520215", "0395520215"], publisher: ["Houghton Mifflin"], publish_date: ["1984"], cover_i: 15223072, format: ["paperback"] }] },
    },
  ],
};
const olEdition = {
  key: "/books/OL51709286M",
  title: "The Hobbit",
  publishers: ["Houghton Mifflin Company"],
  publish_date: "1984",
  number_of_pages: 290,
  isbn_13: ["9780395520215"],
  isbn_10: ["0395520215"],
  covers: [15223072],
  works: [{ key: "/works/OL27482W" }],
  physical_format: "paperback",
  languages: [{ key: "/languages/eng" }],
};

function mockOpenLibrary() {
  return installFetchMock((url) => {
    if (url.startsWith("https://openlibrary.org/search.json")) return Response.json(olSearch);
    if (url.startsWith("https://openlibrary.org/books/OL51709286M.json")) return Response.json(olEdition);
    if (url.startsWith("https://openlibrary.org/books/OL77777777M.json"))
      return Response.json({ ...olEdition, key: "/books/OL77777777M", isbn_13: ["9780261102217"], isbn_10: ["0261102214"], number_of_pages: 310 });
    if (url.startsWith("https://openlibrary.org/works/OL27482W.json")) return Response.json({ description: "A hobbit's tale.", authors: [{ author: { key: "/authors/OL26320A" } }] });
    if (url.startsWith("https://openlibrary.org/authors/OL26320A.json")) return Response.json({ name: "J.R.R. Tolkien" });
    return undefined;
  });
}

describe("catalogue", () => {
  it("searches Open Library when no Google key is configured and stores editions by ISBN-13", async () => {
    mockOpenLibrary();
    const search = await json(await as(alice)("/api/books/search?q=hobbit"));
    expect(search.provider).toBe("open_library");
    expect(search.catalog[0]).toMatchObject({ providerId: "OL51709286M", isbn13: "9780395520215", existingEditionId: null });

    const added = await as(alice)("/api/books/editions/provider", { body: { provider: "open_library", providerId: "OL51709286M" } });
    expect(added.status).toBe(201);
    const edition = await json(added);
    expect(edition).toMatchObject({ isbn13: "9780395520215", isbn10: "0395520215", pageCount: 290, format: "paperback", authors: ["J.R.R. Tolkien"] });
    expect(edition.retailerLinks.some((l: any) => l.url.includes("9780395520215"))).toBe(true);

    // Adding again returns the same edition rather than a duplicate.
    const again = await json(await as(alice)("/api/books/editions/provider", { body: { provider: "open_library", providerId: "OL51709286M" } }));
    expect(again.id).toBe(edition.id);
    const search2 = await json(await as(alice)("/api/books/search?q=hobbit"));
    expect(search2.catalog[0].existingEditionId).toBe(edition.id);
    expect(search2.local.some((l: any) => l.id === edition.id)).toBe(true);
  });

  it("falls back gracefully when catalogue providers are down", async () => {
    installFetchMock((url) => (url.includes("openlibrary.org") ? new Response("down", { status: 503 }) : undefined));
    const search = await json(await as(alice)("/api/books/search?q=anything"));
    expect(search.provider).toBe("none");
    expect(search.providerError).toMatch(/manually/);
    const manual = await as(alice)("/api/books/editions", { body: { title: "Local Zine", authors: ["Neighbour"], format: "paperback" } });
    expect(manual.status).toBe(201);
  });

  it("rejects invalid ISBNs on manual entry", async () => {
    installFetchMock();
    const res = await as(alice)("/api/books/editions", { body: { title: "Bad", authors: ["X"], isbn: "9780000000000" } });
    expect(res.status).toBe(422);
  });
});

const CSV = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
2767052,"The Hunger Games (The Hunger Games, #1)",Suzanne Collins,"Collins, Suzanne",,"=""0439023483""","=""9780439023481""",5,4.33,Scholastic Press,Hardcover,374,2008,2008,2024/03/02,2024/02/01,,,read,"Great<br/>book",,,1,0
1,Untitled Draft,Someone,"Someone, S",,"=""""","=""""",0,0,,Paperback,,,,,2024/01/05,to-read,to-read (#1),to-read,,,,0,0
`;

describe("Goodreads import", () => {
  it("imports rows into the member's own library, reviews and goal counts", async () => {
    installFetchMock();
    const parsed = parseGoodreadsCsv(CSV);
    expect(parsed.rows).toHaveLength(2);
    const res = await as(alice)("/api/imports/goodreads/batch", {
      body: { rows: parsed.rows, totalRows: 2, isFinalBatch: true, visibility: "club", importReviews: true },
    });
    expect(res.status).toBe(200);
    const result = await json(res);
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0 });

    const library = await json<any[]>(await as(alice)("/api/library"));
    const hg = library.find((b) => b.edition.isbn13 === "9780439023481");
    expect(hg).toMatchObject({ status: "finished", finishedAt: "2024-03-02" });
    const reviews = await json<any[]>(await as(alice)("/api/reviews?scope=mine"));
    expect(reviews.find((r) => r.edition.isbn13 === "9780439023481")).toMatchObject({ sentiment: "loved", body: "Great\nbook" });

    // Re-importing updates rather than duplicating.
    const again = await json(
      await as(alice)("/api/imports/goodreads/batch", { body: { rows: parsed.rows, totalRows: 2, isFinalBatch: true } }),
    );
    expect(again).toMatchObject({ created: 0, updated: 2 });
    const imports = await json<any[]>(await as(alice)("/api/imports"));
    expect(imports[0].status).toBe("completed");
  });

  it("rejects malformed rows server-side", async () => {
    installFetchMock();
    const res = await as(alice)("/api/imports/goodreads/batch", {
      body: { rows: [{ title: "", authors: [], status: "read" }], totalRows: 1 },
    });
    expect(res.status).toBe(422);
  });
});

describe("fast add from a search result", () => {
  it("saves instantly from the hint and enriches details in the background", async () => {
    mockOpenLibrary();
    const res = await as(alice)("/api/books/editions/provider", {
      body: {
        provider: "open_library",
        providerId: "OL77777777M",
        hint: {
          title: "The Hobbit",
          authors: ["J.R.R. Tolkien"],
          isbn13: "9780261102217",
          publishedYear: 1984,
          coverUrl: "https://covers.openlibrary.org/b/id/15223072-M.jpg",
          format: "paperback",
        },
      },
    });
    expect([200, 201]).toContain(res.status);
    const edition = await json(res);
    expect(res.status).toBe(201);
    expect(edition.title).toBe("The Hobbit");
    expect(edition.pageCount).toBeNull(); // not in the hint; filled in afterwards
    // Background enrichment (awaited by the test harness) filled in the missing details.
    const detail = await json(await as(alice)(`/api/books/editions/${edition.id}`));
    expect(detail.edition.pageCount).toBe(310);
    expect(detail.edition.description).toBe("A hobbit's tale.");
  });

  it("does not depend on the catalogue being up and ignores untrusted cover hosts", async () => {
    installFetchMock((url) => (url.includes("openlibrary.org") ? new Response("down", { status: 503 }) : undefined));
    const res = await as(alice)("/api/books/editions/provider", {
      body: {
        provider: "open_library",
        providerId: "OL99999999M",
        hint: { title: "Offline Book", authors: ["Someone"], coverUrl: "https://evil.example/tracker.png" },
      },
    });
    expect(res.status).toBe(201);
    const edition = await json(res);
    expect(edition.title).toBe("Offline Book");
    expect(edition.coverUrl).toBeNull();
  });

  it("returns the existing edition for a provider id already in the catalogue", async () => {
    installFetchMock((url) => (url.includes("openlibrary.org") ? new Response("down", { status: 503 }) : undefined));
    const first = await json(
      await as(alice)("/api/books/editions/provider", { body: { provider: "open_library", providerId: "OL88888888M", hint: { title: "Dup", authors: ["A"] } } }),
    );
    const again = await as(alice)("/api/books/editions/provider", { body: { provider: "open_library", providerId: "OL88888888M", hint: { title: "Dup", authors: ["A"] } } });
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(first.id);
  });
});
