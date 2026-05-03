'use strict';

const { spinWheel }    = require('./spinWheel');
const { parseGameData } = require('./parseGameData');
const path = require('path');

const EXCEL = path.join(__dirname, 'meobal.xlsx');
let _G = null;
const G = () => { if (!_G) _G = parseGameData(EXCEL); return _G; };

// ─── helpers ──────────────────────────────────────────────────────────────────
const clamp = (v, min) => Math.max(v, min);

function spinStat(table, race) {
  const raceKey = Object.keys(table).find(k => k.toLowerCase() === race.toLowerCase());
  const data    = raceKey ? table[raceKey] : null;
  if (!data) return { value: null, fixed: true, note: `Không có stat cho tộc "${race}"` };
  const slices = data.filter(s => s.weight !== null && s.weight > 0).map(s => ({ item: s.level, weight: s.weight }));
  if (!slices.length) return { value: 1, fixed: true, note: 'Cố định theo luật tộc' };
  return { value: spinWheel(slices).item, fixed: false };
}

function sampleWithoutReplacement(list, count) {
  const pool = [...list]; const chosen = [];
  for (let i = 0; i < count && pool.length; i++) {
    const r = spinWheel(pool);
    chosen.push(r);
    pool.splice(pool.findIndex(x => x.item === r.item), 1);
  }
  return chosen;
}

// ─── main ─────────────────────────────────────────────────────────────────────
function generateCharacter() {
  const { Races, Stats, SkillWheel, Skills, Gear, GearWheel, WeaponWheel, Weapons } = G();

  // 1. Race
  const raceResult = spinWheel(Races.map(r => ({ item: r.race, weight: r.weight, ...r })));
  const raceName   = raceResult.item;
  const raceInfo   = Races.find(r => r.race === raceName);

  // 2. Stats (Skeleton IQ fixed = 1)
  const rawStats = {
    ATK: spinStat(Stats.ATK, raceName),
    HP:  spinStat(Stats.HP,  raceName),
    SPD: spinStat(Stats.SPD, raceName),
    IQ:  raceName.toLowerCase() === 'skeleton'
           ? { value: 1, fixed: true, note: 'Skeleton IQ cố định = 1' }
           : spinStat(Stats.IQ, raceName),
    BIQ: spinStat(Stats.BIQ, raceName),
    MA:  spinStat(Stats.MA,  raceName),
  };
  const stats = {
    ATK: clamp(rawStats.ATK.value ?? 1, 1),
    HP:  clamp(rawStats.HP.value  ?? 1, 1),
    SPD: clamp(rawStats.SPD.value ?? 1, 1),
    IQ:  clamp(rawStats.IQ.value  ?? 1, 1),
    BIQ: clamp(rawStats.BIQ.value ?? 1, 1),
    MA:  clamp(rawStats.MA.value  ?? 1, 1),
  };

  // 3. Skills
  const skillWheelKey = Object.keys(SkillWheel).find(k => k.toLowerCase() === raceName.toLowerCase());
  const swSlices      = skillWheelKey
    ? SkillWheel[skillWheelKey].map(s => ({ item: s.skillCount, weight: s.weight }))
    : [{ item: 0, weight: 100 }];
  const skillCount = spinWheel(swSlices).item;
  const skills = skillCount > 0
    ? sampleWithoutReplacement(Skills.map(s => ({ item: s.name, weight: s.weight, effect: s.effect })), skillCount)
        .map(s => ({ name: s.item, effect: s.effect }))
    : [];

  // 4. Weapon (70/30)
  const hasWeapon = spinWheel(WeaponWheel).item === 'Có';
  let weapon = null;
  if (hasWeapon && Weapons.length) {
    const w = spinWheel(Weapons.map(w => ({ item: w.name, weight: 1, category: w.category, milestones: w.milestones })));
    weapon = { name: w.item, category: w.category, milestones: w.milestones };
  }

  // 5. Gear
  const gearCount = spinWheel(GearWheel.map(g => ({ item: g.gearCount, weight: g.weight }))).item;
  const gears = gearCount > 0
    ? sampleWithoutReplacement(Gear.map(g => ({ item: g.name, weight: g.weight, effect: g.effect, type: g.type })), gearCount)
        .map(g => ({ name: g.item, effect: g.effect, type: g.type }))
    : [];

  return {
    race:   { name: raceName, subraceWheel: raceInfo?.subraceWheel || null, trait: raceInfo?.trait || null },
    stats,
    statsNotes: Object.fromEntries(
      Object.entries(rawStats).filter(([, v]) => v.fixed && v.note).map(([k, v]) => [k, v.note])
    ),
    skills,
    weapon,
    gears,
  };
}

module.exports = { generateCharacter };
