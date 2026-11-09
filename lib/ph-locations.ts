/**
 * Looks up a Philippine city or municipality and returns its province and region, so the registration
 * form can fill those in when a participant types their locality and presses Enter.
 *
 * The data (lib/ph-locations.json, built by scripts/build-ph-locations.js from the official PSGC list)
 * is loaded on first use, so it is not part of the page's initial download.
 */

export type RegionKey =
  | 'I'
  | 'II'
  | 'III'
  | 'IV-A'
  | 'IV-B'
  | 'V'
  | 'VI'
  | 'VII'
  | 'VIII'
  | 'IX'
  | 'X'
  | 'XI'
  | 'XII'
  | 'XIII'
  | 'NCR'
  | 'CAR'
  | 'BARMM';

export interface Place {
  /** Name as shown to the participant, e.g. "Balanga City". */
  name: string;
  province: string;
  region: RegionKey;
}

type Row = [key: string, name: string, province: string, region: RegionKey];

let cache: Promise<Row[]> | null = null;

function loadPlaces(): Promise<Row[]> {
  if (!cache) {
    cache = import('./ph-locations.json').then((mod) => (mod as unknown as { default: { places: Row[] } }).default.places);
  }
  return cache;
}

/**
 * Same normalisation the data was built with (scripts/build-ph-locations.js): no accents, no "City of"
 * or "City", "Sta."/"Sto." spelled out, punctuation and extra spaces removed.
 */
export function normalizePlace(value: string): string {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.,'’-]/g, ' ')
    .replace(/\bcity of\b/g, ' ')
    .replace(/\bmunicipality of\b/g, ' ')
    .replace(/\bcity\b/g, ' ')
    .replace(/\bsta\b/g, 'santa')
    .replace(/\bsto\b/g, 'santo')
    .replace(/\s+/g, ' ')
    .trim();
}

const toPlace = (row: Row): Place => ({ name: row[1], province: row[2], region: row[3] });

export interface PlaceSearch {
  /** Places that match. One entry means it is unambiguous; several means the participant should choose. */
  matches: Place[];
  /** True when these are only "starts with" suggestions, not an exact match for what was typed. */
  approximate: boolean;
}

/**
 * Finds the place a participant typed. `provinceHint` (whatever is already in the Province box) settles
 * names shared by several provinces, and typing "City" (as in "Quezon City") prefers cities.
 */
export async function findPlaces(query: string, provinceHint = ''): Promise<PlaceSearch> {
  const key = normalizePlace(query);
  if (!key) return { matches: [], approximate: false };

  const rows = await loadPlaces();
  let matches = rows.filter((r) => r[0] === key);
  let approximate = false;

  if (matches.length === 0 && key.length >= 3) {
    matches = rows.filter((r) => r[0].startsWith(key)).slice(0, 8);
    approximate = matches.length > 0;
  }

  if (!approximate && matches.length > 1) {
    // "Quezon City" means the city, not the six municipalities called Quezon.
    if (/\bcity\b/i.test(query)) {
      const cities = matches.filter((r) => /\bCity$/.test(r[1]));
      if (cities.length > 0) matches = cities;
    }
    // A province already typed narrows the rest ("San Jose" + "Tarlac").
    const hint = normalizePlace(provinceHint);
    if (hint && matches.length > 1) {
      const inProvince = matches.filter((r) => {
        const p = normalizePlace(r[2]);
        return p === hint || p.includes(hint) || hint.includes(p);
      });
      if (inProvince.length > 0) matches = inProvince;
    }
  }

  return { matches: matches.map(toPlace), approximate };
}

// How each region can be written in the form's Region list. The list is edited by admins, so match by
// the region's number or its usual name rather than by one exact string.
const REGION_PATTERNS: Record<RegionKey, RegExp[]> = {
  NCR: [/\bncr\b/i, /national capital/i],
  CAR: [/\bcar\b/i, /cordillera/i],
  I: [/^region\s+i(?![a-z-])/i, /ilocos/i],
  II: [/^region\s+ii(?![a-z-])/i, /cagayan valley/i],
  III: [/^region\s+iii(?![a-z-])/i, /central luzon/i],
  'IV-A': [/\biv-?a\b/i, /calabarzon/i],
  'IV-B': [/\biv-?b\b/i, /mimaropa/i],
  V: [/^region\s+v(?![a-z-])/i, /bicol/i],
  VI: [/^region\s+vi(?![a-z-])/i, /western visayas/i],
  VII: [/^region\s+vii(?![a-z-])/i, /central visayas/i],
  VIII: [/^region\s+viii(?![a-z-])/i, /eastern visayas/i],
  IX: [/^region\s+ix(?![a-z-])/i, /zamboanga/i],
  X: [/^region\s+x(?![a-z-])/i, /northern mindanao/i],
  XI: [/^region\s+xi(?![a-z-])/i, /davao region/i],
  XII: [/^region\s+xii(?![a-z-])/i, /soccsksargen/i],
  XIII: [/xiii/i, /caraga/i],
  BARMM: [/barmm/i, /bangsamoro/i],
};

/** The entry of the form's Region list that stands for this region, or null if the list has none. */
export function matchRegionOption(region: RegionKey, options: string[]): string | null {
  const patterns = REGION_PATTERNS[region];
  return options.find((option) => patterns.some((p) => p.test(option))) ?? null;
}
