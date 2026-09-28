// Serves cached (resized, EXIF-stripped) media derivatives from CACHE_DIR.
// Originals in ASSETS_DIR are never reachable through this route.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { isSafeMediaRequest } from "@/lib/media-path-safety";
import { parseByteRange } from "@/lib/http-range";

// turbopackIgnore: this is a runtime data path (photo cache), not something
// to trace/bundle — without the hint Turbopack pulls the whole repo into
// the server output trying to statically resolve it.
const CACHE_DIR = resolve(
  /* turbopackIgnore: true */ process.env.CACHE_DIR ?? "./data/cache",
);

/**
 * A web stream over a file read stream that tolerates the client going away
 * mid-download (a navigation cancelling an image, a video seek): the file
 * stream is destroyed and any late chunk/end is dropped. Readable.toWeb
 * instead throws "Controller is already closed" from inside Node's stream
 * internals in that case — uncaught, which takes the whole server down.
 * Pull-based, so a slow client still applies backpressure.
 */
function fileWebStream(file: ReadStream): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      file.on("data", (chunk) => {
        if (closed) return;
        controller.enqueue(chunk as Buffer);
        if ((controller.desiredSize ?? 1) <= 0) file.pause();
      });
      file.on("end", () => {
        if (closed) return;
        closed = true;
        controller.close();
      });
      file.on("error", (err) => {
        if (closed) return;
        closed = true;
        controller.error(err);
      });
    },
    pull() {
      file.resume();
    },
    cancel() {
      closed = true;
      file.destroy();
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; file: string }> },
) {
  const { slug, file } = await params;

  if (!isSafeMediaRequest(slug, file)) {
    return new Response("Not found", { status: 404 });
  }

  const absPath = join(CACHE_DIR, slug, file);
  // Belt-and-suspenders: confirm the resolved path is still inside CACHE_DIR
  // even though the regexes above already rule out ".." and slashes.
  if (!resolve(absPath).startsWith(CACHE_DIR)) {
    return new Response("Not found", { status: 404 });
  }

  let size: number;
  try {
    size = (await stat(absPath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const baseHeaders = {
    "Content-Type": file.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  const range = parseByteRange(request.headers.get("range"), size);
  if (range) {
    const { start, end } = range;
    const stream = createReadStream(absPath, { start, end });
    return new Response(fileWebStream(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = createReadStream(absPath);
  return new Response(fileWebStream(stream), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
