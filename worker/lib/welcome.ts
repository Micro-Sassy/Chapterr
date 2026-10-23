import type { Env } from "../env";
import { openDirectConversation, sendMessage } from "../routes/messages";
import { first } from "./db";

/**
 * Welcome a new member (called by the join and approve flows). When the club
 * has a welcome message, post it into the club chat as a `welcome` message from
 * the owner addressed to the newcomer (`@username ...`, mentions = [newcomer])
 * and send the same text as a direct message from the owner. Never throws: a
 * welcome hiccup must not undo a join.
 */
export async function postWelcome(env: Env, clubId: string, userId: string): Promise<void> {
  try {
    const db = env.DB;
    const club = await first<{ id: string; name: string; welcome_message: string | null; created_by: string | null }>(
      db,
      "SELECT id, name, welcome_message, created_by FROM clubs WHERE id = ? AND archived_at IS NULL",
      clubId,
    );
    const text = club?.welcome_message?.trim();
    if (!club || !text) return;
    const owner =
      (await first<{ user_id: string }>(db, "SELECT user_id FROM club_members WHERE club_id = ? AND role = 'owner' ORDER BY joined_at LIMIT 1", clubId))?.user_id ??
      (club.created_by
        ? (await first<{ user_id: string }>(db, "SELECT user_id FROM club_members WHERE club_id = ? AND user_id = ?", clubId, club.created_by))?.user_id
        : undefined);
    if (!owner || owner === userId) return;
    const newcomer = await first<{ username: string }>(
      db,
      'SELECT u.username FROM "user" u JOIN club_members cm ON cm.user_id = u.id AND cm.club_id = ? WHERE u.id = ?',
      clubId,
      userId,
    );
    if (!newcomer) return;
    const main = await first<{ id: string }>(db, "SELECT id FROM conversations WHERE club_id = ? AND kind = 'club'", clubId);
    if (main) {
      const posted = await sendMessage(env, {
        clubId,
        clubName: club.name,
        conversationId: main.id,
        senderId: owner,
        body: `@${newcomer.username} ${text}`,
        kind: "welcome",
        extraMentionIds: [userId],
      });
      await posted.deliver();
    }
    const dm = await openDirectConversation(db, clubId, owner, userId);
    const sent = await sendMessage(env, { clubId, clubName: club.name, conversationId: dm.id, senderId: owner, body: text, kind: "welcome" });
    await sent.deliver();
  } catch (err) {
    console.error("welcome message failed", err instanceof Error ? err.message : err);
  }
}
