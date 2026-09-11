import { describe, expect, it } from "vitest";

import {
  MAX_AVATAR_URL_LENGTH,
  MAX_USER_NAME_LENGTH,
  MAX_WORKSPACE_NAME_LENGTH,
} from "@/features/settings/constants";
import {
  avatarUrlFieldSchema,
  memberRoleSchema,
  profileFormSchema,
  updateMemberRoleSchema,
  updateProfileSchema,
  updateWorkspaceNameSchema,
  workspaceGeneralFormSchema,
} from "@/features/settings/schemas";
import { MEMBER_ROLES } from "@/features/workspaces/roles";

describe("updateWorkspaceNameSchema", () => {
  it("trims the name", () => {
    expect(updateWorkspaceNameSchema.parse({ name: "  Acme  " })).toEqual({ name: "Acme" });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(updateWorkspaceNameSchema.safeParse({ name: "" }).success).toBe(false);
    expect(updateWorkspaceNameSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name past the length cap", () => {
    expect(updateWorkspaceNameSchema.safeParse({ name: "a".repeat(MAX_WORKSPACE_NAME_LENGTH) }).success).toBe(true);
    expect(updateWorkspaceNameSchema.safeParse({ name: "a".repeat(MAX_WORKSPACE_NAME_LENGTH + 1) }).success).toBe(false);
  });

  it("is the schema the General form uses, so client and server cannot drift", () => {
    expect(workspaceGeneralFormSchema).toBe(updateWorkspaceNameSchema);
  });
});

describe("updateMemberRoleSchema", () => {
  it("accepts every known role", () => {
    for (const role of MEMBER_ROLES) {
      expect(updateMemberRoleSchema.parse({ role })).toEqual({ role });
    }
  });

  it("rejects a role that is not in the enum", () => {
    expect(updateMemberRoleSchema.safeParse({ role: "superuser" }).success).toBe(false);
    expect(updateMemberRoleSchema.safeParse({ role: "OWNER" }).success).toBe(false);
    expect(memberRoleSchema.safeParse("").success).toBe(false);
  });

  it("requires the role to be present", () => {
    expect(updateMemberRoleSchema.safeParse({}).success).toBe(false);
  });
});

describe("avatarUrlFieldSchema", () => {
  it('accepts "" as "no avatar", which is what an untouched optional input sends', () => {
    expect(avatarUrlFieldSchema.parse("")).toBe("");
  });

  it("accepts http and https links and trims them", () => {
    expect(avatarUrlFieldSchema.parse("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(avatarUrlFieldSchema.parse("  http://example.com/a.png  ")).toBe("http://example.com/a.png");
  });

  it("rejects a javascript: URL", () => {
    // Parsed with the same parser the browser uses, so the scheme check cannot
    // be walked around with casing or whitespace.
    expect(avatarUrlFieldSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(avatarUrlFieldSchema.safeParse("JavaScript:alert(1)").success).toBe(false);
    expect(avatarUrlFieldSchema.safeParse("  javascript:alert(document.cookie)  ").success).toBe(false);
  });

  it("rejects other non-HTTP schemes", () => {
    expect(avatarUrlFieldSchema.safeParse("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=").success).toBe(false);
    expect(avatarUrlFieldSchema.safeParse("file:///etc/passwd").success).toBe(false);
  });

  it("rejects something that is not a URL at all", () => {
    expect(avatarUrlFieldSchema.safeParse("example.com/a.png").success).toBe(false);
    expect(avatarUrlFieldSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects a link past the length cap", () => {
    const long = `https://example.com/${"a".repeat(MAX_AVATAR_URL_LENGTH)}`;
    expect(avatarUrlFieldSchema.safeParse(long).success).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("collapses an empty string and null to null", () => {
    expect(updateProfileSchema.parse({ name: "Ada", avatarUrl: "" })).toEqual({ name: "Ada", avatarUrl: null });
    expect(updateProfileSchema.parse({ name: "Ada", avatarUrl: null })).toEqual({ name: "Ada", avatarUrl: null });
  });

  it("keeps a valid link", () => {
    expect(updateProfileSchema.parse({ name: " Ada ", avatarUrl: " https://cdn.example.com/ada.png " })).toEqual({
      name: "Ada",
      avatarUrl: "https://cdn.example.com/ada.png",
    });
  });

  it("rejects a javascript: avatar on the wire, not only in the form", () => {
    expect(updateProfileSchema.safeParse({ name: "Ada", avatarUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("requires a name and caps its length", () => {
    expect(updateProfileSchema.safeParse({ name: "  ", avatarUrl: "" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "a".repeat(MAX_USER_NAME_LENGTH), avatarUrl: "" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: "a".repeat(MAX_USER_NAME_LENGTH + 1), avatarUrl: "" }).success).toBe(
      false,
    );
  });

  it("does not accept an email: it is the login identity, changed through auth", () => {
    const parsed = updateProfileSchema.parse({ name: "Ada", avatarUrl: "", email: "new@example.com" });
    expect("email" in parsed).toBe(false);
  });
});

describe("profileFormSchema", () => {
  it("keeps the avatar as the string the input holds", () => {
    expect(profileFormSchema.parse({ name: "Ada", avatarUrl: "" })).toEqual({ name: "Ada", avatarUrl: "" });
    expect(profileFormSchema.parse({ name: "Ada", avatarUrl: "https://example.com/a.png" })).toEqual({
      name: "Ada",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("rejects what the wire schema rejects", () => {
    expect(profileFormSchema.safeParse({ name: "Ada", avatarUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(profileFormSchema.safeParse({ name: "", avatarUrl: "" }).success).toBe(false);
  });
});
