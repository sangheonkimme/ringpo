"use client";

import { cn } from "@/lib/utils";

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 w-[60px] shrink-0 items-center justify-center disabled:opacity-60"
    >
      <span
        className={cn(
          "flex h-8 w-[52px] rounded-full p-[3px] transition-colors",
          checked ? "justify-end bg-foreground" : "justify-start bg-[#D8CFC3]",
        )}
      >
        <span className="size-[26px] rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}
