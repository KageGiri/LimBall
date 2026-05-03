'use strict';

const express           = require('express');
const { v4: uuidv4 }   = require('uuid');
const { generateCharacter } = require('./generateCharacter');
const { startCombat }       = require('./startCombat');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── Session storage (in-memory) ─────────────────────────────────────────────
let sessionBalls = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pickTwo(arr) {
  const idxA = Math.floor(Math.random() * arr.length);
  let idxB;
  do { idxB = Math.floor(Math.random() * arr.length); } while (idxB === idxA);
  return [arr[idxA], arr[idxB]];
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/balls
 * Trả về danh sách toàn bộ bóng đang có trong session.
 */
app.get('/api/balls', (req, res) => {
  res.json({ count: sessionBalls.length, balls: sessionBalls });
});

/**
 * POST /api/generate
 * Tạo 1 quả bóng mới bằng cách quay Gacha.
 * Giới hạn tối đa 10 bóng / session.
 */
app.post('/api/generate', (req, res) => {
  if (sessionBalls.length >= 10) {
    return res.status(400).json({ error: 'Đã đạt giới hạn 10 bóng' });
  }

  try {
    const char = generateCharacter();
    const ball = {
      id:        uuidv4(),
      createdAt: new Date().toISOString(),
      ...char,
      // Tên hiển thị cho combat log
      name: `${char.race.name}#${sessionBalls.length + 1}`,
    };
    sessionBalls.push(ball);
    return res.status(201).json({ message: 'Tạo bóng thành công', ball });
  } catch (err) {
    console.error('[/api/generate]', err);
    return res.status(500).json({ error: 'Lỗi tạo nhân vật', detail: err.message });
  }
});

/**
 * POST /api/battle/random
 * Chọn ngẫu nhiên 2 bóng khác nhau và bắt đầu 1v1.
 */
app.post('/api/battle/random', (req, res) => {
  if (sessionBalls.length < 2) {
    return res.status(400).json({ error: 'Cần ít nhất 2 bóng để bắt đầu trận đấu' });
  }

  try {
    const [p1, p2] = pickTwo(sessionBalls);
    const result   = startCombat(p1, p2);

    return res.json({
      player1:   { id: p1.id, name: p1.name, race: p1.race, stats: p1.stats, weapon: p1.weapon, skills: p1.skills, gears: p1.gears },
      player2:   { id: p2.id, name: p2.name, race: p2.race, stats: p2.stats, weapon: p2.weapon, skills: p2.skills, gears: p2.gears },
      winner:    result.winner,
      reason:    result.reason,
      duration:  result.duration,
      summary:   result.summary,
      combatLog: result.combatLog,
    });
  } catch (err) {
    console.error('[/api/battle/random]', err);
    return res.status(500).json({ error: 'Lỗi combat', detail: err.message });
  }
});

/**
 * POST /api/reset
 * Xóa toàn bộ session, về trạng thái ban đầu.
 */
app.post('/api/reset', (req, res) => {
  const count  = sessionBalls.length;
  sessionBalls = [];
  return res.json({ message: `Reset thành công. Đã xóa ${count} bóng.`, balls: [] });
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Không tìm thấy route: ${req.method} ${req.path}` }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎱 Gacha Ball Server đang chạy tại http://localhost:${PORT}`);
  console.log(`   POST /api/generate      — Tạo bóng mới (tối đa 10)`);
  console.log(`   GET  /api/balls         — Xem danh sách bóng`);
  console.log(`   POST /api/battle/random — Trận đấu 1v1 ngẫu nhiên`);
  console.log(`   POST /api/reset         — Xóa toàn bộ session\n`);
});

module.exports = app; // export để test
