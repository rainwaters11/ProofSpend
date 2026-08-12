import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const VIEWPORT = { width: 1280, height: 720 };
const BASE_URL = process.env.PROOFSPEND_DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const OUTPUT_DIR = resolve(
  process.cwd(),
  process.env.PROOFSPEND_DEMO_OUTPUT_DIR ?? "demo-recordings",
);
const ARCSCAN_TRANSACTION_URL = process.env.PROOFSPEND_DEMO_ARCSCAN_URL;
const PAUSE = {
  short: 700,
  state: 1_400,
  scene: 2_200,
};

const clips = [
  ["launchvault.webm", captureLaunchVault],
  ["evidence-gap.webm", captureEvidenceGap],
  ["proof-recovery.webm", captureProofRecovery],
  ["approval-and-settlement.webm", captureApprovalAndSettlement],
  ["backer-view-and-replay.webm", captureBackerViewAndReplay],
];

function validatedArcscanUrl(rawUrl) {
  if (rawUrl === undefined) return null;

  const url = new URL(rawUrl);
  const validHost = url.hostname === "testnet.arcscan.app";
  const validPath = /^\/tx\/0x[a-fA-F0-9]{64}$/.test(url.pathname);
  if (url.protocol !== "https:" || !validHost || !validPath || url.search || url.hash || url.username || url.password) {
    throw new Error(
      "PROOFSPEND_DEMO_ARCSCAN_URL must be an exact https://testnet.arcscan.app/tx/0x… transaction URL.",
    );
  }
  return url.toString();
}

async function pause(page, duration = PAUSE.state) {
  await page.waitForTimeout(duration);
}

async function deliberateMove(page, x, y) {
  await page.mouse.move(x, y, { steps: 24 });
  await pause(page, PAUSE.short);
}

async function deliberateClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Cannot click an element without a visible bounding box.");
  await deliberateMove(page, box.x + box.width / 2, box.y + box.height / 2);
  await locator.click();
  await page.waitForLoadState("networkidle");
  await pause(page);
}

async function show(page, path, heading) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  await pause(page, PAUSE.scene);
}

async function captureLaunchVault(page) {
  await show(
    page,
    "/",
    "Fund the vision. Prove the progress. Unlock what comes next.",
  );
  await deliberateMove(page, 430, 360);
  await deliberateClick(page, page.getByRole("link", { name: /Launch the guided demo/ }));
  await deliberateMove(page, 720, 430);
  await pause(page, PAUSE.scene);
}

async function captureEvidenceGap(page) {
  await show(page, "/app/activity?stage=gap", "Verification Agent Activity");
  await page.getByText("CORRECTION_REQUIRED", { exact: true }).first().waitFor();
  await deliberateMove(page, 720, 420);
  await pause(page, PAUSE.scene);
  await page.getByRole("heading", { name: "Agent Activity Trace" }).scrollIntoViewIfNeeded();
  await pause(page, PAUSE.scene);
}

async function captureProofRecovery(page) {
  await show(page, "/app/activity?stage=gap", "Verification Agent Activity");
  await deliberateClick(page, page.getByRole("link", { name: "Recovered proposal" }));
  await page.getByText("APPROVAL_REQUIRED", { exact: true }).first().waitFor();
  await deliberateMove(page, 700, 390);
  await pause(page, PAUSE.scene);
  await page.getByRole("heading", { name: "Agent Activity Trace" }).scrollIntoViewIfNeeded();
  await deliberateMove(page, 750, 560);
  await pause(page, PAUSE.scene);
}

async function captureApprovalAndSettlement(page) {
  const milestonePath = "/app/milestones/milestone%3Alaunch-ready";
  await show(
    page,
    `${milestonePath}?state=APPROVAL_PENDING`,
    "Launch identity and outreach ready",
  );

  for (const state of ["Approved", "Prepared", "Submitted", "Confirmed", "Reconciled"]) {
    await deliberateClick(page, page.getByRole("link", { name: state, exact: true }));
  }

  await page.getByRole("status").filter({ hasText: "Reconciled" }).scrollIntoViewIfNeeded();
  await deliberateMove(page, 760, 520);
  await pause(page, PAUSE.scene);
}

async function captureBackerViewAndReplay(page, arcscanUrl) {
  await show(page, "/proof/demo", "PawPOVAI InvestFest Soft Launch");
  await deliberateMove(page, 680, 400);
  await pause(page, PAUSE.scene);
  await page.getByRole("heading", { name: "Proof-of-Progress", exact: true }).scrollIntoViewIfNeeded();
  await pause(page, PAUSE.scene);

  await show(page, "/app/activity", "Verification Agent Activity");
  await page.getByText("APPROVAL_REQUIRED", { exact: true }).first().waitFor();
  await pause(page, PAUSE.scene);

  if (arcscanUrl !== null) {
    await page.goto(arcscanUrl, { waitUntil: "domcontentloaded" });
    await pause(page, 4_000);
  }
}

async function assertSafeDemoServer() {
  const response = await fetch(`${BASE_URL}/api/health`);
  if (!response.ok) throw new Error(`Demo health check failed with HTTP ${response.status}.`);
  const health = await response.json();
  if (health.adapterMode !== "mock" || health.agentMode !== "mock") {
    throw new Error("Video capture requires explicit mock adapter and mock agent modes.");
  }
}

async function captureClip(browser, filename, capture, arcscanUrl) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    recordVideo: { dir: OUTPUT_DIR, size: VIEWPORT },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    await capture(page, arcscanUrl);
  } finally {
    await context.close();
  }

  if (video === null) throw new Error(`Playwright did not create ${filename}.`);
  const temporaryPath = await video.path();
  await rename(temporaryPath, resolve(OUTPUT_DIR, filename));
  process.stdout.write(`Recorded ${filename}\n`);
}

const arcscanUrl = validatedArcscanUrl(ARCSCAN_TRANSACTION_URL);
await assertSafeDemoServer();
await mkdir(OUTPUT_DIR, { recursive: true });
for (const [filename] of clips) await rm(resolve(OUTPUT_DIR, filename), { force: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const [filename, capture] of clips) {
    await captureClip(browser, filename, capture, arcscanUrl);
  }
} finally {
  await browser.close();
}

if (arcscanUrl === null) {
  process.stdout.write(
    "Recorded the deterministic mock cut without Arcscan. Set PROOFSPEND_DEMO_ARCSCAN_URL to a separately verified public Arc Testnet transaction URL for the final proof cut.\n",
  );
}
