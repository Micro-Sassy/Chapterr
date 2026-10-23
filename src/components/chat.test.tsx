import { QueryClient } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { DiscussionRoom, Page } from "@shared/types";
import { extractMentionUsernames, insertMention, mentionQueryAt, parseMentions, renderMentions } from "@/lib/mentions";
import { applyMessageEvent, applyReactionEvent, applyThreadReplyEvent } from "@/lib/realtime";
import { mockFetch, renderWithProviders } from "@/test/utils";
import { Composer, filterMembers } from "./chat/Composer";
import { gateLabel, lockedCopy, reachedGate } from "./chat/gate";
import { ReactionBar } from "./chat/ReactionBar";
import { RoomCard } from "./chat/RoomCard";
import { messagesKey, threadKey, type ChatMessage, type MessagePages } from "./chat/types";
import { toggleLocally } from "./chat/useChat";

const bob = { id: "u2", username: "bob", displayName: "Bob Bell", avatarUrl: null };
const alice = { id: "u3", username: "alice.w", displayName: "Alice Wren", avatarUrl: null };
const edition = { id: "e1", bookId: "b1", title: "Dune", subtitle: null, authors: ["Frank Herbert"], coverUrl: null, isbn13: null, publishedYear: 1965, format: "paperback" as const, pageCount: 400 };

describe("mentions", () => {
  it("parses @username tokens and leaves emails and punctuation alone", () => {
    const segs = parseMentions("Hi @bob, ask @alice.w. Mail me@example.com");
    expect(segs.filter((s) => s.type === "mention").map((s) => (s.type === "mention" ? s.username : ""))).toEqual(["bob", "alice.w"]);
    expect(segs.map((s) => (s.type === "text" ? s.text : s.raw)).join("")).toBe("Hi @bob, ask @alice.w. Mail me@example.com");
    expect(extractMentionUsernames("@Bob and @bob again, @alice.w")).toEqual(["bob", "alice.w"]);
  });

  it("renders known mentions as links to the member profile inside the club", () => {
    render(<MemoryRouter>{renderMentions("Hi @bob and @nobody", "c1", ["bob"])}</MemoryRouter>);
    const link = screen.getByRole("link", { name: "@bob" });
    expect(link).toHaveAttribute("href", "/c/c1/members/bob");
    expect(screen.queryByRole("link", { name: "@nobody" })).not.toBeInTheDocument();
    expect(screen.getByText("@nobody")).toBeInTheDocument();
  });

  it("finds the mention query at the caret and inserts the chosen username", () => {
    expect(mentionQueryAt("hello @bo", 9)).toEqual({ start: 6, query: "bo" });
    expect(mentionQueryAt("mail me@ex", 10)).toBeNull();
    expect(mentionQueryAt("plain text", 10)).toBeNull();
    const next = insertMention("hello @bo there", 6, 9, "bob");
    expect(next.text).toBe("hello @bob  there");
    expect(next.caret).toBe(11);
  });

  it("ranks members by username prefix, then name words", () => {
    expect(filterMembers([alice, bob], "b").map((m) => m.username)).toEqual(["bob"]);
    expect(filterMembers([alice, bob], "wr").map((m) => m.username)).toEqual(["alice.w"]);
    expect(filterMembers([alice, bob], "").map((m) => m.username)).toEqual(["alice.w", "bob"]);
  });
});

describe("gate copy", () => {
  it("words each gate plainly", () => {
    expect(gateLabel({ gateType: "chapter", gateValue: 6 })).toBe("Opens at chapter 6");
    expect(gateLabel({ gateType: "page", gateValue: 120 })).toBe("Opens at page 120");
    expect(gateLabel({ gateType: "percent", gateValue: 50 })).toBe("Opens at 50%");
    expect(gateLabel({ gateType: "finished", gateValue: null })).toBe("Opens when you finish the book");
    expect(gateLabel({ gateType: "none", gateValue: null })).toBe("Open to everyone");
    expect(lockedCopy({ gateType: "chapter", gateValue: 6 })).toContain("chapter 6");
  });

  it("mirrors the server gate on the client", () => {
    const gate = { gateType: "chapter" as const, gateValue: 6 };
    expect(reachedGate({ chapter: 5, page: null, percent: null, finished: false, updatedAt: null }, gate)).toBe(false);
    expect(reachedGate({ chapter: 6, page: null, percent: null, finished: false, updatedAt: null }, gate)).toBe(true);
    expect(reachedGate({ chapter: null, page: null, percent: null, finished: true, updatedAt: null }, gate)).toBe(true);
    expect(reachedGate(null, { gateType: "none", gateValue: null })).toBe(true);
  });

  it("shows a locked room with its gate and no way in", () => {
    const room: DiscussionRoom = {
      id: "r1",
      clubId: "c1",
      edition,
      kind: "chapter",
      title: "Chapter 6",
      position: 6,
      gateType: "chapter",
      gateValue: 6,
      conversationId: "cv1",
      unlocked: false,
      membersInside: 3,
      messageCount: 12,
      lastMessageAt: null,
      questions: [],
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const onOpen = vi.fn();
    render(
      <ul>
        <RoomCard room={room} onOpen={onOpen} />
      </ul>,
    );
    expect(screen.getByText("Opens at chapter 6")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Chapter 6, locked/)).toHaveAttribute("aria-disabled", "true");
  });
});

describe("ReactionBar", () => {
  it("opens the curated picker and toggles a reaction", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ReactionBar reactions={[{ emoji: "📚", count: 2, mine: true }]} onToggle={onToggle} />);
    const mine = screen.getByRole("button", { name: /Books, 2, you reacted/ });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    await user.click(mine);
    expect(onToggle).toHaveBeenCalledWith("📚");

    await user.click(screen.getByRole("button", { name: "Add reaction" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a reaction" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(16);
    await user.click(within(dialog).getByRole("button", { name: "Thumbs up" }));
    expect(onToggle).toHaveBeenLastCalledWith("👍");
    expect(screen.queryByRole("dialog", { name: "Choose a reaction" })).not.toBeInTheDocument();
  });

  it("closes the picker on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ReactionBar reactions={[]} onToggle={() => undefined} />);
    const trigger = screen.getByRole("button", { name: "Add reaction" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Thumbs up" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("toggles a local summary the way the server will", () => {
    expect(toggleLocally([], "👍")).toEqual([{ emoji: "👍", count: 1, mine: true }]);
    expect(toggleLocally([{ emoji: "👍", count: 1, mine: true }], "👍")).toEqual([]);
    expect(toggleLocally([{ emoji: "👍", count: 2, mine: false }], "👍")).toEqual([{ emoji: "👍", count: 3, mine: true }]);
  });
});

describe("Composer", () => {
  it("sends on Enter and breaks a line on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    mockFetch({});
    renderWithProviders(<Composer clubId="c1" members={[bob, alice]} onSend={onSend} />);
    const box = screen.getByLabelText("Message");
    await user.type(box, "First line{Shift>}{Enter}{/Shift}second line");
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("First line\nsecond line");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith({ body: "First line\nsecond line", attachmentFileIds: [], localPreviews: [] });
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("offers members after @ and inserts the chosen username on Enter", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    mockFetch({});
    renderWithProviders(<Composer clubId="c1" members={[bob, alice]} onSend={onSend} />);
    const box = screen.getByLabelText("Message");
    await user.type(box, "Hey @bo");
    const list = screen.getByRole("listbox", { name: "Members" });
    expect(within(list).getByRole("option", { name: /Bob Bell/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("Hey @bob ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not send an empty message", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    mockFetch({});
    renderWithProviders(<Composer clubId="c1" members={[]} onSend={onSend} />);
    await user.type(screen.getByLabelText("Message"), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});

describe("realtime cache helpers", () => {
  const base = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    conversationId: "cv1",
    sender: bob,
    body: `m${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    parentId: null,
    replyCount: 0,
    attachments: [],
    mentions: [],
    reactions: [],
    kind: "user",
    ...extra,
  });
  const pages = (items: ChatMessage[]): MessagePages => ({ pages: [{ items, nextCursor: null } as Page<ChatMessage>], pageParams: [null] });

  it("merges reactions wherever the message is cached", () => {
    const qc = new QueryClient();
    qc.setQueryData(messagesKey("cv1"), pages([base("1"), base("2")]));
    qc.setQueryData(threadKey("1"), pages([base("3", { parentId: "1" })]));
    applyReactionEvent(qc, "3", [{ emoji: "👍", count: 1, mine: false }]);
    const thread = qc.getQueryData<MessagePages>(threadKey("1"))!;
    expect(thread.pages[0]!.items[0]!.reactions).toEqual([{ emoji: "👍", count: 1, mine: false }]);
    expect(qc.getQueryData<MessagePages>(messagesKey("cv1"))!.pages[0]!.items[0]!.reactions).toEqual([]);
  });

  it("bumps the reply count and appends the reply to an open thread", () => {
    const qc = new QueryClient();
    qc.setQueryData(messagesKey("cv1"), pages([base("1")]));
    qc.setQueryData(threadKey("1"), pages([]));
    applyThreadReplyEvent(qc, { parentId: "1", replyCount: 4, message: base("9") });
    expect(qc.getQueryData<MessagePages>(messagesKey("cv1"))!.pages[0]!.items[0]!.replyCount).toBe(4);
    const thread = qc.getQueryData<MessagePages>(threadKey("1"))!;
    expect(thread.pages[0]!.items.map((m) => m.id)).toEqual(["9"]);
    // The reply does not join the main list.
    expect(qc.getQueryData<MessagePages>(messagesKey("cv1"))!.pages[0]!.items).toHaveLength(1);
  });

  it("appends new messages and replaces edited ones", () => {
    const qc = new QueryClient();
    qc.setQueryData(messagesKey("cv1"), pages([base("1")]));
    applyMessageEvent(qc, base("2"));
    applyMessageEvent(qc, base("1", { body: "edited", editedAt: "2026-01-02T00:00:00.000Z" }));
    const items = qc.getQueryData<MessagePages>(messagesKey("cv1"))!.pages[0]!.items;
    expect(items.map((m) => m.id)).toEqual(["1", "2"]);
    expect(items[0]!.body).toBe("edited");
  });
});

describe("quiet message kinds", () => {
  it("renders welcome notes without a bubble", async () => {
    const { MessageItem } = await import("./chat/MessageItem");
    render(
      <MemoryRouter>
        <MessageItem message={{ id: "w", conversationId: "cv1", sender: bob, body: "@alice.w welcome to the club.", createdAt: "2026-01-01T00:00:00.000Z", editedAt: null, deletedAt: null, kind: "welcome" }} own={false} clubId="c1" knownUsernames={new Set(["alice.w"])} />
      </MemoryRouter>,
    );
    const note = screen.getByRole("note", { name: "Welcome" });
    expect(within(note).getByRole("link", { name: "@alice.w" })).toHaveAttribute("href", "/c/c1/members/alice.w");
  });
});
