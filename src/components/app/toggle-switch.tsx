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
          checked ? "justify-end bg-pop" : "justify-start bg-input",
        )}
      >
        {/* 켜짐은 핑크 트랙에 흰 손잡이(디자인 A — 메뉴의 '지금 여기'와 같은 색). 흰 손잡이와 핑크는 5:1 */}
        <span className="size-[26px] rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}
