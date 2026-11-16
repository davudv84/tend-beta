// What a notification channel is. One file per channel in this folder, each exporting a Channel; notify/index.ts lists them and knows
// nothing else about any of them. Adding Slack or a native app (APNs) later is one more file here and one more entry in that list.
import type { ApprovalView } from "../../approvals.ts";
import type { DB } from "../../db.ts";
import type { Kind } from "../../notifications.ts";

/** One queued notification, as the notifier hands it to a channel. An approval notification carries the approval it is about. */
export interface Notice {
  /** The notification's id (notifications.id); what a channel sent for it is remembered under this id (delivery_messages). */
  id: string;
  workspace: string;
  kind: Kind;
  subject: string | null;
  agentId: string | null;
  createdAt: number;
  approval?: ApprovalView;
}

export interface Tally { sent: number; failed: number }
export type ChannelName = "web-push" | "telegram";

export interface Channel {
  name: ChannelName;
  /** Whether this server has the credentials to use the channel at all. */
  configured(): boolean;
  /** Which kinds of notification the channel carries. Every channel carries "approval". */
  carries(kind: Kind): boolean;
  /**
   * Sends one notification to everyone in its workspace who connected this channel. Must not throw for a recipient that cannot be reached
   * (count it as failed and go on). For an approval, remembers what it sent so `resolved` can update it.
   */
  send(db: DB, notice: Notice, now: number): Promise<Tally>;
  /**
   * The approval of this notice was decided, expired or was withdrawn: update what `send` put out, where the channel can (edit a message,
   * replace a notification). Called at most a few times per approval; a second call must find nothing left to do.
   */
  resolved(db: DB, notice: Notice & { approval: ApprovalView }, now: number): Promise<void>;
}
