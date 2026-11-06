import { PublicError } from "./errors.js";

// Check bounded QuickTime/ISO BMFF atom structure and a video media handler.
// This validates the container; the browser decides whether it can decode the codec.
export function inspectLivePhotoVideo(buffer: Buffer) {
  let videoTrack = false;
  let mediaData = false;
  let movie = false;
  let quickTime = false;
  let atoms = 0;
  const invalid = () => new PublicError(415, "INVALID_LIVE_PHOTO_VIDEO", "动态片段不是有效的 MOV 或 MP4 视频");
  const walk = (start: number, end: number, depth: number) => {
    for (let offset = start; offset < end;) {
      if (++atoms > 10_000 || offset + 8 > end) throw invalid();
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      let size = buffer.readUInt32BE(offset);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw invalid();
        const extended = buffer.readBigUInt64BE(offset + 8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
        size = Number(extended);
        header = 16;
      } else if (size === 0) size = end - offset;
      if (size < header || size > end - offset) throw invalid();
      const body = offset + header;
      if (depth === 0 && type === "ftyp" && size >= header + 8) {
        quickTime = buffer.toString("ascii", body, body + 4) === "qt  ";
      }
      if (depth === 0 && type === "mdat" && size > header) mediaData = true;
      if (depth === 0 && type === "moov") movie = true;
      if (depth === 3 && type === "hdlr" && size >= header + 12) {
        videoTrack ||= buffer.toString("ascii", body + 8, body + 12) === "vide";
      }
      if ((depth === 0 && type === "moov") || (depth === 1 && type === "trak") || (depth === 2 && type === "mdia")) {
        walk(body, offset + size, depth + 1);
      }
      offset += size;
    }
  };
  walk(0, buffer.byteLength, 0);
  if (!movie || !mediaData || !videoTrack) throw invalid();
  return { mime: quickTime ? "video/quicktime" : "video/mp4", extension: quickTime ? "mov" : "mp4" };
}

export function parseByteRange(value: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!value) return null;
  // Ignore unsupported multiple ranges, units and malformed syntax; send the full body.
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) return "unsatisfiable";
  if (size <= 0) return "unsatisfiable";
  if (first === undefined) {
    if (!last) return "unsatisfiable";
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== undefined && last < first)) return "unsatisfiable";
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
