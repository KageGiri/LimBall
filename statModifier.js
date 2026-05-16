'use strict';

/**
 * applyStatModifiers
 * Applies base stats, gear effects, and skill effects to a fighter.
 * This is used to calculate final stats before combat starts.
 */
function applyStatModifiers(char) {
  const stats = { ...char.stats };

  // 1. Gear Effects
  if (char.gears) {
    for (const g of char.gears) {
      const e = g.effect.toLowerCase();
      if (e.includes('+2 speed')) stats.SPD = Math.max(1, stats.SPD + 2);
      if (e.includes('+2 hp')) stats.HP = Math.max(1, stats.HP + 2);
      if (e.includes('+1 iq')) stats.IQ = Math.max(1, stats.IQ + 1);
      if (e.includes('+3 iq')) stats.IQ = Math.max(1, stats.IQ + 3);
      if (e.includes('+1 biq')) stats.BIQ = Math.max(1, stats.BIQ + 1);
      if (e.includes('+3 biq')) stats.BIQ = Math.max(1, stats.BIQ + 3);
      if (e.includes('+1 iq') && e.includes('+2 biq')) {
        stats.IQ = Math.max(1, stats.IQ + 1);
        stats.BIQ = Math.max(1, stats.BIQ + 2);
      }
      if (e.includes('+3 atk') && e.includes('+3 hp')) {
        stats.ATK = Math.max(1, stats.ATK + 3);
        stats.HP = Math.max(1, stats.HP + 3);
      }
      if (e.includes('+1 atk') && e.includes('+1 hp')) {
        stats.ATK = Math.max(1, stats.ATK + 1);
        stats.HP = Math.max(1, stats.HP + 1);
      }
      if (e.includes('-2 speed')) stats.SPD = Math.max(1, stats.SPD - 2);
      if (e.includes('-1 iq') && e.includes('-1 biq')) {
        stats.IQ = Math.max(1, stats.IQ - 1);
        stats.BIQ = Math.max(1, stats.BIQ - 1);
      }
      if (e.includes('+4 atk') && e.includes('+4 hp')) {
        stats.ATK = Math.max(1, stats.ATK + 4);
        stats.HP = Math.max(1, stats.HP + 4);
      }
      if (e.includes('+1 hp') && e.includes('-1 iq')) {
        stats.HP = Math.max(1, stats.HP + 1);
        stats.IQ = Math.max(1, stats.IQ - 1);
      }
    }
  }

  // 2. Skill Effects
  if (char.skills) {
    for (const sk of char.skills) {
      if (sk.name === 'Swinging Maestro') stats.BIQ = Math.max(1, stats.BIQ + 4);
      if (sk.name === 'Enlarging') {
        stats.ATK = Math.max(1, stats.ATK + 3);
        stats.HP = Math.max(1, stats.HP + 3);
        stats.SPD = Math.max(1, stats.SPD - 6);
      }
      if (sk.name === 'Shrinking') {
        stats.SPD = Math.max(1, stats.SPD + 6);
        stats.ATK = Math.max(1, stats.ATK - 3);
        stats.HP = Math.max(1, stats.HP - 3);
      }
      if (sk.name === 'Healing Factor') stats.HP = Math.max(1, stats.HP + 1);
    }
  }

  // 3. Weapon Mastery milestones
  if (char.weapon) {
    const ma = stats.MA || 0;
    const mkeys = Object.keys(char.weapon.milestones || {}).map(Number).filter(k => k <= ma);
    if (mkeys.length) {
      const mk = Math.max(...mkeys);
      const eff = char.weapon.milestones[mk].effect.toLowerCase();
      if (eff.includes('+1 atk')) stats.ATK = Math.max(1, stats.ATK + 1);
      if (eff.includes('+2 atk')) stats.ATK = Math.max(1, stats.ATK + 2);
      if (eff.includes('+1 speed') || eff.includes('+1 spd')) stats.SPD = Math.max(1, stats.SPD + 1);
      if (eff.includes('+2 speed')) stats.SPD = Math.max(1, stats.SPD + 2);
      if (eff.includes('+1 biq')) stats.BIQ = Math.max(1, stats.BIQ + 1);
      if (eff.includes('+2 biq')) stats.BIQ = Math.max(1, stats.BIQ + 2);
    }
  }

  // enforce minimums
  stats.ATK = Math.max(1, stats.ATK);
  stats.HP = Math.max(1, stats.HP);
  stats.SPD = Math.max(1, stats.SPD);
  stats.BIQ = Math.max(1, stats.BIQ);
  stats.IQ = Math.max(0, stats.IQ);

  return stats;
}

module.exports = { applyStatModifiers };
