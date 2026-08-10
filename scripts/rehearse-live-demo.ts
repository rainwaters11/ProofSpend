import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const baseUrl = required("PROOFSPEND_DEMO_BASE_URL").replace(/\/$/, "");
const apiToken = required("PROOFSPEND_AGENT_API_TOKEN");
const authorization = `Bearer ${apiToken}`;
const invocationKey = `demo:${randomUUID()}`;
const startedAt = Date.now();

type JsonRecord = Record<string, unknown>;

async function post(path: string, body?: JsonRecord, extraHeaders?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as JsonRecord;
  return { response, payload };
}

const runResponse = await post(
  "/api/verification-agent/run",
  undefined,
  { "Idempotency-Key": invocationKey },
);
assertStatus(runResponse, 200, "OpenAI verification run");
const runId = stringField(runResponse.payload, "runId");
if (runResponse.payload.status !== "CORRECTION_REQUIRED") fail("Agent did not pause for correction.");
const question = stringField(runResponse.payload, "missingReceiptQuestion");
if (!/receipt/i.test(question)) fail("Agent question is not the missing-receipt recovery question.");
console.log(`Recovery question: ${question}`);

const correctionResponse = await post("/api/verification-agent/correction", {
  runId,
  confirmSeededCorrection: true,
});
assertStatus(correctionResponse, 200, "founder correction");
if (correctionResponse.payload.status !== "APPROVAL_REQUIRED") {
  fail("Deterministic re-evaluation did not stop at APPROVAL_REQUIRED.");
}
const proposal = objectField(correctionResponse.payload, "proposal");
const amount = objectField(proposal, "amount");
if (
  amount.asset !== "USDC" ||
  amount.atomicUnits !== "1000000" ||
  proposal.chain !== "ARC_TESTNET" ||
  proposal.state !== "APPROVAL_REQUIRED"
) {
  fail("Proposal is not the exact 1 USDC Arc Testnet approval intent.");
}

console.log("\nExact action awaiting human approval:");
console.log("  Amount: 1.00 USDC (1000000 atomic units)");
console.log(`  Destination: ${stringField(proposal, "destination")}`);
console.log("  Network: ARC TESTNET");
const prompt = createInterface({ input: stdin, output: stdout });
const answer = await prompt.question("Type APPROVE 1 USDC to submit this exact intent: ");
prompt.close();
if (answer !== "APPROVE 1 USDC") fail("Human approval was not recorded; nothing was submitted.");

const decidedAt = new Date().toISOString();
const approval = {
  approvalId: `approval:${randomUUID()}`,
  intentId: stringField(proposal, "intentId"),
  authorizedActorRole: "FOUNDER",
  authorizedActorId: "founder:fictional",
  decision: "APPROVED",
  decidedAt,
  expiresAt: stringField(proposal, "expiresAt"),
  idempotencyKey: stringField(proposal, "idempotencyKey"),
};
const handoffResponse = await post("/api/verification-agent/handoff", { runId, approval });
assertStatus(handoffResponse, 200, "Circle handoff");
if (handoffResponse.payload.status !== "HANDOFF_CONFIRMED") {
  fail(`Circle handoff did not confirm: ${JSON.stringify(handoffResponse.payload)}`);
}
const execution = objectField(handoffResponse.payload, "execution");
const transactionHash = stringField(execution, "transactionHash");
const explorerUrl = stringField(execution, "explorerUrl");
if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) fail("Confirmed result has no real Arc hash.");
if (explorerUrl !== `https://testnet.arcscan.app/tx/${transactionHash}`) {
  fail("Confirmed result has a noncanonical Arcscan link.");
}

const replay = await post("/api/verification-agent/handoff", { runId, approval });
if (replay.response.status !== 409 || replay.payload.error !== "HANDOFF_DUPLICATE") {
  fail("Replay was not rejected before a second transfer.");
}

const activityResponse = await fetch(`${baseUrl}/app/activity`, { cache: "no-store" });
const activityHtml = await activityResponse.text();
if (
  !activityResponse.ok ||
  !activityHtml.includes("Confirmed on Arc Testnet") ||
  !activityHtml.includes("1.00 USDC") ||
  !activityHtml.includes(transactionHash) ||
  !activityHtml.includes(explorerUrl)
) {
  fail("The activity UI does not show the confirmed 1 USDC hash and Arcscan link.");
}

const elapsedSeconds = Math.ceil((Date.now() - startedAt) / 1000);
if (elapsedSeconds > 180) fail(`Rehearsal took ${elapsedSeconds}s, above the three-minute target.`);
console.log(`\nPASS: confirmed ${transactionHash}`);
console.log(`Explorer: ${explorerUrl}`);
console.log(`Replay: rejected with HANDOFF_DUPLICATE`);
console.log(`Rehearsal: ${elapsedSeconds}s`);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function assertStatus(
  result: { response: Response; payload: JsonRecord },
  expected: number,
  label: string,
) {
  if (result.response.status !== expected) {
    fail(`${label} returned ${result.response.status}: ${JSON.stringify(result.payload)}`);
  }
}

function objectField(record: JsonRecord, key: string): JsonRecord {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${key} is missing or invalid.`);
  }
  return value as JsonRecord;
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) fail(`${key} is missing or invalid.`);
  return value as string;
}

function fail(message: string): never {
  throw new Error(message);
}
