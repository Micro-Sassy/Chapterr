import { AuthLayout } from "./auth/AuthLayout";

/** Plain-English terms for the beta. */
export function TermsPage() {
  return (
    <AuthLayout title="Terms of use" subtitle="Beta terms, in plain English." wide>
      <div className="mx-auto max-w-prose space-y-6 text-[15px] leading-relaxed">
        <section className="space-y-2">
          <h2 className="heading-s">What Chapterr is</h2>
          <p>
            Chapterr is a web app for book clubs: a shared shelf, a schedule and a conversation for each club, plus a personal library for every member. It is
            currently in beta, which means features may change and occasionally break. We will do our best to warn you before anything that affects your data.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Price</h2>
          <p>
            Chapterr is free for everyone during the beta. After the beta, a club costs $1 per month, paid by the club's owner. Personal accounts stay free.
            Before billing starts, every owner gets at least 30 days' notice by email and in the app, and nothing is charged until the owner chooses to continue.
            Clubs that choose not to pay become read-only rather than disappearing.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Your data is yours</h2>
          <p>
            You own what you add to Chapterr: your reading lists, reviews, quotes, notes and messages. You grant us only the permission needed to store and show
            them to the people you choose. You can download a copy of your data and delete your account at any time from Settings. Deleting your account removes
            your personal content; shared club records you created (such as meetings) stay with the club without your name.
          </p>
          <p>
            A club's content belongs to its members together. The owner can delete the club, after which its data is kept for 30 days in case of mistakes and
            then permanently removed.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Accounts</h2>
          <p>
            You need to be at least 16 to use Chapterr. Keep your password to yourself and tell us if you think someone else has used your account. You are
            responsible for what is posted from your account.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Acceptable use</h2>
          <p>Chapterr is for reading together. Do not use it to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>harass, threaten or demean other people;</li>
            <li>post other people's private information, or content you do not have the right to share;</li>
            <li>send spam, run scams, or spread malware;</li>
            <li>break the law, or try to break into or overload the service;</li>
            <li>scrape, resell or impersonate the service.</li>
          </ul>
          <p>
            Club owners and admins are responsible for the tone of their clubs and can remove members. We may suspend accounts or clubs that break these rules,
            and we will tell you why when we do.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Book information</h2>
          <p>
            Book details and covers come from public catalogues such as Open Library and Google Books. They may contain errors; any member can correct an
            edition. Links to find a book are plain searches, with no affiliate or tracking codes.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">No warranty, limited liability</h2>
          <p>
            Chapterr is provided as is. We work hard to keep it running and to keep your data safe, but we cannot promise it will always be available or
            error-free, and we are not liable for losses that come from using it, to the extent the law allows. Please keep your own copy of anything that
            matters to you.
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="heading-s">Changes to these terms</h2>
          <p>
            We may update these terms as Chapterr grows. When we do, we will post the new version here and, for meaningful changes, tell you in the app at least
            30 days before they take effect. Continuing to use Chapterr after that means you accept the new terms.
          </p>
        </section>
        <p className="text-sm text-ink-muted">Last updated October 2026. Questions: support@chapterr.io</p>
      </div>
    </AuthLayout>
  );
}
