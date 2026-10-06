// src/App.jsx
import React from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { SidebarProvider } from "./shadcn/ui/sidebar";

import AdminShell from "./layouts/adminShell";
import AdminHome from "./pages/admin/home";
import AgentShell from "./layouts/agentShell";
import SettingsLayout from "./pages/agents/settings/SettingsLayout";
import ProfileSettings from "./pages/agents/settings/profile";
import NotificationSettings from "./pages/agents/settings/notifications";
import SignatureSettings from "./pages/agents/settings/signature";
import SessionSettings from "./pages/agents/settings/sessions";
import AppearanceSettings from "./pages/agents/settings/appearance";

import NotificationsPage from "./pages/notifications";
import OnboardingPage from "./pages/onboarding";
import ProfilePage from "./pages/profile";
import SubmitPage from "./pages/submit";
import NotFoundPage from "./pages/404";
import LoginPage from "./pages/auth/login";

import Inbox from "./pages/inbox";
import Ticket from "./pages/tickets";
import NewTicket from "./pages/tickets/new";
import TicketDetail from "./pages/tickets/detail";
import AgentTicketInbox from "./components/tickets/TicketInbox";
import AgentTicketWorkspace from "./components/tickets/TicketWorkspace";
import TicketSearch from "./pages/tickets/search";

import Users from "./pages/admin/users";
import NewUser from "./pages/admin/users/new";
import Clients from "./pages/admin/clients";
import NewClient from "./pages/admin/clients/new";
import EmailQueuesList from "./pages/admin/email-queues";
import NewEmailQueue from "./pages/admin/email-queues/new";
import AdminMailboxes from "./pages/admin/mailboxes";
import AdminTickets from "./pages/admin/tickets/index";
import AdminMessages from "./pages/admin/messages";
import AdminThreads from "./pages/admin/threads";
import Webhooks from "./pages/admin/webhooks";
import SMTP from "./pages/admin/smtp";
import OAuth from "./pages/admin/smtp/oauth";
import Authentication from "./pages/admin/authentication";
import Roles from "./pages/admin/roles";
import NewRole from "./pages/admin/roles/new";
import EditRole from "./pages/admin/roles/edit";
import EditEmailTemplate from "./pages/admin/smtp/templates/edit";
import EmailQueueOAuth from "./pages/admin/email-queues/oauth";
import Logs from "./pages/admin/logs";
import MailerOpsPage from "./pages/admin/mailer-ops";
import AgentMailboxes from "./pages/agents/mailboxes";
import AgentMessages from "./pages/agents/messages";
import AgentThreads from "./pages/agents/threads";
import PortalMessages from "./pages/portal/messages";
import PortalThreads from "./pages/portal/threads";

import { useUser } from "./store/session";

/* ============================================================
   ERROR BOUNDARY
============================================================ */
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center text-red-500 p-4 bg-red-50">
          <div>
            <p>Something went wrong: {this.state.error?.message || "Unknown"}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   ROLE-BASED ACCESS CONTROL
============================================================ */
function RequireRole({ children, adminOnly, agentOnly, portalOnly }) {
  const { user, loading, isAdmin, isAgent } = useUser();

  if (loading && !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin h-10 w-10 border-b-2 border-primary rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to={isAgent ? "/agents/tickets?status=open" : "/portal"} replace />;
  }

  if (agentOnly && !isAgent) {
    return <Navigate to={isAdmin ? "/admin" : "/portal"} replace />;
  }

  if (portalOnly && (isAdmin || isAgent)) {
    return <Navigate to={isAdmin ? "/admin" : "/agents/tickets?status=open"} replace />;
  }

  return children;
}

/* ============================================================
   AUTO-REDIRECT AFTER LOGIN
============================================================ */
function RedirectAfterLogin() {
  const { user, loading } = useUser();
  const location = useLocation();

  if (loading || !user || !location.pathname.startsWith("/auth")) {
    return null;
  }

  if (user.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (user.isAgent) {
    return <Navigate to="/agents/tickets?status=open" replace />;
  }

  return <Navigate to="/portal" replace />;
}

function LandingRoute() {
  const { user, loading } = useUser();

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full"></div>
        <p className="ml-4">Authenticating...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  if (user.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (user.isAgent) {
    return <Navigate to="/agents/tickets?status=open" replace />;
  }

  return <Navigate to="/portal" replace />;
}

/* ============================================================
   MAIN APP
============================================================ */
function App() {
  const { user, loading } = useUser();

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin h-12 w-12 border-b-2 border-primary rounded-full"></div>
        <p className="ml-4">Authenticating...</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <ErrorBoundary>
        <RedirectAfterLogin />

        <Routes>
          {/* PUBLIC */}
          <Route path="/" element={<LandingRoute />} />
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/submit" element={<SubmitPage />} />

          {/* ============================================================
             PORTAL (Customers / Normal Users)
          ============================================================== */}
          <Route
            path="/portal"
            element={
              <RequireRole portalOnly>
                <AgentShell />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="threads" replace />} />
            <Route path="inbox" element={<Inbox />} />

            {/* Ticket routes */}
            <Route path="tickets">
              <Route index element={<AgentTicketInbox />} />
              <Route path="new" element={<NewTicket />} />
              <Route path="search" element={<TicketSearch />} />
              <Route path=":id" element={<AgentTicketWorkspace />} />
            </Route>

            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<ProfileSettings />} />
              <Route path="notifications" element={<NotificationSettings />} />
              <Route path="signature" element={<SignatureSettings />} />
              <Route path="sessions" element={<SessionSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
            </Route>
            <Route path="profile" element={<ProfilePage />} />
            <Route path="threads" element={<PortalThreads />} />
            <Route path="messages" element={<PortalMessages />} />
          </Route>

          {/* ============================================================
             AGENTS (Support Agents)
          ============================================================== */}
          <Route
            path="/agents"
            element={
              <RequireRole agentOnly>
                <AgentShell />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="tickets?status=mine" replace />} />

            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<ProfileSettings />} />
              <Route path="notifications" element={<NotificationSettings />} />
              <Route path="signature" element={<SignatureSettings />} />
              <Route path="sessions" element={<SessionSettings />} />
              <Route path="appearance" element={<AppearanceSettings />} />
            </Route>

            <Route path="tickets">
              <Route index element={<AgentTicketInbox />} />
              <Route path="new" element={<NewTicket />} />
              <Route path="search" element={<TicketSearch />} />
              <Route path=":id" element={<AgentTicketWorkspace />} />
            </Route>

            <Route path="profile" element={<ProfilePage />} />
            <Route path="mailboxes" element={<AgentMailboxes />} />
            <Route path="threads" element={<AgentThreads />} />
            <Route path="messages" element={<AgentMessages />} />
          </Route>

          {/* ============================================================
             ADMIN
          ============================================================== */}
          <Route
            path="/admin"
            element={
              <RequireRole adminOnly>
                <AdminShell />
              </RequireRole>
            }
          >
            <Route index element={<AdminHome />} />

            <Route path="users" element={<Users />} />
            <Route path="users/new" element={<NewUser />} />

            <Route path="clients" element={<Clients />} />
            <Route path="clients/new" element={<NewClient />} />

            <Route path="email-queues" element={<EmailQueuesList />} />
            <Route path="email-queues/new" element={<NewEmailQueue />} />
            <Route path="email-queues/oauth" element={<EmailQueueOAuth />} />
            <Route path="mailboxes" element={<AdminMailboxes />} />
            <Route path="tickets" element={<AdminTickets />} />
            <Route path="threads" element={<AdminThreads />} />
            <Route path="messages" element={<AdminMessages />} />

            <Route path="webhooks" element={<Webhooks />} />
            <Route path="smtp" element={<SMTP />} />
            <Route path="smtp/oauth" element={<OAuth />} />
            <Route path="smtp/templates/:id" element={<EditEmailTemplate />} />
            <Route path="authentication" element={<Authentication />} />
            <Route path="roles" element={<Roles />} />
            <Route path="roles/new" element={<NewRole />} />
            <Route path="roles/:id" element={<EditRole />} />
            <Route path="logs" element={<Logs />} />
            <Route path="mailer-ops" element={<MailerOpsPage />} />
          </Route>

          {/* 404 */}
          <Route
            path="*"
            element={user ? <NotFoundPage /> : <Navigate to="/auth/login" replace />}
          />
        </Routes>
      </ErrorBoundary>
    </SidebarProvider>
  );
}

export default App;
