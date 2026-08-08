import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReleaseLifecycleTimeline } from "./release-lifecycle-timeline";

const countStepsSection = (markup: string, pattern: RegExp) => {
  const stepsSection = markup.split("</ol>")[0] ?? "";
  return (stepsSection.match(pattern) ?? []).length;
};

describe("ReleaseLifecycleTimeline", () => {
  it("renders distinct banner copy for rejected vs failed", () => {
    const rejectedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="REJECTED" />);
    const failedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="FAILED" />);

    expect(rejectedMarkup).toContain("Lifecycle ended at founder approval: Rejected");
    expect(failedMarkup).toContain("Lifecycle ended: Failed");
    expect(rejectedMarkup).not.toContain("Lifecycle ended: Failed");
    expect(failedMarkup).not.toContain("Lifecycle ended at founder approval");
  });

  it("renders a distinct halted-step icon for rejected (ShieldX) vs failed (AlertOctagon)", () => {
    const rejectedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="REJECTED" />);
    const failedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="FAILED" />);

    expect(countStepsSection(rejectedMarkup, /lucide-shield-x/g)).toBe(1);
    expect(countStepsSection(rejectedMarkup, /lucide-octagon-alert/g)).toBe(0);
    expect(countStepsSection(failedMarkup, /lucide-octagon-alert/g)).toBe(1);
    expect(countStepsSection(failedMarkup, /lucide-shield-x/g)).toBe(0);
  });

  it("anchors rejected at the approval step, matching APPROVAL_PENDING's completed-step count", () => {
    const rejectedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="REJECTED" />);
    const approvalPendingMarkup = renderToStaticMarkup(
      <ReleaseLifecycleTimeline current="APPROVAL_PENDING" />,
    );

    // Rejected never progressed past the approval gate (no prepared/submitted
    // transaction ever existed for it), so the number of steps rendered as
    // fully complete (checkmark) must match being at APPROVAL_PENDING itself.
    expect(countStepsSection(rejectedMarkup, /lucide-check/g)).toBe(
      countStepsSection(approvalPendingMarkup, /lucide-check/g),
    );
  });

  it("anchors a pre-submission failure at the prepared step", () => {
    const failedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="FAILED" />);
    const preparedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="PREPARED" />);

    expect(countStepsSection(failedMarkup, /lucide-check/g)).toBe(
      countStepsSection(preparedMarkup, /lucide-check/g),
    );
  });

  it("anchors a submitted failure at the submitted step", () => {
    const failedMarkup = renderToStaticMarkup(
      <ReleaseLifecycleTimeline current="FAILED" failedAt="SUBMITTED" />,
    );
    const submittedMarkup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="SUBMITTED" />);
    const preSubmissionFailureMarkup = renderToStaticMarkup(
      <ReleaseLifecycleTimeline current="FAILED" />,
    );

    expect(countStepsSection(failedMarkup, /lucide-check/g)).toBe(
      countStepsSection(submittedMarkup, /lucide-check/g),
    );
    expect(countStepsSection(failedMarkup, /lucide-check/g)).toBeGreaterThan(
      countStepsSection(preSubmissionFailureMarkup, /lucide-check/g),
    );
  });

  it("does not mark a rejected release's submitted or confirmed steps as reached", () => {
    const markup = renderToStaticMarkup(<ReleaseLifecycleTimeline current="REJECTED" />);

    // Only the halted step (approval) and steps before it may be styled as
    // reached; later steps (Prepared/Submitted/Confirmed/Reconciled) must
    // stay in their plain "upcoming" numeral styling.
    expect(countStepsSection(markup, /lucide-check/g)).toBe(1);
    expect(countStepsSection(markup, /lucide-shield-x/g)).toBe(1);
  });
});
