"use client";
import { AppButton } from "@/components/ui/app-button";

export default function AdminError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4">
    <h2 className="text-xl font-semibold">Platform data could not be loaded</h2>
    <p>Please retry. If the problem persists, check the database connection and migrations.</p>
    <AppButton onClick={reset}>Try again</AppButton>
  </div>;
}
