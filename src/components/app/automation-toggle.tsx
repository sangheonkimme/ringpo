"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleAutomationAction } from "@/app/app/automations/actions";
import { TOGGLE_ERROR } from "@/lib/event-labels";
import { ToggleSwitch } from "./toggle-switch";

export function AutomationToggle({ id, active, label }: { id: string; active: boolean; label: string }) {
  const router = useRouter();
  const [checked, setChecked] = useState(active);
  const [pending, startTransition] = useTransition();
  return (
    <ToggleSwitch
      checked={checked}
      disabled={pending}
      label={`${label} ${checked ? "끄기" : "켜기"}`}
      onChange={(next) =>
        startTransition(async () => {
          setChecked(next);
          const res = await toggleAutomationAction(id, next);
          if (!res.ok) {
            setChecked(!next);
            toast.error(TOGGLE_ERROR[res.reason]);
          } else {
            toast.success(next ? "자동화를 켰어요" : "자동화를 일시중지했어요");
            router.refresh(); // 상태 배지를 토글과 맞춘다
          }
        })
      }
    />
  );
}
