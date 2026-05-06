/**
 * Compresses image blobs before upload to Supabase Storage.
 * Skips PDFs and very small images (<200 KB).
 */
import imageCompression from "browser-image-compression";

const SKIP_BELOW_BYTES = 200 * 1024; // 200 KB
const DEFAULT_OPTIONS = {
  maxSizeMB: 0.6,           // target ~600 KB
  maxWidthOrHeight: 1800,   // enough for passport scans
  useWebWorker: false,      // Web Workers can hang silently in proxied/CSP-restricted envs
  initialQuality: 0.82,
  fileType: "image/jpeg",
};

const COMPRESS_TIMEOUT_MS = 12_000; // 12 s — fail-safe jika kompresi stuck

export async function compressIfImage(blob: Blob, contentType: string): Promise<Blob> {
  if (!contentType.startsWith("image/")) return blob;
  if (contentType === "image/gif") return blob;
  if (blob.size < SKIP_BELOW_BYTES) return blob;
  try {
    const file = new File([blob], "upload", { type: contentType });
    const compressionPromise = imageCompression(file, DEFAULT_OPTIONS);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("compress timeout")), COMPRESS_TIMEOUT_MS),
    );
    const compressed = await Promise.race([compressionPromise, timeoutPromise]);
    if (compressed.size < blob.size) return compressed;
    return blob;
  } catch (err) {
    console.warn("[imageCompress] failed, using original", err);
    return blob;
  }
}
