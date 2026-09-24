"use client";

import { useState, useTransition } from "react";
import { deleteAutomationAction } from "@/app/app/automations/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteAutomationButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-12 rounded-xl px-5 text-[15px] font-semibold text-destructive">
        삭제
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>자동화를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>발송 기록 통계도 함께 사라져요. 이미 보낸 DM의 링크는 계속 동작해요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => startTransition(() => deleteAutomationAction(id))}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
