import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "@/App";
import { RunLayout } from "@/screens/RunLayout";

import { Dashboard } from "@/screens/Dashboard";
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
 * The route tree from ADR 0003. `App` is the root layout (providers + shell +
 * <Outlet/> + global overlays). Run-scoped routes nest under `RunLayout`, which
 * owns the single run WebSocket. Vite base is '/', so no basename.
 */
export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
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
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
