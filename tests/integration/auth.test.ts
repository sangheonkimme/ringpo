import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { getDb } from "@/server/db/client";
import { verification } from "@/server/db/schema";
import { resetDb } from "../helpers/db";

describe("auth route", () => {
  beforeEach(resetDb);

  it("responds on the ok endpoint", async () => {
    const res = await GET(new Request("http://localhost:3000/api/auth/ok"));
    expect(res.status).toBe(200);
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
