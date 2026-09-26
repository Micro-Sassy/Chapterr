import { AuthLayout } from "./auth/AuthLayout";

export function PrivacyPage() {
  return (
    <AuthLayout title="Privacy and use notice">
      <div className="space-y-3 text-sm leading-relaxed">
        <p>
          Teel Ridge Book Club is a private, non-commercial app for one book club. It is not sold, has no advertising, and does not share member data
          with advertisers.
        </p>
        <p>
          <strong>What we store:</strong> your username, display name, email address, an optional profile photo and bio, your reading lists,
          progress, reviews, quotes, goals, recommendations and messages. Passwords are stored only as secure one-way hashes.
        </p>
        <p>
          <strong>Who can see it:</strong> signed-in club members can see your profile and anything you mark as visible to the club. Items marked
          private are visible only to you. Direct messages are visible only to the two people in the conversation. Nothing is public unless you create a
          share link for a specific review, quote or list, and you can turn those links off at any time. Chats can never be shared publicly.
        </p>
        <p>
          <strong>Services used:</strong> the app runs on Cloudflare (hosting, database, bot protection) and sends account emails through Resend. Book
          details and covers come from Open Library and, if configured, Google Books.
        </p>
        <p>
          <strong>Your choices:</strong> you can edit or delete your own content, download a copy of your data, and delete your account from Settings.
        </p>
        <p>
          <strong>Be kind:</strong> keep conversation respectful, avoid posting other people's private information, and mark spoilers.
        </p>
      </div>
    </AuthLayout>
  );
}
