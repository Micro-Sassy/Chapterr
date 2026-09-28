import clsx from "clsx";
import type { MemberSummary } from "@shared/types";

const sizes = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-20 text-2xl" };

export function Avatar({ member, size = "sm", className }: { member: Pick<MemberSummary, "displayName" | "avatarUrl"> | null; size?: keyof typeof sizes; className?: string }) {
  const name = member?.displayName ?? "Former member";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (member?.avatarUrl) {
    return <img src={member.avatarUrl} alt="" className={clsx("shrink-0 rounded-full object-cover ring-1 ring-gold/50", sizes[size], className)} loading="lazy" />;
  }
  return (
    <span aria-hidden className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong ring-1 ring-gold/40", sizes[size], className)}>
      {initials || "?"}
    </span>
  );
}
