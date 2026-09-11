"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { Controller, useForm, type Control, type Resolver } from "react-hook-form";
import { z } from "zod";

import { AppFormField, type FieldControlProps } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppInlineCode } from "@/components/ui/app-code-block";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppSwitch } from "@/components/ui/app-switch";
import { AppTextarea } from "@/components/ui/app-textarea";
import { AppCaption, AppText } from "@/components/ui/app-typography";
import type { WorkflowNode } from "@/features/workflows/domain/definition";
import { NODE_CATEGORY_META, NODE_TYPES, type NodeConfigFieldDescriptor } from "@/features/workflows/domain/node-types";
import { cn } from "@/lib/cn";

/**
 * Configuration form for one step. The controls come from the node type's
 * field descriptors and validation comes from the same node type's
 * `configSchema`, so a new node type gets a working form for free.
 *
 * Changes are applied to the builder draft; publishing them is the builder's
 * Save action, which is what bumps the workflow version.
 */

const LABEL_FIELD = "stepLabel";

type ConfigValues = Record<string, unknown>;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToLines(value: unknown): string {
  return Array.isArray(value) ? value.map(asText).join("\n") : asText(value);
}

function headersToText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([name, headerValue]) => `${name}: ${asText(headerValue)}`)
    .join("\n");
}

function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (name.length === 0) continue;
    headers[name] = line.slice(separator + 1).trim();
  }
  return headers;
}

/**
 * Text-backed controls keep their own draft text: deriving the textarea value
 * from the parsed array on every keystroke would swallow newlines as they are
 * typed.
 */
function TextBackedControl({
  initialText,
  rows,
  placeholder,
  aria,
  mono,
  onText,
}: {
  initialText: string;
  rows?: number;
  placeholder?: string;
  aria: FieldControlProps;
  mono?: boolean;
  onText: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  return (
    <AppTextarea
      {...aria}
      rows={rows ?? 3}
      placeholder={placeholder}
      className={cn(mono && "font-mono text-xs")}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onText(event.target.value);
      }}
    />
  );
}

function ConfigControl({
  descriptor,
  control,
  error,
}: {
  descriptor: NodeConfigFieldDescriptor;
  control: Control<ConfigValues>;
  error: string | undefined;
}) {
  return (
    <Controller
      control={control}
      name={descriptor.name}
      render={({ field }) => {
        if (descriptor.control === "switch") {
          return (
            <AppSwitch
              id={`switch-${descriptor.name}`}
              checked={field.value === true}
              onCheckedChange={(checked) => field.onChange(checked)}
              label={descriptor.label}
              description={descriptor.description}
            />
          );
        }
        return (
          <AppFormField label={descriptor.label} description={descriptor.description} error={error}>
            {(aria) => {
              switch (descriptor.control) {
                case "number":
                  return (
                    <AppInput
                      {...aria}
                      type="number"
                      inputMode="decimal"
                      min={descriptor.min}
                      max={descriptor.max}
                      step={descriptor.step}
                      value={asText(field.value)}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value === "" ? "" : Number(event.target.value))}
                    />
                  );
                case "select":
                  return (
                    <AppSelect
                      {...aria}
                      options={descriptor.options ?? []}
                      value={asText(field.value)}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  );
                case "textarea":
                case "template":
                  return (
                    <AppTextarea
                      {...aria}
                      rows={descriptor.rows ?? 3}
                      placeholder={descriptor.placeholder}
                      className={cn(descriptor.control === "template" && "font-mono text-xs")}
                      value={asText(field.value)}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  );
                case "lines":
                  return (
                    <TextBackedControl
                      aria={aria}
                      rows={descriptor.rows}
                      placeholder={descriptor.placeholder}
                      initialText={arrayToLines(field.value)}
                      onText={(text) => field.onChange(linesToArray(text))}
                    />
                  );
                case "headers":
                  return (
                    <TextBackedControl
                      aria={aria}
                      mono
                      rows={descriptor.rows}
                      placeholder="Content-Type: application/json"
                      initialText={headersToText(field.value)}
                      onText={(text) => field.onChange(textToHeaders(text))}
                    />
                  );
                default:
                  return (
                    <AppInput
                      {...aria}
                      value={asText(field.value)}
                      placeholder={descriptor.placeholder}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  );
              }
            }}
          </AppFormField>
        );
      }}
    />
  );
}

export function NodeConfigPanel({
  node,
  editable,
  onApply,
}: {
  node: WorkflowNode;
  editable: boolean;
  onApply: (patch: { label: string; config: Record<string, unknown> }) => void;
}) {
  const nodeType = NODE_TYPES[node.type];
  const Icon = nodeType.icon;
  const [formKey, setFormKey] = useState(0);

  const schema = useMemo(
    () =>
      nodeType.configSchema.extend({
        [LABEL_FIELD]: z.string().trim().min(1, { error: "Enter a step name" }).max(80),
      }),
    [nodeType],
  );

  const defaultValues = useMemo<ConfigValues>(() => {
    const parsed = nodeType.configSchema.safeParse(node.config);
    // An invalid stored config still has to be editable, so fall back to the
    // registry defaults merged with whatever was stored.
    const base = parsed.success
      ? (parsed.data as ConfigValues)
      : { ...nodeType.defaultConfig, ...(node.config as ConfigValues) };
    return { ...base, [LABEL_FIELD]: node.label };
  }, [node.config, node.label, nodeType]);

  // The generic schema is built at runtime, so the resolver is asserted once
  // here instead of threading a per-node-type generic through the panel.
  const resolver = useMemo(() => zodResolver(schema) as Resolver<ConfigValues>, [schema]);
  const form = useForm<ConfigValues>({ resolver, defaultValues });

  const onSubmit = form.handleSubmit((values) => {
    const { [LABEL_FIELD]: label, ...config } = values;
    onApply({ label: asText(label) || nodeType.label, config });
  });

  const errors = form.formState.errors;

  return (
    <AppCard className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-foreground-secondary [&_svg]:size-4">
          <Icon aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{nodeType.label}</p>
          <AppCaption>{NODE_CATEGORY_META[nodeType.category].label}</AppCaption>
        </div>
        <AppInlineCode>{node.id}</AppInlineCode>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 px-5 py-5">
        <AppText size="sm" tone="muted">
          {nodeType.description}
        </AppText>
        <fieldset key={formKey} disabled={!editable} className="flex min-w-0 flex-col gap-5">
          <AppFormField label="Step name" required error={asText(errors[LABEL_FIELD]?.message) || undefined}>
            {(aria) => <AppInput {...aria} {...form.register(LABEL_FIELD)} />}
          </AppFormField>
          {nodeType.fields.map((descriptor) => (
            <ConfigControl
              key={descriptor.name}
              descriptor={descriptor}
              control={form.control}
              error={asText(errors[descriptor.name]?.message) || undefined}
            />
          ))}
        </fieldset>

        {nodeType.outputs.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-muted px-3 py-2">
            <AppCaption>Outputs</AppCaption>
            <ul className="flex flex-col gap-0.5">
              {nodeType.outputs.map((port) => (
                <li key={port.id} className="text-xs text-foreground-secondary">
                  <span className="font-medium">{port.label}</span> — {port.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {editable ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-end gap-2">
              <AppButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  form.reset(defaultValues);
                  setFormKey((key) => key + 1);
                }}
              >
                Reset
              </AppButton>
              <AppButton type="submit" size="sm">
                Apply
              </AppButton>
            </div>
            <AppCaption>Applied changes stay in this draft until you save the workflow.</AppCaption>
          </div>
        ) : (
          <AppCaption>You need the member role to change a workflow.</AppCaption>
        )}
      </form>
    </AppCard>
  );
}
