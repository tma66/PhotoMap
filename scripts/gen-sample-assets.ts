// Generates assets/example/: a handful of synthetic (not real photos, no
// copyright concerns), geotagged JPEGs so ingestion + the UI have something
// to render out of the box. Safe to re-run; overwrites its own output only.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
// @ts-expect-error -- no type declarations for this small pure-JS package
import piexif from "piexifjs";

const OUT_DIR = join(process.cwd(), "assets", "example");

interface Shot {
  file: string;
  color: { r: number; g: number; b: number };
  label: string;
  lat: number;
  lng: number;
  when: string; // "YYYY:MM:DD HH:MM:SS", EXIF's native format
  caption: string;
}

const SHOTS: Shot[] = [
  {
    file: "01-paris-eiffel.jpg",
    color: { r: 90, g: 110, b: 150 },
    label: "Eiffel Tower",
    lat: 48.8584,
    lng: 2.2945,
    when: "2025:06:10 09:15:00",
    caption:
      "First morning in Paris. Queued for the Eiffel Tower before the crowds arrived.",
  },
  {
    file: "02-paris-louvre.jpg",
    color: { r: 120, g: 100, b: 80 },
    label: "The Louvre",
    lat: 48.8606,
    lng: 2.3376,
    when: "2025:06:10 14:40:00",
    caption: "Spent the afternoon getting lost in the Louvre.",
  },
  {
    file: "03-lyon-vieux.jpg",
    color: { r: 160, g: 130, b: 90 },
    label: "Vieux Lyon",
    lat: 45.7626,
    lng: 4.8272,
    when: "2025:06:11 12:30:00",
    caption:
      "Drove down to Lyon. The old town's traboules are impossible to find on your own.",
  },
  {
    file: "04-lyon-fourviere.jpg",
    color: { r: 140, g: 150, b: 170 },
    label: "Basilique de Fourvière",
    lat: 45.7622,
    lng: 4.8222,
    when: "2025:06:11 18:05:00",
    caption: "Sunset over the city from Fourviere hill.",
  },
  {
    file: "05-nice-promenade.jpg",
    color: { r: 60, g: 140, b: 180 },
    label: "Promenade des Anglais",
    lat: 43.6953,
    lng: 7.2654,
    when: "2025:06:12 11:00:00",
    caption:
      "Made it to the coast. The water here is a color I didn't believe existed.",
  },
  {
    file: "06-nice-vieux.jpg",
    color: { r: 200, g: 150, b: 90 },
    label: "Vieux Nice",
    lat: 43.6975,
    lng: 7.2769,
    when: "2025:06:13 09:30:00",
    caption: "Last morning - market in the old town before heading home.",
  },
];

function toDeg(
  value: number,
): [[number, number], [number, number], [number, number]] {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100);
  return [
    [deg, 1],
    [min, 1],
    [sec, 100],
  ];
}

async function buildImage(shot: Shot): Promise<Buffer> {
  // A simple vertical gradient + label text, rendered as SVG then flattened
  // to JPEG — deliberately abstract rather than a stock photo.
  const svg = `
    <svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgb(${shot.color.r},${shot.color.g},${shot.color.b})"/>
          <stop offset="1" stop-color="rgb(${Math.max(0, shot.color.r - 60)},${Math.max(0, shot.color.g - 60)},${Math.max(0, shot.color.b - 60)})"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#g)"/>
      <text x="60" y="740" font-family="sans-serif" font-size="48" fill="white" opacity="0.9">${shot.label}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const shot of SHOTS) {
    const jpegBuf = await buildImage(shot);
    const jpegBase64 = jpegBuf.toString("binary");

    const exifDict = {
      "0th": {
        [piexif.ImageIFD.ImageDescription]: shot.caption,
      },
      Exif: {
        [piexif.ExifIFD.DateTimeOriginal]: shot.when,
      },
      GPS: {
        [piexif.GPSIFD.GPSLatitudeRef]: shot.lat >= 0 ? "N" : "S",
        [piexif.GPSIFD.GPSLatitude]: toDeg(shot.lat),
        [piexif.GPSIFD.GPSLongitudeRef]: shot.lng >= 0 ? "E" : "W",
        [piexif.GPSIFD.GPSLongitude]: toDeg(shot.lng),
      },
    };

    const exifBytes = piexif.dump(exifDict);
    const withExif = piexif.insert(exifBytes, jpegBase64);
    const outBuf = Buffer.from(withExif, "binary");

    await writeFile(join(OUT_DIR, shot.file), outBuf);
    console.log(`wrote ${shot.file}`);
  }

  console.log(`\nDone. ${SHOTS.length} sample photos in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
