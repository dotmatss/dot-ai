"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";

import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardFooter, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppInput } from "@/components/ui/app-input";
import { AppLabel } from "@/components/ui/app-label";
import { AppText } from "@/components/ui/app-typography";
import { MAX_CUSTOM_PROPERTIES, MAX_PROPERTY_KEY_LENGTH, MAX_PROPERTY_VALUE_LENGTH } from "@/features/crm/constants";
import { isValidPropertyKey } from "@/features/crm/normalize";
import { useUpdateContactMutation } from "@/features/crm/mutations";
import type { Contact, ContactProperties } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

interface PropertyRow {
  key: string;
  value: string;
}

function toRows(properties: ContactProperties): PropertyRow[] {
  return Object.entries(properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
}

function toObject(rows: PropertyRow[]): ContactProperties {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function sameProperties(rows: PropertyRow[], properties: ContactProperties): boolean {
  const keys = Object.keys(properties);
  if (rows.length !== keys.length) return false;
  return rows.every((row) => properties[row.key] === row.value);
}

/**
 * Editor over the `properties` jsonb column. The whole map is sent on save
 * (PATCH replaces it), so add, rename-by-remove and edit all go through one
 * explicit save rather than a request per keystroke.
 */
export function ContactPropertiesEditor({ contact }: { contact: Contact }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateContactMutation(contact.id);
  const baseId = useId();

  // `null` means "follow the server copy". A sibling mutation (stage, tags)
  // refreshes the contact, and mirroring that into state would wipe whatever
  // is being typed here; holding only the edit keeps both behaviours correct.
  const [draft, setDraft] = useState<PropertyRow[] | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const serverRows = useMemo(() => toRows(contact.properties), [contact.properties]);
  const rows = draft ?? serverRows;
  const dirty = draft !== null;

  function commit(next: PropertyRow[]) {
    setDraft(sameProperties(next, contact.properties) ? null : next);
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const key = draftKey.trim();
    if (!isValidPropertyKey(key)) {
      setError(`Use letters, numbers, spaces, hyphens and underscores, up to ${MAX_PROPERTY_KEY_LENGTH} characters`);
      return;
    }
    if (rows.some((row) => row.key.toLowerCase() === key.toLowerCase())) {
      setError(`“${key}” already exists`);
      return;
    }
    if (rows.length >= MAX_CUSTOM_PROPERTIES) {
      setError(`Up to ${MAX_CUSTOM_PROPERTIES} custom properties`);
      return;
    }
    setError(null);
    setDraftKey("");
    setDraftValue("");
    commit([...rows, { key, value: draftValue.trim() }]);
  }

  const atCapacity = rows.length >= MAX_CUSTOM_PROPERTIES;

  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Custom properties</AppCardTitle>
          <AppCardDescription>
            Your own fields for this contact, available to workflows and agents. Up to {MAX_CUSTOM_PROPERTIES}.
          </AppCardDescription>
        </div>
      </AppCardHeader>

      <AppCardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <AppText size="sm" tone="muted">
            No custom properties yet.
          </AppText>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const inputId = `${baseId}-${index}`;
              return (
                <li key={row.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                  <AppLabel htmlFor={inputId} className="truncate">
                    {row.key}
                  </AppLabel>
                  <AppInput
                    id={inputId}
                    size="sm"
                    value={row.value}
                    readOnly={!editable}
                    maxLength={MAX_PROPERTY_VALUE_LENGTH}
                    onChange={(event) =>
                      commit(rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                    }
                  />
                  {editable ? (
                    <AppButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove property ${row.key}`}
                      disabled={update.isPending}
                      onClick={() => commit(rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 aria-hidden />
                    </AppButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {editable ? (
          <form onSubmit={onAdd} className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
            <AppInput
              size="sm"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="Property name"
              aria-label="New property name"
              maxLength={MAX_PROPERTY_KEY_LENGTH}
              disabled={atCapacity || update.isPending}
              className="sm:max-w-56"
            />
            <AppInput
              size="sm"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              placeholder="Value"
              aria-label="New property value"
              maxLength={MAX_PROPERTY_VALUE_LENGTH}
              disabled={atCapacity || update.isPending}
            />
            <AppButton
              type="submit"
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              disabled={atCapacity || update.isPending || draftKey.trim().length === 0}
            >
              Add
            </AppButton>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </AppCardContent>

      {dirty ? (
        <AppCardFooter className="justify-end">
          <AppButton
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Discard
          </AppButton>
          <AppButton
            size="sm"
            loading={update.isPending}
            onClick={() => update.mutate({ properties: toObject(rows) }, { onSuccess: () => setDraft(null) })}
          >
            Save properties
          </AppButton>
        </AppCardFooter>
      ) : null}
    </AppCard>
  );
}
