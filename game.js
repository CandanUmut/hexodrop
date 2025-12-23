// game.js
// Hex Hive Drop – donut board + rotating hive, gravity & controls aligned with screen.

(function (global) {
  const DEBUG = true;

  function debugLog(...args) {
    if (DEBUG) {
      console.log("[HexHive][DEBUG]", ...args);
    }
  }

  const HEX_DIRECTIONS = global.HEX_DIRECTIONS || [];
  const HEX_SIZE = global.HEX_SIZE || 24;

  // Board radii
  const HIVE_RADIUS = 8; // total radius (outermost ring)
  const INNER_RADIUS = 2; // radius of empty hole (0..INNER_RADIUS = spawn zone only)

  const GAME_STATES = {
    MENU: "menu",
    PLAYING: "playing",
    PAUSED: "paused",
    GAMEOVER: "gameover"
  };

  const HONEY_COLORS = ["#f6c453", "#fda85a", "#ffc86a"];

  // Canvas & layout
  let canvas = null;
  let nextCanvas = null;
  let gameWidth = 600;
  let gameHeight = 800;
  let ctxNext = null;

  // Grid & pieces
  let grid = new Map();
  let allCells = [];      // all cells in big hex (for bounds & visuals)
  let boardCells = [];    // donut cells: ringIndex > INNER_RADIUS
  let currentPiece = null;
  let nextPiece = null;

  // Game state
  let gameState = GAME_STATES.MENU;
  let score = 0;
  let level = 1;
  let linesClearedTotal = 0;

  // Effects
  let cellEffects = [];
  const LANDING_EFFECT_DURATION = 0.18;
  const CLEAR_EFFECT_DURATION = 0.22;

  // Gravity timing
  let fallInterval = 0.9;
  let fallTimer = 0;

  // Hive rotation + shake (visual)
  let hiveRotationAngle = 0; // radians – actual rendered angle
  let targetRotationAngle = 0; // where the hive wants to go
  let rotationStartAngle = 0;
  let rotationProgress = 1; // 0..1
  const HIVE_ROTATE_DURATION = 0.18;

  let hiveShakeTime = 0;
  const HIVE_SHAKE_DURATION = 0.12;

  // Direction mapping (indexes into HEX_DIRECTIONS)
  let gravityDirIndex = 0; // updated dynamically to match screen-down
  let controlDirLeftIndex = 0;
  let controlDirRightIndex = 0;

  // Assets
  let images = {
    hiveBg: null,
    hexEmpty: null,
    hexFilled: [null, null, null]
  };

  let sounds = {
    move: null,
    rotate: null,
    drop: null,
    lineClear: null,
    levelUp: null,
    gameOver: null,
    uiClick: null,
    bgm: null
  };

  let bgmStarted = false;

  // WebAudio fallback
  let audioCtx = null;

  // Input state hooks
  let inputTickFn = null;
  let hoverTargetAxial = null;
  let dragTargetAxial = null;
  let dragPointerActive = false;
  let hoverActive = false;
  let hoverBaseH = 0;

  // ---------- Audio helpers ----------

  function playAudioSafe(a) {
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch (e) {}
  }

  function safePlaySound(soundKey) {
    const s = sounds[soundKey];
    if (s && !s._broken) {
      playAudioSafe(s);
      return;
    }
    playBeep(soundKey);
  }

  function playBeep(type) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";

      const now = audioCtx.currentTime;
      let freq = 440;

      switch (type) {
        case "move":
          freq = 420;
          break;
        case "rotate":
          freq = 520;
          break;
        case "drop":
          freq = 320;
          break;
        case "lineClear":
          freq = 720;
          break;
        case "gameOver":
          freq = 260;
          osc.frequency.setValueAtTime(620, now);
          osc.frequency.exponentialRampToValueAtTime(180, now + 0.3);
          break;
        default:
          freq = 480;
      }

      if (type !== "gameOver") {
        osc.frequency.setValueAtTime(freq, now);
      }

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(now + 0.22);
    } catch (e) {}
  }

  function safeLoopBgm() {
    if (!sounds.bgm) return;
    if (bgmStarted) return;
    bgmStarted = true;
    try {
      sounds.bgm.loop = true;
      sounds.bgm.volume = 0.45;
      const p = sounds.bgm.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          bgmStarted = false;
        });
      }
    } catch (e) {
      bgmStarted = false;
    }
  }

  // ---------- Asset loading ----------

  function loadImage(src) {
    const img = new Image();
    img.onerror = () => {
      img._broken = true;
    };
    img.src = src;
    return img;
  }

  function loadAudio(src) {
    try {
      const audio = new Audio(src);
      audio.onerror = () => {
        audio._broken = true;
      };
      return audio;
    } catch (e) {
      return null;
    }
  }

  function isImageReady(img) {
    return (
      img &&
      !img._broken &&
      img.complete === true &&
      typeof img.naturalWidth === "number" &&
      img.naturalWidth > 0 &&
      img.naturalHeight > 0
    );
  }

  function initAssets() {
    images.hiveBg = loadImage("./assets/img/hive_bg.png");
    images.hexEmpty = loadImage("./assets/img/hex_empty.png");
    images.hexFilled[0] = loadImage("./assets/img/hex_filled_1.png");
    images.hexFilled[1] = loadImage("./assets/img/hex_filled_2.png");
    images.hexFilled[2] = loadImage("./assets/img/hex_filled_3.png");

    sounds.move = loadAudio("./assets/sfx/move.wav");
    sounds.rotate = loadAudio("./assets/sfx/rotate.wav");
    sounds.drop = loadAudio("./assets/sfx/drop.wav");
    sounds.lineClear = loadAudio("./assets/sfx/line_clear.wav");
    sounds.levelUp = loadAudio("./assets/sfx/level_up.wav");
    sounds.gameOver = loadAudio("./assets/sfx/game_over.wav");
    sounds.uiClick = loadAudio("./assets/sfx/ui_click.wav");
    sounds.bgm = loadAudio("./assets/music/bgm_loop.ogg");
  }

  // ---------- Grid helpers ----------

  function axialKey(q, r) {
    return q + "," + r;
  }

  function precomputeHive() {
    allCells = [];
    boardCells = [];
    for (let q = -HIVE_RADIUS; q <= HIVE_RADIUS; q++) {
      for (let r = -HIVE_RADIUS; r <= HIVE_RADIUS; r++) {
        const s = -q - r;
        const rad = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
        if (rad > HIVE_RADIUS) continue;
        const cell = { q, r, ringIndex: rad };
        allCells.push(cell);
        if (rad > INNER_RADIUS) {
          boardCells.push(cell);
        }
      }
    }
  }

  function createEmptyGrid() {
    grid = new Map();
    if (!allCells.length) precomputeHive();
  }

  function ringIndexOf(q, r) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  }

  // inside big hex at all (even hole)
  function isInsideHive(q, r) {
    return ringIndexOf(q, r) <= HIVE_RADIUS;
  }

  // playable donut
  function isInsideBoard(q, r) {
    const rad = ringIndexOf(q, r);
    return rad > INNER_RADIUS && rad <= HIVE_RADIUS;
  }

  function isCellEmpty(q, r) {
    if (!isInsideHive(q, r)) return false;
    if (!isInsideBoard(q, r)) return true; // inner hole always empty
    return !grid.has(axialKey(q, r));
  }

  function isOccupied(q, r) {
    if (!isInsideBoard(q, r)) return false;
    return grid.has(axialKey(q, r));
  }

  function setCell(q, r, value) {
    if (!isInsideBoard(q, r)) return;
    grid.set(axialKey(q, r), value);
  }

  function clearCell(q, r) {
    if (!isInsideBoard(q, r)) return;
    grid.delete(axialKey(q, r));
  }

  function getCell(q, r) {
    if (!isInsideBoard(q, r)) return null;
    return grid.get(axialKey(q, r)) ?? null;
  }

  // ---------- Pieces ----------

  const PIECE_SHAPES = [
    {
      name: "line3",
      colorIndex: 0,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 0 }
      ]
    },
    {
      name: "line4",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 0 },
        { q: -2, r: 0 }
      ]
    },
    {
      name: "triangle3",
      colorIndex: 2,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 }
      ]
    },
    {
      name: "tee4",
      colorIndex: 0,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 0 },
        { q: 0, r: 1 }
      ]
    },
    {
      name: "zig4_a",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 2, r: -1 }
      ]
    },
    {
      name: "zig4_b",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: -2, r: 1 }
      ]
    },
    {
      name: "diamond4",
      colorIndex: 2,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: 1, r: -1 }
      ]
    },
    {
      name: "duo2",
      colorIndex: 0,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 }
      ]
    },
    {
      name: "corner3",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 }
      ]
    },
    {
      name: "hook4",
      colorIndex: 2,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 0, r: 1 }
      ]
    },
    {
      name: "line5",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 0 },
        { q: 2, r: 0 },
        { q: -2, r: 0 }
      ]
    },
    {
      name: "fork5",
      colorIndex: 0,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: -1, r: 0 },
        { q: 0, r: 1 },
        { q: 0, r: -1 }
      ]
    }
  ];

  function randomShape() {
    const idx = Math.floor(Math.random() * PIECE_SHAPES.length);
    return PIECE_SHAPES[idx];
  }

  function clonePiece(piece) {
    return {
      shape: piece.shape,
      colorIndex: piece.colorIndex,
      pivotQ: piece.pivotQ,
      pivotR: piece.pivotR,
      rotation: piece.rotation
    };
  }

  function createPieceFromShape(shape) {
    // Spawn in the empty middle region (donut hole), near center
    return {
      shape,
      colorIndex: shape.colorIndex,
      pivotQ: 0,
      pivotR: 0,
      rotation: 0
    };
  }

  function createRandomPiece() {
    const shape = randomShape();
    return createPieceFromShape(shape);
  }

  function getPieceCells(piece) {
    const cells = [];
    for (const offset of piece.shape.cells) {
      const rotated = global.rotateAxial(offset.q, offset.r, piece.rotation);
      const q = piece.pivotQ + rotated.q;
      const r = piece.pivotR + rotated.r;
      cells.push({ q, r });
    }
    return cells;
  }

  function canPieceExist(piece) {
    const cells = getPieceCells(piece);
    for (const c of cells) {
      const ring = ringIndexOf(c.q, c.r);
      if (!isInsideHive(c.q, c.r)) return false;
      if (ring > INNER_RADIUS && isOccupied(c.q, c.r)) return false;
    }
    return true;
  }

  function movePiece(dq, dr) {
    if (!currentPiece) return false;
    const test = clonePiece(currentPiece);
    test.pivotQ += dq;
    test.pivotR += dr;
    if (canPieceExist(test)) {
      currentPiece = test;
      debugLog("Piece moved", { dq, dr, pivotQ: currentPiece.pivotQ, pivotR: currentPiece.pivotR });
      return true;
    }
    return false;
  }

  function rotatePiece(deltaRotation) {
    if (!currentPiece) return;
    const test = clonePiece(currentPiece);
    test.rotation = (test.rotation + deltaRotation + 6) % 6;
    if (canPieceExist(test)) {
      currentPiece = test;
      safePlaySound("rotate");
      debugLog("Piece rotate", { rotation: currentPiece.rotation });
    }
  }

  function hardDropCurrentPiece() {
    if (!currentPiece) return;
    let moved = false;
    const gdir = HEX_DIRECTIONS[gravityDirIndex];
    if (gdir) {
      while (movePiece(gdir.q, gdir.r)) {
        moved = true;
      }
    }
    if (moved) {
      safePlaySound("drop");
    }
    lockPiece();
  }

  // ---------- Direction & gravity mapping ----------

  // Recalculate which axial directions correspond to screen-down, screen-left, screen-right
  function recomputeDirectionMapping() {
    if (!HEX_DIRECTIONS.length) return;

    let bestDownIdx = 0;
    let bestDownVal = -Infinity;

    let bestRightIdx = 0;
    let bestRightVal = -Infinity;

    let bestLeftIdx = 0;
    let bestLeftVal = Infinity;

    const angle = hiveRotationAngle;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rotatedYValues = [];

    for (let i = 0; i < HEX_DIRECTIONS.length; i++) {
      const d = HEX_DIRECTIONS[i];
      const p = global.axialToPixel(d.q, d.r, 0, 0);
      const x = p.x;
      const y = p.y;

      // Apply the same rotation used when rendering the hive (standard 2D rotation)
      const xr = x * cosA - y * sinA;
      const yr = x * sinA + y * cosA;
      rotatedYValues.push({ i, yr });

      // Screen-down: max y'
      if (yr > bestDownVal) {
        bestDownVal = yr;
        bestDownIdx = i;
      }
      // Screen-right: max x'
      if (xr > bestRightVal) {
        bestRightVal = xr;
        bestRightIdx = i;
      }
      // Screen-left: min x'
      if (xr < bestLeftVal) {
        bestLeftVal = xr;
        bestLeftIdx = i;
      }
    }

    const prevGravity = gravityDirIndex;
    const prevLeft = controlDirLeftIndex;
    const prevRight = controlDirRightIndex;

    gravityDirIndex = bestDownIdx;
    controlDirRightIndex = bestRightIdx;
    controlDirLeftIndex = bestLeftIdx;

    if (
      DEBUG &&
      (prevGravity !== gravityDirIndex || prevLeft !== controlDirLeftIndex || prevRight !== controlDirRightIndex)
    ) {
      debugLog("Dir map updated", {
        angle,
        gravityDirIndex,
        controlDirLeftIndex,
        controlDirRightIndex,
        gravityVector: HEX_DIRECTIONS[gravityDirIndex]
      });
      debugLog("Rotated Y values", rotatedYValues);
    }
  }

  function getGravityDir() {
    return HEX_DIRECTIONS[gravityDirIndex] || { q: 0, r: 1 };
  }

  // ---------- Locking & line clears ----------

  function lockPiece() {
    if (!currentPiece) return;
    const cells = getPieceCells(currentPiece);

    const blockedInHole = cells.some((c) => ringIndexOf(c.q, c.r) <= INNER_RADIUS);
    if (blockedInHole) {
      gameState = GAME_STATES.GAMEOVER;
      debugLog("Lock attempted in hole – game over");
      safePlaySound("gameOver");
      currentPiece = null;
      return;
    }

    for (const c of cells) {
      if (!isInsideBoard(c.q, c.r)) continue; // only outer donut keeps blocks
      setCell(c.q, c.r, currentPiece.colorIndex);
      cellEffects.push({
        q: c.q,
        r: c.r,
        colorIndex: currentPiece.colorIndex,
        type: "landing",
        timer: LANDING_EFFECT_DURATION,
        duration: LANDING_EFFECT_DURATION
      });
    }
    currentPiece = null;
    safePlaySound("drop");

    const clearedLines = resolveClearsAndCollapse();
    if (clearedLines > 0) {
      linesClearedTotal += clearedLines;
      updateLevelFromLines();
      score += 100 * clearedLines;
      safePlaySound("lineClear");
    }

    spawnNextPieceOrGameOver();
  }

  function spawnNextPieceOrGameOver() {
    if (!nextPiece) {
      nextPiece = createRandomPiece();
    }

    const spawnPiece = createPieceFromShape(nextPiece.shape);
    spawnPiece.colorIndex = nextPiece.colorIndex;

    if (canPieceExist(spawnPiece)) {
      currentPiece = spawnPiece;
      if (hoverActive) {
        setHoverBaseFromCurrentPiece();
      }
    } else {
      gameState = GAME_STATES.GAMEOVER;
      debugLog("Spawn blocked", spawnPiece);
      safePlaySound("gameOver");
    }

    nextPiece = createRandomPiece();
  }

  function stepsToCanonicalDown() {
    const g = HEX_DIRECTIONS[gravityDirIndex] || { q: 0, r: 1 };
    for (let s = 0; s < 6; s++) {
      const rot = global.rotateAxial(g.q, g.r, s);
      if (rot.q === 0 && rot.r === 1) return s;
    }
    return 0;
  }

  // Clear “rows” perpendicular to gravity direction, only on donut cells
  // Rotation-independent full-line detection across axial families (q, r, s)
  function findFullLinesAxial() {
    const families = [
      { axis: "q", map: new Map(), keyFn: (cell) => cell.q },
      { axis: "r", map: new Map(), keyFn: (cell) => cell.r },
      { axis: "s", map: new Map(), keyFn: (cell) => -cell.q - cell.r }
    ];

    for (const cell of boardCells) {
      for (const family of families) {
        const key = family.keyFn(cell);
        let line = family.map.get(key);
        if (!line) {
          line = { key, cells: [] };
          family.map.set(key, line);
        }
        line.cells.push(cell);
      }
    }

    const cellsToClear = new Set();
    const linesMeta = [];

    for (const family of families) {
      for (const [, line] of family.map) {
        const seen = new Set();
        let occupied = 0;

        for (const cell of line.cells) {
          const key = axialKey(cell.q, cell.r);
          if (seen.has(key)) continue;
          seen.add(key);
          if (isOccupied(cell.q, cell.r)) {
            occupied++;
          }
        }

        const lineSize = seen.size;
        const isFull = lineSize > 0 && occupied === lineSize;
        if (isFull) {
          linesMeta.push({ axis: family.axis, key: line.key, lineSize, occupied });
          for (const cell of line.cells) {
            cellsToClear.add(axialKey(cell.q, cell.r));
          }
        }
      }
    }

    return { clearedLineCount: linesMeta.length, cellsToClear, linesMeta };
  }

  // Clear all detected lines, then collapse along current gravity until stable
  function resolveClearsAndCollapse() {
    let totalCleared = 0;
    while (true) {
      const { clearedLineCount, cellsToClear, linesMeta } = findFullLinesAxial();
      if (!clearedLineCount) break;

      const clearedCellsArr = Array.from(cellsToClear).map((key) => {
        const [qStr, rStr] = key.split(",");
        return { q: parseInt(qStr, 10), r: parseInt(rStr, 10) };
      });

      for (const cell of clearedCellsArr) {
        const colorIndex = getCell(cell.q, cell.r);
        if (colorIndex !== null && colorIndex !== undefined) {
          cellEffects.push({
            q: cell.q,
            r: cell.r,
            colorIndex,
            type: "clear",
            timer: CLEAR_EFFECT_DURATION,
            duration: CLEAR_EFFECT_DURATION
          });
          cellEffects.push({
            q: cell.q,
            r: cell.r,
            colorIndex,
            type: "clearRing",
            timer: CLEAR_EFFECT_DURATION + 0.08,
            duration: CLEAR_EFFECT_DURATION + 0.08
          });
        }
        clearCell(cell.q, cell.r);
      }

      applyGravity();
      hiveShakeTime = Math.max(hiveShakeTime, HIVE_SHAKE_DURATION);
      totalCleared += clearedLineCount;

      if (DEBUG) {
        debugLog("[HexHive][LINES_CLEAR]", linesMeta);
      }
    }

    return totalCleared;
  }

  function applyGravityCanonical(steps, inverseSteps) {
    const canonical = [];
    for (const cell of boardCells) {
      const rotated = global.rotateAxial(cell.q, cell.r, steps);
      const val = getCell(cell.q, cell.r);
      canonical.push({
        qOrig: cell.q,
        rOrig: cell.r,
        qPrim: rotated.q,
        rPrim: rotated.r,
        val
      });
    }

    const columns = new Map(); // q' -> [canonicalCell]
    for (const cc of canonical) {
      let col = columns.get(cc.qPrim);
      if (!col) {
        col = [];
        columns.set(cc.qPrim, col);
      }
      col.push(cc);
    }

    const newGrid = new Map();

    for (const col of columns.values()) {
      col.sort((a, b) => a.rPrim - b.rPrim);
      const nonEmpty = col.filter((c) => c.val !== null && c.val !== undefined);

      let cursor = col.length - 1;
      for (let k = nonEmpty.length - 1; k >= 0; k--) {
        const targetCell = col[cursor];
        const sourceVal = nonEmpty[k].val;
        const rotatedBack = global.rotateAxial(
          targetCell.qPrim,
          targetCell.rPrim,
          inverseSteps
        );
        if (!isInsideBoard(rotatedBack.q, rotatedBack.r)) continue;
        newGrid.set(axialKey(rotatedBack.q, rotatedBack.r), sourceVal);
        cursor--;
      }
    }

    grid = newGrid;
  }

  function applyGravity() {
    const steps = stepsToCanonicalDown();
    const inverseSteps = (6 - steps) % 6;
    applyGravityCanonical(steps, inverseSteps);
  }

  function updateLevelFromLines() {
    const newLevel = 1 + Math.floor(linesClearedTotal / 10);
    if (newLevel !== level) {
      level = newLevel;
      safePlaySound("levelUp");
    }
    const base = 0.9;
    const minInterval = 0.15;
    fallInterval = Math.max(minInterval, base - (level - 1) * 0.06);
  }

  // ---------- State management ----------

  function resetGame() {
    createEmptyGrid();
    currentPiece = null;
    nextPiece = null;
    fallTimer = 0;
    score = 0;
    level = 1;
    linesClearedTotal = 0;
    fallInterval = 0.9;
    gameState = GAME_STATES.MENU;
    cellEffects = [];
    hiveRotationAngle = 0;
    targetRotationAngle = 0;
    rotationStartAngle = 0;
    rotationProgress = 1;
    hiveShakeTime = 0;
    hoverActive = false;
    hoverBaseH = 0;
    recomputeDirectionMapping();
  }

  function startGame() {
    if (gameState === GAME_STATES.PLAYING) return;

    createEmptyGrid();
    currentPiece = null;
    nextPiece = null;
    fallTimer = 0;
    score = 0;
    level = 1;
    linesClearedTotal = 0;
    fallInterval = 0.9;
    cellEffects = [];
    hoverActive = false;
    hoverBaseH = 0;

    recomputeDirectionMapping();
    spawnNextPieceOrGameOver();
    gameState = GAME_STATES.PLAYING;
    safeLoopBgm();
  }

  function togglePause() {
    if (gameState === GAME_STATES.PLAYING) {
      gameState = GAME_STATES.PAUSED;
    } else if (gameState === GAME_STATES.PAUSED) {
      gameState = GAME_STATES.PLAYING;
    }
  }

  // ---------- Update loop ----------

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function updateHiveVisual(deltaTime) {
    if (rotationProgress < 1) {
      rotationProgress = Math.min(1, rotationProgress + deltaTime / HIVE_ROTATE_DURATION);
      const t = easeOutCubic(rotationProgress);
      hiveRotationAngle = rotationStartAngle + (targetRotationAngle - rotationStartAngle) * t;
      if (rotationProgress >= 1) {
        const tau = Math.PI * 2;
        hiveRotationAngle = ((hiveRotationAngle % tau) + tau) % tau;
      }
    }

    if (hiveShakeTime > 0) {
      hiveShakeTime = Math.max(0, hiveShakeTime - deltaTime);
    }

    // keep gravity + controls aligned with the screen during the animation
    recomputeDirectionMapping();
  }

  function tickEffects(deltaTime) {
    if (!deltaTime) return;
    for (const fx of cellEffects) {
      fx.timer -= deltaTime;
    }
    cellEffects = cellEffects.filter((fx) => fx.timer > 0);
  }

  function updateGame(deltaTime) {
    tickEffects(deltaTime);
    updateHiveVisual(deltaTime);

    if (typeof inputTickFn === "function") {
      inputTickFn(deltaTime);
    }

    if (gameState !== GAME_STATES.PLAYING) return;
    if (!currentPiece) return;

    fallTimer += deltaTime;
    if (fallTimer >= fallInterval) {
      fallTimer = 0;
      const gdir = HEX_DIRECTIONS[gravityDirIndex];
      if (gdir) {
        const moved = movePiece(gdir.q, gdir.r);
        if (moved && hoverActive) {
          hoverBaseH += 2;
        }
        if (!moved) {
          lockPiece();
        }
      }
    }
  }

  // ---------- Geometry helpers ----------

  function getGridOrigin() {
    if (!allCells.length) precomputeHive();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const cell of allCells) {
      const pos = global.axialToPixel(cell.q, cell.r, 0, 0);
      minX = Math.min(minX, pos.x - HEX_SIZE);
      maxX = Math.max(maxX, pos.x + HEX_SIZE);
      minY = Math.min(minY, pos.y - HEX_SIZE);
      maxY = Math.max(maxY, pos.y + HEX_SIZE);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    const margin = 20;
    const availableWidth = gameWidth - margin * 2;
    const availableHeight = gameHeight - margin * 2;

    let scale = Math.min(availableWidth / width, availableHeight / height);
    if (!isFinite(scale) || scale <= 0) scale = 1;

    const originX = (gameWidth - width * scale) / 2 - minX * scale;
    const originY = (gameHeight - height * scale) / 2 - minY * scale;

    return { originX, originY, scale };
  }

  function axialDistance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  function pixelToAxial(x, y) {
    const { originX, originY, scale } = getGridOrigin();
    const center = projectCell(0, 0, originX, originY, scale);

    // Convert to board-local pixels (pre-scale)
    const localX = (x - originX) / scale;
    const localY = (y - originY) / scale;
    const centerLocalX = (center.x - originX) / scale;
    const centerLocalY = (center.y - originY) / scale;

    // Undo hive rotation so hit-tests align with logical grid
    const cos = Math.cos(-hiveRotationAngle);
    const sin = Math.sin(-hiveRotationAngle);
    const relX = localX - centerLocalX;
    const relY = localY - centerLocalY;
    const rotX = relX * cos - relY * sin + centerLocalX;
    const rotY = relX * sin + relY * cos + centerLocalY;

    // Axial inversion for flat-topped layout (Red Blob Games)
    const fq = ((2 / 3) * rotX) / HEX_SIZE;
    const fr = ((-1 / 3) * rotX + (Math.sqrt(3) / 3) * rotY) / HEX_SIZE;

    return global.axialRound(fq, fr);
  }

  function heightKey(qPrim, rPrim) {
    return 2 * rPrim + qPrim;
  }

  function setHoverBaseFromCurrentPiece() {
    if (!currentPiece) return;
    const steps = stepsToCanonicalDown();
    const pivotPrim = global.rotateAxial(currentPiece.pivotQ, currentPiece.pivotR, steps);
    hoverBaseH = heightKey(pivotPrim.q, pivotPrim.r);
  }

  function activateHoverTracking() {
    setHoverBaseFromCurrentPiece();
    hoverActive = true;
  }

  function ensureHoverTracking() {
    if (!currentPiece) return;
    if (!hoverActive) {
      activateHoverTracking();
    }
  }

  function deactivateHoverTracking() {
    hoverActive = false;
  }

  function maybeDeactivateHoverTracking() {
    if (!dragPointerActive && !hoverTargetAxial && !dragTargetAxial) {
      deactivateHoverTracking();
    }
  }

  function nudgePieceToward(target, maxSteps = 3, deadzone = 0) {
    if (gameState !== GAME_STATES.PLAYING) return;
    if (!currentPiece || !target) return;

    // Determine canonical frame where gravity points +r'
    const steps = stepsToCanonicalDown();
    const inverseSteps = (6 - steps) % 6;
    const pivot = { q: currentPiece.pivotQ, r: currentPiece.pivotR };
    const pivotPrim = global.rotateAxial(pivot.q, pivot.r, steps);
    const targetPrim = global.rotateAxial(target.q, target.r, steps);

    const deltaQ = targetPrim.q - pivotPrim.q;
    if (Math.abs(deltaQ) <= deadzone) return;

    const currentH = heightKey(pivotPrim.q, pivotPrim.r);
    const candidates =
      deltaQ > 0
        ? [
            { dq: 1, dr: 0 },
            { dq: 1, dr: -1 }
          ]
        : [
            { dq: -1, dr: 0 },
            { dq: -1, dr: 1 }
          ];

    const scored = candidates
      .map((step) => {
        const deltaH = 2 * step.dr + step.dq;
        const score = Math.abs(currentH + deltaH - hoverBaseH);
        const stepOrig = global.rotateAxial(step.dq, step.dr, inverseSteps);
        const test = clonePiece(currentPiece);
        test.pivotQ += stepOrig.q;
        test.pivotR += stepOrig.r;
        const valid = canPieceExist(test);
        return { ...step, score, stepOrig, valid };
      })
      .sort((a, b) => a.score - b.score);

    for (const step of scored) {
      if (!step.valid) continue;
      const moved = movePiece(step.stepOrig.q, step.stepOrig.r);
      if (moved) break;
    }
  }

  function projectCell(q, r, originX, originY, scale) {
    const base = global.axialToPixel(q, r, 0, 0);
    return {
      x: originX + base.x * scale,
      y: originY + base.y * scale
    };
  }

  // Flat-topped hex drawing – aligns with axialToPixel
  function drawHex(ctx, centerX, centerY, size, fillStyle, strokeStyle) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i); // 0,60,... flat-top
      const x = centerX + size * Math.cos(angle);
      const y = centerY + size * Math.sin(angle);
      corners.push({ x, y });
    }
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = Math.max(1.6, size * 0.08);
      ctx.stroke();
    }
  }

  // ---------- Rendering ----------

  function renderGame(ctx) {
    if (!canvas) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = global.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, gameWidth, gameHeight);

    ctx.save();
    ctx.fillStyle = "#050308";
    ctx.fillRect(0, 0, gameWidth, gameHeight);

    const bgImg = images.hiveBg;
    if (isImageReady(bgImg)) {
      try {
        const pattern = ctx.createPattern(bgImg, "repeat");
        if (pattern) {
          ctx.globalAlpha = 0.32;
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, gameWidth, gameHeight);
          ctx.globalAlpha = 1;
        }
      } catch (e) {}
    }

    const { originX, originY, scale } = getGridOrigin();
    const hexSize = HEX_SIZE * scale;
    const centerPos = projectCell(0, 0, originX, originY, scale);

    // rotate + shake around center
    ctx.save();
    let shakeX = 0;
    let shakeY = 0;
    if (hiveShakeTime > 0) {
      const strength = hiveShakeTime / HIVE_SHAKE_DURATION;
      const maxOffset = 6;
      shakeX = (Math.random() * 2 - 1) * maxOffset * strength;
      shakeY = (Math.random() * 2 - 1) * maxOffset * strength;
    }
    ctx.translate(centerPos.x + shakeX, centerPos.y + shakeY);
    ctx.rotate(hiveRotationAngle);
    ctx.translate(-centerPos.x, -centerPos.y);

    // shade inner hole
    for (const cell of allCells) {
      if (cell.ringIndex > INNER_RADIUS) continue;
      const pos = projectCell(cell.q, cell.r, originX, originY, scale);
      const tInner = cell.ringIndex / Math.max(1, INNER_RADIUS);
      const fillAlphaInner = 0.15 + 0.08 * tInner;
      drawHex(
        ctx,
        pos.x,
        pos.y,
        hexSize * 1.05,
        `rgba(15, 8, 20, ${fillAlphaInner.toFixed(3)})`,
        `rgba(255,255,255,0.08)`
      );
    }

    // Draw donut board (only outer rings)
    for (const cell of boardCells) {
      const pos = projectCell(cell.q, cell.r, originX, originY, scale);
      const value = getCell(cell.q, cell.r);

      const t = HIVE_RADIUS > 0 ? cell.ringIndex / HIVE_RADIUS : 0;
      const strokeAlpha = 0.18 + 0.28 * t;
      const fillAlpha = 0.08 + 0.14 * t;
      const strokeColor = `rgba(255,255,255,${strokeAlpha.toFixed(3)})`;

      if (value === null || value === undefined) {
        drawHex(
          ctx,
          pos.x,
          pos.y,
          hexSize * 1.03,
          `rgba(255,255,255,${fillAlpha.toFixed(3)})`,
          strokeColor
        );
      } else {
        const colorIndex = value % HONEY_COLORS.length;
        const img2 = images.hexFilled[colorIndex];
        if (isImageReady(img2)) {
          const sizePx = hexSize * 2.1;
          ctx.save();
          ctx.shadowColor = "rgba(255, 200, 80, 0.25)";
          ctx.shadowBlur = hexSize * 0.18;
          ctx.translate(pos.x - sizePx / 2, pos.y - sizePx / 2);
          ctx.drawImage(img2, 0, 0, sizePx, sizePx);
          ctx.restore();
        } else {
          const fill = HONEY_COLORS[colorIndex];
          drawHex(ctx, pos.x, pos.y, hexSize * 1.02, fill, "#120910");
        }
      }
    }

    // Effects
    for (const fx of cellEffects) {
      if (!isInsideBoard(fx.q, fx.r)) continue;
      const pos = projectCell(fx.q, fx.r, originX, originY, scale);
      const colorIndex = fx.colorIndex % HONEY_COLORS.length;
      const fill = HONEY_COLORS[colorIndex] || HONEY_COLORS[0];
      const t = Math.max(0, Math.min(1, fx.timer / fx.duration));

      if (fx.type === "clearRing") {
        ctx.save();
        const pulse = 1 - t;
        const radius = hexSize * (1.05 + pulse * 0.45);
        ctx.globalAlpha = 0.55 * t;
        ctx.lineWidth = Math.max(2, hexSize * 0.2 * pulse);
        ctx.strokeStyle = `rgba(255, 230, 140, ${0.7 * t})`;
        ctx.shadowColor = "rgba(255, 200, 120, 0.3)";
        ctx.shadowBlur = hexSize * 0.55 * pulse;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const scaleFx = fx.type === "clear" ? 1 + 0.28 * (1 - t) : 1 + 0.18 * (1 - t);
      ctx.save();
      ctx.globalAlpha = fx.type === "clear" ? t : 0.65 + 0.35 * t;
      drawHex(
        ctx,
        pos.x,
        pos.y,
        hexSize * 1.05 * scaleFx,
        fill,
        fx.type === "clear" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.55)"
      );
      ctx.restore();
    }

    // Ghost piece
    if (currentPiece) {
      const gdir = getGravityDir();
      let ghost = clonePiece(currentPiece);
      while (true) {
        const test = clonePiece(ghost);
        test.pivotQ += gdir.q;
        test.pivotR += gdir.r;
        if (canPieceExist(test)) {
          ghost = test;
        } else {
          break;
        }
      }
      const ghostCells = getPieceCells(ghost);
      ctx.globalAlpha = 0.22;
      for (const c of ghostCells) {
        if (!isInsideHive(c.q, c.r)) continue;
        const pos = projectCell(c.q, c.r, originX, originY, scale);
        const colorIndex = ghost.colorIndex % HONEY_COLORS.length;
        const fill = HONEY_COLORS[colorIndex];
        drawHex(ctx, pos.x, pos.y, hexSize * 0.95, fill, null);
      }
      ctx.globalAlpha = 1;
    }

    // Current falling piece
    if (currentPiece) {
      const cells = getPieceCells(currentPiece);
      for (const c of cells) {
        if (!isInsideHive(c.q, c.r)) continue;
        const pos = projectCell(c.q, c.r, originX, originY, scale);
        const colorIndex = currentPiece.colorIndex % HONEY_COLORS.length;
        const img2 = images.hexFilled[colorIndex];
        if (isImageReady(img2)) {
          const sizePx = hexSize * 2.1;
          ctx.save();
          ctx.translate(pos.x - sizePx / 2, pos.y - sizePx / 2);
          ctx.drawImage(img2, 0, 0, sizePx, sizePx);
          ctx.restore();
        } else {
          const fill = HONEY_COLORS[colorIndex];
          drawHex(ctx, pos.x, pos.y, hexSize * 1.02, fill, "#120910");
        }
      }
    }

    ctx.restore(); // hive transform
    ctx.restore(); // scene

    renderMenuHint(ctx);
    renderNextPreview();
  }

  function renderMenuHint(ctx) {
    if (gameState !== GAME_STATES.MENU) return;
    ctx.save();
    const margin = 18;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "18px 'Inter', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Tap or click to start", gameWidth / 2, margin + 22);

    ctx.font = "14px 'Inter', 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "rgba(255, 220, 180, 0.9)";
    ctx.textBaseline = "top";
    ctx.fillText(
      "Drag sideways to steer • Tap piece to rotate • Use the DROP button for a fast drop",
      gameWidth / 2,
      gameHeight - margin - 34
    );
    ctx.restore();
  }

  function renderNextPreview() {
    if (!nextCanvas || !ctxNext) return;
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    ctxNext.save();
    ctxNext.clearRect(0, 0, w, h);

    ctxNext.fillStyle = "#130918";
    ctxNext.fillRect(0, 0, w, h);

    if (!nextPiece) {
      ctxNext.restore();
      return;
    }

    const size = HEX_SIZE * 0.9;
    const centerX = w / 2;
    const centerY = h / 2;

    for (const offset of nextPiece.shape.cells) {
      const rotated = global.rotateAxial(
        offset.q,
        offset.r,
        nextPiece.rotation || 0
      );
      const x = centerX + rotated.q * size * 1.5;
      const y = centerY + (rotated.r + rotated.q / 2) * size * Math.sqrt(3);
      const colorIndex = nextPiece.colorIndex % HONEY_COLORS.length;
      const img2 = images.hexFilled[colorIndex];
      if (isImageReady(img2)) {
        const sizePx = size * 2;
        ctxNext.save();
        ctxNext.translate(x - sizePx / 2, y - sizePx / 2);
        ctxNext.drawImage(img2, 0, 0, sizePx, sizePx);
        ctxNext.restore();
      } else {
        drawHex(ctxNext, x, y, size, HONEY_COLORS[colorIndex], "#1a0c10");
      }
    }

    ctxNext.restore();
  }

  // ---------- Hive rotation controls ----------

  function rotateHive(step) {
    // visual anim
    rotationStartAngle = hiveRotationAngle;
    targetRotationAngle = hiveRotationAngle + step * (Math.PI / 3);
    rotationProgress = 0;
    hiveShakeTime = HIVE_SHAKE_DURATION;
    safePlaySound("rotate");
    debugLog("Hive rotate", { step, targetRotationAngle });
    recomputeDirectionMapping();
  }

  function rotateHiveLeft() {
    rotateHive(-1);
  }

  function rotateHiveRight() {
    rotateHive(1);
  }

  // ---------- Public API ----------

  function initGame(mainCanvas, previewCanvas) {
    canvas = mainCanvas;
    nextCanvas = previewCanvas;
    ctxNext = nextCanvas ? nextCanvas.getContext("2d") : null;

    const rect = canvas.getBoundingClientRect();
    gameWidth = rect.width || 600;
    gameHeight = rect.height || 800;

    initAssets();
    precomputeHive();
    resetGame();
  }

  function setSize(width, height) {
    gameWidth = width;
    gameHeight = height;
  }

  function getStats() {
    return {
      score,
      level,
      lines: linesClearedTotal
    };
  }

  function getState() {
    return gameState;
  }

  function handleMoveLeft() {
    if (gameState !== GAME_STATES.PLAYING) return;
    const dir = HEX_DIRECTIONS[controlDirLeftIndex];
    if (!dir) return;
    if (movePiece(dir.q, dir.r)) {
      safePlaySound("move");
    }
  }

  function handleMoveRight() {
    if (gameState !== GAME_STATES.PLAYING) return;
    const dir = HEX_DIRECTIONS[controlDirRightIndex];
    if (!dir) return;
    if (movePiece(dir.q, dir.r)) {
      safePlaySound("move");
    }
  }

  function handleRotateCW() {
    if (gameState !== GAME_STATES.PLAYING) return;
    rotatePiece(1);
  }

  function handleRotateCCW() {
    if (gameState !== GAME_STATES.PLAYING) return;
    rotatePiece(-1);
  }

  function handleSoftDrop() {
    if (gameState !== GAME_STATES.PLAYING) return;
    const gdir = HEX_DIRECTIONS[gravityDirIndex];
    if (!gdir) return;
    const moved = movePiece(gdir.q, gdir.r);
    if (moved && hoverActive) {
      hoverBaseH += 2;
    }
    if (!moved) {
      lockPiece();
    }
  }

  function handleHardDrop() {
    if (gameState !== GAME_STATES.PLAYING) return;
    hardDropCurrentPiece();
  }

  function handleRotateHiveLeft() {
    if (gameState !== GAME_STATES.PLAYING) return;
    rotateHiveLeft();
  }

  function handleRotateHiveRight() {
    if (gameState !== GAME_STATES.PLAYING) return;
    rotateHiveRight();
  }

  // ---------- Input controller (pointer + keyboard) ----------

  function createInputController(canvas) {
    if (!canvas) return null;

    const tapDistanceSq = 10 * 10;
    const tapDurationMs = 180;
    const touchSteerThreshold = 8;
    const softDropIntervalMs = 60;
    const touchLockDelayMs = 80;
    const touchDropThresholdPx = 42;
    const touchDropAngleRatio = 1.6;
    const enableTouchSwipeDrop = false;
    const hoverStepsPerFrame = 3;
    const dragStepsPerFrame = 4;
    const followDeadzone = 0.4;
    const hiveButtonSize = 56;
    const hiveButtonMargin = 12;

    const state = {
      pointerId: null,
      downPos: null,
      lastPos: null,
      downTime: 0,
      dragging: false,
      pointerType: null,
      totalDelta: { x: 0, y: 0 },
      interactingWithHiveButton: false,
      hiveButtonHover: false,
      hiveButtonPressed: false,
      lastSoftDrop: 0,
      touchActive: false,
      touchMode: "none",
      touchStartTime: 0,
      touchStartPos: null
    };

    function getHiveButtonRect() {
      return {
        x: hiveButtonMargin,
        y: hiveButtonMargin,
        size: hiveButtonSize
      };
    }

    function rotatePoint(x, y, cx, cy, angle) {
      const dx = x - cx;
      const dy = y - cy;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos
      };
    }

    function getPointerPos(evt) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    }

    function isOnHiveButton(pos) {
      const rect = getHiveButtonRect();
      return (
        pos.x >= rect.x &&
        pos.x <= rect.x + rect.size &&
        pos.y >= rect.y &&
        pos.y <= rect.y + rect.size
      );
    }

    function isTapOnPiece(pos) {
      if (!currentPiece) return false;
      const tappedAxial = pixelToAxial(pos.x, pos.y);
      const pieceCells = getPieceCells(currentPiece);
      const onCell = pieceCells.some((c) => c.q === tappedAxial.q && c.r === tappedAxial.r);
      if (onCell) return true;

      const { originX, originY, scale } = getGridOrigin();
      const pivotPos = projectCell(currentPiece.pivotQ, currentPiece.pivotR, originX, originY, scale);
      const centerPos = projectCell(0, 0, originX, originY, scale);
      const rotatedPivot = rotatePoint(
        pivotPos.x,
        pivotPos.y,
        centerPos.x,
        centerPos.y,
        hiveRotationAngle
      );
      const dx = pos.x - rotatedPivot.x;
      const dy = pos.y - rotatedPivot.y;
      const radius = HEX_SIZE * scale * 1.25;
      return dx * dx + dy * dy <= radius * radius;
    }

    function setHoverTarget(pos) {
      hoverTargetAxial = pixelToAxial(pos.x, pos.y);
      if (gameState === GAME_STATES.PLAYING) {
        ensureHoverTracking();
      }
    }

    function clearHoverTarget() {
      hoverTargetAxial = null;
      maybeDeactivateHoverTracking();
    }

    function setDragTarget(pos) {
      dragTargetAxial = pixelToAxial(pos.x, pos.y);
      if (gameState === GAME_STATES.PLAYING) {
        ensureHoverTracking();
      }
    }

    function clearDragTarget() {
      dragTargetAxial = null;
      maybeDeactivateHoverTracking();
    }

    function maybeSoftDrop(deltaX, deltaY, pointerType) {
      if (pointerType === "touch") return;
      if (gameState !== GAME_STATES.PLAYING) return;
      const now = performance.now();
      if (
        deltaY > touchDropThresholdPx &&
        Math.abs(deltaY) > touchDropAngleRatio * Math.abs(deltaX) &&
        now - state.lastSoftDrop > softDropIntervalMs
      ) {
        state.lastSoftDrop = now;
        handleSoftDrop();
      }
    }

    function handleTouchMove(pos, deltaX, deltaY) {
      state.dragging = true;
      if (state.touchMode === "steer") {
        if (Math.abs(deltaX) >= touchSteerThreshold) {
          dragPointerActive = true;
          const steerY = state.touchStartPos ? state.touchStartPos.y : pos.y;
          setDragTarget({ x: pos.x, y: steerY });
        }

        if (
          enableTouchSwipeDrop &&
          performance.now() - state.touchStartTime > touchLockDelayMs &&
          deltaY > touchDropThresholdPx &&
          Math.abs(deltaY) > touchDropAngleRatio * Math.abs(deltaX)
        ) {
          state.touchMode = "drop";
          state.lastSoftDrop = 0;
          handleSoftDrop();
        }
      } else if (state.touchMode === "drop" && enableTouchSwipeDrop) {
        maybeSoftDrop(deltaX, deltaY, "touch");
      }
    }

    function maybeStartFromMenu() {
      if (gameState === GAME_STATES.MENU) {
        startGame();
      }
    }

    function tickInput() {
      if (gameState !== GAME_STATES.PLAYING) return;
      if (!currentPiece) return;

      if (hoverTargetAxial || dragTargetAxial) {
        ensureHoverTracking();
      }

      if (dragPointerActive && dragTargetAxial) {
        nudgePieceToward(dragTargetAxial, dragStepsPerFrame, followDeadzone);
      } else if (hoverTargetAxial) {
        nudgePieceToward(hoverTargetAxial, hoverStepsPerFrame, followDeadzone);
      }
    }

    function onPointerDown(evt) {
      if (evt.button === 2) {
        handleHardDrop();
        evt.preventDefault();
        return;
      }

      if (state.pointerId !== null) return;
      const pos = getPointerPos(evt);
      state.pointerId = evt.pointerId;
      state.downPos = pos;
      state.lastPos = pos;
      state.downTime = performance.now();
      state.touchActive = evt.pointerType === "touch";
      state.touchMode = state.touchActive ? "steer" : "none";
      state.touchStartTime = state.downTime;
      state.touchStartPos = pos;
      state.dragging = false;
      state.pointerType = evt.pointerType;
      state.totalDelta = { x: 0, y: 0 };
      state.interactingWithHiveButton = isOnHiveButton(pos);
      state.hiveButtonPressed = state.interactingWithHiveButton;
      state.hiveButtonHover = state.interactingWithHiveButton;

      if (!state.interactingWithHiveButton) {
        if (state.touchActive) {
          dragPointerActive = false;
          clearDragTarget();
        } else {
          dragPointerActive = true;
          setDragTarget(pos);
        }
      }

      canvas.setPointerCapture(evt.pointerId);
      evt.preventDefault();
    }

    function onPointerMove(evt) {
      if (state.pointerId !== null && state.pointerId !== evt.pointerId) return;
      const pos = getPointerPos(evt);

      if (state.pointerId === null) {
        if (evt.pointerType === "mouse" && evt.buttons === 0) {
          setHoverTarget(pos);
        }
        return;
      }

      const deltaX = pos.x - state.downPos.x;
      const deltaY = pos.y - state.downPos.y;
      state.totalDelta = { x: deltaX, y: deltaY };
      state.lastPos = pos;

      if (state.interactingWithHiveButton) {
        state.hiveButtonHover = isOnHiveButton(pos);
      } else if (state.touchActive) {
        handleTouchMove(pos, deltaX, deltaY);
      } else {
        state.dragging = true;
        if (gameState === GAME_STATES.MENU && Math.abs(deltaY) > 20) {
          maybeStartFromMenu();
        }
        dragPointerActive = true;
        setDragTarget(pos);
        maybeSoftDrop(deltaX, deltaY, state.pointerType);
      }

      evt.preventDefault();
    }

    function onPointerUp(evt) {
      if (state.pointerId !== evt.pointerId) return;
      const pos = getPointerPos(evt);
      const duration = performance.now() - state.downTime;
      const dx = pos.x - state.downPos.x;
      const dy = pos.y - state.downPos.y;
      const distSq = dx * dx + dy * dy;
      const isTap = distSq <= tapDistanceSq && duration <= tapDurationMs;

      const wasOnButton = state.interactingWithHiveButton;
      const buttonTriggered = wasOnButton && isOnHiveButton(pos);

      if (buttonTriggered) {
        if (gameState === GAME_STATES.PLAYING) {
          handleRotateHiveLeft();
        }
      } else if (gameState === GAME_STATES.MENU) {
        maybeStartFromMenu();
      } else if (isTap && isTapOnPiece(pos)) {
        handleRotateCW();
      }

      if (evt.pointerType === "mouse") {
        setHoverTarget(pos);
      }

      cleanupPointer(evt.pointerId);
      evt.preventDefault();
    }

    function onPointerCancel(evt) {
      if (state.pointerId !== evt.pointerId) return;
      cleanupPointer(evt.pointerId);
    }

    function cleanupPointer(pointerId) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch (e) {}
      state.pointerId = null;
      state.downPos = null;
      state.lastPos = null;
      state.dragging = false;
      state.pointerType = null;
      state.totalDelta = { x: 0, y: 0 };
      state.interactingWithHiveButton = false;
      state.hiveButtonHover = false;
      state.hiveButtonPressed = false;
      dragPointerActive = false;
      state.touchActive = false;
      state.touchMode = "none";
      state.touchStartTime = 0;
      state.touchStartPos = null;
      clearDragTarget();
    }

    function onKeyDown(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
        return;
      }

      const key = e.key;
      const stateName = gameState;
      let handled = false;

      if (stateName === GAME_STATES.MENU && (key === " " || key === "Enter")) {
        startGame();
        handled = true;
      }

      switch (key) {
        case "ArrowLeft":
          handleMoveLeft();
          handled = true;
          break;
        case "ArrowRight":
          handleMoveRight();
          handled = true;
          break;
        case "ArrowDown":
          handleSoftDrop();
          handled = true;
          break;
        case "ArrowUp":
          handleRotateCW();
          handled = true;
          break;
        case "q":
        case "Q":
          handleRotateHiveLeft();
          handled = true;
          break;
        case " ":
          handleHardDrop();
          handled = true;
          break;
        case "p":
        case "P":
          togglePause();
          handled = true;
          break;
      }

      if (handled) {
        e.preventDefault();
      }
    }

    function onPointerLeave() {
      if (!dragPointerActive) {
        clearHoverTarget();
      }
    }

    function onDblClick(e) {
      if (gameState === GAME_STATES.PLAYING) {
        handleHardDrop();
        e.preventDefault();
      }
    }

    const preventContextMenu = (e) => e.preventDefault();

    function renderOverlay(ctx) {
      if (!ctx) return;
      const rect = getHiveButtonRect();
      const baseAlpha = state.hiveButtonHover ? 0.65 : 0.52;
      const pressScale = state.hiveButtonPressed && state.hiveButtonHover ? 0.96 : 1;
      ctx.save();
      ctx.translate(rect.x + rect.size / 2, rect.y + rect.size / 2);
      ctx.scale(pressScale, pressScale);
      ctx.translate(-rect.size / 2, -rect.size / 2);

      const radius = 12;
      ctx.fillStyle = `rgba(18, 12, 26, ${baseAlpha})`;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(rect.size - radius, 0);
      ctx.quadraticCurveTo(rect.size, 0, rect.size, radius);
      ctx.lineTo(rect.size, rect.size - radius);
      ctx.quadraticCurveTo(rect.size, rect.size, rect.size - radius, rect.size);
      ctx.lineTo(radius, rect.size);
      ctx.quadraticCurveTo(0, rect.size, 0, rect.size - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#ffd56b";
      ctx.font = "22px 'Inter', 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("↺", rect.size / 2, rect.size / 2 + 1);
      ctx.restore();
    }

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp, { passive: false });
    canvas.addEventListener("pointercancel", onPointerCancel, { passive: false });
    canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });
    canvas.addEventListener("dblclick", onDblClick, { passive: false });
    canvas.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("keydown", onKeyDown);

    inputTickFn = tickInput;

    return {
      renderOverlay,
      detach() {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("pointerleave", onPointerLeave);
        canvas.removeEventListener("dblclick", onDblClick);
        canvas.removeEventListener("contextmenu", preventContextMenu);
        window.removeEventListener("keydown", onKeyDown);
        inputTickFn = null;
        clearHoverTarget();
        clearDragTarget();
      }
    };
  }

  const HexHiveGame = {
    initGame,
    setSize,
    resetGame,
    startGame,
    togglePause,
    updateGame,
    renderGame,
    handleMoveLeft,
    handleMoveRight,
    handleRotateCW,
    handleRotateCCW,
    handleSoftDrop,
    handleHardDrop,
    handleRotateHiveLeft,
    handleRotateHiveRight,
    createInputController,
    getStats,
    getState,
    GAME_STATES
  };

  global.HexHiveGame = HexHiveGame;
})(window);
