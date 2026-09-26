import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Review } from "@shared/types";
import { mockFetch, renderWithProviders } from "@/test/utils";
import { BookCover } from "./BookCover";
import { ReviewCard } from "./content";
import { ProgressBar } from "./ui";

const member = { id: "u2", username: "bob", displayName: "Bob B", avatarUrl: null };
const edition = { id: "e1", bookId: "b1", title: "Dune", subtitle: null, authors: ["Frank Herbert"], coverUrl: null, isbn13: null, publishedYear: 1965, format: "paperback" as const, pageCount: 400 };

describe("BookCover", () => {
  it("falls back to a placeholder when the image fails", () => {
    const { container } = render(<BookCover url="https://covers.openlibrary.org/b/id/1-M.jpg" title="Dune" />);
    const img = screen.getByAltText("Cover of Dune");
    fireEvent.error(img);
    expect(screen.queryByAltText("Cover of Dune")).not.toBeInTheDocument();
    expect(container.querySelector("[title='Dune']")).toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("exposes accessible progress values", () => {
    render(<ProgressBar value={3} max={12} label="Goal" />);
    const bar = screen.getByRole("progressbar", { name: "Goal" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "12");
  });
});

describe("ReviewCard", () => {
  const review: Review = {
    id: "r1",
    author: member,
    edition,
    body: "The spice must flow.",
    sentiment: "loved",
    visibility: "club",
    containsSpoilers: true,
    reactions: [{ reaction: "like", count: 2, mine: false }],
    isOwn: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("hides spoilers from other members until revealed and hides owner controls", async () => {
    mockFetch({});
    renderWithProviders(<ReviewCard review={review} />);
    expect(await screen.findByText("Loved it")).toBeInTheDocument();
    expect(screen.queryByText("The spice must flow.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show review with spoilers/ }));
    expect(screen.getByText("The spice must flow.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete review" })).not.toBeInTheDocument();
  });

  it("shows edit, delete and share controls to the author", async () => {
    mockFetch({});
    renderWithProviders(<ReviewCard review={{ ...review, isOwn: true, containsSpoilers: false }} />);
    expect(await screen.findByRole("button", { name: "Edit review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share publicly" })).toBeInTheDocument();
  });
});
