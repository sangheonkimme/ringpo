"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteMyAccountAction, disconnectAccountAction } from "@/app/app/settings/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DisconnectButton({ accountId, username }: { accountId: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 shrink-0 rounded-[10px] border border-input bg-card px-3.5 text-sm font-semibold"
      >
        연결 해제
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>@{username} 연결을 해제할까요?</AlertDialogTitle>
            <AlertDialogDescription>이 계정의 자동화가 모두 꺼지고 더 이상 댓글에 반응하지 않아요. 나중에 다시 연결할 수 있어요.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  if (await disconnectAccountAction(accountId)) toast.success("연결을 해제했어요");
                  else toast.error("해제하지 못했어요");
                  setOpen(false);
                })
              }
            >
              연결 해제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-11 self-start text-sm font-semibold text-destructive">
        회원 탈퇴
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 탈퇴할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              연결된 인스타 계정, 자동화, 발송 기록이 모두 삭제되고 정기결제가 중단돼요. 결제 기록은 법령에 따라 5년간 보관돼요. 계속하려면 &lsquo;탈퇴&rsquo;를 입력하세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="탈퇴" />
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending || confirm.trim() !== "탈퇴"}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteMyAccountAction(confirm);
                  if (res && !res.ok) toast.error(res.error);
                })
              }
            >
              탈퇴하기
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
