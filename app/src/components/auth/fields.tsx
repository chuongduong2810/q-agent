/**
 * Auth form field kit (ADR 0007) — the shared inputs every auth screen
 * (Login / Forgot / Profile / User management) composes. Tokens mirror the
 * design source (`design/…/Q-Agent Auth.dc.html`): 46px pill fields on the
 * `#16161f` panel, `#9494a6` labels, violet accents.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/cn";

/** Field label — small, semibold, muted. */
export function AuthLabel({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("mb-2 block text-xs font-semibold text-[#9494a6]", className)}
    >
      {children}
    </label>
  );
}

/** The pill container that wraps a leading icon + control(s). */
export function FieldWrap({
  icon,
  children,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[46px] items-center gap-2.5 rounded-xl border border-white/10 bg-[#16161f] px-3.5 focus-within:border-accent/50",
        className,
      )}
    >
      {icon ? <span className="flex shrink-0 text-[#7a7a8c]">{icon}</span> : null}
      {children}
    </div>
  );
}

const inputClass =
  "min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-[#6c6c7e]";

type FieldInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Optional leading icon (a lucide element sized ~15). */
  icon?: ReactNode;
  /** Class applied to the outer `FieldWrap`. */
  wrapClassName?: string;
};

/** A single-line text/email input inside a `FieldWrap`. */
export function TextInput({ icon, wrapClassName, className, ...rest }: FieldInputProps) {
  return (
    <FieldWrap icon={icon} className={wrapClassName}>
      <input {...rest} className={cn(inputClass, className)} />
    </FieldWrap>
  );
}

/** Password input with a show/hide eye toggle. Defaults to a lock leading icon. */
export function PasswordInput({ icon, wrapClassName, className, ...rest }: FieldInputProps) {
  const { t } = useTranslation("auth");
  const [show, setShow] = useState(false);
  return (
    <FieldWrap icon={icon === undefined ? <Lock size={15} /> : icon} className={wrapClassName}>
      <input
        {...rest}
        type={show ? "text" : "password"}
        className={cn(inputClass, className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t("fields.hidePassword") : t("fields.showPassword")}
        className="flex shrink-0 text-[#7a7a8c] transition-colors hover:text-ink"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </FieldWrap>
  );
}
