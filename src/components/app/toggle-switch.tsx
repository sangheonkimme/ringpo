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
          checked ? "justify-end bg-brand" : "justify-start bg-input",
        )}
      >
        {/* 켜짐은 라임 트랙에 Ink 손잡이: 흰 손잡이는 라임 위에서 거의 안 보인다(대비 1.2:1) */}
        <span className={cn("size-[26px] rounded-full shadow-sm", checked ? "bg-foreground" : "bg-white")} />
      </span>
    </button>
  );
}
