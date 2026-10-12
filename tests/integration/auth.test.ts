import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { getDb } from "@/server/db/client";
import { verification } from "@/server/db/schema";
import { getAuth } from "@/server/auth";
import { resetDb } from "../helpers/db";

describe("auth route", () => {
  beforeEach(resetDb);

  it("responds on the ok endpoint", async () => {
    const res = await GET(new Request("http://localhost:3000/api/auth/ok"));
    expect(res.status).toBe(200);
  });

  it("auto-links social logins only for providers that verify email (not Kakao)", () => {
    // 카카오는 미인증·재할당 이메일이 올 수 있어 신뢰하면 같은 이메일의 기존 계정이 탈취된다
    expect(getAuth().options.account?.accountLinking?.trustedProviders).toEqual(["google"]);
  });

  it("stores a magic-link verification token", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: "new@test.local", callbackURL: "/app" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await getDb().select().from(verification)).toHaveLength(1);
  });
});
