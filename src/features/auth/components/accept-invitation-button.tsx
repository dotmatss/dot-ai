"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { acceptInvitationAction } from "@/features/auth/actions";

/**
 * The one control on the invitation page.
 *
 * The action redirects on success, so there is no success state to render here;
 * anything that comes back is a refusal worth showing - an expired invitation,
 * a link issued to a different address, a rate limit.
 */
export function AcceptInvitationButton({ token, organizationName }: { token: string; organizationName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction(token);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <AppAlert tone="danger">{error}</AppAlert> : null}
      <AppButton size="lg" fullWidth loading={pending} onClick={accept} leadingIcon={<Check aria-hidden />}>
        Join {organizationName}
      </AppButton>
    </div>
  );
}
