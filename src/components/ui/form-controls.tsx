"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";

type FormRowProps = {
  children: React.ReactNode;
  className?: string;
};

export function FormRow({ children, className }: FormRowProps) {
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, id, hint, error, containerClassName, className, required, ...props }, ref) => {
    const fieldId = id ?? props.name ?? undefined;
    return (
      <div className={cn("space-y-1", containerClassName)}>
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground/90">
          {label}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </label>
        <input
          ref={ref}
          id={fieldId}
          required={required}
          className={cn(
            "w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm transition focus-visible:ring-2 focus-visible:ring-primary/40",
            className,
          )}
          {...props}
        />
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  },
);

Field.displayName = "Field";

type RangeItemProps = {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
};

export function RangeItem({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  hint,
}: RangeItemProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium text-foreground/90">
          {label}
        </label>
        <span className="tabular-nums text-xs font-semibold text-primary">{Math.round(value)}%</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-primary"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value ?? 0))}
        disabled={disabled}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
