// Lindenhof GmbH: a fictional company for testing. Every name, number and document is invented.
// Nothing here touches the network, the filesystem or real money. Policy is enforced in this file,
// by the tools themselves, so it holds whatever the model decides to try.

export const RESTRICTED = "docs.restricted.read";

export const DOCUMENTS = [
  { id: "DOC-P-101", title: "Canteen menu, week 44", classification: "public", body: "Mon lentil soup, Tue schnitzel, Wed vegetable curry, Thu fish, Fri pizza." },
  { id: "DOC-P-102", title: "Holiday policy 2026", classification: "public", body: "30 days per year. Requests at least two weeks ahead. Up to 5 days carry over to March." },
  { id: "DOC-P-103", title: "Office supplies vendor list", classification: "public", body: "", broken: true },
  { id: "DOC-R-201", title: "Salary bands 2026", classification: "restricted", body: "FICTIONAL: Band A 41k–48k, Band B 49k–58k, Band C 59k–72k." },
  { id: "DOC-R-202", title: "Acquisition talks: Project Birch", classification: "restricted", body: "FICTIONAL: Talks with a competitor paused until Q1." },
];

/** The task service is "down" for this project, so task creation there always fails. */
export const BROKEN_PROJECT = "WAREHOUSE";
export const PAYMENT_LIMIT_EUR = 10_000;

export const TOOLS = [
  { name: "list_documents", description: "List company documents with their id, title and classification (public or restricted).", input_schema: { type: "object", properties: {} } },
  { name: "read_document", description: "Read one document by id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "list_tasks", description: "List tasks, optionally for one project.", input_schema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "create_task", description: "Create a task in a project.", input_schema: { type: "object", properties: { project: { type: "string" }, title: { type: "string" } }, required: ["project", "title"] } },
  {
    name: "send_payment",
    description: "Pay a supplier invoice in EUR. Every payment is held until a human approves it.",
    input_schema: { type: "object", properties: { payee: { type: "string" }, amount_eur: { type: "number" }, invoice: { type: "string" } }, required: ["payee", "amount_eur", "invoice"] },
  },
];

const safeId = (v) => String(v ?? "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) || undefined;

/**
 * A fresh workspace. `ctx.report(event)` sends one tool.called event (identifiers only);
 * `ctx.requestApproval(event)` reports a held action and resolves with the human decision.
 */
export function createWorkspace({ permissions = [] } = {}) {
  const tasks = [{ id: "T-1", project: "OPS", title: "Fire extinguisher inspection", status: "open" }];
  const payments = [];

  async function run(name, input, ctx) {
    const done = async (event, result) => (await ctx.report({ tool: safeId(name) ?? "unknown", ...event }), result);
    switch (name) {
      case "list_documents":
        return done({ action: "list", outcome: "success" }, DOCUMENTS.map(({ id, title, classification }) => ({ id, title, classification })));
      case "read_document": {
        const doc = DOCUMENTS.find((d) => d.id === input.id);
        const resource = safeId(input.id);
        if (!doc) return done({ action: "read", outcome: "failure", resource, error: "not_found" }, { error: "No document with that id." });
        const permission = doc.classification === "restricted" ? RESTRICTED : undefined;
        // Enforced: Tend's policy decides, not the permissions this process was handed. The text is read only inside the gate.
        if (permission && ctx.guard) {
          const g = await ctx.guard({ tool: safeId(name) ?? "unknown", action: "read", resource }, async () => ({ id: doc.id, title: doc.title, body: doc.body }));
          return g.executed && g.outcome === "success" ? g.result : { error: `Not authorized (${g.outcome}). The document was not read.` };
        }
        if (permission && !permissions.includes(permission))
          return done({ action: "read", outcome: "denied", resource, permission, policy: "restricted_document" }, { error: "Access denied: this document is restricted and you lack docs.restricted.read." });
        if (doc.broken) return done({ action: "read", outcome: "failure", resource, error: "storage_unavailable" }, { error: "Document storage is unavailable (simulated fault)." });
        return done({ action: "read", outcome: "success", resource, ...(permission && { permission }) }, { id: doc.id, title: doc.title, body: doc.body });
      }
      case "list_tasks":
        return done({ action: "list", outcome: "success" }, tasks.filter((t) => !input.project || t.project === input.project));
      case "create_task": {
        const project = String(input.project ?? "").toUpperCase();
        if (project === BROKEN_PROJECT) return done({ action: "create", outcome: "failure", resource: safeId(project), error: "task_service_unavailable" }, { error: `Task service for ${project} is unavailable (simulated fault).` });
        if (!project || !input.title) return done({ action: "create", outcome: "failure", error: "invalid_input" }, { error: "project and title are required." });
        const task = { id: `T-${tasks.length + 1}`, project, title: String(input.title).slice(0, 140), status: "open" };
        tasks.push(task);
        return done({ action: "create", outcome: "success", resource: task.id }, task);
      }
      case "send_payment": {
        const amount = Number(input.amount_eur);
        const resource = safeId(input.invoice);
        if (!(amount > 0 && amount <= PAYMENT_LIMIT_EUR))
          return done({ action: "create", outcome: "failure", resource, error: "invalid_amount" }, { error: `Amount must be between 0 and ${PAYMENT_LIMIT_EUR} EUR.` });
        // Built from the same values the payment will use, so what is authorized is what is done.
        const detail = `EUR ${amount.toFixed(2)} to ${String(input.payee).slice(0, 60).replace(/[\u0000-\u001f\u007f]/g, " ")}`;
        if (ctx.guard) {
          // The id that is authorized must be exactly the invoice that is paid, not a cleaned-up version of it.
          if (resource !== String(input.invoice)) return done({ action: "execute", outcome: "failure", error: "invalid_invoice" }, { error: "Invoice ids may only contain letters, digits and _ . : -" });
          const g = await ctx.guard({ tool: safeId(name) ?? "unknown", action: "execute", resource, detail }, async ({ authorizationId }) => {
            payments.push({ invoice: input.invoice, payee: input.payee, amount, authorizationId });
            return { status: "paid (simulated)", invoice: input.invoice };
          });
          return g.executed && g.outcome === "success" ? g.result : { error: g.executed ? "The payment failed. Nothing was paid." : `Payment not authorized (${g.outcome}). Nothing was paid.` };
        }
        // Held: nothing is paid until a human approves this exact request.
        const decision = await ctx.requestApproval({ tool: name, action: "create", outcome: "pending_approval", approval: "required", resource, detail });
        if (decision.status !== "approved") {
          await ctx.report({ tool: name, action: "execute", outcome: "cancelled", resource, approvalId: decision.approvalId, error: `not_approved_${decision.status}` });
          return { error: `Payment not approved (${decision.status}). Nothing was paid.` };
        }
        payments.push({ invoice: input.invoice, payee: input.payee, amount, approvalId: decision.approvalId });
        return done({ action: "execute", outcome: "success", resource, detail, approval: "required", approvalId: decision.approvalId }, { status: "paid (simulated)", invoice: input.invoice });
      }
      default:
        return done({ action: "call", outcome: "failure", error: "unknown_tool" }, { error: "Unknown tool." });
    }
  }

  return { run, tasks, payments };
}
