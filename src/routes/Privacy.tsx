import { AuthLayout } from "./auth/AuthLayout";

export function PrivacyPage() {
  return (
    <AuthLayout title="Privacy and use notice" wide>
      <div className="mx-auto max-w-prose space-y-4 text-[15px] leading-relaxed">
        <p>
          Chapterr is a home for book clubs. Each club is a private space for its members. Chapterr is not sold to advertisers, carries no advertising, and does
          not share member data with advertisers.
        </p>
        <p>
          <strong>What we store:</strong> your username, display name, email address, an optional profile photo and bio, your reading lists, progress, reviews,
          quotes, goals, recommendations, messages, and the clubs you belong to. Passwords are stored only as secure one-way hashes.
        </p>
        <p>
          <strong>Who can see it:</strong> members of a club you share can see your profile and anything you mark as visible to your clubs. Items marked private
          are visible only to you. Direct messages are visible only to the two people in the conversation. Nothing is public unless you create a share link for
          a specific review, quote or list, and you can turn those links off at any time. Chats can never be shared publicly.
        </p>
        <p>
          <strong>Clubs:</strong> a club's owner and admins can see who is a member, create and revoke invite links, change roles and remove members. When you
          leave a club or are removed, you lose access to it and it loses access to you. Your own library, reviews and quotes stay with your account.
        </p>
        <p>
          <strong>Services used:</strong> the app runs on Cloudflare (hosting, database, bot protection) and sends account emails through Resend. Book details
          and covers come from Open Library and, if configured, Google Books.
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
