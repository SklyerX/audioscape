import { createHash, createHmac, randomBytes } from "crypto";

export const generateTrackId = (artist: string, track: string) => {
  const normalized = `${artist.toLowerCase().trim()}:${track.toLowerCase().trim()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
};

export const generateApiKey = () => {
  const raw = randomBytes(32).toString("hex");
  const lu_hash = raw.slice(0, 8);
  const completeHash = createHash("sha256").update(raw).digest("hex");
  const display_key = `as_live_${raw}`;

  return { lu_hash, completeHash, display_key };
};

export const generateWebhookSecret = () => {
  return `whsec_${randomBytes(32).toString("hex")}`;
};

export const verifyApiKey = (incoming: string, storedHash: string) => {
  const hash = createHash("sha256").update(incoming).digest("hex");
  return hash === storedHash;
};

export const signPayload = (payload: string, secret: string) => {
  return createHmac("sha256", secret).update(payload).digest("hex");
};
