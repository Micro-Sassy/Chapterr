import clsx from "clsx";
import { BookOpen, Loader2, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link, type LinkProps } from "react-router";

export { clsx as cx };

// --- Buttons (§7.2) -----------------------------------------------------------------
// Primary: Forest fill, Linen text. Secondary: Parchment + Thread border. Ghost: text
// with an underline on hover. Brass is never a button colour.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover disabled:opacity-60",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2 disabled:opacity-60",
  ghost: "text-ink hover:bg-surface-2 disabled:opacity-50",
  danger: "bg-error text-white hover:opacity-90 disabled:opacity-60",
};

/** Class list for something styled as a button (used by Button and LinkButton). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-semibold transition-colors select-none",
    size === "sm" ? "h-9 px-3 text-sm" : "h-11 px-4 text-[15px]",
    variants[variant],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
});

/** A router link that looks like a button. */
export function LinkButton({ variant = "primary", size = "md", icon: Icon, className, children, ...rest }: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: LucideIcon }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </Link>
  );
}

export function IconButton({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50", className)}
      {...rest}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

/** A plain text link in Forest with an underline. */
export function TextLink({ className, ...rest }: LinkProps) {
  return <Link className={clsx("font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink", className)} {...rest} />;
}

// --- Form fields --------------------------------------------------------------------

const inputBase =
  "w-full rounded-control border border-line bg-surface px-3.5 text-base text-ink placeholder:text-ink-muted/70 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15 disabled:opacity-60";

export interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-11", invalid && "border-error", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={clsx(inputBase, "py-2.5", invalid && "border-error", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-11 pr-8", invalid && "border-error", className)} {...rest}>
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={clsx("flex items-start gap-2.5 text-sm text-ink", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5 size-4 shrink-0 rounded-[4px] border-line accent-[var(--color-primary)]" {...rest} />
      <span>{label}</span>
    </label>
  );
});

// --- Layout & feedback ----------------------------------------------------------------

/** Cards sit flat: Parchment, 1px Thread border, 20px radius, no shadow (§5). */
export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li"; id?: string }) {
  return (
    <As className={clsx("rounded-card border border-line bg-surface p-5 sm:p-6", className)} {...rest}>
      {children}
    </As>
  );
}

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="label mb-2 text-ink-muted">{eyebrow}</p>}
        <h1 className="display-l text-balance">{title}</h1>
        {description && <p className="mt-2 max-w-prose text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, action, as: As = "h2" }: { children: ReactNode; action?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <As className="heading-m text-ink">{children}</As>
      {action}
    </div>
  );
}

export type BadgeTone = "neutral" | "forest" | "brass" | "success" | "error" | "info";

/** Chips: 6px radius, Inter 600 12px. Brass chips use Forest text so small type never sits in Brass. */
export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-line bg-surface-2 text-ink-muted",
    forest: "border-primary bg-primary text-on-primary",
    brass: "border-accent/40 bg-accent-soft text-ink",
    success: "border-success/30 bg-success-soft text-ink",
    error: "border-error/30 bg-error-soft text-ink",
    info: "border-info/30 bg-info-soft text-ink",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-chip border px-1.5 py-px text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-ink-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

/** Empty states offer one next step (§6). */
export function EmptyState({ icon: Icon = BookOpen, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line px-6 py-10 text-center">
      <Icon className="mb-3 size-8 text-ink-muted" aria-hidden strokeWidth={1.5} />
      <p className="heading-s">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "error" | "success" | "warning"; title?: string; children?: ReactNode; className?: string }) {
  const tones = {
    info: "border-info/30 bg-info-soft",
    success: "border-success/30 bg-success-soft",
    warning: "border-accent/40 bg-accent-soft",
    error: "border-error/30 bg-error-soft",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={clsx("rounded-control border px-4 py-3 text-sm text-ink", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

/** Reading progress: a Forest track with a Brass fill, 4px tall (§7.3). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1 overflow-hidden rounded-[2px] bg-primary/25" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-full rounded-[2px] bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            value === t.value ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-ink-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A numeric stat with a small label underneath. */
export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <p className="heading-m">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}
