import { CnctError, CnctErrorCode } from '../errors.js';

/**
 * The web channel's limits on files, as the server enforces them.
 *
 * The server is the authority and refuses anything outside these; they are repeated here so an
 * interface can say "that file is over 50 MB" the moment it is picked, rather than after a person
 * has watched a progress bar crawl to the end of something that was never going to be accepted.
 */
export const CnctAttachmentLimits = Object.freeze({
  /** Files per message. */
  maxFiles: 10,
  /** Bytes per file. */
  maxBytes: 50 * 1024 * 1024,
  /** What the server accepts. HEIC and HEIF are not in it; see {@link prepareAttachment}. */
  types: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'audio/aac',
    'audio/mpeg',
    'audio/ogg',
    'audio/mp4',
    'audio/amr',
    'video/mp4',
    'video/3gpp',
    'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ] as const),
  /** A photo is downscaled to this on its long side before upload, and never upscaled. */
  maxImageSide: 2560,
  /** The JPEG quality a converted or downscaled photo is written at. */
  jpegQuality: 0.85,
});

/** Anything with the shape of a picked file. A `File` is one; so is a `Blob` with a name beside it. */
export interface CnctFileLike {
  readonly size: number;
  readonly type: string;
  readonly name?: string;
}

const HEIC = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

/** What a file's extension says it is, for the browsers and platforms that report no type at all. */
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  amr: 'audio/amr',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

/** The other names platforms give the accepted types. */
const ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-aac': 'audio/aac',
  'video/x-m4v': 'video/mp4',
};

/**
 * The type the server should be told a file is.
 *
 * The reported type first, because it is usually right. The extension where it is missing — Windows
 * and some Android pickers report nothing for a HEIC photo — or where it is a known mislabel: Windows
 * calls every `.csv` `application/vnd.ms-excel`, which the server would refuse for a file it accepts.
 */
export function attachmentMimeType(file: CnctFileLike): string {
  const reported = (file.type || '').toLowerCase().split(';')[0].trim();
  const extension = (file.name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const fromName = BY_EXTENSION[extension];
  if (ALIASES[reported]) return ALIASES[reported];
  if (isAccepted(reported) || HEIC.has(reported)) return reported;
  return fromName ?? reported;
}

function isAccepted(type: string): boolean {
  return (CnctAttachmentLimits.types as readonly string[]).includes(type);
}

/** True for a HEIC or HEIF photo — what iPhones take by default, and what the server refuses. */
export function isHeic(file: CnctFileLike): boolean {
  return HEIC.has(attachmentMimeType(file));
}

/**
 * Why a file cannot be sent, before a byte of it is uploaded — or null when it can.
 *
 * `alreadyPicked` is how many files are already waiting to go with the same message, so the
 * eleventh is refused rather than the whole set. HEIC counts as acceptable here when
 * `canConvertHeic` says this runtime can turn it into a JPEG; {@link prepareAttachment} does that.
 *
 * The codes are stable and the same on every CNCT SDK: `too_many`, `too_large` and
 * `unsupported_type`.
 */
export function attachmentProblem(
  file: CnctFileLike,
  options: { alreadyPicked?: number; canConvertHeic?: boolean } = {},
): CnctError | null {
  const name = file.name || 'That file';
  if ((options.alreadyPicked ?? 0) >= CnctAttachmentLimits.maxFiles) {
    return new CnctError(
      `Up to ${CnctAttachmentLimits.maxFiles} files at a time.`,
      CnctErrorCode.tooMany,
    );
  }
  if (file.size > CnctAttachmentLimits.maxBytes) {
    return new CnctError(`${name} is over 50 MB.`, CnctErrorCode.tooLarge);
  }
  const type = attachmentMimeType(file);
  if (isAccepted(type)) return null;
  if (HEIC.has(type) && (options.canConvertHeic ?? defaultImageTranscoder() !== null)) return null;
  return new CnctError(
    `${name} is a kind of file this chat does not take.`,
    CnctErrorCode.unsupportedType,
  );
}

/**
 * Re-encodes a photo as a JPEG no larger than `maxSide` on its long side.
 *
 * Resolves to the new JPEG, or to `null` when `force` is false and the image is already small
 * enough — in which case the original is sent untouched. Rejects when the image cannot be decoded.
 * Injectable so a runtime without a canvas (Node, a test) can still convert, with whatever image
 * library it has.
 */
export type CnctImageTranscoder = (
  image: Blob,
  options: { maxSide: number; quality: number; force: boolean },
) => Promise<Blob | null>;

/**
 * The browser's own decoder and a canvas, or null where there is neither.
 *
 * `createImageBitmap` applies the photo's EXIF orientation, so a portrait taken on a phone stays
 * portrait; drawing it onto a canvas also drops the EXIF block, location included, which is the
 * right thing to do to a photo about to be sent to a business. Safari decodes HEIC natively, which
 * is where HEIC photos come from; elsewhere a HEIC that cannot be decoded is refused in a sentence.
 */
export function defaultImageTranscoder(): CnctImageTranscoder | null {
  const scope = globalThis as unknown as {
    createImageBitmap?: (image: Blob) => Promise<ImageBitmap>;
    OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas;
    document?: Document;
  };
  if (typeof scope.createImageBitmap !== 'function') return null;
  if (typeof scope.OffscreenCanvas !== 'function' && !scope.document) return null;
  return async (image, { maxSide, quality, force }) => {
    const bitmap = await scope.createImageBitmap!(image);
    try {
      const long = Math.max(bitmap.width, bitmap.height);
      if (!force && long <= maxSide) return null;
      const scale = Math.min(1, maxSide / long);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (typeof scope.OffscreenCanvas === 'function') {
        const canvas = new scope.OffscreenCanvas(width, height);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
        return await canvas.convertToBlob({ type: 'image/jpeg', quality });
      }
      const canvas = scope.document!.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be encoded.'))),
          'image/jpeg',
          quality,
        ),
      );
    } finally {
      bitmap.close?.();
    }
  };
}

/** A file ready to upload: the bytes, the name and the type the server will be told. */
export interface CnctPreparedAttachment {
  blob: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Turns a picked file into what is uploaded.
 *
 * - **HEIC/HEIF becomes JPEG.** The server does not take it, and iPhones (and some Android phones)
 *   take every photo in it. The file name's extension follows: `IMG_0042.HEIC` goes up as
 *   `IMG_0042.jpg`.
 * - **A JPEG photo larger than 2560 px on its long side is downscaled** to it, at quality 0.85. A
 *   phone's 48-megapixel photo is a slow upload for a picture that will be looked at in a chat
 *   bubble; one already smaller is sent untouched, never upscaled and never re-encoded.
 * - **Everything else is left exactly as it is.** A PNG screenshot keeps its transparency and a GIF
 *   its animation.
 */
export async function prepareAttachment(
  file: Blob & { name?: string },
  options: { filename?: string; transcoder?: CnctImageTranscoder | null } = {},
): Promise<CnctPreparedAttachment> {
  const filename = options.filename ?? file.name ?? 'file';
  const mimeType = attachmentMimeType({ size: file.size, type: file.type, name: filename });
  const transcoder =
    options.transcoder === undefined ? defaultImageTranscoder() : options.transcoder;
  const settings = {
    maxSide: CnctAttachmentLimits.maxImageSide,
    quality: CnctAttachmentLimits.jpegQuality,
  };

  if (HEIC.has(mimeType)) {
    const refused = new CnctError(
      `${filename} is a HEIC photo, and this browser cannot turn it into a JPEG to send.`,
      CnctErrorCode.unsupportedType,
    );
    if (!transcoder) throw refused;
    let jpeg: Blob | null;
    try {
      jpeg = await transcoder(file, { ...settings, force: true });
    } catch {
      throw refused;
    }
    if (!jpeg) throw refused;
    return {
      blob: retype(jpeg, 'image/jpeg'),
      filename: asJpegName(filename),
      mimeType: 'image/jpeg',
    };
  }

  if (mimeType === 'image/jpeg' && transcoder) {
    try {
      const smaller = await transcoder(file, { ...settings, force: false });
      if (smaller) return { blob: retype(smaller, 'image/jpeg'), filename, mimeType };
    } catch {
      // A photo this runtime cannot decode is still a JPEG the server can take. Send it as it is.
    }
  }

  return { blob: retype(file, mimeType), filename, mimeType };
}

function asJpegName(filename: string): string {
  return /\.[^./\\]+$/.test(filename) ? filename.replace(/\.[^./\\]+$/, '.jpg') : `${filename}.jpg`;
}

/** The same bytes under the type the server should see. `slice` shares them rather than copying. */
function retype(blob: Blob, type: string): Blob {
  return blob.type === type ? blob : blob.slice(0, blob.size, type);
}

// ── Uploading ──────────────────────────────────────────────────────────────────────────────────

export interface CnctUploadRequest {
  url: string;
  /** The visitor token travels here, on `x-chat-token`, never in the URL. */
  headers: Record<string, string>;
  /** Sent as the one multipart part, named `file`. */
  file: Blob;
  filename: string;
  /** 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface CnctUploadResponse {
  status: number;
  /** The decoded JSON body, or `{}` where there was none. */
  body: unknown;
}

/**
 * How a file goes up. The default is chosen per runtime — see {@link defaultUploader} — and a
 * different one can be passed as `uploader` in the config: for a test, for a fake CNCT, or for an
 * app that already has an upload queue of its own.
 */
export type CnctUploader = (request: CnctUploadRequest) => Promise<CnctUploadResponse>;

/**
 * `XMLHttpRequest` in a browser, because it is the only request a browser lets report **upload**
 * progress — `fetch` reports the download, and streaming a request body is Chromium-only and
 * HTTP/2-only. A photo over a phone's data takes long enough to need the bar. Everywhere else,
 * {@link fetchUploader}.
 */
export function defaultUploader(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
): CnctUploader {
  if (typeof (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest === 'function') {
    return xhrUploader;
  }
  return fetchUploader(fetch);
}

/** The browser path. One `file` part in a `FormData`, which sets its own boundary. */
export const xhrUploader: CnctUploader = (request) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0)
        request.onProgress?.(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let body: unknown = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        // A proxy's error page rather than CNCT's answer. The status still says what happened.
      }
      if (xhr.status >= 200 && xhr.status < 300) request.onProgress?.(1);
      resolve({ status: xhr.status, body });
    });
    xhr.addEventListener('error', () =>
      reject(new CnctError('Could not reach the chat service.', CnctErrorCode.offline)),
    );
    xhr.addEventListener('abort', () =>
      reject(new CnctError('The upload was cancelled.', CnctErrorCode.cancelled)),
    );
    if (request.signal) {
      if (request.signal.aborted) return xhr.abort();
      request.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append('file', request.file, request.filename);
    request.onProgress?.(0);
    xhr.send(form);
  });

/**
 * The path for Node, and for anything else without `XMLHttpRequest`.
 *
 * In Node the multipart body is written by hand and handed to `fetch` as a stream, so progress is
 * the share of it `fetch` has pulled — which, with the backpressure a socket applies, is the share
 * that has left. Where request streams are not a thing (a service worker in Firefox or Safari), the
 * same body goes as one buffer, and progress is reported at the start and at the end.
 */
export function fetchUploader(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
): CnctUploader {
  return async (request) => {
    const boundary = `----cnct${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeFilename(request.filename)}"\r\n` +
        `Content-Type: ${request.file.type || 'application/octet-stream'}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const bytes = new Uint8Array(await request.file.arrayBuffer());
    const total = head.length + bytes.length + tail.length;
    const body = new Uint8Array(total);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);

    const headers = {
      ...request.headers,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers,
      signal: request.signal ?? null,
    };
    const isNode = Boolean(
      (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node,
    );
    request.onProgress?.(0);
    if (isNode && typeof ReadableStream === 'function') {
      const chunk = 64 * 1024;
      let sent = 0;
      init.body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= total) return controller.close();
          const next = body.subarray(sent, Math.min(total, sent + chunk));
          sent += next.length;
          controller.enqueue(next);
          request.onProgress?.(Math.min(0.99, sent / total));
        },
      });
      init.duplex = 'half';
    } else {
      init.body = body;
    }

    let response: Response;
    try {
      response = await fetch(request.url, init);
    } catch (cause) {
      if (request.signal?.aborted) {
        throw new CnctError('The upload was cancelled.', CnctErrorCode.cancelled);
      }
      throw new CnctError(
        `Could not reach the chat service: ${cause instanceof Error ? cause.message : String(cause)}`,
        CnctErrorCode.offline,
      );
    }
    const decoded = (await response.json().catch(() => ({}))) as unknown;
    if (response.ok) request.onProgress?.(1);
    return { status: response.status, body: decoded };
  };
}

/** As browsers write a multipart file name: quotes and line breaks percent-encoded, the rest UTF-8. */
function escapeFilename(name: string): string {
  return name.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
