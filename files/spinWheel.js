/**
 * spinWheel - Core Gacha Engine
 *
 * Mô phỏng vòng quay vật lý: tổng weight = chu vi vòng tròn,
 * random một điểm rơi trên chu vi để xác định ô trúng thưởng.
 *
 * @param {Array<{item: string, weight: number}>} slices - Các ô trên vòng quay
 * @returns {{ item: string, weight: number, index: number }} - Ô trúng thưởng
 *
 * @example
 * spinWheel([{ item: 'Goblin', weight: 6.5 }, { item: 'God', weight: 2.5 }])
 * // => { item: 'Goblin', weight: 6.5, index: 0 }
 */
function spinWheel(slices) {
  if (!slices || slices.length === 0) {
    throw new Error('spinWheel: slices không được rỗng');
  }

  // Lọc bỏ các ô bị disable (weight <= 0 hoặc weight là 'x')
  const valid = slices.filter(s => {
    const w = parseFloat(s.weight);
    return !isNaN(w) && w > 0;
  });

  if (valid.length === 0) {
    throw new Error('spinWheel: Không có ô nào có weight hợp lệ (> 0)');
  }

  // Tính chu vi vòng quay = tổng tất cả weight
  const totalWeight = valid.reduce((sum, s) => sum + parseFloat(s.weight), 0);

  // Random một điểm rơi trên [0, totalWeight)
  const spin = Math.random() * totalWeight;

  // Quét từ đầu để tìm ô chứa điểm rơi
  let cursor = 0;
  for (let i = 0; i < valid.length; i++) {
    cursor += parseFloat(valid[i].weight);
    if (spin < cursor) {
      return { ...valid[i], index: slices.indexOf(valid[i]) };
    }
  }

  // Fallback phòng floating-point: trả về ô cuối
  const last = valid[valid.length - 1];
  return { ...last, index: slices.indexOf(last) };
}

module.exports = { spinWheel };
