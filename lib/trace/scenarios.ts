import type { Scenario } from "./types.ts";
import type { ScenarioBuilder } from "./simulate.ts";

const PROMPT_DATE = "2026-09-01T09:00:00Z";

const refundPrompts = [
  {
    id: "v1", label: "v1 · baseline", createdAt: PROMPT_DATE,
    text: "You are a payments support agent.\nConfirm the duplicate charge with payments.getTransactions.\nRefund the duplicate capture with payments.refund.\nTell the customer when the money returns.",
  },
  {
    id: "v2", label: "v2 · policy lookup", createdAt: "2026-09-20T09:00:00Z",
    text: "You are a payments support agent.\nConfirm the duplicate charge with payments.getTransactions.\nLook up the refund policy with policy.search before refunding.\nRefund the duplicate capture with payments.refund.\nTell the customer when the money returns.",
  },
  {
    id: "v3", label: "v3 · approval limits", createdAt: "2026-10-10T09:00:00Z",
    text: "You are a payments support agent.\nConfirm the duplicate charge with payments.getTransactions.\nLook up the refund policy with policy.search before refunding.\nIf the amount is above the automatic limit, call support.escalate instead of refunding.\nOtherwise refund the duplicate capture with payments.refund.\nOnly quote facts returned by tools.\nTell the customer when the money returns.",
  },
];

const takeoverPrompts = [
  {
    id: "v1", label: "v1 · baseline", createdAt: PROMPT_DATE,
    text: "You are a trust & safety agent.\nInspect sessions and the risk score.\nTell the customer what happened.\nRevoke suspicious sessions and force a password reset.",
  },
  {
    id: "v2", label: "v2 · contain first", createdAt: "2026-10-02T09:00:00Z",
    text: "You are a trust & safety agent.\nInspect sessions and the risk score in parallel.\nContain first: revoke suspicious sessions and force a password reset.\nOnly then notify the customer.\nOnly quote facts returned by tools.",
  },
];

const addressPrompts = [
  {
    id: "v1", label: "v1 · baseline", createdAt: PROMPT_DATE,
    text: "You are an order support agent.\nFetch the order with orders.get.\nUpdate the address with orders.update.\nConfirm the change to the customer.",
  },
  {
    id: "v2", label: "v2 · validate", createdAt: "2026-09-28T09:00:00Z",
    text: "You are an order support agent.\nFetch the order with orders.get.\nValidate the new address with address.validate.\nOnly update unshipped orders with orders.update.\nOnly quote facts returned by tools.\nConfirm the change to the customer.",
  },
];

export const SCENARIOS: Scenario[] = [
  {
    id: "refund",
    task: "Refund a duplicate payment",
    description: "Customer was charged twice for one order and asks for a refund.",
    expectedTools: ["payments.getTransactions", "policy.search", "payments.refund", "support.escalate"],
    orderedTools: [["payments.getTransactions", "payments.refund"], ["policy.search", "payments.refund"], ["policy.search", "support.escalate"]],
    prompts: refundPrompts,
  },
  {
    id: "takeover",
    task: "Triage an account takeover",
    description: "Customer reports logins they do not recognise.",
    expectedTools: ["auth.getSessions", "risk.score", "auth.revokeSessions", "auth.forcePasswordReset", "notify.customer"],
    orderedTools: [["risk.score", "auth.revokeSessions"], ["auth.revokeSessions", "notify.customer"], ["auth.forcePasswordReset", "notify.customer"]],
    prompts: takeoverPrompts,
  },
  {
    id: "address",
    task: "Update delivery address",
    description: "Customer moved and wants a pending order sent to the new address.",
    expectedTools: ["orders.get", "address.validate", "orders.update"],
    orderedTools: [["orders.get", "orders.update"], ["address.validate", "orders.update"]],
    prompts: addressPrompts,
  },
];

const refund: ScenarioBuilder = ({ prompt, model, chance, seq, claim }) => {
  const over = chance(0.3);
  const amount = over ? "€186.40" : "€86.40";
  seq({
    type: "model", title: "Interpret customer request", ms: 620, tokensIn: 1180, tokensOut: 160,
    input: "Customer: I was charged twice for order ORD-44182, please refund one of them.",
    output: "Intent: refund_duplicate_charge\nOrder: ORD-44182\nPlan: confirm duplicate → check policy → refund",
  });
  if (model === "gpt-5-mini" && chance(0.45)) {
    seq({
      type: "tool", name: "orders.get", title: "Fetch order", ms: 150, status: "error",
      input: { orderId: "ORD-44182" }, output: { error: "Order record has no payment captures" },
      note: "Wrong tool: order records do not contain payment captures. The agent retried with payments.getTransactions.",
    });
  }
  seq({
    type: "tool", name: "payments.getTransactions", title: "Fetch payment history", ms: 184,
    input: { orderId: "ORD-44182" },
    output: { orderId: "ORD-44182", transactions: [{ id: "TX-1", amount }, { id: "TX-2", amount }], captureWindowSec: 4 },
  });
  seq({
    type: "decision", title: "Duplicate confirmed", ms: 34,
    input: "Compare captures TX-1 and TX-2", output: `Both captures share order, amount (${amount}) and a 4s capture window. Confidence 0.97.`,
  });
  if (prompt !== "v1") {
    seq({
      type: "retrieval", name: "policy.search", title: "Check refund policy", ms: 241,
      input: { query: "automatic refund limit duplicate charge" },
      output: "Automatic refunds are allowed up to €100. Larger refunds need manager approval via support.escalate.",
    });
  }
  seq({
    type: "model", title: "Prepare resolution", ms: 488, tokensIn: 1420, tokensOut: 240,
    input: "Decide the resolution using the transactions and policy.",
    output: over && prompt === "v3" ? "Amount exceeds the automatic limit. Escalate for approval." : "Refund TX-2 and tell the customer when funds return.",
  });
  if (over && prompt === "v3") {
    seq({
      type: "tool", name: "support.escalate", title: "Escalate for approval", ms: 210,
      input: { orderId: "ORD-44182", transaction: "TX-2", reason: "refund above automatic limit" },
      output: { ticket: "ESC-2231", queue: "payments-approvals", sla: "4 hours" },
    });
    claim("ESC-2231", "4 hours", amount);
  } else {
    seq({
      type: "tool", name: "payments.refund", title: "Issue refund", ms: 197,
      status: over ? "warning" : "ok",
      note: over ? "Refund above the €100 automatic limit was issued without manager approval." : undefined,
      input: { transaction: "TX-2", amount },
      output: { refundId: "RF-10892", status: "accepted", eta: "3-5 days" },
    });
    claim("RF-10892", amount, model === "gpt-5-mini" && chance(0.5) ? "1-2 days" : "3-5 days");
  }
  seq({
    type: "model", title: "Write customer reply", ms: 520, tokensIn: 980, tokensOut: 210,
    input: "Draft a short reply that explains the outcome.",
    output: "Reply drafted with the reference number and expected timing.",
  });
};

const takeover: ScenarioBuilder = ({ prompt, model, chance, seq, par, claim }) => {
  seq({
    type: "model", title: "Interpret report", ms: 540, tokensIn: 1020, tokensOut: 150,
    input: "Customer: There are logins on my account from places I've never been.",
    output: "Intent: suspected_account_takeover\nPlan: inspect sessions + risk → contain → notify",
  });
  par([
    {
      type: "tool", name: "auth.getSessions", title: "List active sessions", ms: 260,
      input: { userId: "U-5521" },
      output: { sessions: [{ ip: "84.24.10.2", city: "Utrecht" }, { ip: "185.220.101.7", city: "Bucharest" }, { ip: "185.220.101.9", city: "Bucharest" }] },
    },
    {
      type: "tool", name: "risk.score", title: "Score login risk", ms: 340,
      input: { userId: "U-5521", window: "24h" }, output: { score: 0.91, signals: ["tor_exit_node", "impossible_travel"] },
    },
  ]);
  seq({
    type: "decision", title: "Takeover likely", ms: 40,
    input: "Evaluate sessions and risk score", output: "Two sessions from a Tor exit node with impossible travel. Risk 0.91 > 0.8 threshold.",
  });
  const contain = () => {
    seq({
      type: "tool", name: "auth.revokeSessions", title: "Revoke suspicious sessions", ms: 180,
      input: { sessions: ["185.220.101.7", "185.220.101.9"] }, output: { revoked: 2 },
    });
    seq({
      type: "tool", name: "auth.forcePasswordReset", title: "Force password reset", ms: 150,
      input: { userId: "U-5521" }, output: { resetEmailSent: true },
    });
  };
  const notify = (warn: boolean) => seq({
    type: "tool", name: "notify.customer", title: "Notify customer", ms: 120,
    status: warn ? "warning" : "ok",
    note: warn ? "Customer was notified while the attacker's sessions were still active." : undefined,
    input: { channel: "email" }, output: { delivered: true },
  });
  seq({
    type: "model", title: "Draft security notice", ms: 610, tokensIn: 1350, tokensOut: 280,
    input: "Explain what happened and the actions taken.", output: "Notice drafted.",
  });
  if (prompt === "v1") {
    notify(true);
    contain();
  } else {
    contain();
    notify(false);
  }
  claim("Bucharest", "185.220.101.7", model === "gpt-5-mini" && chance(0.4) ? "your card was not used" : "0.91");
};

const address: ScenarioBuilder = ({ prompt, model, chance, seq, claim }) => {
  seq({
    type: "model", title: "Interpret request", ms: 450, tokensIn: 860, tokensOut: 120,
    input: "Customer: Please send order ORD-51007 to Keizersgracht 221, Amsterdam instead.",
    output: "Intent: change_shipping_address\nOrder: ORD-51007",
  });
  seq({
    type: "tool", name: "orders.get", title: "Fetch order", ms: 160,
    input: { orderId: "ORD-51007" }, output: { orderId: "ORD-51007", status: "processing", carrier: "PostNL" },
  });
  if (prompt !== "v1") {
    seq({
      type: "tool", name: "address.validate", title: "Validate new address", ms: 230,
      input: { address: "Keizersgracht 221, Amsterdam" },
      output: { valid: true, normalized: "Keizersgracht 221, 1016 DV Amsterdam" },
    });
  }
  seq({
    type: "decision", title: "Safe to update", ms: 28,
    input: "Order status", output: "Order is still processing, so the address can change without a carrier intercept.",
  });
  seq({
    type: "tool", name: "orders.update", title: "Update shipping address", ms: 210,
    status: prompt === "v1" ? "warning" : "ok",
    note: prompt === "v1" ? "Address was written without validation; postcode is missing." : undefined,
    input: { orderId: "ORD-51007", address: prompt === "v1" ? "Keizersgracht 221, Amsterdam" : "Keizersgracht 221, 1016 DV Amsterdam" },
    output: { updated: true, estimatedDelivery: "Thursday" },
  });
  seq({
    type: "model", title: "Confirm to customer", ms: 380, tokensIn: 720, tokensOut: 140,
    input: "Confirm the change.", output: "Confirmation drafted.",
  });
  claim("Keizersgracht 221", model === "gpt-5-mini" && chance(0.35) ? "Wednesday" : "Thursday");
};

export const BUILDERS: Record<string, ScenarioBuilder> = { refund, takeover, address };

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
