"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppFieldError, AppHelpText } from "@/components/ui/app-label";
import { AppTab, AppTabList, AppTabPanel, AppTabs } from "@/components/ui/app-tabs";
import { AppTextarea } from "@/components/ui/app-textarea";
import { estimateTokens } from "@/features/knowledge/chunking";
import { TEXT_SOURCE_MAX_CHARS } from "@/features/knowledge/constants";
import {
  useCreateSourceMutation,
  useUploadSourceMutation,
} from "@/features/knowledge/mutations";
import {
  textSourceFormSchema,
  urlSourceFormSchema,
  type TextSourceFormValues,
  type UrlSourceFormValues,
} from "@/features/knowledge/schemas";
import {
  formatBytes,
  UNSUPPORTED_DOCUMENT_NOTE,
  UPLOAD_ACCEPT_ATTRIBUTE,
  UPLOAD_FORMATS_LABEL,
  UPLOAD_MAX_LABEL,
  validateUpload,
} from "@/features/knowledge/uploads";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { formatNumber } from "@/lib/format/number";

type Mode = "text" | "url" | "file";

const TEXT_FORM_ID = "add-text-source-form";
const URL_FORM_ID = "add-url-source-form";

type CreateMutation = ReturnType<typeof useCreateSourceMutation>;
type UploadMutation = ReturnType<typeof useUploadSourceMutation>;

function TextSourceForm({ mutation, onDone }: { mutation: CreateMutation; onDone: () => void }) {
  const form = useForm<TextSourceFormValues>({
    resolver: zodResolver(textSourceFormSchema),
    defaultValues: { name: "", content: "" },
  });
  const content = useWatch({ control: form.control, name: "content" }) ?? "";

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      { type: "text", name: values.name, content: values.content },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <form id={TEXT_FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField label="Name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Refund policy" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Content"
        required
        error={form.formState.errors.content?.message}
        description={`${formatNumber(content.length)} of ${formatNumber(TEXT_SOURCE_MAX_CHARS)} characters · about ${formatNumber(estimateTokens(content))} tokens`}
      >
        {(field) => (
          <AppTextarea
            {...field}
            {...form.register("content")}
            rows={10}
            placeholder="Paste the text you want your chatbots and agents to answer from."
          />
        )}
      </AppFormField>
    </form>
  );
}

function UrlSourceForm({ mutation, onDone }: { mutation: CreateMutation; onDone: () => void }) {
  const form = useForm<UrlSourceFormValues>({
    resolver: zodResolver(urlSourceFormSchema),
    defaultValues: { url: "", name: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      { type: "url", url: values.url, name: values.name.trim() || undefined },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <form id={URL_FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField
        label="Page URL"
        required
        error={form.formState.errors.url?.message}
        description="The page is fetched now and converted to readable text. Only public http and https pages can be imported."
      >
        {(field) => (
          <AppInput {...field} {...form.register("url")} type="url" placeholder="https://example.com/help/refunds" autoFocus />
        )}
      </AppFormField>
      <AppFormField label="Name" optional description="Defaults to the page title." error={form.formState.errors.name?.message}>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Refund policy" />}
      </AppFormField>
    </form>
  );
}

function FileSourceForm({ mutation, onDone }: { mutation: UploadMutation; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      setError(null);
      return;
    }
    // The same rules the route handler enforces, run here so the user hears
    // about a bad file before megabytes go over the wire.
    const validation = validateUpload({ name: selected.name, type: selected.type, size: selected.size });
    if (!validation.ok) {
      setError(validation.message);
      reset();
      return;
    }
    setError(null);
    setFile(selected);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="knowledge-upload-input" className="text-sm font-medium text-foreground">
          File
        </label>
        <input
          ref={inputRef}
          id="knowledge-upload-input"
          type="file"
          accept={UPLOAD_ACCEPT_ATTRIBUTE}
          onChange={onFileChange}
          disabled={mutation.isPending}
          aria-describedby="knowledge-upload-help"
          aria-invalid={error ? true : undefined}
          className="block w-full cursor-pointer rounded-md border border-border bg-surface text-sm text-foreground-secondary shadow-xs file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-border file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:border-border-strong focus-ring disabled:cursor-not-allowed disabled:bg-surface-muted"
        />
        <AppHelpText id="knowledge-upload-help">
          {UPLOAD_FORMATS_LABEL} up to {UPLOAD_MAX_LABEL}, encoded as UTF-8.
        </AppHelpText>
        {error ? <AppFieldError>{error}</AppFieldError> : null}
        {file ? (
          <p className="text-xs text-foreground-secondary">
            Selected <span className="font-medium">{file.name}</span> ({formatBytes(file.size)})
          </p>
        ) : null}
      </div>

      <AppAlert tone="neutral" title="PDF and Word documents are not supported yet">
        {UNSUPPORTED_DOCUMENT_NOTE}
      </AppAlert>

      <AppButton
        fullWidth
        leadingIcon={<Upload aria-hidden />}
        disabled={!file}
        loading={mutation.isPending}
        onClick={() => {
          if (!file) return;
          mutation.mutate(file, {
            onSuccess: () => {
              reset();
              onDone();
            },
            onError: (uploadError) => {
              const fieldError = isApiError(uploadError) ? uploadError.details?.file?.[0] : undefined;
              setError(fieldError ?? (isApiError(uploadError) ? uploadError.message : "Upload failed. Try again."));
            },
          });
        }}
      >
        Upload and index
      </AppButton>
    </div>
  );
}

export function AddSourceButton({
  knowledgeBaseId,
  variant,
}: {
  knowledgeBaseId: string;
  variant?: "primary" | "secondary";
}) {
  const { membership } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  // Owned here so the dialog footer can reflect the pending state of whichever
  // panel is submitting.
  const createMutation = useCreateSourceMutation(knowledgeBaseId);
  const uploadMutation = useUploadSourceMutation(knowledgeBaseId);
  const busy = createMutation.isPending || uploadMutation.isPending;

  if (!canEdit(membership.role)) return null;

  const close = () => setOpen(false);

  return (
    <>
      <AppButton variant={variant} onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />}>
        Add source
      </AppButton>
      <AppDialog
        open={open}
        onClose={close}
        title="Add a source"
        description="Content is ingested, chunked, embedded and indexed before it can be retrieved."
        size="lg"
        dismissible={!busy}
        footer={
          mode === "file" ? (
            <AppButton variant="secondary" onClick={close} disabled={busy}>
              Close
            </AppButton>
          ) : (
            <>
              <AppButton variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </AppButton>
              <AppButton type="submit" form={mode === "text" ? TEXT_FORM_ID : URL_FORM_ID} loading={busy}>
                {mode === "text" ? "Add text source" : "Fetch and index"}
              </AppButton>
            </>
          )
        }
      >
        <AppTabs
          defaultValue="text"
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
          className="flex flex-col gap-5"
        >
          <AppTabList label="Source type" variant="pill">
            <AppTab value="text" variant="pill" disabled={busy}>
              Text
            </AppTab>
            <AppTab value="url" variant="pill" disabled={busy}>
              URL
            </AppTab>
            <AppTab value="file" variant="pill" disabled={busy}>
              File
            </AppTab>
          </AppTabList>
          <AppTabPanel value="text">
            <TextSourceForm mutation={createMutation} onDone={close} />
          </AppTabPanel>
          <AppTabPanel value="url">
            <UrlSourceForm mutation={createMutation} onDone={close} />
          </AppTabPanel>
          <AppTabPanel value="file">
            <FileSourceForm mutation={uploadMutation} onDone={close} />
          </AppTabPanel>
        </AppTabs>
      </AppDialog>
    </>
  );
}
