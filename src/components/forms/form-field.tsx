import { useId, type ReactNode } from "react";

import { AppFieldError, AppHelpText, AppLabel } from "@/components/ui/app-label";
import { cn } from "@/lib/cn";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

interface AppFormFieldProps {
  label: ReactNode;
  /** Visually hide the label while keeping it for assistive tech. */
  labelHidden?: boolean;
  description?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  optional?: boolean;
  className?: string;
  /** Render-prop receives id and aria attributes to spread onto the control. */
  children: (control: FieldControlProps) => ReactNode;
  /** Optional trailing content next to the label (e.g. a link). */
  labelAction?: ReactNode;
}

/**
 * Layout + accessibility wiring for a single form control. Works with any
 * control (native or App*) and with React Hook Form's `register`.
 */
export function AppFormField({
  label,
  labelHidden,
  description,
  error,
  required,
  optional,
  className,
  children,
  labelAction,
}: AppFormFieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className={cn("flex items-center justify-between gap-2", labelHidden && "sr-only")}>
        <AppLabel htmlFor={id} required={required} optional={optional}>
          {label}
        </AppLabel>
        {labelAction}
      </div>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {description && !error ? <AppHelpText id={descriptionId}>{description}</AppHelpText> : null}
      {error ? <AppFieldError id={errorId}>{error}</AppFieldError> : null}
    </div>
  );
}

interface AppFormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Settings-style section: heading column on the left, fields on the right. */
export function AppFormSection({ title, description, children, actions, className }: AppFormSectionProps) {
  return (
    <section className={cn("grid gap-6 border-b border-border py-8 first:pt-0 last:border-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]", className)}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-foreground-muted">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-5">
        {children}
        {actions ? <div className="flex items-center justify-end gap-2 pt-1">{actions}</div> : null}
      </div>
    </section>
  );
}

export function AppFormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
}
