export interface LoopOptions<T> {
  concurrency: number;
  pollMs: number;
  claim: (n: number) => Promise<T[]>;
  handle: (item: T) => Promise<void>;
  onError: (err: unknown) => void;
}

export function startEventLoop<T>(o: LoopOptions<T>): { wake(): void; stop(): Promise<void> } {
  let stopped = false;
  let inFlight = 0;
  let wakeUp: (() => void) | null = null;
  const tasks = new Set<Promise<void>>();

  const idle = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakeUp = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wakeUp = done;
    });

  const run = async () => {
    while (!stopped) {
      const free = o.concurrency - inFlight;
      if (free <= 0) {
        await idle(o.pollMs);
        continue;
      }
      let items: T[] = [];
      try {
        items = await o.claim(free);
      } catch (e) {
        o.onError(e);
        await idle(o.pollMs);
        continue;
      }
      if (items.length === 0) {
        await idle(o.pollMs);
        continue;
      }
      for (const item of items) {
        inFlight++;
        const task: Promise<void> = o
          .handle(item)
          .catch(o.onError)
          .finally(() => {
            inFlight--;
            tasks.delete(task);
            wakeUp?.();
          });
        tasks.add(task);
      }
    }
  };

  const loopDone = run();
  return {
    wake: () => wakeUp?.(),
    async stop() {
      stopped = true;
      wakeUp?.();
      await loopDone;
      await Promise.all([...tasks]);
    },
  };
}
