import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { AppShell } from "./components/AppShell";
import { Alert, Spinner } from "./components/ui";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { useSession } from "./lib/auth";
import { RealtimeProvider } from "./lib/realtime";
import { AddBookPage } from "./routes/AddBook";
import { CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, VerifiedPage } from "./routes/auth/Recovery";
import { RegisterPage } from "./routes/auth/Register";
import { SignInPage } from "./routes/auth/SignIn";
import { BookDetailPage } from "./routes/BookDetail";
import { ClubPage } from "./routes/Club";
import { ActivitiesPage, GenresPage, MeetingsPage } from "./routes/ClubExtras";
import { GoalsPage, QuotesPage, RecommendationsPage, ReviewsPage } from "./routes/Collections";
import { DashboardPage } from "./routes/Dashboard";
import { LibraryPage } from "./routes/Library";
import { MessagesPage } from "./routes/Messages";
import { MemberProfilePage, MembersPage, MorePage, NotFoundPage, NotificationsPage } from "./routes/People";
import { PrivacyPage } from "./routes/Privacy";
import { PublicSharePage } from "./routes/PublicShare";
import { SettingsPage } from "./routes/Settings";

/**
 * Client-side guard for member pages. This only decides what to render — the
 * Worker independently rejects every private API call without a valid session.
 */
function RequireAuth() {
  const { data: session, isPending, isError } = useSession();
  const location = useLocation();
  if (isPending) return <Spinner label="Opening the club" />;
  if (isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert tone="warning" title="Can't reach the club right now">
          You appear to be offline. Reconnect and reload to continue.
        </Alert>
      </div>
    );
  }
  if (!session) return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <RealtimeProvider enabled>
      <AppShell />
    </RealtimeProvider>
  );
}

/** Auth pages redirect signed-in members to the app. */
function GuestOnly() {
  const { data: session, isPending } = useSession();
  if (isPending) return <Spinner />;
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}

export const routes = [
  // Intentionally public routes.
  { path: "/s/:token", element: <PublicSharePage /> },
  { path: "/privacy", element: <PrivacyPage /> },
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
      { path: "/", element: <DashboardPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/books/add", element: <AddBookPage /> },
      { path: "/books/:id", element: <BookDetailPage /> },
      { path: "/club", element: <ClubPage /> },
      { path: "/club/meetings", element: <MeetingsPage /> },
      { path: "/club/activities", element: <ActivitiesPage /> },
      { path: "/club/genres", element: <GenresPage /> },
      { path: "/messages", element: <MessagesPage /> },
      { path: "/messages/:id", element: <MessagesPage /> },
      { path: "/recommendations", element: <RecommendationsPage /> },
      { path: "/reviews", element: <ReviewsPage /> },
      { path: "/quotes", element: <QuotesPage /> },
      { path: "/goals", element: <GoalsPage /> },
      { path: "/members", element: <MembersPage /> },
      { path: "/members/:username", element: <MemberProfilePage /> },
      { path: "/notifications", element: <NotificationsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/more", element: <MorePage /> },
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
