'use strict';

const { applyStatModifiers } = require('./statModifier');

// ══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const MAX_TIME      = 180;
const BASE_INTERVAL = 2.0;
const SPD_ACCEL     = 0.10;
const IQ_CD_REDUCE  = 0.1;
const BIQ_PARRY     = 0.036;
const HP_MULT       = 10;
const MIN_STAT      = 1;

const CAT = {
  SWORD:'sword', DAGGER:'dagger', POLEARM:'polearms',
  BOW:'bow/crossbow', FIREARM:'firearm', MAGIC:'magic',
  SPECIAL:'special', UNARMED:'unarmed',
};
const PROJ_TRAVEL = { [CAT.BOW]:0.6, [CAT.FIREARM]:0.25, [CAT.MAGIC]:0.5 };

const clamp = (v,lo,hi) => Math.min(Math.max(v,lo),hi);
const fmt   = t => `${t.toFixed(2)}s`;
const pct   = v => `${(v*100).toFixed(1)}%`;

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT HOOK SYSTEM
//  ─────────────────────────────────────────────────────────────────────────────
//  Mỗi fighter có object `hooks` chứa 4 hook arrays:
//    hooks.onTick[]          : (fighter, opponent, dt, t, log) => void
//    hooks.onTakeDamage[]    : (fighter, opponent, dmg, log) => { dmg, cancel }
//    hooks.onDealDamage[]    : (fighter, opponent, dmg, log) => { dmg }
//    hooks.onParry[]         : (fighter, opponent, log) => void
//
//  Mỗi hook là { id, fn } để dễ remove.
//  Helper: addHook / removeHook
// ══════════════════════════════════════════════════════════════════════════════

function makeHooks() {
  return { onTick: [], onTakeDamage: [], onDealDamage: [], onParry: [] };
}

function addHook(hooks, type, id, fn) {
  if (!hooks[type].find(h => h.id === id))
    hooks[type].push({ id, fn });
}

function removeHook(hooks, type, id) {
  hooks[type] = hooks[type].filter(h => h.id !== id);
}

// ─── Fire helpers ─────────────────────────────────────────────────────────────
function fireTick(fighter, opponent, dt, t, log) {
  fighter.hooks.onTick.forEach(h => h.fn(fighter, opponent, dt, t, log));
}

/**
 * fireTakeDamage — runs before HP is subtracted.
 * Each hook may modify dmg or set cancel=true.
 * Returns { finalDmg, cancelled }
 */
function fireTakeDamage(defender, attacker, rawDmg, log) {
  let dmg = rawDmg, cancelled = false;
  for (const h of defender.hooks.onTakeDamage) {
    const res = h.fn(defender, attacker, dmg, log);
    if (res) {
      if (res.dmg !== undefined) dmg = res.dmg;
      if (res.cancel) { cancelled = true; break; }
    }
  }
  return { finalDmg: Math.max(0, dmg), cancelled };
}

/**
 * fireDealDamage — runs after hit is confirmed (after parry check).
 * Each hook may add to dmg.
 * Returns finalDmg.
 */
function fireDealDamage(attacker, defender, rawDmg, log) {
  let dmg = rawDmg;
  for (const h of attacker.hooks.onDealDamage) {
    const res = h.fn(attacker, defender, dmg, log);
    if (res && res.dmg !== undefined) dmg = res.dmg;
  }
  return Math.max(0, dmg);
}

function fireParry(defender, attacker, log) {
  defender.hooks.onParry.forEach(h => h.fn(defender, attacker, log));
}

// ══════════════════════════════════════════════════════════════════════════════
//  HOOK REGISTRY
//  buildHooks(fighter) → populates fighter.hooks from skills & gears
// ══════════════════════════════════════════════════════════════════════════════

function buildHooks(fighter) {
  fighter.hooks = makeHooks();
  const sk  = name => fighter.char.skills.some(s  => s.name === name);
  const gr  = name => fighter.char.gears.some(g  => g.name === name);
  const grs = fighter.char.gears || [];

  // ══════════════════════════════════════════════════════════════════════════
  //  onTick HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  // ── U=ma2: hồi 3 HP mỗi 3s khi SPD thấp hơn đối thủ ────────────────────
  //  Text: "Trong combat: Spd mình thấp hơn sẽ hồi 3 Hp mỗi 3 giây"
  if (sk('U=ma2')) {
    fighter._uma2Timer = 0;
    addHook(fighter.hooks, 'onTick', 'uma2', (f, opp, dt, t, log) => {
      if (f.SPD >= opp.SPD) return;
      f._uma2Timer += dt;
      if (f._uma2Timer >= 3) {
        f._uma2Timer -= 3;
        const heal = 3 * HP_MULT;
        f.currentHp = Math.min(f.maxHp, f.currentHp + heal);
        log.push(`${fmt(t)}: [U=ma2] ${f.label} hồi ${heal} HP (${Math.round(f.currentHp)}/${f.maxHp})`);
      }
    });
  }

  // ── Earth-Quake: mỗi 10s stun đối thủ 1s ────────────────────────────────
  //  Text: "Mỗi 10s sẽ khiến toàn bộ sân đấu rung chuyển và khiến đối thủ bất động trong 1s"
  if (sk('Earth-Quake')) {
    fighter._eqTimer = 0;
    addHook(fighter.hooks, 'onTick', 'earthquake', (f, opp, dt, t, log) => {
      f._eqTimer += dt;
      if (f._eqTimer >= 10) {
        f._eqTimer -= 10;
        opp.stunTimer = Math.max(opp.stunTimer || 0, 1);
        log.push(`${fmt(t)}: [Earth-Quake] ${f.label} rung chuyển sân! ${opp.label} bất động 1s`);
      }
    });
  }

  // ── Tornado: mỗi 10s hút đối thủ lại gần ───────────────────────────────
  //  Text: "Mỗi 10s sẽ tạo 1 vòi rồng ở tâm đấu trường hút tất cả lại gần"
  if (sk('Tornado')) {
    fighter._tornadoTimer = 0;
    addHook(fighter.hooks, 'onTick', 'tornado', (f, opp, dt, t, log) => {
      f._tornadoTimer += dt;
      if (f._tornadoTimer >= 10) {
        f._tornadoTimer -= 10;
        // Kéo đối thủ → giảm tốc độ tấn công (simulate pull: shorten their next attack)
        if (opp.nextAttackAt !== undefined)
          opp.nextAttackAt = Math.max(0, opp.nextAttackAt - 0.3);
        log.push(`${fmt(t)}: [Tornado] ${f.label} tạo vòi rồng! ${opp.label} bị kéo lại`);
      }
    });
  }

  // ── Incineration: mỗi 10s tạo vòng lửa bán kính 3.6× ──────────────────
  //  Text: "Cứ 10s tạo ra một vòng tròn lửa... tồn tại trong 0.67s"
  if (sk('Incineration')) {
    fighter._incinerTimer = 0;
    fighter._incinerWave  = null; // { endTime }
    addHook(fighter.hooks, 'onTick', 'incineration', (f, opp, dt, t, log) => {
      f._incinerTimer += dt;
      // Check active wave hits
      if (f._incinerWave && t <= f._incinerWave.endTime) {
        const dmgPerSec = 5 * HP_MULT / 0.67;
        const waveDmg = Math.round(dmgPerSec * dt);
        if (waveDmg > 0) {
          opp.currentHp = Math.max(0, opp.currentHp - waveDmg);
          log.push(`${fmt(t)}: [Incineration] vòng lửa gây ${waveDmg} HP cho ${opp.label}`);
        }
      }
      if (f._incinerTimer >= 10) {
        f._incinerTimer -= 10;
        f._incinerWave = { endTime: t + 0.67 };
        log.push(`${fmt(t)}: [Incineration] ${f.label} tạo vòng lửa! (0.67s)`);
      }
    });
  }

  // ── Steroid: -1% maxHp mỗi giây ─────────────────────────────────────────
  //  Text: "(2). Mỗi giây trừ 1% điểm HP"
  if (gr('Steroid')) {
    addHook(fighter.hooks, 'onTick', 'steroid', (f, _opp, dt, t, log) => {
      const drain = Math.ceil(f.maxHp * 0.01 * dt);
      f.currentHp = Math.max(1, f.currentHp - drain);
      // chỉ log mỗi 5s để tránh spam
      if (Math.floor(t) % 5 === 0 && dt > 0)
        log.push(`${fmt(t)}: [Steroid] ${f.label} mất ${drain} HP (${Math.round(f.currentHp)}/${f.maxHp})`);
    });
  }

  // ── Determined Investor: 10s không bị trúng → +1 ATK +1 SPD ─────────────
  //  Text: "Sau mỗi 10s không bị trúng đòn sẽ được +1 ATK và +1 SPD"
  if (gr('Determined Investor')) {
    fighter._deterTimer = 0;
    addHook(fighter.hooks, 'onTick', 'determined_investor', (f, _opp, dt, t, log) => {
      f._deterTimer += dt;
      if (f._deterTimer >= 10) {
        f._deterTimer -= 10;
        f.ATK++;
        f.SPD = Math.max(1, f.SPD + 1);
        log.push(`${fmt(t)}: [Determined Investor] ${f.label} +1 ATK (→${f.ATK}), +1 SPD (→${f.SPD})`);
      }
    });
  }

  // ── Cuộn khăn giấy: 10s không bị tấn công → hồi 1 HP ───────────────────
  //  Text: "Sau 10s không bị tấn công hồi 1 điểm Hp"
  if (gr('Cuộn khăn giấy')) {
    fighter._scrollTimer = 0;
    addHook(fighter.hooks, 'onTick', 'scroll_heal', (f, _opp, dt, t, log) => {
      f._scrollTimer += dt;
      if (f._scrollTimer >= 10) {
        f._scrollTimer -= 10;
        const heal = 1 * HP_MULT;
        f.currentHp = Math.min(f.maxHp, f.currentHp + heal);
        log.push(`${fmt(t)}: [Cuộn khăn giấy] ${f.label} hồi ${heal} HP`);
      }
    });
  }

  // ── Debuff timer: giảm dần SPD debuff từ Frost Fingers ──────────────────
  fighter._frostDebuffTimer = 0;
  addHook(fighter.hooks, 'onTick', 'frost_debuff_tick', (f, _opp, dt, _t, _log) => {
    if ((f.spdDebuff || 0) < 0) {
      f._frostDebuffTimer += dt;
      if (f._frostDebuffTimer >= 10) {
        f._frostDebuffTimer = 0;
        f.spdDebuff = 0; // hết hiệu ứng chậm
      }
    }
  });

  // ── Stun countdown ────────────────────────────────────────────────────────
  addHook(fighter.hooks, 'onTick', 'stun_tick', (f, _opp, dt, _t, _log) => {
    if ((f.stunTimer || 0) > 0) f.stunTimer = Math.max(0, f.stunTimer - dt);
  });

  // ── Phasing: 0.5s immune sau khi bị trúng ────────────────────────────────
  //  Text: "Sau khi dính sát thương nhận 0.5s tàng hình..."
  if (sk('Phasing')) {
    fighter._phasingTimer = 0;
    addHook(fighter.hooks, 'onTick', 'phasing_tick', (f, _opp, dt, _t, _log) => {
      if (f._phasingTimer > 0) f._phasingTimer = Math.max(0, f._phasingTimer - dt);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  onTakeDamage HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Phasing: cancel damage nếu đang trong 0.5s immune ───────────────────
  if (sk('Phasing')) {
    addHook(fighter.hooks, 'onTakeDamage', 'phasing_block', (f, att, dmg, log) => {
      if (f._phasingTimer > 0) {
        log.push(`  [Phasing] ${f.label} tàng hình — miễn sát thương!`);
        return { cancel: true };
      }
      // Activate phasing after taking damage
      f._phasingTimer = 0.5;
    });
  }

  // ── Frost Armor: +2 HP khi bị trúng đòn, giảm 1 SPD đối thủ ────────────
  //  Text: "Nhận +2 Hpbility khi bị trúng đòn sẽ giảm 1 spd của đối thủ"
  if (sk('Frost Armor')) {
    addHook(fighter.hooks, 'onTakeDamage', 'frost_armor', (f, att, dmg, log) => {
      const heal = 2 * HP_MULT;
      f.currentHp = Math.min(f.maxHp, f.currentHp + heal);
      att.SPD = Math.max(1, att.SPD - 1);
      log.push(`  [Frost Armor] ${f.label} hồi ${heal} HP | ${att.label} -1 SPD (→${att.SPD})`);
    });
  }

  // ── Giáp gai: reflect 15% ────────────────────────────────────────────────
  //  Text: "Phản lại 15% sát thương khi bị trúng đòn"
  if (gr('Giáp gai')) {
    addHook(fighter.hooks, 'onTakeDamage', 'giap_gai', (f, att, dmg, log) => {
      const reflect = Math.round(dmg * 0.15);
      att.currentHp = Math.max(0, att.currentHp - reflect);
      log.push(`  [Giáp gai] ${f.label} phản ${reflect} HP → ${att.label} (${Math.round(att.currentHp)}/${att.maxHp})`);
    });
  }

  // ── EMP: vô hiệu hóa tấn công đối thủ 2s khi mất ≥ 5 HP ────────────────
  //  Text: "Vô hiệu hóa khả năng tấn công trong 2s của kẻ địch mỗi khi mất 5 điểm máu trở lên"
  if (sk('EMP')) {
    addHook(fighter.hooks, 'onTakeDamage', 'emp', (f, att, dmg, log) => {
      if (dmg >= 5 * HP_MULT) {
        att.stunTimer = Math.max(att.stunTimer || 0, 2);
        log.push(`  [EMP] ${f.label} bị ${dmg} HP → ${att.label} bị vô hiệu 2s!`);
      }
    });
  }

  // ── Healing Flasks: hồi 15% HP khi dưới 50%, chỉ 1 lần ─────────────────
  //  Text: "Khi Hp dưới 50% sẽ sử dụng để hồi lại 15%Hp ( chỉ dùng 1 lần )"
  if (gr('Healing Flasks')) {
    fighter._flaskUsed = false;
    addHook(fighter.hooks, 'onTakeDamage', 'healing_flasks', (f, _att, _dmg, log) => {
      if (f._flaskUsed) return;
      // Check HP after damage would be applied (currentHp already reduced in resolveAttack)
      if (f.currentHp / f.maxHp < 0.5) {
        f._flaskUsed = true;
        const heal = Math.round(f.maxHp * 0.15);
        f.currentHp = Math.min(f.maxHp, f.currentHp + heal);
        log.push(`  [Healing Flasks] ${f.label} kích hoạt! +${heal} HP (${Math.round(f.currentHp)}/${f.maxHp})`);
      }
    });
  }

  // ── Determined Investor + Cuộn khăn giấy: reset timer khi bị đánh ───────
  if (gr('Determined Investor')) {
    addHook(fighter.hooks, 'onTakeDamage', 'deter_reset', (f, _att, _dmg, _log) => {
      f._deterTimer = 0;
    });
  }
  if (gr('Cuộn khăn giấy')) {
    addHook(fighter.hooks, 'onTakeDamage', 'scroll_reset', (f, _att, _dmg, _log) => {
      f._scrollTimer = 0;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  onDealDamage HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Bloody Strike: 50% → -3 HP self, +6 dmg ─────────────────────────────
  //  Text: "Có 50% tự giảm 3 máu của bản thân để gây thêm 6 điểm sát thương"
  if (sk('Bloody Strike')) {
    addHook(fighter.hooks, 'onDealDamage', 'bloody_strike', (f, _def, dmg, log) => {
      if (Math.random() < 0.5) {
        f.currentHp = Math.max(0, f.currentHp - 3 * HP_MULT);
        const bonus = 6 * HP_MULT;
        log.push(`  [Bloody Strike] ${f.label} -${3*HP_MULT} HP bản thân, +${bonus} sát thương`);
        return { dmg: dmg + bonus };
      }
    });
  }

  // ── Critical Strike: 20% × 1.5, tối đa 5 stack (tăng critical chance) ───
  //  Text: "bạn có 20% gây gấp 1.5 lần sát thương. Max 5 stack"
  if (sk('Critical Strike')) {
    fighter._critStacks = 0;
    addHook(fighter.hooks, 'onDealDamage', 'critical_strike', (f, _def, dmg, log) => {
      const chance = 0.20 + f._critStacks * 0.04; // mỗi stack +4%
      if (Math.random() < chance) {
        const crit = Math.round(dmg * 1.5);
        if (f._critStacks < 5) f._critStacks++;
        log.push(`  [Critical Strike] CRIT! ${dmg}→${crit} (stack ${f._critStacks})`);
        return { dmg: crit };
      }
    });
  }

  // ── Bloodlust: sau mỗi lần đánh trúng → -2 IQ, +1 ATK, +1 SPD, +2 HP ──
  //  Text: "Sau lần đánh trúng kẻ địch, nhận -2 IQ và +1 atk, +1 Speed, +2 Hp"
  if (sk('Bloodlust')) {
    addHook(fighter.hooks, 'onDealDamage', 'bloodlust', (f, _def, dmg, log) => {
      f.IQ  = Math.max(0, f.IQ - 2);
      f.ATK++;
      f.SPD = Math.max(1, f.SPD + 1);
      f.currentHp = Math.min(f.maxHp, f.currentHp + 2 * HP_MULT);
      log.push(`  [Bloodlust] ${f.label}: -2 IQ, +1 ATK(→${f.ATK}), +1 SPD(→${f.SPD}), +2 HP`);
    });
  }

  // ── Evasion: tích stack mỗi khi đánh trúng → mỗi stack +10% né ──────────
  //  Text: "bạn có 10% nhận được né cho mỗi stack. max 6 stack"
  if (sk('Evasion')) {
    fighter._evasionStacks = 0;
    addHook(fighter.hooks, 'onDealDamage', 'evasion_stack', (f, _def, _dmg, log) => {
      if (f._evasionStacks < 6) {
        f._evasionStacks++;
        // Cập nhật parryRate
        f.parryRate = Math.min(1, f._evasionStacks * 0.10);
        log.push(`  [Evasion] ${f.label} stack ${f._evasionStacks} → né ${pct(f.parryRate)}`);
      }
    });
  }

  // ── Frost Fingers: 35% → -3 SPD đối thủ 10s ─────────────────────────────
  //  Text: "Sau mỗi đòn trúng đích, đối thủ có 35% bị -3 spd trong 10s"
  if (sk('Frost Fingers')) {
    addHook(fighter.hooks, 'onDealDamage', 'frost_fingers', (f, def, _dmg, log) => {
      if (Math.random() < 0.35) {
        def.spdDebuff   = (def.spdDebuff || 0) - 3;
        def._frostDebuffTimer = 0; // reset timer
        log.push(`  [Frost Fingers] ${def.label} -3 SPD trong 10s (→${def.SPD + def.spdDebuff})`);
      }
    });
  }

  // ── Fishing Rod: 30% kéo đối thủ lại khi dùng ranged ────────────────────
  //  Text: "Nếu dùng vũ khí tầm xa có tỉ lệ 30% kéo đối thủ lại gần"
  if (gr('Fishing Rod')) {
    const isRanged = [CAT.BOW, CAT.FIREARM, CAT.MAGIC].includes(
      resolveCategory(fighter.char.weapon)
    );
    if (isRanged) {
      addHook(fighter.hooks, 'onDealDamage', 'fishing_rod', (f, def, _dmg, log) => {
        if (Math.random() < 0.30) {
          // Simulate pull: shorten defender next attack (they're off-balance)
          if (def.nextAttackAt !== undefined) def.nextAttackAt += 0.5;
          log.push(`  [Fishing Rod] ${f.label} kéo ${def.label} lại! (next attack +0.5s)`);
        }
      });
    }
  }

  // ── Golden Coin: mỗi coin stack → đổi 1 điểm stat cao nhất đối thủ ──────
  //  Text: "Với mỗi đồng tiền Vàng trong người (stack được), sẽ mua lại 1 điểm
  //         của chỉ số cao nhất của đối thủ để cộng cho chỉ số thấp nhất của bản thân"
  const coinCount = grs.filter(g => g.name === 'Golden Coin').length;
  if (coinCount > 0) {
    addHook(fighter.hooks, 'onDealDamage', 'golden_coin', (f, def, _dmg, log) => {
      const STATS = ['ATK','HP','SPD','IQ','BIQ'];
      for (let c = 0; c < coinCount; c++) {
        const maxStat = STATS.reduce((a,b) => (def[a]||0) >= (def[b]||0) ? a : b);
        const minStat = STATS.reduce((a,b) => (f[a]||0)  <= (f[b]||0)  ? a : b);
        if ((def[maxStat] || 0) > 1) {
          def[maxStat] = (def[maxStat] || 0) - 1;
          f[minStat]   = (f[minStat]  || 0) + 1;
          log.push(`  [Golden Coin] ${f.label}: ${def.label} -1 ${maxStat} → ${f.label} +1 ${minStat}`);
        }
      }
    });
  }

  // ── The Sand of Time: sau mỗi đòn trúng → giảm CD bản thân, tăng CD đối thủ ─
  //  Text: "giảm 1s hồi skill của mình và tăng 1s hồi skill cho đối thủ"
  if (sk('The Sand of Time')) {
    addHook(fighter.hooks, 'onDealDamage', 'sand_of_time', (f, def, _dmg, log) => {
      f.skillCooldown   = Math.max(0.5, (f.skillCooldown || 5) - 1);
      def.skillCooldown = (def.skillCooldown || 5) + 1;
      log.push(`  [Sand of Time] ${f.label} CD -1s (→${f.skillCooldown.toFixed(1)}s) | ${def.label} CD +1s`);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  onParry HOOKS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Bash: sau khi parry → đẩy lùi và gây choáng 3s ─────────────────────
  //  Text: "Sau mỗi lần parry, đẩy kẻ địch về phía trước gây choáng 3s"
  if (sk('Bash')) {
    addHook(fighter.hooks, 'onParry', 'bash', (f, att, log) => {
      att.stunTimer = Math.max(att.stunTimer || 0, 3);
      // Knockback simulated: delay next attack
      if (att.nextAttackAt !== undefined) att.nextAttackAt += 1.0;
      log.push(`  [Bash] ${f.label} BASH! ${att.label} choáng 3s + knockback`);
    });
  }

  // ── Evasion on parry: +1 stack ────────────────────────────────────────────
  if (sk('Evasion')) {
    addHook(fighter.hooks, 'onParry', 'evasion_parry_stack', (f, _att, log) => {
      if (f._evasionStacks < 6) {
        f._evasionStacks++;
        f.parryRate = Math.min(1, f._evasionStacks * 0.10);
        log.push(`  [Evasion+Parry] ${f.label} stack ${f._evasionStacks} → né ${pct(f.parryRate)}`);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  WEAPON SCALE (giữ nguyên từ v2)
// ══════════════════════════════════════════════════════════════════════════════
const WEAPON_SCALE = {
  [CAT.SWORD]:   { label:'⚔ Sword',   projectile:false,
    onHit(a,_d,log){ a.ATK++; log.push(`  ↑ Sword: ${a.label} ATK→${a.ATK}`); } },
  [CAT.DAGGER]:  { label:'🗡 Dagger',  projectile:false, secondHitDelay:0.12,
    onHit(a,_d,log){ a.BIQ=Math.min(a.BIQ+1,20); log.push(`  ↑ Dagger: ${a.label} BIQ→${a.BIQ}`); } },
  [CAT.POLEARM]: { label:'🏹 Polearm', projectile:false, rangeBonus:0.8,
    onHit(a,_d,log){
      a._polearmAccum=(a._polearmAccum||0)+0.5;
      if(a._polearmAccum>=1){ const b=Math.floor(a._polearmAccum); a.ATK+=b; a._polearmAccum-=b;
        log.push(`  ↑ Polearm: ${a.label} ATK→${a.ATK}`); }
    } },
  [CAT.BOW]:     { label:'🏹 Bow',     projectile:true,  travelTime:PROJ_TRAVEL[CAT.BOW],
    onHit(a,_d,log){ a._bowExtraShots=(a._bowExtraShots||0)+1; log.push(`  ↑ Bow: extra shots→${a._bowExtraShots}`); },
    projectileCount(a){ return 1+(a._bowExtraShots||0); } },
  [CAT.FIREARM]: { label:'🔫 Firearm', projectile:true,  travelTime:PROJ_TRAVEL[CAT.FIREARM],
    onHit(a,_d,log){ a.ATK++; a._firearmSpeedMult=Math.max(0.4,(a._firearmSpeedMult||1)*0.92);
      log.push(`  ↑ Firearm: ${a.label} ATK→${a.ATK} speed×${a._firearmSpeedMult.toFixed(2)}`); },
    projectileCount:()=>1, intervalMult(a){ return a._firearmSpeedMult||1; } },
  [CAT.MAGIC]:   { label:'🔮 Magic',   projectile:true,  travelTime:PROJ_TRAVEL[CAT.MAGIC], baseInterval:2.5,
    onHit(a,_d,log){ a.BIQ=Math.min(a.BIQ+1,20); a._magicSize=(a._magicSize||1)+0.3;
      log.push(`  ↑ Magic: ${a.label} BIQ→${a.BIQ} size×${a._magicSize.toFixed(1)}`); },
    projectileCount:()=>1 },
  [CAT.UNARMED]: { label:'✊ Unarmed', projectile:false, onHit(){}  },
  [CAT.SPECIAL]: { label:'✨ Special', projectile:false, onHit(){}  },
};

function resolveCategory(weapon) {
  if (!weapon) return CAT.UNARMED;
  const raw = (weapon.category||'').toLowerCase().trim();
  if (raw.includes('sword'))   return CAT.SWORD;
  if (raw.includes('dagger'))  return CAT.DAGGER;
  if (raw.includes('polearm')) return CAT.POLEARM;
  if (raw.includes('bow'))     return CAT.BOW;
  if (raw.includes('firearm')||raw.includes('gun')) return CAT.FIREARM;
  if (raw.includes('magic'))   return CAT.MAGIC;
  return CAT.UNARMED;
}

// ══════════════════════════════════════════════════════════════════════════════
//  STAT MODIFIER INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════
function computeFinalStats(p1, p2) {
  const preLog = [];
  const r1 = applyStatModifiers(p1);
  const r2 = applyStatModifiers(p2);
  if (r1.log.length) { preLog.push(`── ${p1.name} STAT MODIFIERS ──`); r1.log.forEach(l=>preLog.push(`  ${l}`)); }
  if (r2.log.length) { preLog.push(`── ${p2.name} STAT MODIFIERS ──`); r2.log.forEach(l=>preLog.push(`  ${l}`)); }
  for (const d of r1.opponentDebuffs) { r2.finalStats[d.stat]=Math.max(1,(r2.finalStats[d.stat]||0)+d.delta); preLog.push(`  ${p1.name} debuff→${p2.name}: ${d.delta} ${d.stat}`); }
  for (const d of r2.opponentDebuffs) { r1.finalStats[d.stat]=Math.max(1,(r1.finalStats[d.stat]||0)+d.delta); preLog.push(`  ${p2.name} debuff→${p1.name}: ${d.delta} ${d.stat}`); }
  const HOLY=new Set(['demon','vampire','spirit','orc','skeleton','goblin']);
  const applyHoly=(att,defS,defName)=>{ if(!(att.gears||[]).some(g=>g.name==='Holy Symbol')) return; if(!HOLY.has((defName||'').toLowerCase())) return; ['ATK','HP','SPD','IQ','BIQ','MA'].forEach(s=>{defS[s]=Math.max(1,(defS[s]||0)-2);}); preLog.push(`  Holy Symbol: ${defName} -2 all`); };
  applyHoly(p1,r2.finalStats,p2.race?.name||p2.race||'');
  applyHoly(p2,r1.finalStats,p1.race?.name||p1.race||'');
  const applyGN=(char,ownS,oppS)=>{ if(!(char.gears||[]).some(g=>g.name==='Giấy Nợ Gia Truyền')) return; const t=Math.floor((ownS.ATK||0)*0.5); ownS.ATK=Math.max(1,(ownS.ATK||0)-t); oppS.ATK=(oppS.ATK||0)+t; preLog.push(`  Giấy Nợ: -${t} ATK→đối thủ`); };
  applyGN(p1,r1.finalStats,r2.finalStats);
  applyGN(p2,r2.finalStats,r1.finalStats);
  return { fs1:r1.finalStats, fs2:r2.finalStats, preLog };
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT FIGHTER
// ══════════════════════════════════════════════════════════════════════════════
function initFighter(char, label, finalStats) {
  const s   = finalStats;
  const ATK = Math.max(s.ATK??1, MIN_STAT);
  const HP  = Math.max(s.HP??1,  MIN_STAT);
  const SPD = Math.max(s.SPD??1, MIN_STAT);
  const BIQ = Math.max(s.BIQ??1, MIN_STAT);
  const IQ  = s.IQ??1;
  const MA  = s.MA??0;
  const maxHp = HP * HP_MULT;
  const armed  = !!(char.weapon);
  const cat    = resolveCategory(char.weapon);
  const scale  = WEAPON_SCALE[cat] || WEAPON_SCALE[CAT.UNARMED];

  console.log(`\n[${'═'.repeat(50)}]`);
  console.log(`  FINAL STATS — ${label}`);
  console.log(`${'─'.repeat(52)}`);
  console.log(`  Base  → ATK:${char.stats.ATK} HP:${char.stats.HP*HP_MULT} SPD:${char.stats.SPD} IQ:${char.stats.IQ} BIQ:${char.stats.BIQ} MA:${char.stats.MA}`);
  console.log(`  Final → ATK:${ATK}  HP:${maxHp}  SPD:${SPD} IQ:${IQ} BIQ:${BIQ} MA:${MA}`);
  console.log(`  Weapon: ${char.weapon ? `${char.weapon.name} [${char.weapon.category}] → ${scale.label}` : '(unarmed)'}`);
  if ((char.gears||[]).length)  console.log(`  Gears : ${char.gears.map(g=>g.name).join(', ')}`);
  if ((char.skills||[]).length) console.log(`  Skills: ${char.skills.map(s=>s.name).join(', ')}`);
  console.log(`${'═'.repeat(52)}\n`);

  const fighter = {
    label, char, finalStats: s,
    ATK, HP, SPD, BIQ, IQ, MA,
    armed, weaponCat: cat, weaponScale: scale,
    currentHp: maxHp, maxHp,
    accelFactor: 1.0,
    parryRate: armed ? 0 : clamp(BIQ * BIQ_PARRY, 0, 1),
    nextAttackAt: 0,
    skillCooldown: Math.max(0.5, 5.0 - IQ * IQ_CD_REDUCE),
    totalDamageDealt: 0, totalDamageTaken: 0,
    hitCount: 0, parryCount: 0, missCount: 0,
    stunTimer: 0, spdDebuff: 0,
    _polearmAccum: 0, _bowExtraShots: 0,
    _firearmSpeedMult: 1.0, _magicSize: 1.0,
    hooks: makeHooks(), // populated by buildHooks below
  };

  buildHooks(fighter);
  return fighter;
}

// ══════════════════════════════════════════════════════════════════════════════
//  INTERVAL CALCULATION
// ══════════════════════════════════════════════════════════════════════════════
function calcInterval(att, def) {
  const scale   = att.weaponScale;
  const effSPD  = Math.max(1, att.SPD + (att.spdDebuff || 0));
  const base    = (scale.baseInterval || BASE_INTERVAL) / (effSPD / 5);
  const spdDiff = Math.max(0, att.SPD - def.SPD);
  const accelM  = att.accelFactor * (1 + spdDiff * SPD_ACCEL);
  const fireM   = scale.intervalMult ? scale.intervalMult(att) : 1;
  const rangeM  = scale.rangeBonus || 1;
  return (base / accelM) * fireM * rangeM;
}

// ══════════════════════════════════════════════════════════════════════════════
//  RESOLVE ATTACK
// ══════════════════════════════════════════════════════════════════════════════
function resolveAttack(att, def, t, log, tag = '') {
  const tagStr = tag ? ` [${tag}]` : '';

  // Stun check
  if ((att.stunTimer || 0) > 0) {
    return { hit: false, ev: { time:t, type:'stun', actor:att.label, target:def.label, damage:0, hpLeft:def.currentHp,
      message:`${fmt(t)}: ${att.label} đang choáng — bỏ lượt!` } };
  }

  // Parry check (unarmed + Evasion stacks)
  if (def.parryRate > 0 && Math.random() < def.parryRate) {
    def.parryCount++; att.missCount++;
    att.accelFactor = def.accelFactor = 1.0;
    const parryLog = [];
    fireParry(def, att, parryLog);
    parryLog.forEach(l => log.push(l));
    return { hit: false, ev: { time:t, type:'parry', actor:att.label, target:def.label, damage:0, hpLeft:def.currentHp,
      message:`${fmt(t)}: ${def.label} PARRY đòn của ${att.label}${tagStr} (${pct(def.parryRate)})` } };
  }

  // onDealDamage hooks (may modify dmg)
  const dealLog = [];
  let baseDmg = att.ATK;
  baseDmg = fireDealDamage(att, def, baseDmg, dealLog);

  // onTakeDamage hooks (may cancel or reflect)
  const takeLog = [];
  const { finalDmg, cancelled } = fireTakeDamage(def, att, baseDmg, takeLog);
  dealLog.forEach(l => log.push(l));
  takeLog.forEach(l => log.push(l));

  if (cancelled) {
    return { hit: false, ev: { time:t, type:'blocked', actor:att.label, target:def.label, damage:0, hpLeft:def.currentHp,
      message:`${fmt(t)}: ${att.label}${tagStr} → ${def.label} BLOCKED!` } };
  }

  // Apply damage
  def.currentHp -= finalDmg;
  att.totalDamageDealt += finalDmg;
  def.totalDamageTaken += finalDmg;
  att.hitCount++;

  // Weapon scale onHit
  const scaleLog = [];
  att.weaponScale.onHit(att, def, scaleLog);
  scaleLog.forEach(l => log.push(l));

  att.accelFactor = def.accelFactor = 1.0;

  const hpLeft = Math.max(0, def.currentHp);
  const dead   = def.currentHp <= 0;
  return { hit: true, ev: { time:t, type: dead?'kill':'hit',
    actor:att.label, target:def.label, damage:finalDmg, hpLeft, weaponCat:att.weaponCat,
    message:`${fmt(t)}: ${att.label}${tagStr} → ${def.label} -${finalDmg} HP | ${hpLeft}/${def.maxHp} HP${dead?' 💀':''}` } };
}

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT QUEUE HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function queuePush(queue, ev) {
  queue.push(ev);
  queue.sort((a, b) => a.time - b.time);
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN startCombat
// ══════════════════════════════════════════════════════════════════════════════
function startCombat(player1, player2) {
  const nameA = player1.name || (player1.race?.name ? `[${player1.race.name}]` : '[P1]');
  const nameB = player2.name || (player2.race?.name ? `[${player2.race.name}]` : '[P2]');
  player1.name = nameA;
  player2.name = nameB;

  const { fs1, fs2, preLog } = computeFinalStats(player1, player2);
  const fA = initFighter(player1, nameA, fs1);
  const fB = initFighter(player2, nameB, fs2);

  // First attack scheduling
  let firstA = 0, firstB = 0;
  if      (fA.SPD > fB.SPD) { firstA=0; firstB=calcInterval(fB,fA)*0.5; }
  else if (fB.SPD > fA.SPD) { firstB=0; firstA=calcInterval(fA,fB)*0.5; }
  else { const c=Math.random()<0.5; firstA=c?0:calcInterval(fA,fB)*0.5; firstB=c?calcInterval(fB,fA)*0.5:0; }

  const queue = [];
  queuePush(queue, { time:firstA, type:'attack',    fighter:fA, opponent:fB });
  queuePush(queue, { time:firstB, type:'attack',    fighter:fB, opponent:fA });
  // onTick fires every 1s
  queuePush(queue, { time:1.0,   type:'tick',      fighter:fA, opponent:fB, nextTick:1.0 });
  queuePush(queue, { time:1.0,   type:'tick',      fighter:fB, opponent:fA, nextTick:1.0 });

  const combatLog = [], events = [];

  combatLog.push(...[
    `${'═'.repeat(52)}`,
    `  ${nameA}  vs  ${nameB}`,
    `${'═'.repeat(52)}`,
    `${nameA}: ATK=${fA.ATK} HP=${fA.maxHp} SPD=${fA.SPD} IQ=${fA.IQ} BIQ=${fA.BIQ} | ${fA.weaponScale.label}`,
    `${nameB}: ATK=${fB.ATK} HP=${fB.maxHp} SPD=${fB.SPD} IQ=${fB.IQ} BIQ=${fB.BIQ} | ${fB.weaponScale.label}`,
    ...preLog.map(l=>`  ${l}`),
    `${'─'.repeat(52)}`,
  ]);
  if (fA.parryRate>0) combatLog.push(`${nameA} parry: ${pct(fA.parryRate)}`);
  if (fB.parryRate>0) combatLog.push(`${nameB} parry: ${pct(fB.parryRate)}`);

  let prevTime = 0;

  // ── EVENT LOOP ──────────────────────────────────────────────────────────
  while (queue.length > 0) {
    const ev = queue.shift();
    if (ev.time > MAX_TIME) break;

    const { time, type, fighter: att, opponent: def } = ev;
    const dt = Math.max(0, time - prevTime);
    prevTime = time;

    // Passive SPD accel
    const dA=Math.max(0,fA.SPD-fB.SPD), dB=Math.max(0,fB.SPD-fA.SPD);
    if(dA>0) fA.accelFactor+=dA*SPD_ACCEL*dt;
    if(dB>0) fB.accelFactor+=dB*SPD_ACCEL*dt;

    if (fA.currentHp<=0 || fB.currentHp<=0) break;

    // ── TICK event ─────────────────────────────────────────────────────────
    if (type === 'tick') {
      const tickLog = [];
      // dt for tick is 1s (or remaining time)
      const tickDt = Math.min(1.0, MAX_TIME - time + 1);
      fireTick(att, def, tickDt, time, tickLog);
      tickLog.forEach(l => combatLog.push(l));

      // Schedule next tick
      const next = time + 1.0;
      if (next <= MAX_TIME)
        queuePush(queue, { time:next, type:'tick', fighter:att, opponent:def });

    // ── ATTACK event ───────────────────────────────────────────────────────
    } else if (type === 'attack') {
      const scale = att.weaponScale;

      if (scale.projectile) {
        const count = scale.projectileCount ? scale.projectileCount(att) : 1;
        for (let i=0; i<count; i++)
          queuePush(queue, { time:time+scale.travelTime+i*0.05, type:'projectile_land', fighter:att, opponent:def });
        combatLog.push(`${fmt(time)}: ${att.label} bắn ${count} đạn (chạm sau ${scale.travelTime}s)`);

      } else if (att.weaponCat === CAT.DAGGER) {
        const log = [];
        const { ev:mainEv, hit } = resolveAttack(att, def, time, log, '1st');
        events.push(mainEv); combatLog.push(mainEv.message);
        log.forEach(l=>combatLog.push(l));
        if (hit && def.currentHp>0)
          queuePush(queue, { time:time+scale.secondHitDelay, type:'second_hit', fighter:att, opponent:def });

      } else {
        const log = [];
        const { ev:mEv } = resolveAttack(att, def, time, log);
        events.push(mEv); combatLog.push(mEv.message);
        log.forEach(l=>combatLog.push(l));
      }

      const nextT = time + calcInterval(att, def);
      if (nextT <= MAX_TIME)
        queuePush(queue, { time:nextT, type:'attack', fighter:att, opponent:def });

    // ── PROJECTILE_LAND event ──────────────────────────────────────────────
    } else if (type === 'projectile_land') {
      if (def.currentHp<=0) {
        combatLog.push(`${fmt(time)}: đạn trúng khoảng không — ${def.label} đã ngã.`);
      } else {
        const log = [];
        const { ev:pEv } = resolveAttack(att, def, time, log, 'proj');
        events.push(pEv); combatLog.push(pEv.message);
        log.forEach(l=>combatLog.push(l));
      }

    // ── SECOND_HIT event (Dagger) ──────────────────────────────────────────
    } else if (type === 'second_hit') {
      if (def.currentHp>0) {
        const log = [];
        const { ev:sEv } = resolveAttack(att, def, time, log, '2nd');
        events.push(sEv); combatLog.push(sEv.message);
        log.forEach(l=>combatLog.push(l));
      }
    }

    if (fA.currentHp<=0 || fB.currentHp<=0) break;
  }

  // ── WINNER ───────────────────────────────────────────────────────────────
  const aAlive=fA.currentHp>0, bAlive=fB.currentHp>0;
  let winner, reason;
  if (!aAlive&&!bAlive) { winner='draw';  reason='Cả hai cùng ngã.'; }
  else if (!bAlive)     { winner=nameA;   reason=`${nameB} hết máu.`; }
  else if (!aAlive)     { winner=nameB;   reason=`${nameA} hết máu.`; }
  else {
    const pa=fA.currentHp/fA.maxHp, pb=fB.currentHp/fB.maxHp;
    if (Math.abs(pa-pb)<0.001) { winner='draw'; reason=`Hết ${MAX_TIME}s — HP ngang.`; }
    else if (pa>pb)            { winner=nameA;  reason=`Hết giờ — ${nameA} nhiều HP hơn.`; }
    else                       { winner=nameB;  reason=`Hết giờ — ${nameB} nhiều HP hơn.`; }
  }

  const duration = Math.min(prevTime, MAX_TIME);
  combatLog.push(`${'─'.repeat(52)}`);
  combatLog.push(winner==='draw' ? `  KẾT QUẢ: HÒA — ${reason}` : `  KẾT QUẢ: ${winner} THẮNG — ${reason}`);
  combatLog.push(`  Thời lượng: ${fmt(duration)}`);
  combatLog.push(`  ${nameA}: ${Math.max(0,Math.round(fA.currentHp))}/${fA.maxHp} HP | ${fA.hitCount} trúng | ATK:${fA.ATK} BIQ:${fA.BIQ}`);
  combatLog.push(`  ${nameB}: ${Math.max(0,Math.round(fB.currentHp))}/${fB.maxHp} HP | ${fB.hitCount} trúng | ATK:${fB.ATK} BIQ:${fB.BIQ}`);
  combatLog.push(`${'═'.repeat(52)}`);

  return {
    winner, reason, duration, combatLog, events,
    finalStats: { [nameA]:fs1, [nameB]:fs2 },
    summary: {
      [nameA]: { hpRemaining:Math.max(0,Math.round(fA.currentHp)), hpMax:fA.maxHp,
        hpPercent:+(Math.max(0,fA.currentHp)/fA.maxHp*100).toFixed(1),
        totalDamageDealt:fA.totalDamageDealt, hitCount:fA.hitCount, parriedCount:fA.parryCount,
        parryRate:+(fA.parryRate*100).toFixed(1), finalATK:fA.ATK, finalBIQ:fA.BIQ },
      [nameB]: { hpRemaining:Math.max(0,Math.round(fB.currentHp)), hpMax:fB.maxHp,
        hpPercent:+(Math.max(0,fB.currentHp)/fB.maxHp*100).toFixed(1),
        totalDamageDealt:fB.totalDamageDealt, hitCount:fB.hitCount, parriedCount:fB.parryCount,
        parryRate:+(fB.parryRate*100).toFixed(1), finalATK:fB.ATK, finalBIQ:fB.BIQ },
    },
  };
}

module.exports = { startCombat, WEAPON_SCALE, resolveCategory, buildHooks,
  addHook, removeHook, fireTick, fireTakeDamage, fireDealDamage, fireParry };
