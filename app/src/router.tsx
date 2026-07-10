import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "@/App";
import { RunLayout } from "@/screens/RunLayout";
import { RequireAuth } from "@/screens/RequireAuth";

import { Login } from "@/screens/auth/Login";
import { ForgotPassword } from "@/screens/auth/ForgotPassword";
import { SignedOut } from "@/screens/auth/SignedOut";
import { Profile } from "@/screens/auth/Profile";
import { UserManagement } from "@/screens/settings/UserManagement";
import { ClaudeCredentials } from "@/screens/settings/ClaudeCredentials";
import { SharedWorkspace } from "@/screens/settings/SharedWorkspace";

import { Dashboard } from "@/screens/Dashboard";
import { GettingStarted } from "@/screens/GettingStarted";
import { Projects } from "@/screens/Projects";
import { ProjectDetail } from "@/screens/ProjectDetail";
import { Tickets } from "@/screens/Tickets";
import { TicketDetail } from "@/screens/TicketDetail";
import { Runs } from "@/screens/Runs";
import { RunDetail } from "@/screens/RunDetail";
import { ReviewCenter } from "@/screens/ReviewCenter";
import { CreateLinkSync } from "@/screens/CreateLinkSync";
import { Automation } from "@/screens/Automation";
import { Execution } from "@/screens/Execution";
import { Evidence } from "@/screens/Evidence";
import { CommentPublish } from "@/screens/CommentPublish";
import { Reports } from "@/screens/Reports";
import { AuditLog } from "@/screens/AuditLog";
import { Settings } from "@/screens/Settings";

/**
 * The route tree from ADR 0003 + auth (ADR 0007). PUBLIC auth screens
 * (`/login`, `/forgot`, `/signed-out`) are top-level siblings of `<App/>`, so
 * they render WITHOUT the app shell. The entire authenticated app is gated by
 * `RequireAuth`, which restores the session (via the refresh cookie) before
 * mounting `<App/>` (providers + shell + <Outlet/>). Run-scoped routes nest
 * under `RunLayout`, which owns the single run WebSocket. Vite base is '/', so
 * no basename.
 */
export const router = createBrowserRouter([
  // Public (unauthenticated) — no app shell.
  { path: "login", element: <Login /> },
  { path: "forgot", element: <ForgotPassword /> },
  { path: "signed-out", element: <SignedOut /> },

  // Authenticated app subtree — RequireAuth gates every route below.
  {
    element: <RequireAuth />,
    children: [
      {
        element: <App />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: "getting-started", element: <GettingStarted /> },
          { path: "projects", element: <Projects /> },
          { path: "projects/:projectName", element: <ProjectDetail /> },
          { path: "tickets", element: <Tickets /> },
          { path: "tickets/:externalId", element: <TicketDetail /> },
          { path: "runs", element: <Runs /> },
          {
            path: "runs/:runId",
            element: <RunLayout />,
            children: [
              { index: true, element: <RunDetail /> },
              { path: "review", element: <ReviewCenter /> },
              { path: "sync", element: <CreateLinkSync /> },
              { path: "automation", element: <Automation /> },
              { path: "execution", element: <Execution /> },
              { path: "evidence", element: <Evidence /> },
              { path: "comment", element: <CommentPublish /> },
            ],
          },
          { path: "reports", element: <Reports /> },
          { path: "audit", element: <AuditLog /> },
          { path: "settings", element: <Settings /> },
          { path: "settings/users", element: <UserManagement /> },
          { path: "settings/claude-credentials", element: <ClaudeCredentials /> },
          { path: "settings/shared-workspace", element: <SharedWorkspace /> },
          { path: "profile", element: <Profile /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
