import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LifecycleStateBadge } from "./lifecycle-state-badge";

describe("LifecycleStateBadge", () => {
  it("renders distinct markup for rejected vs failed", () => {
    const rejectedMarkup = renderToStaticMarkup(<LifecycleStateBadge state="REJECTED" />);
    const failedMarkup = renderToStaticMarkup(<LifecycleStateBadge state="FAILED" />);

    expect(rejectedMarkup).not.toBe(failedMarkup);
    expect(rejectedMarkup).toContain("Release status: Rejected");
    expect(failedMarkup).toContain("Release status: Failed");
  });
});
