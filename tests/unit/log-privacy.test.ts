import { describe, expect, it } from "vitest";
import { errorFields } from "@/server/log";
describe("safe operational errors", () => {
  it("retains error classification and drops SQL binds, usernames and token-bearing URLs", () => {
    const e = new Error('SELECT ... token=secret customer=private-user'); Object.assign(e,{cause:{code:'23514'}});
    expect(errorFields(e)).toEqual({errorName:'Error',errorCode:'23514'});
    expect(JSON.stringify(errorFields('raw-access-token'))).not.toContain('raw-access-token');
    e.name='secret user';Object.assign(e,{code:'access-token-secret'});expect(errorFields(e)).toEqual({errorName:'Error'});
  });
});
