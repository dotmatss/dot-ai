"use client";

import { PlugZap } from "lucide-react";

import { AppButton } from "@/components/ui/app-button";
import { useProbeMcpServerMutation, useUpdateMcpServerMutation } from "@/features/mcp/mutations";
import { useMcpServerQuery } from "@/features/mcp/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";

/**
 * Test the connection, and switch a server off without deleting it.
 *
 * Disabling is separate from disconnecting on purpose: it stops every tool
 * being offered immediately while keeping the approvals, so a customer can
 * pause a misbehaving server without having to re-approve everything after.
 */
export function McpServerActions({ serverId }: { serverId: string }) {
  const { membership } = useWorkspace();
  const query = useMcpServerQuery(serverId);
  const probe = useProbeMcpServerMutation(serverId);
  const update = useUpdateMcpServerMutation(serverId);

  if (!canManage(membership.role) || !query.data) return null;
  const disabled = query.data.status === "disabled";

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <AppButton
        variant="secondary"
        size="sm"
        onClick={() => probe.mutate()}
        loading={probe.isPending}
        leadingIcon={<PlugZap aria-hidden />}
      >
        Test connection
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        onClick={() => update.mutate({ disabled: !disabled })}
        loading={update.isPending}
      >
        {disabled ? "Enable" : "Disable"}
      </AppButton>
    </div>
  );
}
