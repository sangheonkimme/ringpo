import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  // headers()를 먼저 호출해야 빌드 시 prerender가 env 검증 전에 동적 렌더링으로 빠진다
  const h = await headers();
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}
