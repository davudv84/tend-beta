"use client";

import { useState } from "react";
import { ArrowRight, Download, Plus, Search, Settings, Trash2, Trash } from "lucide-react";
import { cx } from "../cx";
import { Scope, useScope } from "../scope";
import { Button, IconButton } from "../ui/button";
import { Checkbox, Field, Input, SearchInput, Select, Switch, Textarea } from "../ui/forms";
import { Dialog, DialogClose, DialogContent, DialogTrigger, Drawer, DrawerClose, DrawerContent, DrawerTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/overlays";
import { ApprovalRequest, PolicyDecision } from "../tend/components";
import { Cap, Chapter, Facts, Plate, Sub } from "./parts";

/* ================================================================================================ 05 Spacing */

const SPACE: [string, number, string][] = [
  ["1", 4, "Icon to text, tight pairs"],
  ["2", 8, "Inline gaps, icon gap"],
  ["3", 12, "Stack inside a control group"],
  ["4", 16, "Panel padding (application)"],
  ["6", 24, "Gutter, panel padding"],
  ["8", 32, "Between groups"],
  ["12", 48, "Between blocks"],
  ["16", 64, "Between subsections"],
  ["24", 96, "Section padding (marketing, mobile)"],
  ["32", 128, "Section padding (marketing)"],
  ["40", 160, "Hero breathing room"],
];

function DensityDemo({ density }: { density: "app" | "marketing" }) {
  const { theme } = useScope();
  const m = density === "marketing";
  return (
    <Scope theme={theme} density={density} className="flex flex-col rounded-t-lg border border-t-line">
      <div className="flex flex-col p-[var(--t-pad-panel)]" style={{ gap: "var(--t-gap-stack)" }}>
        <p className="text-t-caption text-t-muted">{m ? "Marketing: spacious, editorial" : "Application: efficient, structured"}</p>
        <h4 className={m ? "text-t-h2 text-t-ink" : "text-t-h4 text-t-ink"}>Release assistant</h4>
        <p className={m ? "text-t-lead text-t-muted" : "text-t-small text-t-muted"}>Can read the repository and run tests. Asks before it pushes.</p>
        <div className="flex gap-2">
          <Button variant="primary">Review policy</Button>
          <Button>Pause agent</Button>
        </div>
        <ul className="divide-y divide-t-line border-t border-t-line text-t-small">
          {["git status", "npm test", "git push origin main"].map((c, i) => (
            <li key={c} className="flex min-h-[var(--t-row-h)] items-center justify-between gap-4">
              <code className="font-t-mono text-t-code text-t-ink">{c}</code>
              <PolicyDecision decision={i === 2 ? "review" : "allowed"} />
            </li>
          ))}
        </ul>
      </div>
    </Scope>
  );
}

export function Spacing() {
  return (
    <Chapter
      id="spacing"
      n="05"
      title="One scale, two densities."
      lead="Everything sits on a 4px base. Marketing and application share the scale and differ only in a handful of dials: control height, row height, panel padding, and how much air surrounds a section."
    >
      <Sub title="Spacing scale" note="Token names are the multiplier of 4px. Prefer 8, 16, 24, 32, 48, 64 and 96; the others exist for the fine print.">
        <ul className="flex flex-col divide-y divide-t-line border-y border-t-line">
          {SPACE.map(([k, px, use]) => (
            <li key={k} className="grid grid-cols-[3.5rem_3.5rem_1fr] items-center gap-4 py-3 md:grid-cols-[4rem_4rem_minmax(0,1fr)_14rem]">
              <code className="font-t-mono text-[0.75rem] text-t-ink">space-{k}</code>
              <span className="t-num text-t-caption text-t-muted">{px}px</span>
              <span className="h-3 min-w-0"><span className="block h-full rounded-[2px] bg-t-accent/80" style={{ width: `${(Math.min(px, 160) / 160) * 100}%` }} /></span>
              <span className="col-span-3 text-t-caption text-t-muted md:col-span-1">{use}</span>
            </li>
          ))}
        </ul>
      </Sub>

      <Sub title="Application and marketing, side by side" note="The same content with the same components. Only the density dials change: the application is built for scanning many things; the marketing page is built for reading one.">
        <div className="grid gap-6 lg:grid-cols-2">
          <DensityDemo density="app" />
          <DensityDemo density="marketing" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-t-small">
            <thead><tr className="border-b border-t-line text-t-caption text-t-muted"><th className="pb-2 font-normal">Dial</th><th className="pb-2 font-normal">Application</th><th className="pb-2 font-normal">Marketing</th></tr></thead>
            <tbody className="divide-y divide-t-line text-t-ink">
              {[
                ["Control height", "36px (32 compact)", "44px (48 large)"],
                ["Row height", "44px", "64px"],
                ["Panel padding", "16px", "28px"],
                ["Stack gap", "12px", "20px"],
                ["Section padding", "40px", "128px"],
                ["Body text", "14px", "16 to 20px"],
              ].map((r) => <tr key={r[0]}><td className="py-2.5 text-t-muted">{r[0]}</td><td className="py-2.5">{r[1]}</td><td className="py-2.5">{r[2]}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Sub>

      <Sub title="Containers and grid">
        <div className="flex flex-col gap-3">
          {[
            ["Prose", "640", 640],
            ["Narrow", "960 · forms, settings, docs", 960],
            ["Content", "1200 · marketing and app content", 1200],
            ["Wide", "1440 · app shells, big tables", 1440],
          ].map(([n, d, w]) => (
            <div key={n as string} className="flex items-center gap-4">
              <span className="w-16 shrink-0 text-t-small text-t-ink">{n}</span>
              <div className="h-8 flex-1"><div className="h-full rounded-t-sm border border-t-accent-line bg-t-accent-soft" style={{ width: `${((w as number) / 1440) * 100}%` }} /></div>
              <span className="hidden w-60 shrink-0 text-t-caption text-t-muted lg:block">{d}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
          <Facts
            items={[
              ["Grid", "12 columns. Gutter 16px on phones, 24px from 768, 32px from 1280 (marketing)"],
              ["Page margin", "20px phone, 32px tablet, 48px desktop"],
              ["Breakpoints", "640 · 768 · 1024 · 1280 · 1536"],
            ]}
          />
          <Facts
            items={[
              ["Alignment", "Left-aligned text. Centre only a single short line or a graphic"],
              ["Measure", "Prose never wider than 40rem; tables and code may run full width"],
              ["Rhythm", "Related things 8 to 16px apart; separate groups 32px or more"],
            ]}
          />
        </div>
      </Sub>
    </Chapter>
  );
}

/* ================================================================================================ 06 Surfaces */

export function Surfaces() {
  const [confirmed, setConfirmed] = useState(false);
  const levels: [string, string, string, string][] = [
    ["Canvas", "bg-t-canvas", "", "The page. Most content sits directly on it."],
    ["Sunken", "bg-t-sunken", "", "Wells and hover. Below the page, never above."],
    ["Surface", "bg-t-surface border border-t-line", "shadow-t-1", "Plates and panels that need to read as an object."],
    ["Raised", "bg-t-raised border border-t-line", "shadow-t-2", "Menus, popovers, selects, toasts."],
    ["Overlay", "bg-t-raised border border-t-line", "shadow-t-3", "Dialogs and drawers, over a scrim."],
  ];
  return (
    <Chapter
      id="surfaces"
      n="06"
      title="Quiet surfaces, hairline edges."
      lead="Hierarchy comes from space and type first, then a hairline, then a surface tint, then shadow, in that order. Most things need only the first two. Radii are small enough to feel precise."
    >
      <Sub title="Elevation" note="Five levels. A shadow is a hint; the hairline does the real work, which is why dark mode can use almost the same structure.">
        <div className="grid gap-4 rounded-t-lg border border-t-line bg-t-canvas p-6 sm:grid-cols-2 md:p-8 lg:grid-cols-5">
          {levels.map(([n, bg, sh, d], i) => (
            <div key={n} className="flex flex-col gap-3">
              <div className={cx("grid h-28 place-items-center rounded-t-lg text-t-label text-t-ink", bg, sh)}>
                <span className="t-num text-t-muted">{i}</span>
              </div>
              <div>
                <p className="text-t-label text-t-ink">{n}</p>
                <p className="text-t-caption text-t-muted [text-wrap:pretty]">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Shape" note="Controls are 8px. Panels are 12px. Dialogs are 16px. Nothing is a pill except a switch.">
        <div className="flex flex-wrap items-end gap-8">
          {[
            ["xs", 4, "Keys, tags"],
            ["sm", 6, "Badges"],
            ["md", 8, "Buttons, inputs"],
            ["lg", 12, "Panels, menus"],
            ["xl", 16, "Dialogs"],
          ].map(([n, r, u]) => (
            <div key={n as string} className="flex flex-col gap-2.5">
              <div className="size-20 border border-t-line-strong bg-t-surface" style={{ borderRadius: r as number }} />
              <div><p className="text-t-label text-t-ink">{n} · {r}px</p><p className="text-t-caption text-t-muted">{u}</p></div>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Borders and dividers" note="Prefer spacing to lines. When a line is needed, it is a 1px hairline. A strong border is for things you can touch.">
        <div className="grid gap-x-12 gap-y-8 md:grid-cols-3">
          <div><Cap>Hairline · line</Cap><div className="h-px bg-t-line" /><p className="mt-3 text-t-caption text-t-muted">Between rows and sections.</p></div>
          <div><Cap>Control · line-strong</Cap><div className="h-px bg-t-line-strong" /><p className="mt-3 text-t-caption text-t-muted">Inputs, secondary buttons.</p></div>
          <div><Cap>The gate</Cap><div className="t-gate" /><p className="mt-3 text-t-caption text-t-muted">A decision point, used rarely.</p></div>
        </div>
      </Sub>

      <Sub title="Overlays" note="A dialog asks one question. A drawer continues work beside the page. A popover explains or edits one thing in place. All three trap focus appropriately, close on Escape, and return focus to what opened them.">
        <Plate caption="Open each one. Escape closes; focus returns to the trigger.">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
              <DialogContent
                title="Pause release assistant?"
                description="It will stop mid-task. Pending approval requests stay open, and you can resume it at any time."
                footer={<><DialogClose asChild><Button>Keep running</Button></DialogClose><DialogClose asChild><Button variant="destructive" leading={Trash} onClick={() => setConfirmed(true)}>Pause agent</Button></DialogClose></>}
              >
                <Facts items={[["Agent", "Release assistant"], ["Running", "2 tasks"], ["Waiting", "1 approval"]]} />
              </DialogContent>
            </Dialog>
            <Drawer>
              <DrawerTrigger asChild><Button variant="secondary">Open drawer</Button></DrawerTrigger>
              <DrawerContent title="Review request" description="Decide here; the page behind stays where it was." footer={<DrawerClose asChild><Button>Close</Button></DrawerClose>}>
                <ApprovalRequest
                  data={{ agent: "Release assistant", brand: "claudecode", verb: "push to a branch", resource: "git push origin feature/discount-codes", policy: "Push to remote", why: "Pushing publishes work outside this machine.", requestedBy: "Priya N.", waited: "2 min" }}
                />
              </DrawerContent>
            </Drawer>
            <Popover>
              <PopoverTrigger asChild><Button variant="secondary">Open popover</Button></PopoverTrigger>
              <PopoverContent>
                <div className="flex flex-col gap-3">
                  <p className="text-t-label text-t-ink">Why did this pause?</p>
                  <p className="text-t-small text-t-muted">Your “Push to remote” rule asks a person before any agent publishes code. You can change it in the policy.</p>
                  <Button variant="ghost" size="sm" trailing={ArrowRight} className="self-start -ml-2">View policy</Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {confirmed && <p role="status" className="mt-5 text-t-small text-t-muted">The dialog’s action ran (demonstration only; nothing was paused).</p>}
        </Plate>
      </Sub>
    </Chapter>
  );
}

/* ================================================================================================ 07 Buttons */

const FORCE: Record<string, Record<string, string>> = {
  primary: { Hover: "!bg-t-accent-hover", Pressed: "!bg-t-accent-press scale-[0.985]", Focus: "outline-2 outline-offset-2 outline-t-focus" },
  secondary: { Hover: "!bg-t-sunken", Pressed: "!bg-t-sunken scale-[0.985]", Focus: "outline-2 outline-offset-2 outline-t-focus" },
  ghost: { Hover: "!bg-t-sunken !text-t-ink", Pressed: "!bg-t-line scale-[0.985]", Focus: "outline-2 outline-offset-2 outline-t-focus" },
  destructive: { Hover: "!bg-t-danger-hover", Pressed: "!bg-t-danger-hover scale-[0.985]", Focus: "outline-2 outline-offset-2 outline-t-focus" },
};

export function Buttons() {
  const [busy, setBusy] = useState(false);
  const variants = ["primary", "secondary", "ghost", "destructive"] as const;
  const label = { primary: "Approve once", secondary: "Pause agent", ghost: "View policy", destructive: "Disconnect" };
  return (
    <Chapter
      id="buttons"
      n="07"
      title="Buttons that say what they do."
      lead="One primary action per view. Labels are verbs. Every state is visible: hover is a change in tone, press is a small settle, focus is an outline, loading holds the button’s width so nothing jumps."
    >
      <Sub title="Variants and states" note="The real components, with hover, press and focus held on so they can be compared. Try the live ones in the last column.">
        <Plate bodyClassName="overflow-x-auto !p-5">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead>
              <tr className="text-t-caption text-t-muted">
                {["", "Default", "Hover", "Pressed", "Focus", "Disabled", "Loading", "Live"].map((h) => <th key={h} className="pr-2 pb-4 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v}>
                  <th scope="row" className="pr-2 pb-5 align-middle text-t-label font-medium text-t-ink capitalize">{v}</th>
                  <td className="pr-2 pb-5"><Button variant={v}>{label[v]}</Button></td>
                  <td className="pr-2 pb-5"><Button variant={v} className={FORCE[v].Hover} tabIndex={-1}>{label[v]}</Button></td>
                  <td className="pr-2 pb-5"><Button variant={v} className={FORCE[v].Pressed} tabIndex={-1}>{label[v]}</Button></td>
                  <td className="pr-2 pb-5"><Button variant={v} className={FORCE[v].Focus} tabIndex={-1}>{label[v]}</Button></td>
                  <td className="pr-2 pb-5"><Button variant={v} disabled>{label[v]}</Button></td>
                  <td className="pr-2 pb-5"><Button variant={v} loading>{label[v]}</Button></td>
                  <td className="pb-5"><Button variant={v} loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1600); }}>{label[v]}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Plate>
      </Sub>

      <Sub title="Sizes and icons" note="Small (32) for dense tables and toolbars, default follows the density (36 app, 44 marketing), large (48) for marketing calls to action. Icons lead for actions on an object and trail for movement.">
        <Plate>
          <div className="flex flex-wrap items-start gap-x-10 gap-y-8">
            <div><Cap>Small · 32</Cap><Button size="sm" variant="secondary" leading={Plus}>Add rule</Button></div>
            <div><Cap>Default · 36 / 44</Cap><Button variant="secondary" leading={Plus}>Add rule</Button></div>
            <div><Cap>Large · 48</Cap><Button size="lg" variant="primary" trailing={ArrowRight}>Get started</Button></div>
            <div><Cap>Leading and trailing</Cap><div className="flex gap-2"><Button variant="secondary" leading={Download}>Export log</Button><Button variant="ghost" trailing={ArrowRight}>Read the docs</Button></div></div>
          </div>
        </Plate>
        <Plate caption="Icon buttons are square, always carry a label, and show it as a tooltip on hover and keyboard focus.">
          <div className="flex flex-wrap items-center gap-3">
            <IconButton icon={Search} label="Search" size="sm" variant="secondary" />
            <IconButton icon={Settings} label="Settings" variant="secondary" />
            <IconButton icon={Plus} label="Add agent" size="lg" variant="primary" />
            <IconButton icon={Trash2} label="Delete rule" variant="ghost" />
            <IconButton icon={Settings} label="Settings, disabled" variant="ghost" disabled />
            <IconButton icon={Download} label="Exporting" variant="secondary" loading />
          </div>
        </Plate>
      </Sub>
    </Chapter>
  );
}

/* ================================================================================================ 08 Forms */

export function Forms() {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("support");
  const [sw, setSw] = useState(true);
  const [c, setC] = useState<boolean | "indeterminate">("indeterminate");
  const [name, setName] = useState("Support agent");
  const nameError = name.trim().length < 3 ? "Use at least 3 characters." : undefined;
  return (
    <Chapter
      id="forms"
      n="08"
      title="Fields you can trust at a glance."
      lead="Every control shares one surface: the same border, the same hover, the same focus ring, the same error treatment. Labels are always visible and always attached; hints and errors are announced to assistive technology."
    >
      <Sub title="Inputs" note="Type in the last field to see validation respond as you go.">
        <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
          <Field label="Agent name" hint="Shown in activity and approvals.">{(p) => <Input placeholder="e.g. Release assistant" {...p} />}</Field>
          <Field label="Search policies">{(p) => <SearchInput value={q} onValueChange={setQ} placeholder="Search policies" aria-label="Search policies" id={p.id} />}</Field>
          <Field label="Applies to" hint="You can change this later.">{(p) => (
            <Select
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              value={scope}
              onValueChange={setScope}
              options={[{ value: "support", label: "Support agent" }, { value: "release", label: "Release assistant" }, { value: "research", label: "Research agent", hint: "3 tools" }, { value: "all", label: "All agents" }]}
            />
          )}</Field>
          <Field label="Name" error={nameError} hint="Try deleting characters.">{(p) => <Input value={name} onChange={(e) => setName(e.target.value)} {...p} />}</Field>
          <Field label="Disabled" hint="Managed by your organisation.">{(p) => <Input disabled value="Production policy" readOnly {...p} />}</Field>
          <Field label="Endpoint" hint="Identifiers and URLs use the mono face.">{(p) => <Input mono defaultValue="https://tend.example.com/v1/decide" {...p} />}</Field>
          <Field label="Note for the reviewer" optional className="md:col-span-2">{(p) => <Textarea placeholder="Anything the reviewer should know before deciding" {...p} />}</Field>
        </div>
      </Sub>

      <Sub title="Choices">
        <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Cap>Checkbox</Cap>
            <Checkbox label="Ask me before any file is deleted" description="Applies to every agent on this policy." defaultChecked />
            <Checkbox label="Notify the on-call channel" checked={c} onCheckedChange={setC} description={c === "indeterminate" ? "Some agents notify, some do not." : undefined} />
            <Checkbox label="Allow web access" />
            <Checkbox label="Retired option" disabled />
          </div>
          <div className="flex flex-col gap-4">
            <Cap>Switch</Cap>
            <Switch label="Require a reviewer for pushes" description="Takes effect on the next request." checked={sw} onCheckedChange={setSw} />
            <Switch label="Send a weekly summary" defaultChecked={false} />
            <Switch label="Locked by policy" disabled defaultChecked />
          </div>
        </div>
      </Sub>
    </Chapter>
  );
}
