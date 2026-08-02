import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoleBadge } from "./role-badge";
import type { UserRole } from "./role-badge";

describe("RoleBadge", () => {
  it.each<[UserRole, string]>([
    ["founder", "Founder"],
    ["backer", "Backer"],
    ["evaluator", "Evaluator"],
  ])("renders the %s role with label %s", (role, label) => {
    render(<RoleBadge role={role} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByLabelText(`Current role: ${label}`)).toBeInTheDocument();
  });
});
