export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
}

export function startScheduler(
  jobs: ScheduledJob[],
  o: {
    withLock: (name: string, fn: () => Promise<void>) => Promise<unknown>;
    onError: (name: string, err: unknown) => void;
  },
): { stop(): void } {
  const timers = jobs.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await o.withLock(job.name, job.run);
      } catch (e) {
        o.onError(job.name, e);
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(() => void tick(), job.intervalMs);
  });
  return { stop: () => timers.forEach(clearInterval) };
}
