/**
 * Mock Tauri DEV-ONLY — permet de faire tourner l'UI dans un navigateur (preview,
 * revue visuelle) alors que le backend Rust/SQL n'existe que dans le bundle desktop.
 *
 * N'est JAMAIS importé en production : `main.tsx` le charge derrière
 * `import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)`. Il stubbe
 * `window.__TAURI_INTERNALS__.invoke` (lu par @tauri-apps/api/core) + le système
 * d'événements, et renvoie des données factices par commande. Les commandes inconnues
 * sont loguées (console) et renvoient une valeur vide, pour repérer ce qu'il reste à seeder.
 */

type Args = Record<string, unknown> | undefined;

// Petites fabriques de données de démo (juste assez pour révéler la structure des pages).
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

const DEMO_ACCOUNTS = [
  { id: 1, handle: "Commandant Démo", displayName: "Démo", avatarUrl: null },
];

const HANDLERS: Record<string, (a: Args) => unknown> = {
  // ── Boot / comptes ──
  get_accounts: () => DEMO_ACCOUNTS,
  get_active_account: () => DEMO_ACCOUNTS[0],
  set_active_account: () => null,
  create_account: (a) => ({ id: 2, handle: (a?.handle as string) ?? "Nouveau", displayName: null, avatarUrl: null }),
  get_rsi_session_status: () => ({ hasToken: false, portraitUrl: null, conciergeLevel: null, conciergeProgress: null }),

  // ── Méta appli (fraîcheur des sources, onboarding…) ──
  get_app_meta: () => ({}),
  get_all_app_meta: () => ({}),
  set_app_meta: () => null,
  get_sync_freshness: () => [],
  get_active_account_id: () => "1",
  get_pinned_nav: () => [],

  // ── Catalogue ──
  get_item_categories: () => [
    { section: "Personal Weapon", categories: ["Assault Rifle", "SMG", "Pistol"] },
    { section: "Personal Armor", categories: ["Heavy Armor", "Light Armor"] },
    { section: "Ship Shield", categories: ["Shield Generator"] },
    { section: "Ship Quantum", categories: ["Quantum Drive"] },
  ],
  get_catalog_items: () => CATALOG_ITEMS,
  get_catalog_vehicles: () => [],
  get_item_purchase_points: () => PURCHASE_POINTS,
  get_item_wiki_detail: () => ({
    available: true, description: "Fusil d'assaut Behring standard.", manufacturer: "Behring",
    typeLabel: "Fusil d'assaut", subTypeLabel: null, size: 2, grade: "A",
    webUrl: null, imageUrl: null,
    stats: [
      { name: "Cadence", value: "540 rpm" }, { name: "Dégâts", value: "22" },
      { name: "Chargeur", value: "60" }, { name: "Portée", value: "1 500 m" },
    ],
  }),

  // ── Crafting Hub ──
  list_blueprints: () => BLUEPRINTS,
  get_crafting_stats: () => ({
    total: 68,
    byCategory: [
      { category: "Composants vaisseau", count: 24 },
      { category: "Armes vaisseau", count: 18 },
      { category: "Armes FPS", count: 11 },
      { category: "Armures FPS", count: 9 },
      { category: "Objets mission", count: 6 },
    ],
  }),
  list_blueprint_owned: () => ["bp-surestop-s03"],
  get_ingredient_mining_locations: () => [],
  get_blueprint_detail: (a) => {
    const id = (a?.blueprintId as string) ?? "";
    const bp = BLUEPRINTS.find((b) => b.id === id) ?? BLUEPRINTS[0];
    return {
      blueprint: {
        id: bp.id,
        displayName: bp.displayName,
        displayNameSource: bp.displayNameSource,
        producedItemName: bp.producedItemName,
        category: bp.category,
        craftTimeSeconds: bp.craftTimeSeconds,
        webUrl: null,
        imageUrl: null,
        descriptionData: null,
        owned: id === "bp-surestop-s03",
      },
      itemDetails: {
        description: "Objet fabriqué de démonstration.",
        manufacturer: "Basilisk",
        itemType: bp.category,
        subType: null,
        size: 3,
        grade: "A",
        className: bp.producedItemEntityClass,
      },
      ingredients: (bp.ingredientNames ?? []).map((n, i) => ({
        ingredientName: n,
        ingredientRef: `ref-${i}`,
        ingredientType: "Material",
        ingredientTypeLabel: "Matériau",
        quantityLabel: `×${(i % 3) + 1}`,
        order: i,
        slotName: null,
        slotLabel: null,
        requiredCount: (i % 3) + 1,
        selectionGroup: null,
        minQuality: null,
        sliderMin: null,
        sliderMax: null,
        initialQuality: 500,
        modifiers: null,
      })),
      linkedMissions: [],
      stats:
        id === "bp-surestop-s03"
          ? [
              { slotName: "s", slotDebugName: null, gpp: "hp", statNameLocKey: "Points de bouclier", unitLocKey: null, mode: "absolute", baseValue: 105600, scale: 1, transformType: "", valueRanges: [] },
              { slotName: "s", slotDebugName: null, gpp: "regen", statNameLocKey: "Régénération", unitLocKey: "/s", mode: "absolute", baseValue: 2640, scale: 1, transformType: "", valueRanges: [] },
              { slotName: "s", slotDebugName: null, gpp: "delay", statNameLocKey: "Délai avant régen", unitLocKey: "s", mode: "absolute", baseValue: 5, scale: 1, transformType: "", valueRanges: [] },
              { slotName: "s", slotDebugName: null, gpp: "em", statNameLocKey: "Signature EM", unitLocKey: null, mode: "absolute", baseValue: 1380, scale: 1, transformType: "", valueRanges: [] },
            ]
          : [],
    };
  },
  get_blueprint_dismantle: (a) => {
    const id = (a?.blueprintId as string) ?? "";
    if (id !== "bp-surestop-s03") return null;
    return {
      timeSeconds: 15,
      timeLabel: null,
      efficiency: 0.5,
      returns: [
        { name: "Agricium", resourceUuid: "res-agri", quantityScu: 0.18, webUrl: null },
        { name: "Tungstène", resourceUuid: "res-tung", quantityScu: 0.42, webUrl: null },
      ],
    };
  },

  // ── Dashboard ──
  get_dashboard_data: () => ({ shipsCount: 37, ltiCount: 14, lastSyncedAt: daysAgo(1) }),
  get_ships: () => [],
  get_dashboard_top_routes: () => ({
    shipName: "Caterpillar",
    routes: [
      { commodity: "Quantanium", fromLocation: "Stanhope", toLocation: "Area18", profit: 1_420_000, profitPerMinute: 101_000 },
      { commodity: "Laranite", fromLocation: "AM045", toLocation: "Lorville", profit: 986_000, profitPerMinute: 55_000 },
      { commodity: "Agricium", fromLocation: "Olisar", toLocation: "Everus", profit: 742_000, profitPerMinute: 35_000 },
    ],
  }),
  get_rsi_server_status: () => ({
    overall: "operational", overallLabel: "Opérationnel",
    components: [
      { name: "Persistent Universe", status: "operational" },
      { name: "Boutique", status: "degraded" },
      { name: "Plateforme", status: "operational" },
    ],
  }),
  get_rsi_news: () => [],
  list_objectives: () => [],
  list_favorites: () => [],

  // ── Cargo & Routes (cockpit de convoi) ──
  get_cargo_fleet_ships: () => [
    { name: "Caterpillar", manufacturer: "Drake", cargoScu: 576, role: "cargo" },
    { name: "Freelancer MAX", manufacturer: "MISC", cargoScu: 120, role: "cargo" },
  ],
  get_cargo_catalog_ships: () => [
    { name: "Caterpillar", manufacturer: "Drake", cargoScu: 576, role: "cargo", qtDefault: true },
    { name: "Hull C", manufacturer: "MISC", cargoScu: 4608, role: "cargo", qtDefault: true },
    { name: "Freelancer MAX", manufacturer: "MISC", cargoScu: 120, role: "cargo", qtDefault: true },
  ],
  get_uex_prices_status: () => ({ rows: 1240, terminals: 82, terminalsMapped: 78, freshestTimestamp: daysAgo(2), sellPointsWithDemand: 44 }),
  find_cargo_routes: () => ({
    shipName: "Caterpillar", cargoScu: 576, qtResolved: true, investment: 1_200_000,
    routesConsidered: 210, routesWithTime: 14, note: "",
    routes: [
      { commodity: "Quantanium", fromLocation: "HDMS-Stanhope", toLocation: "Area18", fromName: "HDMS-Stanhope", toName: "Area18", fromUuid: null, toUuid: null, buyPrice: 88, sellPrice: 2555, marginUnit: 2467, quantityScu: 576, profit: 1_420_000, fromSystem: "Stanton", toSystem: "Stanton", jumps: 2, distanceGm: 41.2, timeMinutes: 14, profitPerMinute: 101_350, priceTimestamp: daysAgo(0.25), fuel: null, fuelScu: 3.2 },
      { commodity: "Laranite", fromLocation: "ArcCorp Mining 045", toLocation: "Lorville", fromName: "ArcCorp Mining 045", toName: "Lorville", fromUuid: null, toUuid: null, buyPrice: 27, sellPrice: 31, marginUnit: 1712, quantityScu: 576, profit: 986_000, fromSystem: "Stanton", toSystem: "Stanton", jumps: 1, distanceGm: 33.0, timeMinutes: 18, profitPerMinute: 54_780, priceTimestamp: daysAgo(0.12), fuel: null, fuelScu: 2.6 },
      { commodity: "Agricium", fromLocation: "Port Olisar", toLocation: "Everus Harbor", fromName: "Port Olisar", toName: "Everus Harbor", fromUuid: null, toUuid: null, buyPrice: 24, sellPrice: 27, marginUnit: 1449, quantityScu: 512, profit: 742_000, fromSystem: "Stanton", toSystem: "Stanton", jumps: 2, distanceGm: 52.4, timeMinutes: 21, profitPerMinute: 34_900, priceTimestamp: daysAgo(2), fuel: null, fuelScu: 4.1 },
      { commodity: "Titanium", fromLocation: "Daymar Prospect", toLocation: "Grim HEX", fromName: "Daymar Prospect", toName: "Grim HEX", fromUuid: null, toUuid: null, buyPrice: 8, sellPrice: 12, marginUnit: 602, quantityScu: 576, profit: 318_000, fromSystem: "Stanton", toSystem: "Stanton", jumps: 1, distanceGm: 28.6, timeMinutes: 26, profitPerMinute: 19_240, priceTimestamp: daysAgo(0.4), fuel: null, fuelScu: 2.1 },
    ],
  }),
};

// ── Fixtures (contenu calqué sur la maquette de refonte) ──
const CATALOG_ITEMS = [
  { id: 1, uuid: "u1", name: "P4-AR", slug: "p4-ar", section: "Personal Weapon", category: "Assault Rifle", companyName: "Behring", size: "2", idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 8, minPrice: 2400 },
  { id: 2, uuid: "u2", name: "Gallant Rifle", slug: "gallant", section: "Personal Weapon", category: "Assault Rifle", companyName: "Klaus & Werner", size: "2", idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 5, minPrice: 6000 },
  { id: 3, uuid: "u3", name: "SureStop S03", slug: "surestop", section: "Ship Shield", category: "Shield Generator", companyName: "Basilisk", size: "3", idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 4, minPrice: 18500 },
  { id: 4, uuid: "u4", name: "FR-76 Quantum Drive", slug: "fr76", section: "Ship Quantum", category: "Quantum Drive", companyName: "Roberts", size: "2", idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 3, minPrice: 12000 },
  { id: 5, uuid: "u5", name: "Morozov-SH Armor", slug: "morozov", section: "Personal Armor", category: "Heavy Armor", companyName: "CDS", size: null, idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 6, minPrice: 9800 },
  { id: 6, uuid: "u6", name: "C54 SMG", slug: "c54", section: "Personal Weapon", category: "SMG", companyName: "Gemini", size: null, idVehicle: null, vehicleName: null, urlStore: null, imageUrl: null, sellPoints: 7, minPrice: 3100 },
];

const PURCHASE_POINTS = [
  { priceBuy: 2400, terminalName: "Platinum Bay", shopName: "Platinum Bay", systemName: "Stanton", planetName: "ArcCorp", moonName: null, cityName: "Area18", spaceStationName: null, outpostName: null, dateModified: null },
  { priceBuy: 2480, terminalName: "Cousin Crow's", shopName: "Cousin Crow's", systemName: "Stanton", planetName: "Crusader", moonName: null, cityName: "Orison", spaceStationName: null, outpostName: null, dateModified: null },
  { priceBuy: 2520, terminalName: "Dumper's Depot", shopName: "Dumper's Depot", systemName: "Stanton", planetName: "Hurston", moonName: null, cityName: "Lorville", spaceStationName: null, outpostName: null, dateModified: null },
];

const BLUEPRINTS = [
  { id: "bp-surestop-s03", displayName: "SureStop S03", displayNameSource: "producedItem", category: "Shield", categoryGroupKey: "ship-component", producedItemEntityClass: "Shield", producedItemName: "SureStop S03", imageUrl: null, craftTimeSeconds: 7200, ingredientCount: 4, ingredientPreview: ["Aluminium", "Quartz"], ingredientNames: ["Aluminium", "Quartz", "Composant électronique", "Circuit de puissance"] },
  { id: "bp-fr76", displayName: "FR-76 Quantum Drive", displayNameSource: "producedItem", category: "QuantumDrive", categoryGroupKey: "ship-component", producedItemEntityClass: "QuantumDrive", producedItemName: "FR-76", imageUrl: null, craftTimeSeconds: 5400, ingredientCount: 3, ingredientPreview: ["Titane"], ingredientNames: ["Titane", "Quartz", "Or"] },
  { id: "bp-js300", displayName: "JS-300 Cooler", displayNameSource: "producedItem", category: "Cooler", categoryGroupKey: "ship-component", producedItemEntityClass: "Cooler", producedItemName: "JS-300", imageUrl: null, craftTimeSeconds: 3600, ingredientCount: 2, ingredientPreview: ["Aluminium"], ingredientNames: ["Aluminium", "Cuivre"] },
  { id: "bp-panther", displayName: "CF-337 Panther", displayNameSource: "producedItem", category: "WeaponGun", categoryGroupKey: "ship-weapon", producedItemEntityClass: "WeaponGun", producedItemName: "CF-337 Panther", imageUrl: null, craftTimeSeconds: 4800, ingredientCount: 5, ingredientPreview: ["Tungstène"], ingredientNames: ["Tungstène", "Acier", "Or", "Quartz", "Cuivre"] },
  { id: "bp-p4ar", displayName: "P4-AR Rifle", displayNameSource: "producedItem", category: "WeaponPersonal", categoryGroupKey: "fps-weapon", producedItemEntityClass: "WeaponPersonal_Rifle", producedItemName: "P4-AR", imageUrl: null, craftTimeSeconds: 1800, ingredientCount: 3, ingredientPreview: ["Acier"], ingredientNames: ["Acier", "Aluminium", "Cuivre"] },
];

function fallback(cmd: string): unknown {
  // Heuristique : les commandes « get_… » listantes renvoient [], sinon null.
  if (/^(get|list|find|search|fetch)_/.test(cmd)) return [];
  return null;
}

async function mockInvoke(cmd: string, args?: Args): Promise<unknown> {
  const h = HANDLERS[cmd];
  if (h) return h(args);
  // eslint-disable-next-line no-console
  console.info("[tauri-mock] commande non seedée:", cmd, args ?? "");
  return fallback(cmd);
}

// Système d'événements minimal : listen renvoie une fonction d'unlisten no-op.
let cbId = 0;
const listeners = new Map<number, (payload: unknown) => void>();

export function installTauriBrowserMock(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return; // vrai Tauri présent → ne rien faire

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    // core.invoke(cmd, args) délègue ici.
    invoke: (cmd: string, args?: Args) => {
      // Événements : on gère les plugins event pour ne pas casser listen/emit.
      if (cmd === "plugin:event|listen") {
        const id = ++cbId;
        return Promise.resolve(id);
      }
      if (cmd === "plugin:event|unlisten") return Promise.resolve();
      if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") return Promise.resolve();
      return mockInvoke(cmd, args);
    },
    transformCallback: (cb: (payload: unknown) => void) => {
      const id = ++cbId;
      if (typeof cb === "function") listeners.set(id, cb);
      return id;
    },
    unregisterCallback: (id: number) => listeners.delete(id),
  };

  // eslint-disable-next-line no-console
  console.info("[tauri-mock] installé (DEV, hors Tauri) — dates démo :", daysAgo(2));
}
