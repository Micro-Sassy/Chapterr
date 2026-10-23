import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useParams, useSearchParams } from "react-router";
import { AppShell } from "./components/AppShell";
import { Alert, Spinner } from "./components/ui";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { useSession } from "./lib/auth";
import { clubPath, useCurrentClubId, useMe } from "./lib/club";
import { RealtimeProvider } from "./lib/realtime";
import { AddBookPage } from "./routes/AddBook";
import { CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, VerifiedPage } from "./routes/auth/Recovery";
import { RegisterPage } from "./routes/auth/Register";
import { safeNext, SignInPage } from "./routes/auth/SignIn";
import { BookDetailPage } from "./routes/BookDetail";
import { ClubDashboardPage } from "./routes/clubs/ClubDashboard";
import { ActivitiesPage, GenresPage, MeetingsPage } from "./routes/clubs/ClubExtras";
import { ClubLayout } from "./routes/clubs/ClubLayout";
import { ClubSettingsPage } from "./routes/clubs/ClubSettings";
import { ClubQuotesPage, ClubRecommendationsPage, ClubReviewsPage } from "./routes/clubs/Collections";
import { JoinPage } from "./routes/clubs/Join";
import { ClubMembersPage, MemberProfilePage } from "./routes/clubs/Members";
import { ClubMessagesPage } from "./routes/clubs/Messages";
import { NewClubPage } from "./routes/clubs/NewClub";
import { ReadingListPage } from "./routes/clubs/ReadingList";
import { GoalsPage } from "./routes/Goals";
import { HomePage } from "./routes/Home";
import { LibraryPage } from "./routes/Library";
import { MorePage, NotFoundPage, NotificationsPage } from "./routes/Misc";
import { PrivacyPage } from "./routes/Privacy";
import { PublicSharePage } from "./routes/PublicShare";
import { SettingsPage } from "./routes/Settings";
import { TermsPage } from "./routes/Terms";

/**
 * Client-side guard for member pages. This only decides what to render; the
 * Worker independently rejects every private API call without a valid session.
 * Signed-out visits to any app page (including "/") go to sign-in.
 */
function RequireAuth() {
  const { data: session, isPending, isError } = useSession();
  const location = useLocation();
  const { clubId } = useParams();
  if (isPending) return <Spinner label="Opening Chapterr" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert tone="warning" title="Can't reach Chapterr right now">
          You appear to be offline. Reconnect and reload to continue.
        </Alert>
      </div>
    );
  }
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <RealtimeProvider clubId={clubId ?? null}>
      <AppShell />
    </RealtimeProvider>
  );
}

/** Auth pages redirect signed-in members to the app (honouring ?next=). */
function GuestOnly() {
  const { data: session, isPending } = useSession();
  const [params] = useSearchParams();
  if (isPending) return <Spinner />;
  if (session) return <Navigate to={safeNext(params.get("next"))} replace />;
  return <Outlet />;
}

/** Old single-club routes land in the current club (last opened, else first), or home. */
function LegacyClubRedirect({ sub }: { sub?: string }) {
  const params = useParams();
  const me = useMe();
  const clubId = useCurrentClubId();
  if (me.isPending) return <Spinner />;
  if (!clubId) return <Navigate to="/" replace />;
  const tail = sub ? sub.replace(/:(\w+)/g, (_m, k: string) => params[k] ?? "") : undefined;
  return <Navigate to={clubPath(clubId, tail)} replace />;
}

export const routes = [
  // Intentionally public routes.
  { path: "/s/:token", element: <PublicSharePage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/join/:code", element: <JoinPage /> },
  { path: "/verified", element: <VerifiedPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/check-email", element: <CheckEmailPage /> },
  {
    element: <GuestOnly />,
    children: [
      { path: "/sign-in", element: <SignInPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
    ],
  },
  // Member-only routes.
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/clubs/new", element: <NewClubPage /> },
      {
        path: "/c/:clubId",
        element: <ClubLayout />,
        children: [
          { index: true, element: <ClubDashboardPage /> },
          { path: "list", element: <ReadingListPage /> },
          { path: "meetings", element: <MeetingsPage /> },
          { path: "activities", element: <ActivitiesPage /> },
          { path: "genres", element: <GenresPage /> },
          { path: "reviews", element: <ClubReviewsPage /> },
          { path: "quotes", element: <ClubQuotesPage /> },
          { path: "recommend", element: <ClubRecommendationsPage /> },
          { path: "messages", element: <ClubMessagesPage /> },
          { path: "messages/:conversationId", element: <ClubMessagesPage /> },
          { path: "members", element: <ClubMembersPage /> },
          { path: "members/:username", element: <MemberProfilePage /> },
          { path: "settings", element: <ClubSettingsPage /> },
        ],
      },
      // Personal.
      { path: "/library", element: <LibraryPage /> },
      { path: "/books/add", element: <AddBookPage /> },
      { path: "/books/:id", element: <BookDetailPage /> },
      { path: "/goals", element: <GoalsPage /> },
      { path: "/notifications", element: <NotificationsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/more", element: <MorePage /> },
      // Old single-club URLs.
      { path: "/club", element: <LegacyClubRedirect sub="list" /> },
      { path: "/club/meetings", element: <LegacyClubRedirect sub="meetings" /> },
      { path: "/club/activities", element: <LegacyClubRedirect sub="activities" /> },
      { path: "/club/genres", element: <LegacyClubRedirect sub="genres" /> },
      { path: "/club/*", element: <LegacyClubRedirect /> },
      { path: "/messages", element: <LegacyClubRedirect sub="messages" /> },
      { path: "/messages/:id", element: <LegacyClubRedirect sub="messages" /> },
      { path: "/reviews", element: <LegacyClubRedirect sub="reviews" /> },
      { path: "/quotes", element: <LegacyClubRedirect sub="quotes" /> },
      { path: "/recommendations", element: <LegacyClubRedirect sub="recommend" /> },
      { path: "/members", element: <LegacyClubRedirect sub="members" /> },
      { path: "/members/:username", element: <LegacyClubRedirect sub="members/:username" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <>
      {/* Registers the service worker on every page (offline shell) and offers updates. */}
      <UpdatePrompt />
      <RouterProvider router={router} />
    </>
  );
}
