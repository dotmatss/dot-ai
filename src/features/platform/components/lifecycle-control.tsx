"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { apiFetch } from "@/lib/api/http";

export function LifecycleControl({ kind, id, label, current }: {
  kind: "organizations" | "users"; id: string; label: string; current: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(current);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      await apiFetch("/api/admin/" + kind + "/" + id, {
        method: "PATCH", json: kind === "users" ? { disabled: next === "disabled", reason } : { status: next, reason },
      });
      setOpen(false); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update access"); }
    finally { setBusy(false); }
  }
  return <>
    <AppButton variant="secondary" size="sm" onClick={() => { setNext(current); setReason(""); setConfirmation(""); setError(""); setOpen(true); }}>Change access</AppButton>
    <AppDialog open={open} onClose={() => { if (!busy) setOpen(false); }} dismissible={!busy} title={"Change access for " + label}
      description={kind === "users" ? "Disabling prevents sign-in and ends existing sessions. Workspace API keys remain organization credentials. Restoring requires a new sign-in. No customer data is deleted." : "Suspending or disabling blocks workspace access and new public chat, API, agent, workflow, knowledge and MCP execution. Work already underway may finish. No data is deleted and billing is unchanged."}
      footer={<><AppButton variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</AppButton><AppButton variant={next === "active" ? "primary" : "danger"} loading={busy} disabled={busy || next === current || confirmation !== label || (next !== "active" && reason.trim().length < 3)} onClick={save}>Confirm change</AppButton></>}>
      <div className="space-y-4">
        <label className="block text-sm">New status<AppSelect value={next} onChange={e => setNext(e.target.value)} options={(kind === "users" ? ["active", "disabled"] : ["active", "suspended", "disabled"]).map(value => ({ value, label: value }))} /></label>
        <label className="block text-sm">Reason {next !== "active" && "(required)"}<AppInput value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>
        <label className="block text-sm">Type {label} to confirm<AppInput value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </AppDialog>
  </>;
}
