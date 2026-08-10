import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiveHandoffPanel } from "./live-handoff-panel";
import type { HandoffResult } from "@/lib/verification-agent";

function result(
  state: "SUBMITTED" | "CONFIRMED" | "FAILED",
): HandoffResult {
  const confirmed = state === "CONFIRMED";
  return {
    status:
      state === "SUBMITTED"
        ? "HANDOFF_SUBMITTED"
        : confirmed
          ? "HANDOFF_CONFIRMED"
          : "HANDOFF_FAILED",
    adapterMode: "arc-testnet",
    execution: {
      state,
      providerOperationId: "11111111-1111-4111-8111-111111111111",
      transactionHash: confirmed ? `0x${"1a".repeat(32)}` : null,
      confirmation: confirmed ? "ARC_TESTNET_CONFIRMED" : null,
      explorerUrl: confirmed
        ? `https://testnet.arcscan.app/tx/0x${"1a".repeat(32)}`
        : null,
      failureCode: state === "FAILED" ? "AUTHORIZATION_UNAVAILABLE" : null,
      failureMessage:
        state === "FAILED"
          ? "The transfer failed closed."
          : state === "SUBMITTED"
            ? "Circle is still confirming this transaction."
            : null,
    },
    activityTrace: [
      {
        id: `event:${state}`,
        at: "2026-08-09T12:00:00.000Z",
        layer: "ARC TESTNET",
        code:
          state === "SUBMITTED"
            ? "TRANSACTION_SUBMITTED"
            : confirmed
              ? "TRANSACTION_CONFIRMED"
              : "TRANSACTION_FAILED",
        message: `Transfer ${state.toLowerCase()}.`,
      },
    ],
  };
}

describe("LiveHandoffPanel", () => {
  it("shows submitted without claiming confirmation", () => {
    const markup = renderToStaticMarkup(<LiveHandoffPanel result={result("SUBMITTED")} />);
    expect(markup).toContain("Submitted to Circle");
    expect(markup).toContain("Circle is still confirming this transaction.");
    expect(markup).not.toContain("View the real transaction on Arcscan");
  });

  it("shows a real explorer link only for a confirmed hash", () => {
    const markup = renderToStaticMarkup(<LiveHandoffPanel result={result("CONFIRMED")} />);
    expect(markup).toContain("Confirmed on Arc Testnet");
    expect(markup).toContain("https://testnet.arcscan.app/tx/0x");
  });

  it("shows failed closed without a confirmation or explorer link", () => {
    const failed = result("FAILED");
    failed.execution.transactionHash = `0x${"2b".repeat(32)}`;
    failed.execution.explorerUrl =
      `https://testnet.arcscan.app/tx/0x${"2b".repeat(32)}`;
    const markup = renderToStaticMarkup(<LiveHandoffPanel result={failed} />);
    expect(markup).toContain("Failed closed");
    expect(markup).toContain("The transfer failed closed.");
    expect(markup).not.toContain("View the real transaction on Arcscan");
    expect(markup).not.toContain(`0x${"2b".repeat(32)}`);
  });
});
