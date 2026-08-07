import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BackerViewPage from "./page";

describe("BackerViewPage", () => {
  it("labels disclosed mock settlement and synthetic proof data truthfully", async () => {
    const markup = renderToStaticMarkup(
      await BackerViewPage({ params: Promise.resolve({ shareId: "demo" }) }),
    );

    expect(markup).toContain("Disclosed mock settlement");
    expect(markup).not.toContain("Verified spend");
    expect(markup).toContain("Synthetic mock preview — no USDC was transferred");
    expect(markup).not.toContain("Settled to recipient");
    expect(markup).toContain("Synthetic mock hash");
  });
});
