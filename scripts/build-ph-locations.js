#!/usr/bin/env node
/**
 * Builds lib/ph-locations.json: every Philippine city and municipality with its province and region,
 * from the official PSGC data (https://psgc.gitlab.io/api). Run it again (node scripts/build-ph-locations.js)
 * when the PSGC list changes. The normalise() function below must stay identical to normalizePlace() in
 * lib/ph-locations.ts, because search keys are stored already normalised.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://psgc.gitlab.io/api';

const REGION_KEY = {
  '010000000': 'I',
  '020000000': 'II',
  '030000000': 'III',
  '040000000': 'IV-A',
  '170000000': 'IV-B',
  '050000000': 'V',
  '060000000': 'VI',
  '070000000': 'VII',
  '080000000': 'VIII',
  '090000000': 'IX',
  '100000000': 'X',
  '110000000': 'XI',
  '120000000': 'XII',
  '130000000': 'NCR',
  '140000000': 'CAR',
  '160000000': 'XIII',
  '150000000': 'BARMM',
};

// Independent cities that PSGC lists without a province.
const PROVINCE_OVERRIDE = {
  'City of Isabela': 'Basilan',
  'City of Cotabato': 'Maguindanao del Norte',
};

// PSGC files Cotabato City under Region XII, but it has been part of BARMM since the 2019 plebiscite.
const REGION_OVERRIDE = {
  'City of Cotabato': 'BARMM',
};

function normalise(value) {
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

function display(name) {
  const m = /^City of (.+)$/.exec(name);
  return m ? `${m[1]} City` : name;
}

async function get(endpoint) {
  const res = await fetch(`${API}/${endpoint}/`);
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const [provinces, places] = await Promise.all([get('provinces'), get('cities-municipalities')]);
  const provinceName = new Map(provinces.map((p) => [p.code, p.name]));

  const rows = places.map((p) => {
    const region = REGION_OVERRIDE[p.name] || REGION_KEY[p.regionCode];
    if (!region) throw new Error(`Unmapped region ${p.regionCode} for ${p.name}`);
    let province = p.provinceCode ? provinceName.get(p.provinceCode) || '' : '';
    if (!province && region === 'NCR') province = 'Metro Manila';
    if (!province && PROVINCE_OVERRIDE[p.name]) province = PROVINCE_OVERRIDE[p.name];
    return [normalise(p.name), display(p.name), province, region];
  });

  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  const out = path.join(__dirname, '..', 'lib', 'ph-locations.json');
  fs.writeFileSync(out, JSON.stringify({ v: 1, places: rows }));
  const noProvince = rows.filter((r) => !r[2]).length;
  console.log(`Wrote ${rows.length} places to ${path.relative(process.cwd(), out)} (${noProvince} without a province)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
