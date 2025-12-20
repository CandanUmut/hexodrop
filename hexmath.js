// hexmath.js
// Basic hex grid math utilities for a flat-topped axial coordinate system.

(function (global) {
  const HEX_SIZE = 24;
  const SQRT3 = Math.sqrt(3);

  // Axial directions (flat-topped)
  const HEX_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
  ];

  function axialToPixel(q, r, originX, originY) {
    // Flat-topped axial to pixel conversion
    // Reference: https://www.redblobgames.com/grids/hex-grids/
    const x = HEX_SIZE * (1.5 * q);
    const y = HEX_SIZE * (SQRT3 * (r + q / 2));
    return {
      x: originX + x,
      y: originY + y
    };
  }

  function neighbors(q, r) {
    return HEX_DIRECTIONS.map((d) => ({
      q: q + d.q,
      r: r + d.r
    }));
  }

  // Rotate around origin in 60° steps.
  // Using cube coords: (x, y, z), with axial (q, r) mapped to (x = q, z = r, y = -x - z).
  function rotateAxial(q, r, times) {
    let t = ((times % 6) + 6) % 6;
    let x = q;
    let z = r;
    let y = -x - z;

    for (let i = 0; i < t; i++) {
      const nx = -z;
      const ny = -x;
      const nz = -y;
      x = nx;
      y = ny;
      z = nz;
    }
    return { q: x, r: z };
  }

  global.HEX_SIZE = HEX_SIZE;
  global.HEX_DIRECTIONS = HEX_DIRECTIONS;
  global.axialToPixel = axialToPixel;
  global.hexNeighbors = neighbors;
  global.rotateAxial = rotateAxial;
})(window);
