// Serves cached (resized, EXIF-stripped) media derivatives from CACHE_DIR.
// Originals in ASSETS_DIR are never reachable through this route.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { isSafeMediaRequest } from "@/lib/media-path-safety";

// turbopackIgnore: this is a runtime data path (photo cache), not something
// to trace/bundle — without the hint Turbopack pulls the whole repo into
// the server output trying to statically resolve it.
const CACHE_DIR = resolve(
  /* turbopackIgnore: true */ process.env.CACHE_DIR ?? "./data/cache",
);

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

  const range = request.headers.get("range");
  const baseHeaders = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start < size && end < size && start <= end) {
        const stream = createReadStream(absPath, { start, end });
        return new Response(webStreamFrom(stream), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }
  }

  const stream = createReadStream(absPath);
  return new Response(webStreamFrom(stream), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}

function webStreamFrom(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      if ("destroy" in nodeStream && typeof nodeStream.destroy === "function") {
        nodeStream.destroy();
      }
    },
  });
}
