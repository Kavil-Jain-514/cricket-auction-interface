/**
 * Loading images for client-side jsPDF exports.
 *
 * - Cloudinary serves CORS headers, so its images are fetched directly from the
 *   browser, resized and forced to JPEG. Only other hosts (Google Drive) go
 *   through /api/image-proxy, which has a per-user hourly quota and a response
 *   size limit, so sending every photo through it dropped photos on large
 *   tournaments.
 * - Loads run with limited concurrency rather than all at once.
 * - jsPDF only embeds JPEG and PNG. Anything else (WebP, GIF, AVIF…) is
 *   re-encoded to PNG through a canvas.
 */

export function isCloudinaryImage(url: string): boolean {
  return url.includes("res.cloudinary.com") && url.includes("/upload/");
}

export interface PdfImageOptions {
  /** Max width in px for Cloudinary images. Default 300. */
  width?: number;
  /** "png" keeps transparency (logos); "jpg" is smaller (photos). Default "jpg". */
  format?: "jpg" | "png";
}

/**
 * Cloudinary URL that returns a JPEG (or PNG) no wider than `width` px. If the
 * URL already starts with a transformation that has f_auto, that becomes the
 * chosen format so the two don't conflict. Other URLs are returned unchanged.
 */
export function pdfImageUrl(url: string, { width = 300, format = "jpg" }: PdfImageOptions = {}): string {
  if (!isCloudinaryImage(url)) return url;
  const [head, tail] = splitOnce(url, "/upload/");
  const firstSegment = tail.split("/")[0];
  if (/(^|,)f_auto(,|$)/.test(firstSegment)) {
    return `${head}/upload/${tail.replace("f_auto", `f_${format}`)}`;
  }
  const quality = format === "jpg" ? "q_80," : "";
  return `${head}/upload/f_${format},${quality}c_limit,w_${width}/${tail}`;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return [s.slice(0, i), s.slice(i + sep.length)];
}

/** Runs `fn` on every item with at most `limit` in flight. Results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Re-encodes any browser-decodable image as PNG (keeps transparency). */
function toPngDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) return resolve(null);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** jsPDF format for a data URL that is already JPEG or PNG, else null. */
export function pdfImageFormat(dataUrl: string): "JPEG" | "PNG" | null {
  if (/^data:image\/png/i.test(dataUrl)) return "PNG";
  if (/^data:image\/(jpeg|jpg)/i.test(dataUrl)) return "JPEG";
  return null;
}

async function fetchDataUrl(url: string): Promise<string | null> {
  if (isCloudinaryImage(url)) {
    const response = await fetch(url);
    if (!response.ok) return null;
    return blobToDataUrl(await response.blob());
  }
  const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { dataUrl?: string };
  return data.dataUrl ?? null;
}

/** A JPEG or PNG data URL ready for jsPDF addImage, or null if it can't be loaded. */
export async function loadPdfImage(url: string, options?: PdfImageOptions): Promise<string | null> {
  try {
    const dataUrl = await fetchDataUrl(pdfImageUrl(url, options));
    if (!dataUrl) return null;
    return pdfImageFormat(dataUrl) ? dataUrl : await toPngDataUrl(dataUrl);
  } catch {
    return null;
  }
}
