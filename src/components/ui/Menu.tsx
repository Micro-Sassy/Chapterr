import clsx from "clsx";
import { Check, type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";

interface MenuCtx {
  close: () => void;
}
const Ctx = createContext<MenuCtx>({ close: () => undefined });

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * A floating menu (the one place besides dialogs where the soft shadow is used).
 * Keyboard: arrows move, Home/End jump, Escape closes and returns focus, Tab closes.
 * The `trigger` render prop receives the ARIA props to spread on the button.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  label,
  className,
  menuClassName,
}: {
  trigger: (props: { "aria-haspopup": "menu"; "aria-expanded": boolean; "aria-controls": string; onClick: () => void; onKeyDown: (e: KeyboardEvent) => void }, open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  label: string;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const triggerEl = useRef<HTMLElement | null>(null);

  const close = () => setOpen(false);

  // Outside click / focus leaving the menu closes it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  // Focus the first item once opened.
  useEffect(() => {
    if (open) {
      const first = menu.current?.querySelector<HTMLElement>(ITEM_SELECTOR);
      first?.focus();
    }
  }, [open]);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerEl.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case "Home":
        e.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        list.at(-1)?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  const triggerProps = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": id,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
    },
  };

  return (
    <div ref={root} className={clsx("relative", className)}>
      <div
        ref={(el) => {
          triggerEl.current = (el?.querySelector("button, [role=button]") as HTMLElement | null) ?? el;
        }}
        className="contents"
      >
        {trigger(triggerProps, open)}
      </div>
      {open && (
        <Ctx.Provider value={{ close }}>
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className={clsx(
              "absolute z-50 mt-1.5 min-w-56 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-float",
              align === "end" ? "right-0" : "left-0",
              menuClassName,
            )}
          >
            {typeof children === "function" ? children(close) : children}
          </div>
        </Ctx.Provider>
      )}
    </div>
  );
}

const itemClass = (active?: boolean, className?: string) =>
  clsx(
    "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm text-ink outline-none hover:bg-surface-2 focus-visible:bg-surface-2",
    active && "font-semibold",
    className,
  );

export function MenuItem({ icon: Icon, children, active, onClick, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; active?: boolean }) {
  const { close } = useContext(Ctx);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={itemClass(active, className)}
      onClick={(e) => {
        onClick?.(e);
        close();
      }}
      {...rest}
    >
      {Icon && <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check className="size-4 shrink-0" aria-hidden />}
    </button>
  );
}

export function MenuLink({ icon: Icon, children, active, to, className, trailing }: { icon?: LucideIcon; children: ReactNode; active?: boolean; to: string; className?: string; trailing?: ReactNode }) {
  const { close } = useContext(Ctx);
  return (
    <Link to={to} role="menuitem" tabIndex={-1} aria-current={active ? "true" : undefined} className={itemClass(active, className)} onClick={close}>
      {Icon && <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
      {active && <Check className="size-4 shrink-0" aria-hidden />}
    </Link>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1.5 border-t border-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="label px-3 pb-1 pt-2 text-ink-muted">{children}</p>;
}
