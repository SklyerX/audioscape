import { createMiddleware } from "hono/factory";
import { db } from "../db";
import { verifyApiKey } from "../lib/crypto";
import { redis } from "../lib/redis";
import { apiKeys } from "../db/schema";
import { eq } from "drizzle-orm";

export const requireAPIKey = createMiddleware<{
  Variables: {
    apiKey: { luHash: string; webhookUrl: string | null };
  };
}>(async (c, next) => {
  const apiKey = c.req.header("Authorization")?.split("Bearer ").at(1);
  const key = apiKey?.split("as_live_").at(1);

  if (!apiKey || !key)
    return c.json({ success: false, error: "No API key provided" }, 401);

  const lu = key.slice(0, 8);

  const existingApiKey = await db.query.apiKeys.findFirst({
    where: (fields, { eq }) => eq(fields.luHash, lu),
  });

  if (!existingApiKey)
    return c.json({ success: false, error: "Invalid API Key" }, 401);

  const isValid = verifyApiKey(key, existingApiKey.completeHash);

  console.log(isValid);

  if (!isValid)
    return c.json({ success: false, error: "Invalid API Key" }, 401);

  if (existingApiKey.revokedAt)
    return c.json(
      {
        success: false,
        error: "This API key has been revoked",
        data: { revokedAt: existingApiKey.revokedAt },
      },
      401,
    );

  const now = Date.now();
  const expiresAt = existingApiKey.expiresAt;

  if (expiresAt && expiresAt.getTime() < now)
    return c.json({ success: false, error: "This key has been expired" }, 401);

  c.set("apiKey", { luHash: lu, webhookUrl: existingApiKey.webhookUrl });
  await next();

  const today = new Date().toISOString().slice(0, 10);
  const trackKey = `api-key:${lu}:usage:${today}`;
  await redis.hincrby(trackKey, c.req.path, 1);
  await redis.expire(trackKey, 30 * 24 * 60 * 60);

  await db
    .update(apiKeys)
    .set({
      lastUsedAt: new Date(),
    })
    .where(eq(apiKeys.luHash, lu));
});
