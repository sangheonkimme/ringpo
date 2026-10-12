import { describe, expect, it, vi } from "vitest";
import { startEventLoop } from "@/worker/loop";

describe("startEventLoop", () => {
  it("processes everything with bounded concurrency and drains on stop", async () => {
    const queue = Array.from({ length: 12 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const done: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 3,
      pollMs: 10,
      claim: async (n) => queue.splice(0, n),
      handle: async (item) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        done.push(item);
      },
      onError: () => {},
    });
    await vi.waitFor(() => expect(done).toHaveLength(12), { timeout: 3000 });
    await loop.stop();
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("wake() triggers a claim before the poll interval", async () => {
    const claims: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 1,
      pollMs: 60_000,
      claim: async () => {
        claims.push(Date.now());
        return [];
      },
      handle: async () => {},
      onError: () => {},
    });
    await vi.waitFor(() => expect(claims.length).toBe(1));
    loop.wake();
    await vi.waitFor(() => expect(claims.length).toBe(2), { timeout: 1000 });
    await loop.stop();
  });

  it("reports handler errors and keeps going", async () => {
    const errors: unknown[] = [];
    const queue = [1, 2];
    const done: number[] = [];
    const loop = startEventLoop<number>({
      concurrency: 2,
      pollMs: 10,
      claim: async (n) => queue.splice(0, n),
      handle: async (i) => {
        if (i === 1) throw new Error("boom");
        done.push(i);
      },
      onError: (e) => errors.push(e),
    });
    await vi.waitFor(() => expect(done).toEqual([2]));
    await loop.stop();
    expect(errors).toHaveLength(1);
  });
});
