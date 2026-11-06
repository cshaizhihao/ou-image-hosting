import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = process.env.OU_CONTAINER_SMOKE_ORIGIN;
assert(origin, "Set OU_CONTAINER_SMOKE_ORIGIN to a fresh, disposable test stack");
const base = new URL(origin);
assert(["localhost", "127.0.0.1"].includes(base.hostname), "Smoke tests must target loopback");
let cookie = "";
async function request(path, init = {}, status = 200) {
  const headers = new Headers(init.headers);
  headers.set("origin", "http://localhost:3290");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(new URL(path, base), { ...init, headers, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, status, `${init.method ?? "GET"} ${path} returned ${response.status}`);
  return response;
}
async function json(path, method, body, status = 200) {
  return request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, status);
}
assert.equal((await (await request("/api/setup/status")).json()).setupComplete, false, "Refusing to use an initialized stack");
const setup = await json("/api/setup", "POST", { siteName: "Container smoke", displayName: "CI Owner", email: "ci@example.invalid", password: "Container-Smoke-2026!" }, 201);
cookie = setup.headers.get("set-cookie")?.split(";")[0] ?? "";
assert(cookie.startsWith("ou_session="));
await request("/api/auth/session");
const still = await readFile(new URL("../apps/web/public/brand/ou-image-hosting-logo.jpg", import.meta.url));
const video = await readFile(new URL("../apps/api/test-fixtures/live-preview.mp4", import.meta.url));
async function upload(live = false) {
  const form = new FormData();
  form.append("file", new Blob([still], { type: "image/jpeg" }), "IMG_001.jpg");
  if (live) form.append("livePhotoVideo", new Blob([video], { type: "video/mp4" }), "IMG_001.mp4");
  return (await request(live ? "/api/public/uploads" : "/api/uploads", { method: "POST", body: form }, 201)).json();
}
const first = await upload();
await request(first.image.thumbnailUrl);
await json("/api/site/settings", "PATCH", { publicUploadLivePhotoEnabled: true });
const motion = await upload(true);
assert(motion.image.liveVideoUrl);
const partial = await request(motion.image.liveVideoUrl, { headers: { range: "bytes=0-15" } }, 206);
assert.equal((await partial.arrayBuffer()).byteLength, 16);
assert.equal(partial.headers.get("content-range"), `bytes 0-15/${video.byteLength}`);
await json("/api/storage/settings", "PATCH", { delivery: { signedUrls: true } });
const library = await (await request("/api/uploads")).json();
const signed = new URL(library.images[0].originalUrl, base);
signed.searchParams.set("v", "container-smoke");
await request(signed.pathname + signed.search);
await request(`/api/files/${first.image.id}/original`, {}, 403);
console.log("Production containers passed setup, session, upload, thumbnail, Live Photo, byte range and signed-link smoke checks.");
