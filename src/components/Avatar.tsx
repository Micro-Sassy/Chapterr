import clsx from "clsx";
import type { MemberSummary } from "@shared/types";

const sizes = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-20 text-2xl" };

/** Avatars are fully round (§5). Initials sit on Forest in Linen. */
export function Avatar({ member, size = "sm", className }: { member: Pick<MemberSummary, "displayName" | "avatarUrl"> | null; size?: keyof typeof sizes; className?: string }) {
  const name = member?.displayName ?? "Former member";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (member?.avatarUrl) {
    return <img src={member.avatarUrl} alt="" className={clsx("shrink-0 rounded-full border border-line object-cover", sizes[size], className)} loading="lazy" />;
  }
  return (
    <span aria-hidden className={clsx("inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-on-primary", sizes[size], className)}>
      {initials || "?"}
    </span>
  );
}
