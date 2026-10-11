// Runner : lit les CSV VerseTime locaux et écrit starmap-geo.json.
// Usage : node scripts/build-starmap-geo.mjs <dir-csv-versetime> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { buildGeo } from "./starmap-geo.lib.mjs";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("usage: build-starmap-geo.mjs <csvDir> <out.json>");
  process.exit(1);
}
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const geo = buildGeo({
  bodiesCsv: read("bodies.csv"),
  locationsCsv: read("locations.csv"),
  systemsCsv: read("systems.csv"),
});
if (geo.bodies.length < 10) {
  console.error("extraction incomplète, abandon");
  process.exit(1);
}
writeFileSync(out, JSON.stringify(geo) + "\n");
console.log(`${geo.bodies.length} corps, ${geo.pois.length} POI -> ${out}`);
