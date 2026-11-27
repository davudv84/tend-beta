"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Copy, FileText, Globe, Inbox, Pencil, Pause, ShieldCheck, Terminal, Trash2, Users } from "lucide-react";
import { Button, IconButton } from "../ui/button";
import { ActivityRow, CodeBlock, EventTimeline, StatusBadge, Table, TBody, Td, Th, THead, Tr } from "../ui/data";
import { Alert, EmptyState, Skeleton, useToast } from "../ui/feedback";
import { SearchInput } from "../ui/forms";
import { AppSidebar, Breadcrumbs, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownRadioGroup, DropdownRadioItem, DropdownSeparator, DropdownTrigger, SiteHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/navigation";
import { Tooltip } from "../ui/tooltip";
import { ActivityEvent, AgentAvatar, AgentStatus, ApprovalRequest, IntegrationCard, PolicyDecision, PolicySummary } from "../tend/components";
import { Chapter, Plate, SampleTag, Sub } from "./parts";
import { AGENTS, APP_NAV, APPROVAL, EVENTS, POLICY, TIMELINE } from "./sample-data";

/* ================================================================================================ 09 Navigation */

export function Navigation() {
  const [nav, setNav] = useState("Product");
  const [side, setSide] = useState("approvals");
  const [sort, setSort] = useState("recent");
  return (
    <Chapter
      id="navigation"
      n="09"
      title="Finding your way, without thinking about it."
      lead="Navigation is typography first: labels you can read, one clearly marked place you are, and movement that follows your hand. The marketing header is airy and sits on the page; the application sidebar is dense and sits beside it."
    >
      <Sub title="Marketing header" note="72px tall, on the page itself with no bar or border until the page scrolls. One primary action.">
        <Plate><SiteHeader links={["Product", "How it works", "Security", "Docs", "Pricing"]} active={nav} onNavigate={setNav} /></Plate>
      </Sub>

      <Sub title="Application sidebar" note="Grouped, with counts only where a number means something waiting. The current page is marked by tone and weight, not by a coloured bar.">
        <Plate bare bodyClassName="grid overflow-hidden md:grid-cols-[15rem_1fr]">
          <AppSidebar
            groups={APP_NAV}
            active={side}
            onSelect={setSide}
            className="border-b border-t-line md:border-r md:border-b-0"
            footer={
              <div className="flex items-center gap-2.5 rounded-t-md px-2.5 py-2">
                <span aria-hidden className="grid size-7 place-items-center rounded-full bg-t-accent-soft text-t-caption font-medium text-t-accent-text">DR</span>
                <span className="flex min-w-0 flex-col"><span className="truncate text-t-small text-t-ink">Dana Reyes</span><span className="truncate text-t-caption text-t-muted">Owner · Acme</span></span>
              </div>
            }
          />
          <div className="flex min-h-48 items-center justify-center bg-t-surface p-8 text-t-small text-t-muted">
            <p>Selected: <span className="text-t-ink capitalize">{side}</span></p>
          </div>
        </Plate>
      </Sub>

      <div className="grid gap-x-12 gap-y-16 lg:grid-cols-2">
        <Sub title="Tabs" note="The indicator glides to the tab you chose; the panel rises in 12px.">
          <Plate>
            <Tabs defaultValue="all">
              <TabsList label="Requests">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="waiting" count={3}>Waiting</TabsTrigger>
                <TabsTrigger value="decided">Decided</TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="pt-5 text-t-small text-t-muted">Every request from every agent, newest first.</TabsContent>
              <TabsContent value="waiting" className="pt-5 text-t-small text-t-muted">Three requests are waiting for a person. The oldest has waited 2 minutes.</TabsContent>
              <TabsContent value="decided" className="pt-5 text-t-small text-t-muted">Requests that were approved or denied, with who decided.</TabsContent>
            </Tabs>
          </Plate>
        </Sub>

        <Sub title="Breadcrumbs and dropdown" note="Breadcrumbs say where you are; the last item is the page and is not a link.">
          <Plate>
            <div className="flex flex-col gap-8">
              <Breadcrumbs items={[{ label: "Agents" }, { label: "Release assistant" }, { label: "Policy" }]} />
              <div className="flex flex-wrap items-center gap-3">
                <Dropdown>
                  <DropdownTrigger asChild><Button variant="secondary" trailing={ArrowUpDown}>Release assistant</Button></DropdownTrigger>
                  <DropdownContent>
                    <DropdownLabel>Agent</DropdownLabel>
                    <DropdownItem icon={Pencil} shortcut="E">Edit policy</DropdownItem>
                    <DropdownItem icon={Copy} shortcut="D">Duplicate</DropdownItem>
                    <DropdownItem icon={Pause}>Pause agent</DropdownItem>
                    <DropdownSeparator />
                    <DropdownItem icon={Trash2} danger>Disconnect</DropdownItem>
                  </DropdownContent>
                </Dropdown>
                <Dropdown>
                  <DropdownTrigger asChild><Button variant="ghost" trailing={ArrowUpDown}>Sort: {sort === "recent" ? "Most recent" : "Most requests"}</Button></DropdownTrigger>
                  <DropdownContent>
                    <DropdownRadioGroup value={sort} onValueChange={setSort}>
                      <DropdownRadioItem value="recent">Most recent</DropdownRadioItem>
                      <DropdownRadioItem value="requests">Most requests</DropdownRadioItem>
                    </DropdownRadioGroup>
                  </DropdownContent>
                </Dropdown>
              </div>
            </div>
          </Plate>
        </Sub>
      </div>
    </Chapter>
  );
}

/* ================================================================================================ 10 Feedback and data */

export function Data() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>("a1");
  const rows = useMemo(() => AGENTS.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <Chapter
      id="data"
      n="10"
      title="Telling you what happened, plainly."
      lead="Feedback is brief and specific. Data is set for scanning: tabular figures, hairline rows, one status word per row. Colour never works alone; every status has an icon or a word."
    >
      <Sub title="Feedback" note="Toasts confirm something you just did and leave on their own; hovering pauses them. Alerts stay until the situation changes.">
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Alert tone="info" title="Policy changes apply to the next request">Requests already waiting keep the rules they were checked against.</Alert>
            <Alert tone="ok" title="Release assistant is connected">It checked in a few seconds ago.</Alert>
            <Alert tone="warn" title="3 requests are waiting for review" action={<Button size="sm" variant="secondary" leading={Inbox}>Open approvals</Button>}>The oldest has been waiting for 2 minutes.</Alert>
            <Alert tone="danger" title="Cursor in web-app lost its connection">Its last status report was an hour ago. Requests from it are being denied until it reconnects.</Alert>
          </div>
          <Plate caption="Toasts appear bottom right, are announced politely, and pause while you hover or focus them.">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => toast({ tone: "ok", title: "Approved once", description: "Release assistant ran git push.", action: { label: "Undo", onClick: () => toast({ tone: "neutral", title: "Undone", description: "Demonstration only." }) } })}>Success</Button>
              <Button variant="secondary" onClick={() => toast({ tone: "warn", title: "Request needs review", description: "Release assistant wants to push code." })}>Warning</Button>
              <Button variant="secondary" onClick={() => toast({ tone: "danger", title: "Could not reach the gateway", description: "We will retry in a few seconds." })}>Error</Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-t-small text-t-muted">
              <Tooltip label="Copy request ID" shortcut="C"><IconButton icon={Copy} label="Copy request ID" variant="secondary" tooltip={false} /></Tooltip>
              <span>Hover or focus the button for a tooltip.</span>
            </div>
          </Plate>
        </div>
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <Plate caption="Empty states say what belongs here and offer the one next step.">
            <EmptyState icon={Inbox} title="Nothing is waiting for you" action={<Button variant="secondary">View recent decisions</Button>}>When an agent needs a person, the request appears here and nothing runs until you decide.</EmptyState>
          </Plate>
          <Plate caption="Skeletons match the shape of what is coming. They breathe slowly; under reduced motion they stay still.">
            <div className="mb-4"><Button size="sm" variant="secondary" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 2200); }}>{loading ? "Loading…" : "Reload list"}</Button></div>
            <div className="flex flex-col gap-4" aria-busy={loading}>
              {(loading ? [0, 1, 2] : EVENTS.slice(0, 3)).map((e, i) =>
                typeof e === "number" ? (
                  <div key={i} className="flex items-center gap-3"><Skeleton className="size-8 rounded-t-md" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="h-3 w-10" /></div>
                ) : (
                  <ActivityRow key={i} icon={e.action.startsWith("shell") ? Terminal : e.action.startsWith("web") ? Globe : FileText} title={<><span className="font-medium">{e.agent}</span> · {e.action}</>} meta={e.resource} time={e.time} />
                ),
              )}
            </div>
          </Plate>
        </div>
      </Sub>

      <Sub title="Table" note="The workhorse of the application. Left-aligned text, right-aligned numbers, 44px rows, hairlines only. Click a row to select it. The status is a badge with a word.">
        <Plate bare bodyClassName="bg-t-surface">
          <div className="flex items-center justify-between gap-4 p-4 pb-3">
            <SearchInput value={q} onValueChange={setQ} placeholder="Filter agents" aria-label="Filter agents" className="w-full max-w-xs" />
            <span className="t-num hidden text-t-caption text-t-muted sm:block">{rows.length} of {AGENTS.length} agents</span>
          </div>
          <div className="px-4 pb-2">
            <Table>
              <THead><tr><Th>Agent</Th><Th>Status</Th><Th>Policy</Th><Th className="text-right">Requests, 7 days</Th><Th className="text-right">Last seen</Th></tr></THead>
              <TBody>
                {rows.map((a) => (
                  <Tr key={a.id} selected={picked === a.id} onClick={() => setPicked(a.id)} className="cursor-pointer">
                    <Td><span className="flex items-center gap-3"><AgentAvatar brand={a.brand} size={32} /><span className="font-medium text-t-ink">{a.name}</span></span></Td>
                    <Td><AgentStatus state={a.state} /></Td>
                    <Td className="text-t-muted">{a.policy}</Td>
                    <Td className="t-num text-right">{a.requests}</Td>
                    <Td className="text-right text-t-muted">{a.last}</Td>
                  </Tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5}><EmptyState icon={Users} title={`No agent matches “${q}”`}>Check the spelling, or clear the filter.</EmptyState></td></tr>}
              </TBody>
            </Table>
          </div>
        </Plate>
      </Sub>

      <div className="grid gap-x-12 gap-y-16 lg:grid-cols-2">
        <Sub title="Status badges" note="Six tones, one shape: a 6px-radius tag with a dot and a word.">
          <Plate>
            <div className="flex flex-wrap gap-2.5">
              <StatusBadge tone="ok">Connected</StatusBadge><StatusBadge tone="warn">Requires review</StatusBadge><StatusBadge tone="danger">Error</StatusBadge>
              <StatusBadge tone="info">Compatible</StatusBadge><StatusBadge tone="neutral">Planned</StatusBadge><StatusBadge tone="neutral" dot={false}>Read only</StatusBadge>
            </div>
          </Plate>
        </Sub>
        <Sub title="Activity rows" note="Icon for the kind of action, a sentence, a timestamp. Rows that open something show a chevron on hover.">
          <Plate bodyClassName="!p-3">
            <ActivityRow icon={Terminal} title={<><span className="font-medium">Release assistant</span> ran <code className="font-t-mono text-t-code">npm test</code></>} meta="Allowed by Engineering · balanced" time="2 min" onClick={() => toast({ tone: "neutral", title: "Row opened", description: "Rows can open a detail view or drawer." })} />
            <ActivityRow icon={Globe} title={<><span className="font-medium">Support agent</span> fetched a page</>} meta="help.example.com" time="9 min" onClick={() => {}} />
            <ActivityRow icon={ShieldCheck} title={<><span className="font-medium">Dana Reyes</span> edited a policy</>} meta="Engineering · balanced" time="Yesterday" />
          </Plate>
        </Sub>
      </div>

      <div className="grid gap-x-12 gap-y-16 lg:grid-cols-2">
        <Sub title="Code block" note="Mono is for code and identifiers only. A quiet header, a copy action that confirms in place, a colour set that holds in both themes.">
          <div className="flex flex-col gap-4">
            <CodeBlock lang="shell" title="Terminal" code={`# Connect an agent through the gateway\nexport TEND_URL="https://tend.example.com"\ntend connect --agent "Release assistant"`} />
            <CodeBlock lang="json" title="Decision" code={`{\n  "agent": "Release assistant",\n  "action": "shell.run",\n  "decision": "review",\n  "policy": "Push to remote",\n  "attempts": 1\n}`} />
          </div>
        </Sub>
        <Sub title="Event timeline" note="One request, told in order. Nodes take the outcome’s tone, and the sentence always says the outcome too.">
          <Plate><EventTimeline events={TIMELINE} /></Plate>
        </Sub>
      </div>
    </Chapter>
  );
}

/* ================================================================================================ 11 TEND */

export function Tend() {
  return (
    <Chapter
      id="tend"
      n="11"
      title="Components that speak TEND."
      lead="These carry the product’s own vocabulary: an agent asks, a policy decides, a person reviews. They are built from the same parts as everything else, and each one answers a single question at a glance."
    >
      <p className="-mt-12 flex items-center gap-3 text-t-small text-t-muted"><SampleTag /> Agents, people and events below are invented. Integration names come from TEND’s catalogue; their statuses are illustrative, not verification results.</p>

      <div className="grid gap-x-12 gap-y-16 lg:grid-cols-2">
        <Sub title="Agent status" note="Is it running? Active has a slow halo: the one place the interface is allowed to breathe.">
          <Plate>
            <div className="flex flex-col gap-4">
              <AgentStatus state="active" detail="Reported 2 min ago" />
              <AgentStatus state="inactive" detail="Last seen 3 days ago" />
              <AgentStatus state="error" detail="Lost connection" />
            </div>
          </Plate>
        </Sub>
        <Sub title="Policy decision" note="What TEND decided. An icon and a word in the list; a short reason where it matters.">
          <Plate>
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3"><PolicyDecision decision="allowed" /><PolicyDecision decision="review" /><PolicyDecision decision="denied" /></div>
              <div className="flex flex-wrap gap-2.5"><PolicyDecision variant="badge" decision="allowed" /><PolicyDecision variant="badge" decision="review" /><PolicyDecision variant="badge" decision="denied" /></div>
              <PolicyDecision variant="block" decision="denied" reason="Writing .env files is on the “Never allowed” list for this policy." />
            </div>
          </Plate>
        </Sub>
      </div>

      <Sub title="Approval request" note="A person decides about one thing. The sentence first, the exact command second, then two honest choices. Try it.">
        <ApprovalRequest data={APPROVAL} className="max-w-2xl" />
      </Sub>

      <Sub title="Activity events" note="Agent, action, resource, decision, timestamp, in that order, on one line.">
        <Plate bare bodyClassName="bg-t-surface p-2 sm:p-3">
          <div className="hidden grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9.5rem_4.5rem] gap-x-4 px-2 pt-1 pb-2 text-t-caption text-t-muted sm:grid"><span>Agent</span><span>Action and resource</span><span>Decision</span><span className="text-right">When</span></div>
          <div className="divide-y divide-t-line">{EVENTS.map((e) => <ActivityEvent key={e.resource} event={e} onOpen={() => {}} />)}</div>
        </Plate>
      </Sub>

      <Sub title="Policy summary" note="A rule set in words, grouped by what a person cares about: what it does alone, what it asks about, what it never does.">
        <Plate><PolicySummary data={POLICY} /></Plate>
      </Sub>

      <Sub title="Integration cards" note="One way to put TEND in front of an agent. “Planned” never offers a button, because there is nothing to connect.">
        <div className="grid gap-4 md:grid-cols-3">
          <IntegrationCard data={{ name: "Claude Code", brand: "claudecode", kind: "Coding agent", blurb: "Hook it up and every tool call is checked before it runs.", status: "connected" }} />
          <IntegrationCard data={{ name: "Cursor", brand: "cursor", kind: "Coding agent", blurb: "Connect through the Model Context Protocol in a few minutes.", status: "compatible" }} />
          <IntegrationCard data={{ name: "Aider", kind: "Coding agent", blurb: "Not implemented yet. We will list it as connectable when it is.", status: "planned" }} />
        </div>
      </Sub>
    </Chapter>
  );
}

