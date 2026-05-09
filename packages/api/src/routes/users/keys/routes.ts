import { Hono } from "hono";
import { isAuthenticated } from "../../../middlewares/is-authenticated";
import { auth } from "../../../lib/auth";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { db } from "../../../db";
import { apiKeys, user, webhookDeliveries } from "../../../db/schema";
import {
  generateApiKey,
  generateWebhookSecret,
  signPayload,
} from "../../../lib/crypto";
import { and, desc, eq } from "drizzle-orm";
import { redis } from "../../../lib/redis";

const apiKeysRoutes = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

apiKeysRoutes.get("/all", isAuthenticated, async (c) => {
  const user = c.get("user");

  const apiKeys = await db.query.apiKeys.findMany({
    where: (fields, { eq }) => eq(fields.userId, user.id),
    columns: {
      completeHash: false,
      luHash: false,
      webhookSecret: false,
      userId: false,
    },
  });

  return c.json({ success: true, data: apiKeys });
});

const EXPIRY_MAP = {
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "6m": 6 * 30 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
};

function getExpireAt(expiry: keyof typeof EXPIRY_MAP) {
  const duration = EXPIRY_MAP[expiry];
  if (!duration) {
    throw new Error("Invalid expiry value");
  }
  return Date.now() + duration;
}

apiKeysRoutes.post(
  "/create",
  isAuthenticated,
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(50),
      webhookUrl: z.url().nullable(),
      expiresAt: z.enum(["24h", "1w", "1m", "6m", "1y"]).nullable(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const { name, webhookUrl, expiresAt } = c.req.valid("json");

    const { completeHash, display_key, lu_hash } = generateApiKey();
    const webhookSecret = generateWebhookSecret();

    await db.insert(apiKeys).values({
      completeHash,
      luHash: lu_hash,
      name,
      userId: user.id,
      webhookUrl,
      webhookSecret,
      expiresAt: !expiresAt ? null : new Date(getExpireAt(expiresAt)),
    });

    return c.json({
      success: true,
      data: {
        display_key,
        webhook_secret: webhookSecret,
      },
    });
  },
);

apiKeysRoutes.patch(
  "/update/:id",
  isAuthenticated,
  zValidator(
    "param",
    z.object({
      id: z.string(),
    }),
  ),
  zValidator(
    "json",
    z.object({
      name: z.string().optional(),
      webhookUrl: z.url().optional(),
      expiresAt: z
        .enum(["24h", "1w", "1m", "6m", "1y", "never"])
        .nullable()
        .optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const { name, webhookUrl, expiresAt } = c.req.valid("json");
    const { id } = c.req.valid("param");

    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;

    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;

    if (expiresAt !== undefined)
      updates.expiresAt =
        !expiresAt || expiresAt === "never"
          ? null
          : new Date(getExpireAt(expiresAt));

    if (Object.keys(updates).length === 0)
      return c.json(
        { success: false, error: "At least one field required for updates" },
        400,
      );

    await db
      .update(apiKeys)
      .set(updates)
      .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.id, id)));

    return c.json({ success: true, message: "Updated" });
  },
);

apiKeysRoutes.delete(
  "/delete/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.id, id)));

    return c.json({ success: true, message: "Deleted API Key" });
  },
);

apiKeysRoutes.post(
  "/revoke/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    await db
      .update(apiKeys)
      .set({
        revokedAt: new Date(),
      })
      .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.id, id)));

    return c.json({ success: true, message: "API Key revoked" });
  },
);

apiKeysRoutes.post(
  "/rotate-secret/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.coerce.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    const key = await db.query.apiKeys.findFirst({
      where: (fields, { and, eq }) =>
        and(eq(fields.userId, user.id), eq(apiKeys.id, id)),
    });

    if (!key) return c.json({ success: false, error: "No API Key found" }, 404);

    const webhook_secret = generateWebhookSecret();

    await db
      .update(apiKeys)
      .set({
        webhookSecret: webhook_secret,
      })
      .where(and(eq(apiKeys.userId, user.id), eq(apiKeys.id, key.id)));

    return c.json({ success: true, data: { webhook_secret } });
  },
);

apiKeysRoutes.post(
  "/test-webhook/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.coerce.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    const key = await db.query.apiKeys.findFirst({
      where: (fields, { and, eq }) =>
        and(eq(fields.userId, user.id), eq(apiKeys.id, id)),
    });

    if (!key) return c.json({ success: false, error: "No API Key found" }, 404);

    const WEBHOOK_TIMEOUT_MS = 5000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const start = Date.now();
    let status: "success" | "failed" | "timeout" = "failed";
    let statusCode: number | undefined;
    let errorMessage: string | undefined;

    const data = {
      MESSAGE_NOT_IN_PROD:
        "This is a test identifier, you're not in production this is demo data.",
      artist: "Artist",
      trackKey: "trackKey",
      trackName: "Track Name",
      duration_ms: 1000,
      tempo: 120,
      key: 7,
      keyString: "G major",
      mode: 1,
      timeSignature: 4,
      energy: 0.51,
      liveness: 0.36,
      danceability: 0.59,
      instrumentalness: 0.97,
      speechiness: 0.02,
      valence: 0.17,
      arousal: 0.29,
      approachability: 0.62,
      engagement: 0.67,
      mood: {
        happy: 0.41,
        sad: 0.17,
        relaxed: 0.52,
        aggressive: 0.86,
      },
      meta: {
        artist: "Artist",
        track: "Track",
      },
    };

    const body = JSON.stringify(data);
    const signature = signPayload(body, key.webhookSecret as string);

    try {
      const res = await fetch(key.webhookUrl as string, {
        method: "POST",
        body: body,
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        signal: controller.signal,
      });

      statusCode = res.status;
      status = res.ok ? "success" : "failed";
      if (!res.ok) errorMessage = `HTTP ${res.status}`;
    } catch (err: any) {
      status = err.name === "AbortError" ? "timeout" : "failed";
      errorMessage = err.message;
    } finally {
      clearTimeout(timer);
      await db.insert(webhookDeliveries).values({
        webhookUrl: key.webhookUrl as string,
        luHash: key.luHash,
        status,
        statusCode,
        errorMessage,
        duration: Date.now() - start,
        requestPayload: data,
        requestHeaders: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
      });
    }

    return c.json({ success: true, message: "Webhook posted" });
  },
);

apiKeysRoutes.get(
  "/view/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.coerce.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    const key = await db.query.apiKeys.findFirst({
      where: (fields, { and, eq }) =>
        and(eq(fields.userId, user.id), eq(apiKeys.id, id)),
    });

    if (!key) return c.json({ success: false, error: "No API Key found" }, 404);

    const usageKeys: string[] = [];
    let cursor = 0;
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `api-key:${key.luHash}:usage:*`,
        "COUNT",
        100,
      );
      cursor = Number(next);
      usageKeys.push(...keys);
    } while (cursor !== 0);

    const pipeline = redis.pipeline();
    for (const k of usageKeys) pipeline.hgetall(k);
    const results = await pipeline.exec();

    const daily = usageKeys.map((k, i) => {
      const date = k.split(":").at(-1)!;
      const paths = (results?.[i]?.[1] ?? {}) as Record<string, string>;
      return {
        date,
        paths: Object.fromEntries(
          Object.entries(paths).map(([p, v]) => [p, Number(v)]),
        ),
        total: Object.values(paths).reduce((s, v) => s + Number(v), 0),
      };
    });

    daily.sort((a, b) => a.date.localeCompare(b.date));

    return c.json({
      success: true,
      data: {
        id: key.id,
        name: key.name,
        webhookUrl: key.webhookUrl,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        revokedAt: key.revokedAt,
        usage: daily,
      },
    });
  },
);

apiKeysRoutes.get(
  "/deliveries/:id",
  isAuthenticated,
  zValidator("param", z.object({ id: z.coerce.string() })),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");

    const key = await db.query.apiKeys.findFirst({
      where: (fields, { and, eq }) =>
        and(eq(fields.userId, user.id), eq(fields.id, id)),
      columns: { luHash: true },
    });

    if (!key) return c.json({ success: false, error: "No API Key found" }, 404);

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.luHash, key.luHash))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);

    return c.json({ success: true, data: deliveries });
  },
);

export default apiKeysRoutes;
