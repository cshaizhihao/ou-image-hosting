import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.API_PORT ?? 4000);

app
  .listen({ host: "0.0.0.0", port })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
