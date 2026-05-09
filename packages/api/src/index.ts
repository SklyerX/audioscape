import "dotenv/config";

import { Hono } from "hono";
import authRoutes from "./routes/auth/routes";
import audioRoutes from "./routes/audio/route";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { auth } from "./lib/auth";
import apiKeysRoutes from "./routes/users/keys/routes";

const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>().basePath("/api");

app.use(
  "/v1/*",
  cors({
    origin: "*",
    allowMethods: ["GET"],
    allowHeaders: ["*"],
  }),
);

console.log(process.env.NODE_ENV);

app.use(
  "*",
  cors({
    origin:
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "https://audioscape.skylerx.ir",
    credentials: true, // if you use cookies/auth headers
  }),
);

app.use("*", async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    c.set("user", null);
    c.set("session", null);
  } else {
    c.set("user", session.user);
    c.set("session", session.session);
  }
  await next();
});

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.route("/auth", authRoutes);
app.route("/audio", audioRoutes);
app.route("/users/keys", apiKeysRoutes);

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 8888,
});
