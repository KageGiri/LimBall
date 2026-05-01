/**
 * parseGameData.js
 *
 * Đọc file meobal.xlsx và xuất ra object GameData với cấu trúc:
 *
 * GameData = {
 *   Races:       [{ race, weight, subraceWheel, trait }],
 *   Subraces:    { [wheelName]: [{ item, weight, effect }] },
 *   Stats: {
 *     ATK:  { Goblin: [{ level, weight }], Gnome: [...], ... },
 *     HP:   { ... },
 *     SPD:  { ... },
 *     IQ:   { ... },
 *     BIQ:  { ... },
 *     MA:   { ... },   // Weapon Mastery / Martial Arts
 *   },
 *   SkillWheel:  { Goblin: [{ skillCount, weight }], ... },
 *   Skills:      [{ id, name, weight, effect }],
 *   Gear:        [{ id, name, weight, effect, type }],
 *   GearWheel:   [{ gearCount, weight }],
 *   WeaponWheel: [{ item, weight }],
 *   Weapons:     [{ name, milestones: { [level]: effect }, category }],
 *   GeneratedWheels: {
 *     FarmerWheel:        [{ item, weight, effect }],
 *     InstrumentWeapon:   [{ item, weight }],
 *     VampireTaste:       [{ item, weight }],
 *   },
 * }
 */

'use strict';

const path = require('path');
const XLSX = require('xlsx');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Ép về number; trả null nếu không hợp lệ hoặc là 'x' */
const toNum = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'x') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

const str = (v) => (v == null ? '' : String(v).trim());
const notEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== 'NaN';

// ─── parse helpers per sheet type ─────────────────────────────────────────────

/**
 * Parse các sheet chỉ số (ATK, HP, SPD, IQ, BIQ, MA)
 * Row 1 = header: ['Race', 'Goblin', 'Gnome', ...]
 * Rows 2..11 = level 1..10, mỗi cột là weight của chủng tộc đó
 * => { Goblin: [{level:1, weight:10}, ...], ... }
 */
function parseStatSheet(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // tìm dòng header (chứa 'Race')
  const headerRow = data.find(r => r && r.some(c => str(c).toLowerCase() === 'race'));
  if (!headerRow) return {};

  const raceNames = headerRow.slice(1).map(str).filter(Boolean);
  const result = {};
  raceNames.forEach(r => { result[r] = []; });

  for (const row of data) {
    if (!row) continue;
    const level = toNum(row[0]);
    if (level === null) continue;
    raceNames.forEach((race, i) => {
      const w = toNum(row[i + 1]);
      result[race].push({ level, weight: w });
    });
  }
  return result;
}

/**
 * Parse Skill Wheel sheet
 * Bố cục: các bảng 7 cột đặt ngang (mỗi bảng = Race | weights | NaN | Race | ...)
 * => { Goblin: [{skillCount:0, weight:30}, ...], ... }
 */
function parseSkillWheel(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};

  for (const row of data) {
    if (!row) continue;
    // Mỗi row có thể có nhiều cụm [Race, raceName, null, Race, raceName, ...]
    // bước nhảy = 3 (Race | value | separator)
    for (let col = 0; col < row.length; col += 3) {
      if (str(row[col]).toLowerCase() !== 'race') continue;
      const raceName = str(row[col + 1]);
      if (!raceName) continue;
      if (!result[raceName]) result[raceName] = [];
    }
    // Đọc dữ liệu số
    for (let col = 0; col < row.length; col += 3) {
      const maybeLevel = toNum(row[col]);
      const maybeWeight = toNum(row[col + 1]);
      if (maybeLevel === null || maybeWeight === null) continue;
      // tìm tên race tương ứng cột này từ header row phía trên
      // lưu vào tạm, ghép sau
    }
  }

  // Cách parse chính xác hơn: duyệt block header rồi block data
  const blocks = []; // { col, race }

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    // Kiểm tra xem đây có phải dòng header Race không
    const hasRace = row.some(c => str(c).toLowerCase() === 'race');
    if (!hasRace) continue;

    // Thu thập tất cả (col, raceName) trên dòng này
    const newBlocks = [];
    for (let col = 0; col < row.length; col++) {
      if (str(row[col]).toLowerCase() === 'race' && notEmpty(row[col + 1])) {
        newBlocks.push({ col, race: str(row[col + 1]) });
      }
    }

    // Đọc data rows bên dưới cho đến khi gặp dòng race mới hoặc hết
    let dr = r + 1;
    while (dr < data.length) {
      const drow = data[dr];
      if (!drow) { dr++; continue; }
      if (drow.some(c => str(c).toLowerCase() === 'race')) break;
      for (const { col, race } of newBlocks) {
        const sc = toNum(drow[col]);
        const sw = toNum(drow[col + 1]);
        if (sc === null || sw === null) continue;
        if (!result[race]) result[race] = [];
        result[race].push({ skillCount: sc, weight: sw });
      }
      dr++;
    }
  }

  return result;
}

/**
 * Parse Race sheet
 */
function parseRaces(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row || str(row[0]).toLowerCase() === 'race') continue;
    if (!notEmpty(row[0])) continue;
    const w = toNum(row[1]);
    if (w === null) continue;
    result.push({
      race: str(row[0]),
      weight: w,
      subraceWheel: str(row[2]),
      trait: str(row[3]),
    });
  }
  return result;
}

/**
 * Parse Subrace sheet (bảng nằm ngang, nhiều bảng khác nhau)
 * Mỗi bảng bắt đầu bằng tiêu đề tên wheel ở row 0,
 * row 1 = ['Stt','Tên','Trọng số','Hiệu ứng']
 */
function parseSubraces(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = {};

  // Tìm các tiêu đề bảng (row 0) - các ô không rỗng, không phải số, không phải 'Stt'
  const headerRowIdx = 0;
  const titleRow = data[headerRowIdx];
  if (!titleRow) return result;

  // Tìm các cột bắt đầu bảng (có tiêu đề wheel)
  const tableStarts = []; // { col, name }
  for (let col = 0; col < titleRow.length; col++) {
    const v = str(titleRow[col]);
    if (v && isNaN(v) && v.toLowerCase() !== 'stt' && v.toLowerCase() !== 'race') {
      tableStarts.push({ col, name: v });
    }
  }

  // Với mỗi bảng, đọc từ row 1 đến hết
  // Cột của bảng: [col, col+1, col+2, col+3] = Stt | Tên/Loại | Trọng số | Hiệu ứng
  for (const { col, name } of tableStarts) {
    result[name] = [];
    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;
      const stt = row[col];
      const itemName = str(row[col + 1]);
      const w = toNum(row[col + 2]);
      if (!notEmpty(stt) || !itemName || w === null) continue;
      result[name].push({
        item: itemName,
        weight: w,
        effect: str(row[col + 3]),
      });
    }
  }

  return result;
}

/**
 * Parse Gear sheet
 */
function parseGear(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const id = toNum(row[0]);
    if (id === null) continue;
    const w = toNum(row[2]);
    if (w === null) continue;
    result.push({
      id,
      name: str(row[1]),
      weight: w,
      effect: str(row[3]),
      type: str(row[4]),
    });
  }
  return result;
}

/**
 * Parse Gear Wheel sheet
 */
function parseGearWheel(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const label = str(row[0]);
    const w = toNum(row[1]);
    if (!label || w === null) continue;
    const match = label.match(/(\d+)/);
    result.push({
      gearCount: match ? parseInt(match[1]) : label,
      weight: w,
    });
  }
  return result;
}

/**
 * Parse Skill sheet
 */
function parseSkills(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const id = toNum(row[0]);
    if (id === null) continue;
    result.push({
      id,
      name: str(row[1]),
      weight: toNum(row[2]),
      effect: str(row[3]),
    });
  }
  return result;
}

/**
 * Parse Weapon Wheel sheet
 */
function parseWeaponWheel(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const result = [];
  for (const row of data) {
    if (!row) continue;
    const item = str(row[0]);
    // weight ở col 2 (vì col 1 = NaN separator)
    const w = toNum(row[2]) ?? toNum(row[1]);
    if (!item || w === null) continue;
    result.push({ item, weight: w });
  }
  return result;
}

/**
 * Parse Weapons sheet
 */
function parseWeapons(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!data.length) return [];

  const headerRow = data[0];
  const levelLabels = headerRow.slice(1, 11).map(str); // 10 mức
  const result = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || !notEmpty(row[0])) continue;
    const name = str(row[0]);
    const milestones = {};
    for (let i = 0; i < 10; i++) {
      const effect = str(row[i + 1]);
      if (effect) milestones[levelLabels[i] || `level_${i + 1}`] = effect;
    }
    result.push({
      name,
      milestones,
      category: str(row[11]),
    });
  }
  return result;
}

/**
 * Parse Generated Wheel sheet (Farmer, Instrument, Vampire Taste)
 */
function parseGeneratedWheels(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const wheels = {
    FarmerWheel: [],
    InstrumentWeapon: [],
    VampireTaste: [],
  };

  let mode = null;
  for (const row of data) {
    if (!row) continue;
    const first = str(row[0]).toLowerCase();
    if (first.includes('farmer')) { mode = 'FarmerWheel'; continue; }
    if (first.includes('instrument')) { mode = 'InstrumentWeapon'; continue; }
    if (first.includes('vampire') || first.includes('khẩu vị')) { mode = 'VampireTaste'; continue; }
    if (!mode) continue;
    if (['name', 'tên vũ khí', 'bạn thích ăn'].includes(first)) continue;

    const item = str(row[0]);
    if (!notEmpty(item)) continue;

    if (mode === 'FarmerWheel') {
      const w = toNum(row[1]);
      if (w === null) continue;
      wheels.FarmerWheel.push({ item, weight: w, effect: str(row[2]) });
    } else if (mode === 'InstrumentWeapon') {
      const w = toNum(row[1]);
      if (w === null) continue;
      wheels.InstrumentWeapon.push({ item, weight: w });
    } else if (mode === 'VampireTaste') {
      // weight ở col 2 (col 1 = NaN)
      const w = toNum(row[2]) ?? toNum(row[1]);
      if (w === null) continue;
      wheels.VampireTaste.push({ item, weight: w });
    }
  }
  return wheels;
}

// ─── main ─────────────────────────────────────────────────────────────────────

function parseGameData(filePath) {
  const wb = XLSX.readFile(filePath);
  const get = (name) => wb.Sheets[name] || wb.Sheets[Object.keys(wb.Sheets).find(k => k.trim() === name.trim())];

  const GameData = {
    Races: parseRaces(get('Race')),
    Subraces: parseSubraces(get('Subrace')),
    Stats: {
      ATK: parseStatSheet(get('ATK')),
      HP:  parseStatSheet(get('HP')),
      SPD: parseStatSheet(get('SPD')),
      IQ:  parseStatSheet(get('IQ')),
      BIQ: parseStatSheet(get('BIQ')),
      MA:  parseStatSheet(get('Weapon Mastery Martial Arts')),
    },
    SkillWheel:      parseSkillWheel(get('Skill Wheel')),
    Skills:          parseSkills(get('Skill')),
    Gear:            parseGear(get('Gear')),
    GearWheel:       parseGearWheel(get('Gear Wheel')),
    WeaponWheel:     parseWeaponWheel(get('Weapon wheel ')),
    Weapons:         parseWeapons(get('Weapons')),
    GeneratedWheels: parseGeneratedWheels(get('Generated Wheel')),
  };

  return GameData;
}

module.exports = { parseGameData };

// ─── CLI smoke test ───────────────────────────────────────────────────────────
if (require.main === module) {
  const filePath = process.argv[2] || path.join(__dirname, 'meobal.xlsx');
  const GameData = parseGameData(filePath);

  console.log('=== Smoke Test ===\n');

  console.log('Races (top 3):');
  GameData.Races.slice(0, 3).forEach(r => console.log(` - ${r.race}: weight=${r.weight}`));

  console.log('\nGameData.Stats.ATK["Goblin"]:');
  console.log(GameData.Stats.ATK['Goblin']);

  console.log('\nGameData.Stats.HP["Dragon"]:');
  console.log(GameData.Stats.HP['Dragon']);

  console.log('\nGameData.SkillWheel["Goblin"]:');
  console.log(GameData.SkillWheel['Goblin']);

  console.log('\nGameData.SkillWheel["Dragon"]:');
  console.log(GameData.SkillWheel['Dragon']);

  console.log('\nSubrace wheels available:', Object.keys(GameData.Subraces));

  console.log('\nGear count:', GameData.Gear.length);
  console.log('Skills count:', GameData.Skills.length);
  console.log('Weapons count:', GameData.Weapons.length);
}
