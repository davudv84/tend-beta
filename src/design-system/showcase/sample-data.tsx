import { Bell, FileText, Globe, KeyRound, LayoutGrid, Plug, ScrollText, ShieldCheck, Terminal, Users, Activity, Inbox, GitBranch } from "lucide-react";
import type { ActivityEventData, ApprovalData, PolicySummaryData } from "../tend/components";
import type { SidebarItem } from "../ui/navigation";
import type { TimelineEvent } from "../ui/data";

/** Everything here is illustrative. Agents, people, branches and times are invented for the showcase. */

export const AGENTS = [
  { id: "a1", name: "Release assistant", brand: "claudecode" as const, state: "active" as const, policy: "Engineering · balanced", last: "2 min ago", requests: 148 },
  { id: "a2", name: "Support agent", brand: undefined, state: "active" as const, policy: "Support · strict", last: "9 min ago", requests: 312 },
  { id: "a3", name: "Research agent", brand: undefined, state: "inactive" as const, policy: "Research · monitor", last: "3 days ago", requests: 41 },
  { id: "a4", name: "Cursor in web-app", brand: "cursor" as const, state: "error" as const, policy: "Engineering · balanced", last: "1 hr ago", requests: 87 },
];

export const EVENTS: ActivityEventData[] = [
  { agent: "Release assistant", brand: "claudecode", action: "shell · run", resource: "npm test -- --coverage", decision: "allowed", time: "2 min" },
  { agent: "Release assistant", brand: "claudecode", action: "shell · run", resource: "git push origin feature/discount-codes", decision: "review", time: "3 min" },
  { agent: "Support agent", action: "web · fetch", resource: "https://help.example.com/refund-policy", decision: "allowed", time: "9 min" },
  { agent: "Cursor in web-app", brand: "cursor", action: "file · write", resource: "web-app/.env.production", decision: "denied", time: "1 hr" },
];

export const APPROVAL: ApprovalData = {
  agent: "Release assistant",
  brand: "claudecode",
  verb: "push code",
  resource: "git push origin feature/discount-codes",
  policy: "Push to remote",
  why: "Pushing publishes work outside this machine, so your policy asks a person first.",
  requestedBy: "Priya N.",
  waited: "2 min",
};

export const POLICY: PolicySummaryData = {
  name: "Engineering · balanced",
  appliesTo: "2 agents",
  updated: "yesterday",
  allowed: ["Read any file in the repository", "Run tests and linters", "Write files inside the project"],
  review: ["Push code to a remote", "Reach the network", "Change .env files"],
  denied: ["Read SSH keys", "Delete outside the project", "Run commands as an administrator"],
};

export const TIMELINE: TimelineEvent[] = [
  { id: "t1", title: <>Priya N. <strong className="font-medium">approved</strong> the push</>, detail: "git push origin feature/discount-codes · once", time: "11:42", tone: "ok" },
  { id: "t2", title: "Release assistant asked to push code", detail: "Matched “Push to remote”: requires review", time: "11:40", tone: "warn" },
  { id: "t3", title: "Release assistant ran the test suite", detail: "npm test -- --coverage · allowed", time: "11:38", tone: "neutral", icon: Terminal },
  { id: "t4", title: "Cursor in web-app tried to edit .env.production", detail: "Blocked by “Never allowed”", time: "10:57", tone: "danger" },
];

export const APP_NAV: { label?: string; items: SidebarItem[] }[] = [
  { items: [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "approvals", label: "Approvals", icon: Inbox, count: 3 },
    { id: "activity", label: "Activity", icon: Activity },
  ] },
  { label: "Control", items: [
    { id: "agents", label: "Agents", icon: Users, count: 4 },
    { id: "policies", label: "Policies", icon: ShieldCheck },
    { id: "integrations", label: "Integrations", icon: Plug },
  ] },
  { label: "Workspace", items: [
    { id: "keys", label: "Access keys", icon: KeyRound },
    { id: "audit", label: "Audit log", icon: ScrollText },
  ] },
];

export const KIND_ICON = { shell: Terminal, file: FileText, web: Globe, git: GitBranch, bell: Bell };
