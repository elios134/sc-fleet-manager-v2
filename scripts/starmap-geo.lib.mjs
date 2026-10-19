// Transform pur : CSV VerseTime (bodies/locations/systems) -> starmap-geo.json normalisé.
// Données factuelles (Murphy Exploration Group via dydrmr/VerseTime) ; aucune dépendance.
export function parseCsv(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n").filter((l) => l.length);
  if (!lines.length) return [];
  const head = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    head.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : null;
};

export function buildGeo({ bodiesCsv, locationsCsv, systemsCsv }) {
  const systems = parseCsv(systemsCsv).map((r) => ({ name: r.name, star: r.star || r.name }));
  const bodies = [];
  for (const r of parseCsv(bodiesCsv)) {
    const radius = num(r.bodyRadius);
    const cx = num(r.coordinateX), cy = num(r.coordinateY), cz = num(r.coordinateZ);
    if (!r.name || radius == null || cx == null || cy == null || cz == null) continue;
    bodies.push({
      name: r.name,
      type: r.type,
      parentBody: r.parentBody || null,
      parentStar: r.parentStar || null,
      coord: [cx, cy, cz],
      bodyRadius: radius,
      rotationCorrection: num(r.rotationCorrection) ?? 0,
      orbitRadius: num(r.orbitRadius) ?? 0,
      orbitAngle: num(r.orbitAngle) ?? 0,
      themeColor: [num(r.themeColorR) ?? 128, num(r.themeColorG) ?? 128, num(r.themeColorB) ?? 128],
    });
  }
  const pois = [];
  for (const r of parseCsv(locationsCsv)) {
    const cx = num(r.coordinateX), cy = num(r.coordinateY), cz = num(r.coordinateZ);
    if (!r.name || !r.parentBody || cx == null || cy == null || cz == null) continue;
    pois.push({
      name: r.name,
      type: r.type,
      parentBody: r.parentBody,
      coord: [cx, cy, cz],
      wikiLink: r.wikiLink || null,
      quantum: r.quantum === "1", // marqueur quantum visible en jeu
      hidden: r.private === "1", // lieu privé / caché (pas de marqueur public)
    });
  }
  return { systems, bodies, pois };
}
