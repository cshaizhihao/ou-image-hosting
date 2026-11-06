import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const sharp = require("sharp");
const origin = "http://127.0.0.1:3280";

export async function seedPreview() {
  // This module only addresses the loopback preview, never a configurable remote URL.
  const status = await (await fetch(`${origin}/api/setup/status`)).json();
  if (status.setupComplete) return;
  const response = await fetch(`${origin}/api/setup`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ siteName: "OU-Image Hosting", displayName: "预览体验员", email: "preview@ou.local", password: "OuPreview!2026Local", theme: "light" })
  });
  if (!response.ok) throw new Error("无法创建本机预览账号。");
  const cookie = response.headers.getSetCookie()[0].split(";")[0];
  const headers = { cookie, origin, "content-type": "application/json" };
  await fetch(`${origin}/api/me`, { method: "PATCH", headers, body: JSON.stringify({ onboardingCompleted: true }) });
  const albums = [];
  for (const [name, description] of [["山野与远方", "留住旅途中的光与风景"], ["日常灵感", "收集生活里值得记住的片刻"], ["设计素材", "为下一次创作准备好素材"]]) {
    const result = await fetch(`${origin}/api/albums`, { method: "POST", headers, body: JSON.stringify({ name, description }) });
    if (result.ok) albums.push((await result.json()).album.id);
  }
  const photos = [
    ["photo-1470071459604-3b5ec3a7fe05", "山间晨雾.jpg"],
    ["photo-1441974231531-c6227db76b6e", "林间光影.jpg"],
    ["photo-1500534623283-312aade485b7", "走向远方.jpg"],
    ["photo-1464822759023-ddc71c834c4f", "群山之间.jpg"],
    ["photo-1493246507139-91e8fad9978e", "湖畔时光.jpg"],
    ["photo-1518837695005-2083093ee35b", "海风来信.jpg"]
  ];
  for (let index = 0; index < 15; index++) {
    const [photo, title] = photos[index % photos.length];
    let buffer;
    if (index < photos.length && process.env.OU_PREVIEW_SAMPLE_PHOTOS === "1") {
      try {
        const result = await fetch(`https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1200&q=80`, { signal: AbortSignal.timeout(8000) });
        if (result.ok && Number(result.headers.get("content-length") || 0) < 4000000) {
          const bytes = Buffer.from(await result.arrayBuffer());
          if (bytes.length < 4000000) buffer = bytes;
        }
      } catch {}
    }
    if (!buffer) {
      const colors = [["#c8d9cb", "#638a71"], ["#d7deed", "#7e91b0"], ["#e9d0b4", "#af8761"], ["#dacfe3", "#9b84ae"]][index % 4];
      const width = index % 3 === 0 ? 960 : 1200;
      const height = index % 3 === 0 ? 1200 : 800;
      buffer = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="${colors[0]}"/><circle cx="${280 + index * 29}" cy="230" r="95" fill="#fff3d7"/><path d="M0 650L380 260L700 620L1000 290L1200 500V800H0Z" fill="${colors[1]}"/><path d="M0 700L490 510L900 680L1200 550V800H0Z" fill="#263b3a" opacity=".35"/></svg>`)).jpeg().toBuffer();
    }
    const name = index < photos.length ? title : `灵感画面 ${String(index - 5).padStart(2, "0")}.jpg`;
    const form = new FormData(); form.append("file", new Blob([buffer], { type: "image/jpeg" }), name);
    const upload = await fetch(`${origin}/api/uploads`, { method: "POST", headers: { cookie, origin }, body: form });
    if (!upload.ok) continue;
    const { image } = await upload.json();
    await fetch(`${origin}/api/uploads/${image.id}/organization`, { method: "PATCH", headers, body: JSON.stringify({ albumIds: albums.length ? [albums[index % albums.length]] : [], favorite: index % 4 === 0 }) });
  }
}
