import { Hono } from "hono";
import type { AppEnv } from "./types";
import { attachUser } from "./middleware/auth";
import authRoutes from "./routes/auth";
import outagesRoutes from "./routes/outages";
import { artifactById } from "./routes/artifacts";
import moderationRoutes from "./routes/moderation";
import adminRoutes from "./routes/admin";
import stockQuoteRoutes from "./routes/stockQuote";

const app = new Hono<AppEnv>();

app.use("*", attachUser);

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/auth", authRoutes);
app.route("/api/outages", outagesRoutes);
app.route("/api/artifacts", artifactById);
app.route("/api/moderation", moderationRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/stock-quote", stockQuoteRoutes);

export default app;
