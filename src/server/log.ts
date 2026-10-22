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
  // SQL/provider error messages can contain bind parameters, customer text or access tokens.
  const fields: Fields = { errorName: e instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(e.name) ? e.name : "Error" };
  const source = e && typeof e === "object" ? e as { code?: unknown; cause?: { code?: unknown } } : undefined;
  const code = source?.code ?? source?.cause?.code;
  if ((typeof code === "number" && Number.isSafeInteger(code)) || (typeof code === "string" && /^(?:\d+(?:\/\d+)?|[0-9A-Z]{5})$/.test(code))) fields.errorCode = code;
  return fields;
}
