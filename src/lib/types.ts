export type Provider = "Anthropic" | "OpenAI" | "Google" | "Custom";

export interface Agent {
  id: string;
  name: string;
  model: string;
  provider: Provider;
  role: string;
  description: string;
  /** Set only by humans. "idle" agents are connected but between tasks. */
  status: "active" | "idle" | "paused";
  /** When false the integration is disabled and the agent cannot submit anything. */
  integrationEnabled: boolean;
  /** Read-only from the agent's side. Changes only through an approved review. */
  permissions: string[];
  /** Typical check-in interval; 0 when unknown (connected agents). */
  cadenceHours: number;
  connectedAt: number;
  /** "demo" agents are simulated by the server; "connected" agents report through the API. */
  origin: "demo" | "connected";
  /** Last time the agent was heard from (any authenticated request). Connected agents only. */
  lastSeenAt?: number;
  /** Set when the agent reports it is disconnecting; cleared when it is heard from again. */
  disconnectedAt?: number;
  /** Bumped on every human change to status or permissions. */
  configVersion: number;
  /** The configuration version the agent has confirmed it applied. */
  ackedVersion: number;
  /** Connected agents are hidden from public visitors unless an operator marks them public. */
  public: boolean;
}

export type Answer = "yes" | "partially" | "no" | "unsure";

export type QuestionId = "instructions" | "context" | "conflicts" | "review" | "improvements";

export interface QuestionResponse {
  answer: Answer;
  /** Agent-reported confidence in its own answer, 0–100. */
  confidence: number;
  explanation?: string;
}

export type AdjustmentKind = "context" | "instructions" | "tooling" | "permission" | "schedule";

/** A change the agent proposes. Never applied without explicit human approval. */
export interface Adjustment {
  kind: AdjustmentKind;
  title: string;
  detail: string;
  /** Required when kind is "permission". */
  permission?: string;
}

/** "withdrawn": the agent stopped waiting (e.g. an approval timed out), so a decision would no longer do anything. */
export type ReviewStatus = "pending" | "approved" | "rejected" | "acknowledged" | "withdrawn";

export interface CheckIn {
  id: string;
  agentId: string;
  createdAt: number;
  /** simulated = server demo simulation · agent = a connected agent · manual = composed by an operator. */
  source: "simulated" | "agent" | "manual";
  responses: Record<QuestionId, QuestionResponse>;
  feedback: string;
  context: string;
  /** Optional open-ended text the agent chose to write. Model output, not verified experience. */
  reflection?: string;
  adjustment?: Adjustment;
  /** Present only when the check-in requires human review. */
  review?: { status: ReviewStatus; decidedAt?: number; note?: string };
}

export type LogType =
  | "review_approved"
  | "review_rejected"
  | "review_acknowledged"
  | "review_withdrawn"
  | "permission_granted"
  | "agent_paused"
  | "agent_resumed"
  | "integration_disabled"
  | "integration_enabled"
  | "checkin_requested"
  | "checkin_delivered"
  | "config_acknowledged"
  | "agent_registered"
  | "agent_disconnected"
  | "key_rotated"
  | "key_revoked"
  | "policy_violation"
  | "repeated_failures"
  | "unapproved_execution"
  | "authorization_requested"
  | "authorization_approved"
  | "authorization_rejected"
  | "authorization_denied"
  | "authorization_consumed"
  | "authorization_expired"
  | "authorization_cancelled"
  | "authorization_replay"
  | "authorization_mismatch"
  | "unauthorized_execution";

/** Audit log of human, system and agent-acknowledgement actions. */
export interface LogEntry {
  id: string;
  at: number;
  agentId: string;
  actor: "human" | "system" | "agent";
  type: LogType;
  /** English, for the API and old snapshots. The interface builds its own sentence from `type` and `args`. */
  summary: string;
  args?: { perm?: string; adj?: string; target?: "request" | "checkIn"; version?: number; tool?: string; action?: string; policy?: string; count?: number; blocked?: boolean; resource?: string; reason?: string };
  note?: string;
  checkInId?: string;
  /** Alerts: the tool call that triggered them. */
  eventId?: string;
}

export interface Task {
  taskId: string;
  title: string;
  detail?: string;
  startedAt: number;
}

export type TaskEventType = "task.started" | "task.completed" | "task.failed" | "agent.idle" | "tool.called";

/** What happened when an agent's runtime ran a tool. Reported by the runtime, not chosen by the model. */
export type ToolOutcome = "success" | "failure" | "denied" | "pending_approval" | "cancelled";

/** A task lifecycle event as reported by an agent (or the demo simulation). */
export interface TaskEvent {
  id: string;
  seq: number;
  agentId: string;
  at: number;
  type: TaskEventType;
  taskId?: string;
  title?: string;
  detail?: string;
  summary?: string;
  error?: string;
  /** tool.called only. */
  tool?: string;
  action?: string;
  resource?: string;
  outcome?: ToolOutcome;
  policy?: string;
  /** tool.called only: the authorization it ran under, and `gateway` when Tend itself ran the tool. */
  authorizationId?: string;
  via?: string;
  source: CheckIn["source"];
}

/** A review an agent asked for outside a check-in. */
export interface ReviewRequest {
  id: string;
  agentId: string;
  createdAt: number;
  reason: string;
  adjustment?: Adjustment;
  /** Set when an agent's runtime is holding an action (e.g. a payment) until a human approves it. */
  approval?: true;
  source: CheckIn["source"];
  review: { status: ReviewStatus; decidedAt?: number; note?: string };
}

export type AuthorizationStatus = "pending" | "approved" | "rejected" | "expired" | "consumed" | "denied" | "cancelled";

/**
 * A pre-execution authorization, as the event log shows it. "consumed" means Tend authorized the action
 * once; whether it ran is only known from the agent's tool.called report. Never holds a token.
 */
export interface Authorization {
  id: string;
  agentId: string;
  tool: string;
  action: string;
  resource?: string;
  detail?: string;
  status: AuthorizationStatus;
  /** Policy reason code (policy_allowed, approval_required, policy_denied, …) or why it ended. */
  reason?: string;
  createdAt: number;
  /** Pending: when the request lapses. Approved: when the approval lapses. */
  expiresAt?: number;
  decidedAt?: number;
  /** When it reached its current final status (consumed, expired, cancelled). */
  closedAt?: number;
  note?: string;
  /** Replay and mismatch alerts raised against it. */
  alerts: number;
}

/** A human request for a check-in, and whether the agent's runtime has picked it up. */
export interface Ask {
  id: string;
  at: number;
  delivered: boolean;
}
