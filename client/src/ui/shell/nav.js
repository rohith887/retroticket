import {
  Building2,
  CheckCheck,
  Inbox,
  ListTodo,
  UserX,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Mail,
  Mailbox,
  MessageSquareText,
  Send,
  Server,
  ScrollText,
  ShieldCheck,
  Ticket,
  Trash2,
  UserRound,
  Webhook,
} from "lucide-react";

/**
 * Admin navigation: the single source for the rail, the mobile drawer, breadcrumbs and the command palette.
 * `badgeKey` links an item to a live counter supplied by the shell.
 */
export const ADMIN_NAV = [
  {
    title: null,
    items: [{ label: "Overview", href: "/admin", icon: LayoutDashboard, end: true, keywords: "home dashboard" }],
  },
  {
    title: "People",
    items: [
      { label: "Users", href: "/admin/users", icon: UserRound, keywords: "members agents accounts" },
      { label: "Roles", href: "/admin/roles", icon: ShieldCheck, keywords: "permissions access" },
      { label: "Clients", href: "/admin/clients", icon: Building2, keywords: "customers companies" },
    ],
  },
  {
    title: "Support",
    items: [
      { label: "Tickets", href: "/admin/tickets", icon: Ticket, badgeKey: "open", keywords: "issues queue" },
      { label: "Threads", href: "/admin/threads", icon: MessageSquareText, keywords: "conversations" },
      // { label: "Messages", href: "/admin/messages", icon: Mail, keywords: "emails inbox" },
    ],
  },
  {
    title: "Email",
    items: [
      { label: "Email queues", href: "/admin/email-queues", icon: Server, keywords: "imap smtp channels" },
      { label: "Mailboxes", href: "/admin/mailboxes", icon: Mailbox, keywords: "inbox addresses" },
      { label: "SMTP", href: "/admin/smtp", icon: Send, keywords: "outbound templates" },
      { label: "Mailer ops", href: "/admin/mailer-ops", icon: Gauge, keywords: "delivery retries dead letter" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Authentication", href: "/admin/authentication", icon: KeyRound, keywords: "sso oidc login" },
      { label: "Webhooks", href: "/admin/webhooks", icon: Webhook, keywords: "integrations events" },
      { label: "Logs", href: "/admin/logs", icon: ScrollText, keywords: "audit" },
    ],
  },
];

export const ALL_NAV_ITEMS = ADMIN_NAV.flatMap((group) => group.items.map((item) => ({ ...item, section: group.title })));

/** Breadcrumb trail for a pathname: Admin / Section / Page / (detail). */
export function buildBreadcrumbs(pathname) {
  const crumbs = [{ label: "Admin", href: "/admin" }];
  const match = [...ALL_NAV_ITEMS]
    .filter((item) => item.href !== "/admin" && (pathname === item.href || pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!match) {
    if (pathname === "/admin" || pathname === "/admin/") return [{ label: "Overview" }];
    return crumbs;
  }
  if (match.section) crumbs.push({ label: match.section });
  const rest = pathname.slice(match.href.length).split("/").filter(Boolean);
  crumbs.push(rest.length ? { label: match.label, href: match.href } : { label: match.label });
  if (rest.length) {
    const last = rest[rest.length - 1];
    crumbs.push({ label: last === "new" ? "New" : last === "oauth" ? "OAuth" : "Details" });
  }
  return crumbs;
}

/** "/portal" for the moderator layout, "/agents" for the agent layout. */
export const portalBase = (pathname = "") => (pathname.startsWith("/portal") ? "/portal" : "/agents");

const MODERATOR_FOLDERS = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sent", label: "Sent", icon: Send },
  { id: "processed", label: "Processed", icon: CheckCheck },
  { id: "drafts", label: "Drafts", icon: Mail },
  { id: "trash", label: "Trash", icon: Trash2 },
];

/**
 * Sidebar navigation for the two mail-style layouts (agent at /agents, moderator at /portal).
 * Ticket views are query-driven: <base>/tickets?status=<view>. `countKey` links a view to a live counter.
 */
export function portalNav(base) {
  const moderator = base === "/portal";
  const views = [
    { id: "mine", label: "My tickets", to: `${base}/tickets?status=mine`, icon: Inbox, countKey: "mine", emphasise: true, keywords: "assigned inbox" },
    { id: "unassigned", label: "Unassigned", to: `${base}/tickets?status=unassigned`, icon: UserX, countKey: "unassigned", emphasise: true, keywords: "queue unowned" },
    { id: "all", label: "All open", to: `${base}/tickets?status=all`, icon: ListTodo, countKey: "open", keywords: "everything" },
    { id: "closed", label: "Resolved", to: `${base}/tickets?status=closed`, icon: CheckCheck, keywords: "closed completed done" },
  ];
  const conversations = moderator
    ? [{ id: "threads", label: "Applications", to: "/portal/threads", icon: MessageSquareText, keywords: "threads conversations cases" }]
    : [
        { id: "threads", label: "Threads", to: "/agents/threads", icon: MessageSquareText, keywords: "conversations email" },
        { id: "messages", label: "Messages", to: "/agents/messages", icon: Mail, keywords: "inbox mail" },
      ];
  // The moderator's raw email folders (the existing IMAP inbox page).
  const email = moderator ? MODERATOR_FOLDERS.map((f) => ({ ...f, to: `/portal/inbox?folder=${f.id}` })) : [];
  const items = [...views, ...conversations, ...email].map((item) => ({
    label: item.label,
    href: item.to,
    icon: item.icon,
    section: email.includes(item) ? "Email" : conversations.includes(item) ? "Conversations" : "Tickets",
    keywords: item.keywords,
  }));
  return { views, conversations, email, items, settings: `${base}/settings` };
}

// Agent layout defaults, kept for existing imports.
export const AGENT_VIEWS = portalNav("/agents").views;
export const AGENT_CONVERSATIONS = portalNav("/agents").conversations;
export const AGENT_ITEMS = portalNav("/agents").items;

export function agentTitle(fullPath, search) {
  const base = portalBase(fullPath);
  const pathname = fullPath.replace(/^\/portal/, "/agents");
  const status = new URLSearchParams(search).get("status");
  if (base === "/portal" && fullPath.startsWith("/portal/inbox")) return "Email";
  if (pathname.startsWith("/agents/tickets/new")) return "New ticket";
  if (/^\/agents\/tickets\/(?!new|search)[^/]+/.test(pathname)) return "Ticket";
  if (pathname.startsWith("/agents/tickets")) return AGENT_VIEWS.find((v) => v.id === (status === "open" || !status ? "mine" : status))?.label || "Tickets";
  if (pathname.startsWith("/agents/threads")) return base === "/portal" ? "Applications" : "Threads";
  if (pathname.startsWith("/agents/messages")) return "Messages";
  if (pathname.startsWith("/agents/mailboxes")) return "Mailboxes";
  if (pathname.startsWith("/agents/settings")) return "Settings";
  if (pathname.startsWith("/agents/profile")) return "Profile";
  return base === "/portal" ? "Moderator portal" : "Agent portal";
}
