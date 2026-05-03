'use strict';

const MAX_TIME         = 180;
const BASE_INTERVAL    = 2.0;
const SPD_ACCEL        = 0.10;
const IQ_CD_REDUCE     = 0.1;
const BIQ_PARRY        = 0.036;
const HP_MULT          = 10;
const MIN_STAT         = 1;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const fmt   = t => `${t.toFixed(2)}s`;
const pct   = v => `${(v * 100).toFixed(1)}%`;

function initFighter(char, label) {
  const s       = char.stats;
  const ATK     = Math.max(s.ATK, MIN_STAT);
  const HP      = Math.max(s.HP,  MIN_STAT);
  const SPD     = Math.max(s.SPD, MIN_STAT);
  const BIQ     = Math.max(s.BIQ, MIN_STAT);
  const IQ      = s.IQ;
  const maxHp   = HP * HP_MULT;
  const armed   = char.weapon !== null && char.weapon !== undefined;
  return {
    label, char,
    ATK, HP, SPD, BIQ, IQ,
    armed,
    currentHp:    maxHp,
    maxHp,
    accelFactor:  1.0,
    parryRate:    armed ? 0 : clamp(BIQ * BIQ_PARRY, 0, 1),
    nextAttackAt: 0,
    skillCooldown: Math.max(0.5, 5.0 - IQ * IQ_CD_REDUCE),
    totalDamageDealt: 0, totalDamageTaken: 0,
    hitCount: 0, parryCount: 0, missCount: 0,
  };
}

function interval(att, def) {
  const base = BASE_INTERVAL / (att.SPD / 5);
  const diff = Math.max(0, att.SPD - def.SPD);
  return base / (att.accelFactor * (1 + diff * SPD_ACCEL));
}

function resolveAttack(att, def, t) {
  if (!def.armed && def.parryRate > 0 && Math.random() < def.parryRate) {
    def.parryCount++; att.missCount++;
    att.accelFactor = def.accelFactor = 1.0;
    return { time: t, type: 'parry', actor: att.label, target: def.label, damage: 0, hpLeft: def.currentHp,
      message: `${fmt(t)}: ${def.label} đỡ/né đòn của ${att.label}! (parry ${pct(def.parryRate)})` };
  }
  const dmg = att.ATK;
  def.currentHp -= dmg; att.totalDamageDealt += dmg; def.totalDamageTaken += dmg; att.hitCount++;
  att.accelFactor = def.accelFactor = 1.0;
  const hp = Math.max(0, def.currentHp);
  const dead = def.currentHp <= 0;
  return { time: t, type: dead ? 'kill' : 'hit', actor: att.label, target: def.label, damage: dmg, hpLeft: hp,
    message: `${fmt(t)}: ${att.label} đánh ${def.label} gây ${dmg} sát thương — ${def.label} còn ${hp}/${def.maxHp} HP${dead ? ' 💀' : ''}` };
}

function accel(f, opp, dt) {
  const diff = Math.max(0, f.SPD - opp.SPD);
  if (diff > 0) f.accelFactor += diff * SPD_ACCEL * dt;
}

function startCombat(player1, player2) {
  const nameA = player1.name || `[${player1.race.name}]`;
  const nameB = player2.name || `[${player2.race.name}]`;
  const fA = initFighter(player1, nameA);
  const fB = initFighter(player2, nameB);

  // SPD determines who goes first
  if      (fA.SPD > fB.SPD) { fA.nextAttackAt = 0; fB.nextAttackAt = interval(fB, fA) * 0.5; }
  else if (fB.SPD > fA.SPD) { fB.nextAttackAt = 0; fA.nextAttackAt = interval(fA, fB) * 0.5; }
  else { const coin = Math.random() < 0.5; fA.nextAttackAt = coin ? 0 : interval(fA,fB)*0.5; fB.nextAttackAt = coin ? interval(fB,fA)*0.5 : 0; }

  const combatLog = [], events = [];
  let time = 0, prev = 0;

  // header
  const header = [
    `══════════════════════════════════════════`,
    `  ${nameA}  vs  ${nameB}`,
    `══════════════════════════════════════════`,
    `${nameA}: ATK=${fA.ATK} HP=${fA.maxHp} SPD=${fA.SPD} IQ=${fA.IQ} BIQ=${fA.BIQ} ${fA.armed ? `WPN=${player1.weapon.name}` : '(unarmed)'}`,
    `${nameB}: ATK=${fB.ATK} HP=${fB.maxHp} SPD=${fB.SPD} IQ=${fB.IQ} BIQ=${fB.BIQ} ${fB.armed ? `WPN=${player2.weapon.name}` : '(unarmed)'}`,
  ];
  if (fA.parryRate > 0) header.push(`${nameA} parry: ${pct(fA.parryRate)}`);
  if (fB.parryRate > 0) header.push(`${nameB} parry: ${pct(fB.parryRate)}`);
  header.push(`──────────────────────────────────────────`);
  combatLog.push(...header);

  while (time <= MAX_TIME) {
    const aFirst = fA.nextAttackAt <= fB.nextAttackAt;
    const [att, def] = aFirst ? [fA, fB] : [fB, fA];
    prev = time; time = att.nextAttackAt;
    if (time > MAX_TIME) break;
    const dt = time - prev;
    accel(fA, fB, dt); accel(fB, fA, dt);
    const ev = resolveAttack(att, def, time);
    events.push(ev); combatLog.push(ev.message);
    att.nextAttackAt = time + interval(att, def);
    if (def.currentHp <= 0 || fA.currentHp <= 0 || fB.currentHp <= 0) break;
  }

  const aAlive = fA.currentHp > 0, bAlive = fB.currentHp > 0;
  let winner, reason;
  if (!aAlive && !bAlive)  { winner = 'draw'; reason = 'Cả hai cùng ngã.'; }
  else if (!bAlive)        { winner = nameA;  reason = `${nameB} hết máu.`; }
  else if (!aAlive)        { winner = nameB;  reason = `${nameA} hết máu.`; }
  else {
    const pa = fA.currentHp / fA.maxHp, pb = fB.currentHp / fB.maxHp;
    if (Math.abs(pa - pb) < 0.001) { winner = 'draw'; reason = `Hết giờ ${MAX_TIME}s — HP ngang nhau.`; }
    else if (pa > pb)              { winner = nameA;  reason = `Hết giờ ${MAX_TIME}s — ${nameA} nhiều HP hơn.`; }
    else                           { winner = nameB;  reason = `Hết giờ ${MAX_TIME}s — ${nameB} nhiều HP hơn.`; }
  }

  const duration = Math.min(time, MAX_TIME);
  combatLog.push(`──────────────────────────────────────────`);
  combatLog.push(winner === 'draw' ? `  KẾT QUẢ: HÒA — ${reason}` : `  KẾT QUẢ: ${winner} THẮNG — ${reason}`);
  combatLog.push(`  Thời lượng: ${fmt(duration)}`);
  combatLog.push(`  ${nameA}: ${Math.max(0,fA.currentHp)}/${fA.maxHp} HP | ${fA.hitCount} trúng | ${fA.parryCount} parry nhận`);
  combatLog.push(`  ${nameB}: ${Math.max(0,fB.currentHp)}/${fB.maxHp} HP | ${fB.hitCount} trúng | ${fB.parryCount} parry nhận`);
  combatLog.push(`══════════════════════════════════════════`);

  return {
    winner, reason, duration, combatLog, events,
    summary: {
      [nameA]: { hpRemaining: Math.max(0,fA.currentHp), hpMax: fA.maxHp, hpPercent: +(Math.max(0,fA.currentHp)/fA.maxHp*100).toFixed(1), totalDamageDealt: fA.totalDamageDealt, hitCount: fA.hitCount, parriedCount: fA.parryCount, parryRate: +(fA.parryRate*100).toFixed(1) },
      [nameB]: { hpRemaining: Math.max(0,fB.currentHp), hpMax: fB.maxHp, hpPercent: +(Math.max(0,fB.currentHp)/fB.maxHp*100).toFixed(1), totalDamageDealt: fB.totalDamageDealt, hitCount: fB.hitCount, parriedCount: fB.parryCount, parryRate: +(fB.parryRate*100).toFixed(1) },
    },
  };
}

module.exports = { startCombat };
