"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Empty, PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { useNow } from "@/lib/format";
import { requestKind, type HomeRequest } from "@/lib/home";
import { call, useStore } from "@/lib/store";
import type { Agent, Authorization } from "@/lib/types";
import { AnswerCard } from "@/ui/answer-card";
import { Badge, Card, type Tone } from "@/ui/primitives";

/** GET /api/v1/approvals/{id}: the approval as the server has it. */
interface Approval {
  id: string; agentId: string; agentName: string; tool: string; action: string; resource: string | null; detail: string | null;
  risk: "low" | "high"; status: "pending" | "approved" | "denied" | "expired" | "cancelled";
  createdAt: number; expiresAt: number; decidedBy: string | null; via: "dashboard" | "web-push" | "telegram" | null;
}
const TONE: Record<Approval["status"], Tone> = { pending: "attention", approved: "good", denied: "danger", expired: "neutral", cancelled: "neutral" };
const LABEL = { approved: "approved", denied: "rejected", expired: "expired", cancelled: "cancelled", pending: "pending" } as const;

/**
 * One approval on a page of its own. While it waits, it is answered with the same card as on Home and under Approvals (the same request to
 * the server, the same second confirmation for spending). Afterwards the page says what became of it, who decided and through which channel.
 */
export default function View() {
  const t = useT();
  const g = t.approvalPage;
  const { id } = useParams<{ id: string }>();
  const inStore = useStore((s) => s.authorizations.find((a) => a.id === id));
  const agents = useStore((s) => s.agents);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [loaded, setLoaded] = useState<{ id: string; approval: Approval | null } | null>(null);

  const [round, setRound] = useState(0);
  const approval = loaded?.id === id ? loaded.approval : undefined;
  // Asked again whenever what this browser knows about the request changes (decided elsewhere, withdrawn), once its time is up, and after an answer.
  const lapsed = approval?.status === "pending" && approval.expiresAt <= now;
  useEffect(() => {
    let live = true;
    void call<{ approval: Approval }>(`/api/v1/approvals/${encodeURIComponent(id)}`, undefined, "GET").then((r) => { if (live) setLoaded({ id, approval: r.ok ? r.data.approval : null }); });
    return () => { live = false; };
  }, [id, inStore?.status, lapsed, round]);
  const load = () => setRound((n) => n + 1);

  const back = (
    <Link href="/oversight" className="mb-8 inline-flex items-center gap-1.5 text-small text-faint transition-colors hover:text-foreground">
      <ArrowLeftIcon className="size-3.5" aria-hidden /> {g.all}
    </Link>
  );
  if (approval === undefined) return <div>{back}<p role="status" className="text-[14px] text-muted-foreground">{g.loading}</p></div>;
  if (approval === null) return <Empty title={g.notFound} action={<Button asChild variant="outline"><Link href="/oversight">{g.all}</Link></Button>} />;

  // The card gets the request as this browser already holds it (with the rule behind it and the exact command), or as the server just gave it.
  const auth: Authorization = inStore ?? {
    id: approval.id, agentId: approval.agentId, tool: approval.tool, action: approval.action, status: "pending", createdAt: approval.createdAt, expiresAt: approval.expiresAt, alerts: 0,
    ...(approval.resource && { resource: approval.resource }), ...(approval.detail && { detail: approval.detail }),
  };
  const agent = agents.find((a) => a.id === approval.agentId) ?? ({ id: approval.agentId, name: approval.agentName } as Agent);
  const request: HomeRequest = { auth, agent, kind: requestKind(approval.tool), lapsesAt: approval.expiresAt };
  const what = `${approval.tool} · ${approval.action}`;
  const p = t.notify.pushApproval;

  return (
    <div>
      {back}
      <PageHeader title={g.title} description={g.description} />
      {approval.status === "pending" && !lapsed ? (
        <AnswerCard request={request} now={now} onAnswered={load} />
      ) : (
        <Card>
          <div className="grid gap-3 px-6 py-5">
            <Badge tone={TONE[lapsed ? "expired" : approval.status]} className="justify-self-start">{t.authz.status[LABEL[lapsed ? "expired" : approval.status]]}</Badge>
            <p className="text-[15px] font-medium text-pretty">{g.asked(approval.agentName, what)}</p>
            {approval.detail && <p className="font-mono text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{approval.detail}</p>}
            <p className="text-[14px] text-pretty text-muted-foreground">
              {approval.status === "approved" || approval.status === "denied" ? g.outcome[approval.status](approval.decidedBy ?? p.someone, p.via[approval.via ?? "dashboard"])
                : approval.status === "cancelled" ? g.outcome.cancelled : g.outcome.expired}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
