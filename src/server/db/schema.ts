import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Better Auth core ----------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------- Service ----------
export const IG_ACCOUNT_STATUSES = ["active", "reauth_required", "disconnected"] as const;

export const igAccounts = pgTable(
  "ig_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    igUserId: text("ig_user_id").notNull().unique(),
    igScopedId: text("ig_scoped_id"),
    username: text("username").notNull(),
    profilePictureUrl: text("profile_picture_url"),
    accountType: text("account_type").notNull(),
    accessTokenEnc: text("access_token_enc"),
    tokenExpiresAt: tz("token_expires_at"),
    status: text("status", { enum: IG_ACCOUNT_STATUSES }).notNull().default("active"),
    nextReplyAt: tz("next_reply_at").notNull().defaultNow(),
    dmFormat: text("dm_format", { enum: ["button", "text"] }).notNull().default("button"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ig_accounts_user_idx").on(t.userId), index("ig_accounts_scoped_idx").on(t.igScopedId)],
);

export const MEDIA_SCOPES = ["specific", "all", "next"] as const;
export const MATCH_TYPES = ["contains", "exact", "any"] as const;

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    igAccountId: uuid("ig_account_id")
      .notNull()
      .references(() => igAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mediaScope: text("media_scope", { enum: MEDIA_SCOPES }).notNull(),
    mediaId: text("media_id"),
    mediaThumbnailUrl: text("media_thumbnail_url"),
    mediaPermalink: text("media_permalink"),
    mediaCaption: text("media_caption"),
    keywords: text("keywords").array().notNull(),
    matchType: text("match_type", { enum: MATCH_TYPES }).notNull().default("contains"),
    replyEnabled: boolean("reply_enabled").notNull().default(true),
    replyTexts: text("reply_texts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dmText: text("dm_text").notNull(),
    dmButtonTitle: text("dm_button_title").notNull(),
    dmLinkUrl: text("dm_link_url").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_account_active_idx").on(t.igAccountId, t.isActive),
    index("automations_user_idx").on(t.userId),
  ],
);

export const mediaCache = pgTable("media_cache", {
  mediaId: text("media_id").primaryKey(),
  igAccountId: uuid("ig_account_id")
    .notNull()
    .references(() => igAccounts.id, { onDelete: "cascade" }),
  timestamp: tz("timestamp"),
  permalink: text("permalink"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  mediaProductType: text("media_product_type"),
  fetchedAt: tz("fetched_at").notNull().defaultNow(),
});

export const EVENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "partial",
  "failed",
  "skipped",
  "expired",
] as const;
export const SKIP_REASONS = [
  "self",
  "no_match",
  "duplicate",
  "quota",
  "account_inactive",
  "automation_inactive",
] as const;
export const PART_STATUSES = ["sent", "failed", "skipped"] as const;

export const commentEvents = pgTable(
  "comment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    igAccountId: uuid("ig_account_id")
      .notNull()
      .references(() => igAccounts.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    commentId: text("comment_id").notNull().unique(),
    mediaId: text("media_id").notNull(),
    parentCommentId: text("parent_comment_id"),
    mediaProductType: text("media_product_type"),
    commenterIgId: text("commenter_ig_id").notNull(),
    commenterUsername: text("commenter_username"),
    commentText: text("comment_text").notNull().default(""),
    receivedAt: tz("received_at").notNull().defaultNow(),
    status: text("status", { enum: EVENT_STATUSES }).notNull().default("pending"),
    skipReason: text("skip_reason", { enum: SKIP_REASONS }),
    replyStatus: text("reply_status", { enum: PART_STATUSES }),
    dmStatus: text("dm_status", { enum: PART_STATUSES }),
    replyCommentId: text("reply_comment_id"),
    dmMessageId: text("dm_message_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    usagePeriod: text("usage_period"),
    runAt: tz("run_at").notNull().defaultNow(),
    lockedAt: tz("locked_at"),
    dmReservedAt: tz("dm_reserved_at"),
    completedAt: tz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comment_events_queue_idx")
      .on(t.runAt)
      .where(sql`${t.status} in ('pending', 'processing')`),
    index("comment_events_rate_idx").on(t.igAccountId, t.dmReservedAt),
    index("comment_events_automation_idx").on(t.automationId, t.createdAt),
    index("comment_events_account_created_idx").on(t.igAccountId, t.createdAt),
    index("comment_events_reply_idx").on(t.replyCommentId),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull(),
    commenterIgId: text("commenter_ig_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => commentEvents.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deliveries_unique_idx").on(t.automationId, t.mediaId, t.commenterIgId),
    index("deliveries_event_idx").on(t.eventId),
  ],
);

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => commentEvents.id, { onDelete: "set null" }),
    targetUrl: text("target_url").notNull(),
    clickCount: integer("click_count").notNull().default(0),
    firstClickedAt: tz("first_clicked_at"),
    lastClickedAt: tz("last_clicked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("links_automation_idx").on(t.automationId), index("links_event_idx").on(t.eventId)],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    dmCount: integer("dm_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

export const PLAN_IDS = ["free", "pro", "agency"] as const;
export const SUBSCRIPTION_STATUSES = ["active", "past_due", "canceled"] as const;

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: PLAN_IDS }).notNull().default("free"),
  status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("active"),
  billingKeyEnc: text("billing_key_enc"),
  cardLabel: text("card_label"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  billingAnchorAt: tz("billing_anchor_at"),
  currentPeriodStart: tz("current_period_start"),
  currentPeriodEnd: tz("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  pendingPlan: text("pending_plan", { enum: PLAN_IDS }),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: tz("next_retry_at"),
  billingLockedUntil: tz("billing_locked_until"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "canceled"] as const;

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    paymentId: text("payment_id").notNull().unique(),
    plan: text("plan", { enum: PLAN_IDS }).notNull(),
    amount: integer("amount").notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    failureReason: text("failure_reason"),
    periodStart: tz("period_start"),
    periodEnd: tz("period_end"),
    paidAt: tz("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_user_idx").on(t.userId, t.createdAt)],
);

export const dataDeletionRequests = pgTable("data_deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  confirmationCode: text("confirmation_code").notNull().unique(),
  igUserId: text("ig_user_id").notNull(),
  status: text("status", { enum: ["received", "completed"] }).notNull().default("received"),
  createdAt: createdAt(),
  completedAt: tz("completed_at"),
});

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  beatAt: tz("beat_at").notNull(),
});

export type IgAccount = typeof igAccounts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
export type CommentEvent = typeof commentEvents.$inferSelect;
export type NewCommentEvent = typeof commentEvents.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type SkipReason = (typeof SKIP_REASONS)[number];
export type PartStatus = (typeof PART_STATUSES)[number];
