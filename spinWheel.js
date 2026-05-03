'use strict';

/**
 * spinWheel(slices)
 * @param {Array<{item, weight}>} slices
 * @returns {{ item, weight, index }}
 */
function spinWheel(slices) {
  const valid = slices.filter(s => {
    const w = parseFloat(s.weight);
    return !isNaN(w) && w > 0;
  });
  if (!valid.length) throw new Error('spinWheel: không có slice hợp lệ');

  const total = valid.reduce((s, x) => s + parseFloat(x.weight), 0);
  let spin    = Math.random() * total;
  for (let i = 0; i < valid.length; i++) {
    spin -= parseFloat(valid[i].weight);
    if (spin < 0) return { ...valid[i], index: i };
  }
  return { ...valid[valid.length - 1], index: valid.length - 1 };
}

module.exports = { spinWheel };
