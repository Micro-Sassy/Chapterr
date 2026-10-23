import type { Poll, PollOption } from "@shared/types";

export interface OptionResult {
  option: PollOption;
  votes: number;
  /** Share of voters who chose this option, 0 to 100. */
  percent: number;
  leading: boolean;
}

export interface PollResults {
  options: OptionResult[];
  totalVotes: number;
  totalVoters: number;
  /** The winner the server recorded, else the option with the most votes (ties go to the earliest option). */
  winner: PollOption | null;
  tie: boolean;
}

/** Result maths for one poll. Percentages are of voters, so a multi-choice poll can sum past 100. */
export function pollResults(poll: Pick<Poll, "options" | "totalVoters" | "winnerOptionId">): PollResults {
  const options = [...poll.options].sort((a, b) => a.position - b.position);
  const totalVotes = options.reduce((n, o) => n + o.votes, 0);
  const totalVoters = Math.max(poll.totalVoters, 0);
  const top = options.reduce((m, o) => Math.max(m, o.votes), 0);
  const leaders = options.filter((o) => o.votes === top && top > 0);
  const recorded = poll.winnerOptionId ? options.find((o) => o.id === poll.winnerOptionId) ?? null : null;
  const winner = recorded ?? leaders[0] ?? null;
  return {
    options: options.map((option) => ({
      option,
      votes: option.votes,
      percent: totalVoters > 0 ? Math.round((option.votes / totalVoters) * 100) : 0,
      leading: top > 0 && option.votes === top,
    })),
    totalVotes,
    totalVoters,
    winner,
    tie: !recorded && leaders.length > 1,
  };
}

/** "3 of 8 members voted" */
export function turnoutLine(totalVoters: number, memberCount?: number): string {
  if (memberCount && memberCount > 0) return `${totalVoters} of ${memberCount} ${memberCount === 1 ? "member" : "members"} voted`;
  return `${totalVoters} ${totalVoters === 1 ? "vote" : "votes"} cast`;
}
