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

export { clsx as cx };

// --- Button ---------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-accent-strong disabled:opacity-60",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-gold/60 disabled:opacity-60",
  ghost: "text-ink hover:bg-surface-2 disabled:opacity-50",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-60",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium tracking-wide transition-colors",
        size === "sm" ? "h-8 px-3 text-[0.95rem]" : "h-10 px-4 text-base",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink", className)}
      {...rest}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

// --- Form fields ------------------------------------------------------------------

const inputBase =
  "w-full rounded-[var(--radius)] border border-line bg-surface px-3 text-base text-ink shadow-[inset_0_1px_2px_rgb(80_60_20/0.08)] placeholder:italic placeholder:text-ink-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-gold/30 disabled:opacity-60";

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
      <label htmlFor={id} className="smallcaps block text-[0.95rem] font-medium text-ink-muted">
        {label}
      </label>
      {children(id, describedBy)}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-10", invalid && "border-danger", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={clsx(inputBase, "py-2", invalid && "border-danger", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={clsx(inputBase, "h-10 pr-8", invalid && "border-danger", className)} {...rest}>
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className={clsx("flex items-start gap-2.5 text-sm text-ink", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5 size-4 rounded border-line accent-[var(--color-accent)]" {...rest} />
      <span>{label}</span>
    </label>
  );
});

// --- Layout & feedback ----------------------------------------------------------------

export function Card({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "li" }) {
  return (
    <As className={clsx("bookplate rounded-[var(--radius)] border border-line bg-surface p-4 shadow-[0_1px_0_rgb(80_60_20/0.06),0_10px_24px_-18px_rgb(60_40_10/0.5)] sm:p-5", className)}>
      {children}
    </As>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-1 text-base italic text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="ornament mt-4" aria-hidden>
        <span className="text-xs">&#9670;</span>
      </div>
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="smallcaps text-lg font-semibold text-accent">{children}</h2>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "highlight" | "danger"; className?: string }) {
  const tones = {
    neutral: "border-line bg-surface-2 text-ink-muted",
    accent: "border-accent/25 bg-accent-soft text-accent-strong",
    highlight: "border-highlight/25 bg-highlight-soft text-highlight",
    danger: "border-danger/25 bg-danger-soft text-danger",
  };
  return (
    <span className={clsx("smallcaps inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[0.8rem] font-medium", tones[tone], className)}>{children}</span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-ink-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = BookOpen, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius)] border border-dashed border-line bg-surface/40 px-6 py-10 text-center">
      <Icon className="mb-3 size-8 text-gold" aria-hidden strokeWidth={1.5} />
      <p className="text-lg italic">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "error" | "success" | "warning"; title?: string; children?: ReactNode }) {
  const tones = {
    info: "border-accent/30 bg-accent-soft text-ink",
    success: "border-success/30 bg-accent-soft text-ink",
    warning: "border-highlight/40 bg-highlight-soft text-ink",
    error: "border-danger/30 bg-danger-soft text-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={clsx("rounded-[var(--radius)] border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div
        className="h-2.5 overflow-hidden rounded-full border border-line bg-surface-2"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-gold transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "smallcaps -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-base font-medium",
            value === t.value ? "border-gold text-accent" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-ink-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
