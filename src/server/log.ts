type Fields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, fields?: Fields) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

export function errorFields(e: unknown): Fields {
  return e instanceof Error ? { error: e.message, errorName: e.name } : { error: String(e) };
}
