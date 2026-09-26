import { describe, expect, it } from "vitest";
import { meetingSchema, registerSchema, shareCreateSchema, userBookSchema, usernameSchema } from "./schemas";

describe("usernames", () => {
  it("normalises case and rejects confusing or reserved handles", () => {
    expect(usernameSchema.parse("  Reader_One ")).toBe("reader_one");
    for (const bad of ["ab", "has space", "émile", "_leading", "trailing_", "double__under", "admin", "Ｒeader"]) {
      expect(usernameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("registration", () => {
  const base = { username: "reader", displayName: "Reader", email: "Reader@Example.com", password: "long enough pw", confirmPassword: "long enough pw", acceptPrivacy: true };
  it("requires matching passwords and privacy acceptance", () => {
    expect(registerSchema.parse(base).email).toBe("reader@example.com");
    expect(registerSchema.safeParse({ ...base, confirmPassword: "different" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, acceptPrivacy: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
  });
});

describe("library and club inputs", () => {
  it("rejects finish dates before start dates", () => {
    expect(userBookSchema.safeParse({ editionId: "e1", status: "finished", startedAt: "2024-05-01", finishedAt: "2024-04-01" }).success).toBe(false);
    expect(userBookSchema.parse({ editionId: "e1", status: "tbr", startedAt: "", currentPage: "" })).toMatchObject({ startedAt: null, currentPage: null, visibility: "club" });
  });

  it("requires meeting end after start", () => {
    expect(meetingSchema.safeParse({ title: "M", startsAt: "2030-01-01T18:00:00.000Z", endsAt: "2030-01-01T17:00:00.000Z" }).success).toBe(false);
  });

  it("cannot describe a chat as a shareable resource", () => {
    expect(shareCreateSchema.safeParse({ resourceType: "conversation", resourceId: "club" }).success).toBe(false);
    expect(shareCreateSchema.safeParse({ resourceType: "message", resourceId: "m1" }).success).toBe(false);
  });
});
