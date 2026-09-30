import { z } from "zod";

const optional = z.string().min(1).optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  KAKAO_CLIENT_ID: optional,
  KAKAO_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().min(3).default("noreply@localhost"),
  IG_APP_ID: z.string().min(1),
  IG_APP_SECRET: z.string().min(1),
  META_APP_SECRET: optional,
  IG_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  IG_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  IG_PRIVATE_REPLY_HOURLY_LIMIT: z.coerce.number().int().positive().max(750).default(700),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes (base64)"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),
  PORTONE_STORE_ID: optional,
  PORTONE_CHANNEL_KEY: optional,
  PORTONE_API_SECRET: optional,
  PORTONE_WEBHOOK_SECRET: optional,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
