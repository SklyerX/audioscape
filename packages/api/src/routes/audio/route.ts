import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { generateTrackId, signPayload } from "../../lib/crypto";
import { calculateMatchScore } from "../../lib";
import { db } from "../../db";
import { audio_queue } from "../../lib/queue";
import { redis } from "../../lib/redis";
import { apiKeys, tracks, webhookDeliveries } from "../../db/schema";
import { requireAPIKey } from "../../middlewares/is-valid-key";
import { inArray } from "drizzle-orm";

const audioRoutes = new Hono<{
  Variables: {
    apiKey: { luHash: string; webhookUrl: string | null };
  };
}>();

audioRoutes.get(
  "/search",
  requireAPIKey,
  zValidator(
    "query",
    z.object({
      artist: z
        .string()
        .transform((val) => val.trim().replace(/\s+/g, "+"))
        .refine((val) => /^[A-Za-z0-9&'-+]+$/.test(val), {
          message: "Invalid characters in track name.",
        })
        .optional(),
      track: z
        .string()
        .transform((val) => val.trim().replace(/\s+/g, "+"))
        .refine((val) => /^[A-Za-z0-9&'-+]+$/.test(val), {
          message: "Invalid characters in track name.",
        }),
    }),
  ),
  async (c) => {
    const { artist, track: queryTrack } = c.req.valid("query");

    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${queryTrack}${artist ? `&artist=${artist}` : ""}&api_key=${process.env.LAST_FM_API_KEY!}&format=json`,
    );

    if (!res.ok)
      return c.json(
        {
          success: false,
          message: "Something went wrong fetching tracks for this query",
        },
        500,
      );

    const data = await res.json();

    const tracks = [];

    const pipeline = redis.pipeline();

    for (const track of data.results.trackmatches.track) {
      const trackName = track.name;
      const trackArtist = track.artist;

      const thumbnail = track.image.find(
        (x: { size: string }) => x.size === "extralarge" || x.size === "large",
      );

      let thumbnailUrl: string;

      if (thumbnail["#text"]) thumbnailUrl = thumbnail["#text"];
      else thumbnailUrl = "Not found";

      const trackKey = generateTrackId(trackArtist, trackName);

      const score = artist
        ? calculateMatchScore(queryTrack, trackName, artist, trackArtist)
        : calculateMatchScore(queryTrack, trackName);

      tracks.push({
        trackName,
        artist: trackArtist,
        thumbnailUrl,
        trackKey,
        match_score: score,
      });

      pipeline.set(
        `track:${trackKey}`,
        JSON.stringify({ track: trackName, artist: trackArtist }),
        "EX",
        86400,
      );
    }

    await pipeline.exec();

    const seen = new Map<string, (typeof tracks)[0]>();

    for (const track of tracks) {
      const key = `${track.artist.toLowerCase()}:${track.trackName
        .toLowerCase()
        .replace(/[\s\-–()[\]]+.*/g, "")
        .trim()}`;

      if (!seen.has(key) || track.match_score > seen.get(key)!.match_score) {
        seen.set(key, track);
      }
    }

    return c.json({
      success: true,
      data: Array.from(seen.values()).sort(
        (a, b) => b.match_score - a.match_score,
      ),
    });
  },
);

audioRoutes.get(
  "/analysis/:trackKey",
  requireAPIKey,
  zValidator("param", z.object({ trackKey: z.string().min(16).max(16) })),
  async (c) => {
    const apiKey = c.get("apiKey");

    const { trackKey } = c.req.valid("param");

    const savedCache = await redis.get(`saved:${trackKey}`);

    if (savedCache)
      return c.json({ success: true, data: JSON.parse(savedCache) });

    const audioStats = await db.query.tracks.findFirst({
      where: (fields, { eq }) => eq(fields.trackKey, trackKey),
      columns: {
        id: false,
        analyzedAt: false,
        trackKey: false,
      },
    });

    if (audioStats) {
      await redis.set(`saved:${trackKey}`, JSON.stringify(audioStats));
      return c.json({ success: true, data: audioStats });
    }

    const inflight = await audio_queue.getJob(trackKey);

    if (inflight) {
      if (apiKey.webhookUrl) {
        await redis.rpush(trackKey, apiKey.luHash);
      }

      const positionIndex = (
        await audio_queue.getJobs("waiting", 0, -1)
      ).findIndex((x) => x.id === trackKey);

      return c.json({
        success: true,
        message: "Track is currently being processed, please wait.",
        data: { ...inflight.data, queuePosition: positionIndex },
      });
    }

    const cache = await redis.get(`track:${trackKey}`);

    if (!cache)
      return c.json(
        {
          success: false,
          message:
            "No metadata was found for this track, failed to queue analysis",
        },
        409,
      );

    const parsed_cache = JSON.parse(cache);

    await audio_queue.add(
      "analyze-audio",
      {
        trackKey,
        artist: parsed_cache.artist,
        track: parsed_cache.track,
      },
      {
        jobId: trackKey,
      },
    );

    if (apiKey.webhookUrl) {
      await redis.sadd(`webhooks:${trackKey}`, apiKey.luHash);
    }

    return c.json({
      success: true,
      message: "Track has been queued for analysis.",
    });
  },
);

audioRoutes.post(
  "/ingest/:trackKey",
  zValidator(
    "json",
    z.object({
      duration_ms: z.number(),
      tempo: z.number(),
      key: z.number(),
      keyString: z.string(),
      mode: z.number(),
      timeSignature: z.number(),
      energy: z.number(),
      liveness: z.number(),
      danceability: z.number(),
      instrumentalness: z.number(),
      speechiness: z.number(),
      valence: z.number(),
      arousal: z.number(),
      approachability: z.number(),
      engagement: z.number(),
      mood: z.object({
        happy: z.number(),
        sad: z.number(),
        relaxed: z.number(),
        aggressive: z.number(),
      }),
      meta: z.object({ artist: z.string(), track: z.string() }),
    }),
  ),
  async (c) => {
    const data = c.req.valid("json");
    const trackKey = c.req.param("trackKey");

    const serverKey = c.req.header("X-Server-Key");

    if (serverKey !== process.env.SERVER_KEY)
      return c.json({ success: false, message: "Unauthorized" }, 401);

    const dto = {
      artist: data.meta.artist,
      trackKey,
      trackName: data.meta.track,
      ...data,
    };

    await db.insert(tracks).values(dto).onConflictDoNothing();

    const notify = await redis.smembers(`webhooks:${trackKey}`);

    const WEBHOOK_TIMEOUT_MS = 5000;

    if (notify?.length > 0) {
      console.log(notify);

      const urls = await db
        .select()
        .from(apiKeys)
        .where(inArray(apiKeys.luHash, notify));

      const results = await Promise.allSettled(
        urls.map(async (url) => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            WEBHOOK_TIMEOUT_MS,
          );

          const start = Date.now();
          let status: "success" | "failed" | "timeout" = "failed";
          let statusCode: number | undefined;
          let errorMessage: string | undefined;

          const body = JSON.stringify(data);
          const signature = signPayload(body, url.webhookSecret as string);

          try {
            const res = await fetch(url.webhookUrl as string, {
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

            // if (!res.ok) throw new Error(`Webhook failed: ${res.status}`);
          } catch (err: any) {
            status = err.name === "AbortError" ? "timeout" : "failed";
            errorMessage = err.message;
          } finally {
            clearTimeout(timer);
            await db.insert(webhookDeliveries).values({
              webhookUrl: url.webhookUrl as string,
              luHash: url.luHash,
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
        }),
      );

      // optional: log failures
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("Webhook delivery failed:", result.reason);
        }
      }
    }

    await redis.set(`saved:${trackKey}`, JSON.stringify(dto));

    return c.text("OK");
  },
);

export default audioRoutes;
