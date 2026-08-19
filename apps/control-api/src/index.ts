import { createApp } from "./app.ts";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: (request) => app.fetch(request),
});

console.log(`rostrum-control-api listening on http://127.0.0.1:${port}`);
