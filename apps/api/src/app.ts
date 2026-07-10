import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn"
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "ou-image-api",
    version: "0.2.0"
  }));

  return app;
}
