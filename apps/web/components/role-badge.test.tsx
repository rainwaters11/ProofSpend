import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoleBadge } from "./role-badge";
import type { UserRole } from "./role-badge";

describe("RoleBadge", () => {
  it.each<[UserRole, string]>([
    ["founder", "Founder"],
    ["backer", "Backer"],
    ["evaluator", "Evaluator"],
  ])("renders the %s role with label %s", (role, label) => {
    const markup = renderToStaticMarkup(<RoleBadge role={role} />);

    expect(markup).toContain(label);
    expect(markup).toContain(`Current role: ${label}`);
  });
});
