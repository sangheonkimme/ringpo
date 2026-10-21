import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CAMPAIGN_STATES, type CampaignTemplates } from "@/lib/campaign-schema";
import { CAMPAIGN_JOB_KINDS, CAMPAIGN_JOB_STATES, SEND_CHANNELS } from "@/lib/campaign-jobs";
import type { CampaignRuleSnapshot } from "@/server/campaigns/matcher";

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
    /** 켜면 링크 DM 대신 '팔로우했어요' 버튼이 달린 안내를 먼저 보내고, 팔로우가 확인되면 링크를 보낸다 */
    followGate: boolean("follow_gate").notNull().default(false),
    followGateText: text("follow_gate_text").notNull().default(""),
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
  // 팔로우 확인 안내를 보냈고 '팔로우했어요' 탭을 기다리는 중
  "awaiting_follow",
  "campaign_pending",
  "campaign_processing",
  "campaign_routed",
  "campaign_failed",
] as const;
export const SKIP_REASONS = [
  "self",
  "no_match",
  "duplicate",
  "quota",
  "account_inactive",
  "automation_inactive",
  "campaign_excluded",
  "campaign_duplicate",
  "campaign_inactive",
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
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    routeOwner: text("route_owner", { enum: ["legacy", "undecided", "campaign"] }).notNull().default("legacy"),
    stateAtReceipt: text("state_at_receipt", { enum: CAMPAIGN_STATES }),
    storedStateAtReceipt: text("stored_state_at_receipt", { enum: CAMPAIGN_STATES }),
    campaignVersionAtReceipt: integer("campaign_version_at_receipt"),
    campaignRulesSnapshot: jsonb("campaign_rules_snapshot").$type<CampaignRuleSnapshot>(),
    flagCheckedAt: tz("flag_checked_at"),
    commentCreatedAt: tz("comment_created_at"),
    timestampSource: text("timestamp_source", { enum: ["graph"] }),
    matchedRule: text("matched_rule"),
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
    index("comment_events_campaign_queue_idx").on(t.runAt).where(sql`${t.status} in ('campaign_pending', 'campaign_processing')`),
    index("comment_events_campaign_idx").on(t.campaignId, t.receivedAt),
  ],
);

export const FOLLOW_GATE_STATUSES = ["waiting", "sent"] as const;

/** 팔로우 확인 대기. 버튼 payload(fg:<id>)로 탭한 사람과 댓글 이벤트를 잇는다 */
export const followGates = pgTable(
  "follow_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .unique()
      .references(() => commentEvents.id, { onDelete: "cascade" }),
    igAccountId: uuid("ig_account_id")
      .notNull()
      .references(() => igAccounts.id, { onDelete: "cascade" }),
    status: text("status", { enum: FOLLOW_GATE_STATUSES }).notNull().default("waiting"),
    checks: integer("checks").notNull().default(0),
    senderId: text("sender_id"),
    createdAt: createdAt(),
    completedAt: tz("completed_at"),
  },
  (t) => [index("follow_gates_account_idx").on(t.igAccountId, t.status)],
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

// ---------- Gonggu campaigns (default off) ----------
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  defaultEnabled: boolean("default_enabled").notNull().default(false),
  updatedAt: updatedAt(),
});

export const featureFlagOverrides = pgTable("feature_flag_overrides", {
  flagKey: text("flag_key").notNull().references(() => featureFlags.key, { onDelete: "cascade" }),
  igAccountId: uuid("ig_account_id").notNull().references(() => igAccounts.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(),
}, (t) => [primaryKey({ columns: [t.flagKey, t.igAccountId] })]);

export const planEntitlements = pgTable("plan_entitlements", {
  plan: text("plan").notNull(),
  key: text("key").notNull(),
  kind: text("kind", { enum: ["boolean", "limit"] }).notNull(),
  booleanValue: boolean("boolean_value"),
  limitValue: integer("limit_value"),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.plan, t.key] }),
  check("plan_entitlements_value_check", sql`(${t.kind} = 'boolean' and ${t.booleanValue} is not null and ${t.limitValue} is null) or (${t.kind} = 'limit' and ${t.booleanValue} is null and (${t.limitValue} is null or ${t.limitValue} >= 0))`),
]);

export const campaignPolicies = pgTable("campaign_policies", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
}, (t) => [check("campaign_policies_positive", sql`${t.value} > 0`)]);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  igAccountId: uuid("ig_account_id").notNull().references(() => igAccounts.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  brand: text("brand").notNull().default(""),
  slug: text("slug").notNull().unique(),
  status: text("status", { enum: CAMPAIGN_STATES }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  publicReplySequence: integer("public_reply_sequence").notNull().default(0),
  publishedAt: tz("published_at"),
  openAt: tz("open_at").notNull(),
  closeAt: tz("close_at").notNull(),
  openedAt: tz("opened_at"),
  closedAt: tz("closed_at"),
  settledAt: tz("settled_at"),
  archivedAt: tz("archived_at"),
  notificationKeywords: text("notification_keywords").array().notNull(),
  linkKeywords: text("link_keywords").array().notNull(),
  excludedKeywords: text("excluded_keywords").array().notNull().default(sql`'{}'::text[]`),
  matchType: text("match_type", { enum: ["contains", "exact"] }).notNull().default("contains"),
  templates: jsonb("templates").$type<CampaignTemplates>().notNull(),
  followOnly: boolean("follow_only").notNull().default(false),
  followFailurePolicy: text("follow_failure_policy", { enum: ["send_link", "hold"] }).notNull().default("send_link"),
  expiryFallbackEnabled: boolean("expiry_fallback_enabled").notNull().default(false),
  hourlyRate: integer("hourly_rate").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("campaigns_id_account_unique").on(t.id, t.igAccountId),
  index("campaigns_user_idx").on(t.userId, t.status),
  index("campaigns_due_idx").on(t.openAt, t.closeAt).where(sql`${t.publishedAt} is not null and ${t.status} in ('draft','teaser','open') and ${t.archivedAt} is null`),
  check("campaigns_dates_check", sql`${t.openAt} < ${t.closeAt}`),
  check("campaigns_rate_check", sql`${t.hourlyRate} between 1 and 750`),
  check("campaigns_state_check", sql`${t.status} in ('draft','teaser','open','closed','sold_out','settled')`),
]);

export const campaignProducts = pgTable("campaign_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  option: text("option").notNull().default(""),
  originalUrl: text("original_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: tz("archived_at"),
}, (t) => [index("campaign_products_campaign_idx").on(t.campaignId)]);

export const campaignMedia = pgTable("campaign_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  igAccountId: uuid("ig_account_id").notNull().references(() => igAccounts.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull(),
  permalink: text("permalink"),
  routingEnabled: boolean("routing_enabled").notNull().default(false),
  linkedAt: tz("linked_at").notNull().defaultNow(),
  releasedAt: tz("released_at"),
}, (t) => [
  foreignKey({ columns: [t.campaignId, t.igAccountId], foreignColumns: [campaigns.id, campaigns.igAccountId], name: "campaign_media_campaign_account_fk" }).onDelete("cascade"),
  uniqueIndex("campaign_media_pair_unique").on(t.campaignId, t.mediaId),
  uniqueIndex("campaign_media_routing_unique").on(t.igAccountId, t.mediaId).where(sql`${t.routingEnabled} = true`),
]);

export const campaignAuditEvents = pgTable("campaign_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  fromState: text("from_state"),
  toState: text("to_state"),
  version: integer("version").notNull(),
  requestId: text("request_id").notNull(),
  reason: text("reason").notNull(),
  effectiveAt: tz("effective_at").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("campaign_audit_request_unique").on(t.campaignId, t.requestId), index("campaign_audit_campaign_idx").on(t.campaignId, t.createdAt)]);

export type Campaign = typeof campaigns.$inferSelect;

export const campaignParticipants = pgTable("campaign_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  igAccountId: uuid("ig_account_id").notNull(),
  commenterIgId: text("commenter_ig_id").notNull(),
  recipientHash: text("recipient_hash").notNull(),
  firstEventId: uuid("first_event_id").references(() => commentEvents.id, { onDelete: "set null" }),
  firstCommentCreatedAt: tz("first_comment_created_at").notNull(),
  notificationRequestedAt: tz("notification_requested_at"),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.campaignId, t.igAccountId], foreignColumns: [campaigns.id, campaigns.igAccountId] }).onDelete("cascade"),
  unique("campaign_participants_person_key").on(t.campaignId, t.commenterIgId),
  unique("campaign_participants_identity_key").on(t.id, t.campaignId, t.igAccountId),
  check("campaign_participants_hash_check", sql`${t.recipientHash} ~ '^[a-f0-9]{64}$'`),
]);

export const dmJobs = pgTable("dm_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull(),
  igAccountId: uuid("ig_account_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  sourceEventId: uuid("source_event_id").references(() => commentEvents.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: SEND_CHANNELS }).notNull(),
  kind: text("kind", { enum: CAMPAIGN_JOB_KINDS }).notNull(),
  status: text("status", { enum: CAMPAIGN_JOB_STATES }).notNull().default("waiting"),
  scheduledAt: tz("scheduled_at").notNull(),
  nextAttemptAt: tz("next_attempt_at").notNull(),
  deadlineAt: tz("deadline_at").notNull(),
  hardExpiresAt: tz("hard_expires_at").notNull(),
  commentCreatedAt: tz("comment_created_at").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  publicTemplateIndex: integer("public_template_index").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseUntil: tz("lease_until"),
  leaseVersion: integer("lease_version").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  templateRevisionUsed: integer("template_revision_used"),
  providerMessageId: text("provider_message_id"),
  lastErrorCode: text("last_error_code"),
  completedAt: tz("completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ columns: [t.campaignId, t.igAccountId], foreignColumns: [campaigns.id, campaigns.igAccountId] }).onDelete("cascade"),
  foreignKey({ columns: [t.participantId, t.campaignId, t.igAccountId], foreignColumns: [campaignParticipants.id, campaignParticipants.campaignId, campaignParticipants.igAccountId] }).onDelete("cascade"),
  unique("dm_jobs_participant_key").on(t.id, t.participantId),
  index("dm_jobs_due_idx").on(t.nextAttemptAt).where(sql`${t.status} in ('waiting','retry')`),
  index("dm_jobs_account_edf_idx").on(t.igAccountId, t.channel, t.deadlineAt, t.commentCreatedAt, t.id).where(sql`${t.status} in ('waiting','retry')`),
  index("dm_jobs_campaign_status_idx").on(t.campaignId, t.status),
  index("dm_jobs_lease_idx").on(t.leaseUntil).where(sql`${t.status} in ('leased','sending')`),
  check("dm_jobs_channel_check", sql`${t.channel} in ('public_reply','private_reply','message')`),
  check("dm_jobs_status_check", sql`${t.status} in ('waiting','leased','sending','retry','sent','failed','expired','skipped_duplicate','canceled','held','unknown')`),
  check("dm_jobs_source_check", sql`${t.channel} = 'message' or ${t.sourceEventId} is not null`),
  check("dm_jobs_deadline_check", sql`${t.deadlineAt} <= ${t.hardExpiresAt}`),
]);

export const campaignDeliveries = pgTable("campaign_deliveries", {
  participantId: uuid("participant_id").notNull().references(() => campaignParticipants.id, { onDelete: "cascade" }),
  intent: text("intent", { enum: ["initial_contact", "link", "public_ack", "reminder"] }).notNull(),
  owningJobId: uuid("owning_job_id").notNull(),
  state: text("state", { enum: ["reserved", "sent", "failed", "unknown"] }).notNull().default("reserved"),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.participantId, t.intent] }),
  foreignKey({ columns: [t.owningJobId, t.participantId], foreignColumns: [dmJobs.id, dmJobs.participantId] }).onDelete("cascade"),
]);

/** One comment's private-reply right, shared by campaign and enabled legacy senders. */
export const privateReplyClaims = pgTable("private_reply_claims", {
  commentId: text("comment_id").primaryKey().references(() => commentEvents.commentId, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => dmJobs.id, { onDelete: "cascade" }),
  legacyEventId: uuid("legacy_event_id").references(() => commentEvents.id, { onDelete: "cascade" }),
  state: text("state", { enum: ["reserved", "sent", "unknown"] }).notNull().default("reserved"),
  createdAt: createdAt(),
}, (t) => [check("private_reply_claims_owner_check", sql`(${t.jobId} is null) <> (${t.legacyEventId} is null)`)]);

export type DmJob = typeof dmJobs.$inferSelect;
export type CampaignParticipant = typeof campaignParticipants.$inferSelect;

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
