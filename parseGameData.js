'use strict';

const XLSX = require('xlsx');

// ─── micro-helpers ────────────────────────────────────────────────────────────
const toNum  = v => { if (v == null) return null; const s = String(v).trim().toLowerCase(); if (s === 'x' || s === '' || s === 'nan') return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const str    = v => (v == null ? '' : String(v).trim());
const ok     = v => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'nan';

// ─── parsers ──────────────────────────────────────────────────────────────────

/** Stat sheets: row 1 = header (Race | RaceName...), rows 2-11 = level + weights */
function parseStatSheet(ws) {
  if (!ws) return {};
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // find header row: contains 'Race'
  const hi = data.findIndex(r => r && r.some(c => str(c).toLowerCase() === 'race'));
  if (hi < 0) return {};
  const header = data[hi];
  const races  = header.slice(1).map(str).filter(Boolean);
  const result = {};
  races.forEach(r => { result[r] = []; });
  for (let i = hi + 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const level = toNum(row[0]);
    if (level === null) continue;
    races.forEach((race, j) => {
      result[race].push({ level, weight: toNum(row[j + 1]) });
    });
  }
  return result;
}

/** Race sheet */
function parseRaces(ws) {
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return data
    .filter(r => r && ok(r[0]) && str(r[0]).toLowerCase() !== 'race')
    .map(r => ({ race: str(r[0]), weight: toNum(r[1]) || 0, subraceWheel: str(r[2]), trait: str(r[3]) }))
    .filter(r => r.weight > 0);
}

/** Subrace – tables laid out horizontally, row 0 = wheel names */
function parseSubraces(ws) {
  if (!ws) return {};
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};
  const titleRow = data[0] || [];
  const starts = [];
  for (let c = 0; c < titleRow.length; c++) {
    const v = str(titleRow[c]);
    if (v && isNaN(v) && !['stt','race','nan'].includes(v.toLowerCase())) starts.push({ col: c, name: v });
  }
  for (const { col, name } of starts) {
    result[name] = [];
    for (let r = 1; r < data.length; r++) {
      const row = data[r]; if (!row) continue;
      if (!ok(row[col])) continue;
      const itemName = str(row[col + 1]);
      const w = toNum(row[col + 2]);
      if (!itemName || w === null) continue;
      result[name].push({ item: itemName, weight: w, effect: str(row[col + 3]) });
    }
  }
  return result;
}

/** Skill Wheel – horizontal blocks per race */
function parseSkillWheel(ws) {
  if (!ws) return {};
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};
  for (let r = 0; r < data.length; r++) {
    const row = data[r]; if (!row) continue;
    const hasRace = row.some(c => str(c).toLowerCase() === 'race');
    if (!hasRace) continue;
    const blocks = [];
    for (let c = 0; c < row.length; c++) {
      if (str(row[c]).toLowerCase() === 'race' && ok(row[c + 1])) blocks.push({ col: c, race: str(row[c + 1]) });
    }
    let dr = r + 1;
    while (dr < data.length) {
      const drow = data[dr]; if (!drow) { dr++; continue; }
      if (drow.some(c => str(c).toLowerCase() === 'race')) break;
      for (const { col, race } of blocks) {
        const sc = toNum(drow[col]), sw = toNum(drow[col + 1]);
        if (sc === null || sw === null) continue;
        if (!result[race]) result[race] = [];
        result[race].push({ skillCount: sc, weight: sw });
      }
      dr++;
    }
  }
  return result;
}

/** Skill sheet */
function parseSkills(ws) {
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return data.filter(r => r && toNum(r[0]) !== null).map(r => ({ id: toNum(r[0]), name: str(r[1]), weight: toNum(r[2]) || 1, effect: str(r[3]) }));
}

/** Gear sheet */
function parseGear(ws) {
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return data.filter(r => r && toNum(r[0]) !== null).map(r => ({ id: toNum(r[0]), name: str(r[1]), weight: toNum(r[2]) || 1, effect: str(r[3]), type: str(r[4]) }));
}

/** Gear Wheel */
function parseGearWheel(ws) {
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const label = str(row[0]); const w = toNum(row[1]);
    if (!label || w === null) continue;
    const m = label.match(/(\d+)/);
    result.push({ gearCount: m ? parseInt(m[1]) : label, weight: w });
  }
  return result;
}

/** Weapon Wheel – rows like: 'Có' | NaN | weight */
function parseWeaponWheel(ws) {
  if (!ws) return [{ item: 'Có', weight: 70 }, { item: 'Không', weight: 30 }];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const item = str(row[0]); if (!item || item.toLowerCase().includes('?') || item.toLowerCase() === 'hiệu ứng') continue;
    const w = toNum(row[2]) ?? toNum(row[1]);
    if (w === null) continue;
    result.push({ item, weight: w });
  }
  return result.length ? result : [{ item: 'Có', weight: 70 }, { item: 'Không', weight: 30 }];
}

/** Weapons sheet */
function parseWeapons(ws) {
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!data.length) return [];
  const hdr = data[0] || [];
  const levelLabels = hdr.slice(1, 11).map(str);
  return data.slice(1).filter(r => r && ok(r[0])).map(r => {
    const milestones = {};
    for (let i = 0; i < 10; i++) { const e = str(r[i + 1]); if (e) milestones[levelLabels[i] || `lv${i+1}`] = e; }
    return { name: str(r[0]), milestones, category: str(r[11]) };
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────
function parseGameData(filePath) {
  const wb  = XLSX.readFile(filePath);
  const get = name => wb.Sheets[name] || wb.Sheets[Object.keys(wb.Sheets).find(k => k.trim() === name.trim())];

  return {
    Races:       parseRaces(get('Race')),
    Subraces:    parseSubraces(get('Subrace')),
    Stats: {
      ATK: parseStatSheet(get('ATK')),
      HP:  parseStatSheet(get('HP')),
      SPD: parseStatSheet(get('SPD')),
      IQ:  parseStatSheet(get('IQ')),
      BIQ: parseStatSheet(get('BIQ')),
      MA:  parseStatSheet(get('Weapon Mastery Martial Arts')),
    },
    SkillWheel:  parseSkillWheel(get('Skill Wheel')),
    Skills:      parseSkills(get('Skill')),
    Gear:        parseGear(get('Gear')),
    GearWheel:   parseGearWheel(get('Gear Wheel')),
    WeaponWheel: parseWeaponWheel(get('Weapon wheel ')),
    Weapons:     parseWeapons(get('Weapons')),
  };
}

module.exports = { parseGameData };
