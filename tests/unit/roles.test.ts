import { describe, expect, it } from "vitest";

import { canEdit, canManage, hasMinimumRole } from "@/features/workspaces/roles";

describe("roles", () => {
  it("orders roles owner > admin > member > viewer", () => {
    expect(hasMinimumRole("owner", "admin")).toBe(true);
    expect(hasMinimumRole("admin", "owner")).toBe(false);
    expect(hasMinimumRole("member", "member")).toBe(true);
    expect(hasMinimumRole("viewer", "member")).toBe(false);
  });

  it("derives capability helpers", () => {
    expect(canEdit("viewer")).toBe(false);
    expect(canEdit("member")).toBe(true);
    expect(canManage("member")).toBe(false);
    expect(canManage("admin")).toBe(true);
  });
});
