import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Poll, RsvpSummary } from "@shared/types";
import { dateKeyInZone, expandRecurrence, isoToZonedInput, monthGrid, nthWeekdayFor, tzOffsetMinutes, zonedToIso } from "@/lib/calendar";
import { applyRsvp } from "./meetings/api";
import { CalendarGrid } from "./meetings/CalendarGrid";
import { previewPaceSchedule } from "./meetings/pace";
import { RsvpChips, rsvpChipStates, rsvpSummaryLine } from "./meetings/RsvpChips";
import { pollResults } from "./polls/results";
import { renderWithProviders } from "@/test/utils";

const CHI = "America/Chicago";

describe("zone maths", () => {
  it("converts wall-clock input to instants across daylight saving", () => {
    expect(zonedToIso("2026-01-15T19:00", CHI)).toBe("2026-01-16T01:00:00.000Z"); // CST, UTC-6
    expect(zonedToIso("2026-07-15T19:00", CHI)).toBe("2026-07-16T00:00:00.000Z"); // CDT, UTC-5
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), CHI)).toBe(-360);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), CHI)).toBe(-300);
  });
  it("round-trips an instant through the input format and finds its local date", () => {
    const iso = "2030-03-14T19:00:00.000Z";
    expect(isoToZonedInput(iso, "UTC")).toBe("2030-03-14T19:00");
    expect(isoToZonedInput(iso, "Asia/Tokyo")).toBe("2030-03-15T04:00");
    expect(dateKeyInZone(iso, "Asia/Tokyo")).toBe("2030-03-15");
    expect(dateKeyInZone("2030-03-14", CHI)).toBe("2030-03-14");
  });
});

describe("expandRecurrence", () => {
  const start = zonedToIso("2026-10-27T19:00", CHI)!; // a Tuesday
  it("previews weekly meetings a week apart, keeping 7 pm through the DST change", () => {
    const dates = expandRecurrence(start, { freq: "weekly", count: 5 }, CHI);
    expect(dates).toHaveLength(5);
    expect(dates[0]).toBe(start);
    expect(dates.map((d) => isoToZonedInput(d, CHI))).toEqual(["2026-10-27T19:00", "2026-11-03T19:00", "2026-11-10T19:00", "2026-11-17T19:00", "2026-11-24T19:00"]);
    // The clocks changed on 1 Nov, so the UTC hour shifts while the local hour holds.
    expect(dates[0]!.slice(11, 16)).toBe("00:00");
    expect(dates[1]!.slice(11, 16)).toBe("01:00");
  });
  it("handles every-two-weeks, several weekdays and an until date", () => {
    const dates = expandRecurrence(start, { freq: "biweekly", byDay: [2, 4], until: "2026-11-30" }, CHI);
    expect(dates.map((d) => dateKeyInZone(d, CHI))).toEqual(["2026-10-27", "2026-10-29", "2026-11-10", "2026-11-12", "2026-11-24", "2026-11-26"]);
  });
  it("handles monthly on the nth weekday and the last weekday", () => {
    expect(nthWeekdayFor("2026-10-27")).toEqual({ n: -1, day: 2 });
    const last = expandRecurrence(start, { freq: "monthly", nthWeekday: { n: -1, day: 2 }, count: 3 }, CHI);
    expect(last.map((d) => dateKeyInZone(d, CHI))).toEqual(["2026-10-27", "2026-11-24", "2026-12-29"]);
    const second = expandRecurrence(zonedToIso("2026-11-10T19:00", CHI)!, { freq: "monthly", nthWeekday: { n: 2, day: 2 }, count: 3 }, CHI);
    expect(second.map((d) => dateKeyInZone(d, CHI))).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
  });
  it("clamps month days and caps at 52 occurrences", () => {
    const monthly = expandRecurrence(zonedToIso("2026-01-31T10:00", "UTC")!, { freq: "monthly", byMonthDay: 31, count: 3 }, "UTC");
    expect(monthly.map((d) => dateKeyInZone(d, "UTC"))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(expandRecurrence(start, { freq: "weekly" }, CHI)).toHaveLength(52);
    expect(expandRecurrence(start, null, CHI)).toEqual([start]);
  });
});

describe("monthGrid", () => {
  it("pads October 2026 to five full weeks starting on Sunday and marks today", () => {
    const weeks = monthGrid("2026-10", "2026-10-23");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]!.map((d) => d.inMonth)).toEqual([false, false, false, false, true, true, true]);
    expect(weeks[0]![4]!.date).toBe("2026-10-01");
    expect(weeks[4]![6]!.date).toBe("2026-10-31");
    expect(weeks.flat().filter((d) => d.today).map((d) => d.date)).toEqual(["2026-10-23"]);
    expect(monthGrid("2026-02", "2026-10-23")).toHaveLength(4); // Feb 2026 starts on a Sunday
  });
  it("renders as a table with weekday headers, today marked and chips placed on their local day", () => {
    renderWithProviders(
      <CalendarGrid
        month="2026-10"
        today="2026-10-23"
        timezone="America/Chicago"
        items={[
          { id: "m1", kind: "meeting", title: "October meeting", startsAt: "2026-10-28T00:30:00.000Z", endsAt: null, allDay: false, link: "/c/c1/meetings/m1", edition: null, rsvp: null },
          { id: "a1", kind: "assignment", title: "Dune, chapters 1 to 4", startsAt: "2026-10-15", endsAt: null, allDay: true, link: "/c/c1/list", edition: null, rsvp: null },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "October 2026 calendar" });
    expect(table.querySelectorAll("thead th")).toHaveLength(7);
    expect(table.querySelector("thead th")?.textContent).toBe("Sun");
    expect(table.querySelector("[aria-current='date']")?.textContent).toBe("23");
    // 00:30 UTC on the 28th is still the evening of the 27th in Chicago.
    const chip = screen.getAllByRole("link", { name: /October meeting/ })[0]!;
    expect(chip.closest("td")?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-27");
    expect(screen.getAllByRole("link", { name: /Dune/ })[0]!.closest("td")?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-15");
  });
});

describe("RSVP chips", () => {
  const summary: RsvpSummary = { going: 4, maybe: 1, no: 2, goingGuests: 2, mine: "maybe", myGuests: 0, deadlinePassed: false };
  it("derives the chip states and the summary line", () => {
    expect(rsvpChipStates(summary)).toEqual([
      { status: "going", label: "Going", count: 4, selected: false },
      { status: "maybe", label: "Maybe", count: 1, selected: true },
      { status: "no", label: "Can't make it", count: 2, selected: false },
    ]);
    expect(rsvpSummaryLine(summary)).toBe("4 going (+2 guests) · 1 maybe · 2 can't");
  });
  it("moves the viewer's reply optimistically, guests included", () => {
    const next = applyRsvp(summary, "going", 1);
    expect(next).toMatchObject({ going: 5, maybe: 0, no: 2, goingGuests: 3, mine: "going", myGuests: 1 });
    const back = applyRsvp(next, "no", 0);
    expect(back).toMatchObject({ going: 4, no: 3, goingGuests: 2, mine: "no", myGuests: 0 });
  });
  it("renders a radio group with the viewer's choice checked and disables after the deadline", async () => {
    const onChange = vi.fn();
    render(<RsvpChips summary={summary} onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Your RSVP" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Maybe/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Going/ })).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("radio", { name: /Going/ }));
    expect(onChange).toHaveBeenCalledWith("going");
    await userEvent.click(screen.getByRole("radio", { name: /Maybe/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    render(<RsvpChips summary={{ ...summary, deadlinePassed: true }} onChange={onChange} label="Closed" />);
    expect(screen.getByText("RSVPs closed")).toBeInTheDocument();
    for (const r of screen.getByRole("radiogroup", { name: "Closed" }).querySelectorAll("button")) expect(r).toBeDisabled();
  });
});

describe("pollResults", () => {
  const option = (id: string, position: number, votes: number, mine = false): Poll["options"][number] => ({ id, position, label: id, edition: null, startsAt: null, endsAt: null, votes, voters: [], mine });
  it("computes percentages of voters, leaders and a tie broken by position", () => {
    const r = pollResults({ options: [option("b", 2, 3), option("a", 1, 3), option("c", 3, 1)], totalVoters: 4, winnerOptionId: null });
    expect(r.options.map((o) => o.option.id)).toEqual(["a", "b", "c"]);
    expect(r.options.map((o) => o.percent)).toEqual([75, 75, 25]);
    expect(r.options.map((o) => o.leading)).toEqual([true, true, false]);
    expect(r.totalVotes).toBe(7);
    expect(r.tie).toBe(true);
    expect(r.winner?.id).toBe("a");
  });
  it("prefers the winner the server recorded and copes with no votes", () => {
    expect(pollResults({ options: [option("a", 1, 1), option("b", 2, 5)], totalVoters: 6, winnerOptionId: "a" }).winner?.id).toBe("a");
    const empty = pollResults({ options: [option("a", 1, 0), option("b", 2, 0)], totalVoters: 0, winnerOptionId: null });
    expect(empty.winner).toBeNull();
    expect(empty.options.every((o) => o.percent === 0 && !o.leading)).toBe(true);
  });
});

describe("previewPaceSchedule", () => {
  it("splits pages evenly over weekly chunks ending on the end date", () => {
    const rows = previewPaceSchedule({ startsOn: "2026-11-01", endsOn: "2026-11-29", totalPages: 400, cadence: "weekly", restDays: [] });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
    expect(rows[0]).toMatchObject({ fromPage: 1, toPage: 100 });
    expect(rows[3]).toMatchObject({ fromPage: 301, toPage: 400 });
  });
  it("skips rest days on a daily cadence and returns nothing for an impossible range", () => {
    const rows = previewPaceSchedule({ startsOn: "2026-11-01", endsOn: "2026-11-07", totalPages: 60, cadence: "daily", restDays: [0, 6] });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(rows[rows.length - 1]!.toPage).toBe(60);
    expect(previewPaceSchedule({ startsOn: "2026-11-07", endsOn: "2026-11-01", totalPages: 60, cadence: "weekly", restDays: [] })).toEqual([]);
  });
});
