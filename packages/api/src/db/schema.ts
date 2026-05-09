import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
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
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackKey: text("track_key").notNull().unique(),
    artist: text("artist").notNull(),
    trackName: text("track_name").notNull(),
    duration_ms: integer("duration_ms"),
    acousticness: doublePrecision("acousticness"),
    danceability: doublePrecision("danceability"),
    energy: doublePrecision("energy"),
    instrumentalness: doublePrecision("instrumentalness"),
    key: integer("key"),
    liveness: doublePrecision("liveness"),
    loudness: doublePrecision("loudness"),
    mode: integer("mode"),
    speechiness: doublePrecision("speechiness"),
    tempo: doublePrecision("tempo"),
    timeSignature: integer("time_signature"),
    valence: doublePrecision("valence"),
    analyzedAt: timestamp("analyzed_at").defaultNow(),
    metadata: jsonb("metadata").$type<{
      album_cover: string;
      [key: string]: unknown;
    }>(),
  },
  (table) => [uniqueIndex("track_key_idx").on(table.trackKey)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    luHash: text("lu_hash").notNull().unique(),
    completeHash: text("complete_hash").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    webhookSecret: text("webhook_secret"),
    webhookUrl: text("webhook_url"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("lu_hash_idx").on(t.luHash)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    luHash: text("lu_hash")
      .notNull()
      .references(() => apiKeys.luHash, { onDelete: "cascade" }),
    webhookUrl: text("webhook_url").notNull(),
    status: text("status", {
      enum: ["success", "failed", "timeout"],
    }).notNull(),
    statusCode: integer("status_code"),
    errorMessage: text("error_message"),
    duration: integer("duration_ms"),
    requestPayload: jsonb("request_payload"),
    requestHeaders: jsonb("request_headers"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_webhook_deliveries_lu_hash").on(t.luHash)],
);
