// game.js
// Core game logic, state, and rendering for Hex Hive Drop.

(function (global) {
  const GRID_WIDTH = 10;
  const GRID_HEIGHT = 18;
  const MIN_LINE_LEN = 4;

  const GAME_STATES = {
    MENU: "menu",
    PLAYING: "playing",
    PAUSED: "paused",
    GAMEOVER: "gameover"
  };

  const HONEY_COLORS = ["#f6c453", "#fda85a", "#ffc86a"];

  let canvas = null;
  let nextCanvas = null;
  let gameWidth = 600;
  let gameHeight = 800;
  let ctxNext = null;

  let grid = [];
  let currentPiece = null;
  let nextPiece = null;

  let gameState = GAME_STATES.MENU;
  let score = 0;
  let level = 1;
  let linesClearedTotal = 0;

  let cellEffects = [];
  const LANDING_EFFECT_DURATION = 0.18;
  const CLEAR_EFFECT_DURATION = 0.22;

  let fallInterval = 0.9;
  let fallTimer = 0;

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
    if (!s) return;
    playAudioSafe(s);
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

  // Grid helpers

  function createEmptyGrid() {
    grid = [];
    for (let q = 0; q < GRID_WIDTH; q++) {
      const col = [];
      for (let r = 0; r < GRID_HEIGHT; r++) {
        col.push(null);
      }
      grid.push(col);
    }
  }

  function isCellInside(q, r) {
    return q >= 0 && q < GRID_WIDTH && r >= 0 && r < GRID_HEIGHT;
  }

  function isCellEmpty(q, r) {
    if (!isCellInside(q, r)) return false;
    return grid[q][r] === null;
  }

  // Piece definitions (relative axial cells around pivot (0,0))
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
      name: "triangle3",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 }
      ]
    },
    {
      name: "bent3",
      colorIndex: 2,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 1, r: -1 }
      ]
    },
    {
      name: "kite4",
      colorIndex: 1,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 }
      ]
    },
    {
      name: "zig4",
      colorIndex: 0,
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 }
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
    return {
      shape,
      colorIndex: shape.colorIndex,
      pivotQ: Math.floor(GRID_WIDTH / 2),
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
      if (!isCellInside(c.q, c.r)) return false;
      if (!isCellEmpty(c.q, c.r)) return false;
    }
    return true;
  }

  function movePiece(dx, dr) {
    if (!currentPiece) return false;
    const testPiece = clonePiece(currentPiece);
    testPiece.pivotQ += dx;
    testPiece.pivotR += dr;
    if (canPieceExist(testPiece)) {
      currentPiece = testPiece;
      return true;
    }
    return false;
  }

  function rotatePiece(deltaRotation) {
    if (!currentPiece) return;
    const testPiece = clonePiece(currentPiece);
    testPiece.rotation = (testPiece.rotation + deltaRotation + 6) % 6;
    if (canPieceExist(testPiece)) {
      currentPiece = testPiece;
      safePlaySound("rotate");
    }
  }

  function hardDropCurrentPiece() {
    if (!currentPiece) return;
    let moved = false;
    while (movePiece(0, 1)) {
      moved = true;
    }
    if (moved) {
      safePlaySound("drop");
    }
    lockPiece();
  }

  // Locking and clearing

  function lockPiece() {
    if (!currentPiece) return;
    const cells = getPieceCells(currentPiece);
    for (const c of cells) {
      if (isCellInside(c.q, c.r)) {
        grid[c.q][c.r] = currentPiece.colorIndex;
        cellEffects.push({
          q: c.q,
          r: c.r,
          colorIndex: currentPiece.colorIndex,
          type: "landing",
          timer: LANDING_EFFECT_DURATION,
          duration: LANDING_EFFECT_DURATION
        });
      }
    }
    currentPiece = null;
    safePlaySound("drop");

    let combo = 0;
    while (true) {
      const lineResult = checkLineClears();
      const honeyResult = findHoneyClusters();

      const combinedSet = new Set();
      lineResult.toClearSet.forEach((k) => combinedSet.add(k));
      honeyResult.toClearSet.forEach((k) => combinedSet.add(k));

      if (combinedSet.size === 0) break;

      combo++;
      const comboMultiplier = 1 + (combo - 1) * 0.4;

      if (lineResult.linesCleared > 0) {
        linesClearedTotal += lineResult.linesCleared;
        updateLevelFromLines();
      }

      const baseLineScore =
        lineResult.linesCleared === 0
          ? 0
          : lineResult.linesCleared === 1
          ? 100
          : lineResult.linesCleared === 2
          ? 300
          : 600 + (lineResult.linesCleared - 3) * 200;

      const honeyScore = honeyResult.clusters.reduce(
        (sum, size) => sum + 50 * size,
        0
      );

      const addedScore = Math.floor((baseLineScore + honeyScore) * comboMultiplier);
      score += addedScore;

      if (lineResult.linesCleared > 0 || honeyResult.clusters.length > 0) {
        safePlaySound("lineClear");
      }

      combinedSet.forEach((key) => {
        const [qStr, rStr] = key.split(",");
        const q = parseInt(qStr, 10);
        const r = parseInt(rStr, 10);
        if (!isCellInside(q, r)) return;
        const colorIndex = grid[q][r];
        if (colorIndex !== null && colorIndex !== undefined) {
          cellEffects.push({
            q,
            r,
            colorIndex,
            type: "clear",
            timer: CLEAR_EFFECT_DURATION,
            duration: CLEAR_EFFECT_DURATION
          });
        }
        grid[q][r] = null;
      });

      applyGravity();
    }

    spawnNextPieceOrGameOver();
  }

  function spawnNextPieceOrGameOver() {
    if (!nextPiece) {
      nextPiece = createRandomPiece();
    }
    const basePiece = createPieceFromShape(nextPiece.shape);
    basePiece.colorIndex = nextPiece.colorIndex;

    const spawnPiece = findSpawnPosition(basePiece);
    nextPiece = createRandomPiece();

    if (spawnPiece) {
      currentPiece = spawnPiece;
    } else {
      gameState = GAME_STATES.GAMEOVER;
      safePlaySound("gameOver");
    }
  }

  function findSpawnPosition(pieceTemplate) {
    const candidates = [];
    const centerQ = Math.floor(GRID_WIDTH / 2);
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    const rows = [0, 1];

    for (const r of rows) {
      for (const off of offsets) {
        const q = centerQ + off;
        if (q >= 0 && q < GRID_WIDTH) {
          candidates.push({ q, r });
        }
      }
    }

    for (const pos of candidates) {
      const candidate = clonePiece(pieceTemplate);
      candidate.pivotQ = pos.q;
      candidate.pivotR = pos.r;
      if (canPieceExist(candidate)) {
        return candidate;
      }
    }
    return null;
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

  function checkLineClears() {
    const toClearSet = new Set();
    let linesCleared = 0;

    // Helper to mark a line
    function markLine(coords) {
      if (coords.length < MIN_LINE_LEN) return;
      for (const c of coords) {
        if (!isCellInside(c.q, c.r) || grid[c.q][c.r] === null) {
          return;
        }
      }
      linesCleared++;
      for (const c of coords) {
        toClearSet.add(c.q + "," + c.r);
      }
    }

    // 1) Rows: r constant
    for (let r = 0; r < GRID_HEIGHT; r++) {
      const coords = [];
      for (let q = 0; q < GRID_WIDTH; q++) {
        coords.push({ q, r });
      }
      markLine(coords);
    }

    // 2) Columns: q constant
    for (let q = 0; q < GRID_WIDTH; q++) {
      const coords = [];
      for (let r = 0; r < GRID_HEIGHT; r++) {
        coords.push({ q, r });
      }
      markLine(coords);
    }

    // 3) Diagonals: q + r = constant
    const minK = 0;
    const maxK = GRID_WIDTH + GRID_HEIGHT - 2;
    for (let k = minK; k <= maxK; k++) {
      const coords = [];
      for (let q = 0; q < GRID_WIDTH; q++) {
        const r = k - q;
        if (r >= 0 && r < GRID_HEIGHT) {
          coords.push({ q, r });
        }
      }
      markLine(coords);
    }

    return { linesCleared, toClearSet };
  }

  function findHoneyClusters() {
    const toClearSet = new Set();
    const clusters = [];
    const visited = Array.from({ length: GRID_WIDTH }, () =>
      Array.from({ length: GRID_HEIGHT }, () => false)
    );

    for (let q = 0; q < GRID_WIDTH; q++) {
      for (let r = 0; r < GRID_HEIGHT; r++) {
        if (visited[q][r] || grid[q][r] === null) continue;
        const colorIndex = grid[q][r];
        const stack = [{ q, r }];
        const cluster = [];
        visited[q][r] = true;

        while (stack.length > 0) {
          const cell = stack.pop();
          cluster.push(cell);
          const neighbors = global.hexNeighbors(cell.q, cell.r);
          for (const n of neighbors) {
            if (!isCellInside(n.q, n.r)) continue;
            if (visited[n.q][n.r]) continue;
            if (grid[n.q][n.r] === colorIndex) {
              visited[n.q][n.r] = true;
              stack.push(n);
            }
          }
        }

        if (cluster.length >= 6) {
          clusters.push(cluster.length);
          for (const c of cluster) {
            toClearSet.add(c.q + "," + c.r);
          }
        }
      }
    }

    return { toClearSet, clusters };
  }

  function applyGravity() {
    for (let q = 0; q < GRID_WIDTH; q++) {
      let writeR = GRID_HEIGHT - 1;
      for (let r = GRID_HEIGHT - 1; r >= 0; r--) {
        const cell = grid[q][r];
        if (cell !== null) {
          if (writeR !== r) {
            grid[q][writeR] = cell;
            grid[q][r] = null;
          }
          writeR--;
        }
      }
      for (let r = writeR; r >= 0; r--) {
        grid[q][r] = null;
      }
    }
  }

  // State management

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
  }

  function startGame() {
    if (gameState === GAME_STATES.PLAYING) return;
    if (gameState === GAME_STATES.GAMEOVER || gameState === GAME_STATES.MENU) {
      createEmptyGrid();
      currentPiece = null;
      nextPiece = null;
      fallTimer = 0;
      score = 0;
      level = 1;
      linesClearedTotal = 0;
      fallInterval = 0.9;
      cellEffects = [];
      spawnNextPieceOrGameOver();
    }
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

  // Game loop update & render

  function updateGame(deltaTime) {
    tickEffects(deltaTime);
    if (gameState !== GAME_STATES.PLAYING) return;
    if (!currentPiece) return;

    fallTimer += deltaTime;
    if (fallTimer >= fallInterval) {
      fallTimer = 0;
      const moved = movePiece(0, 1);
      if (!moved) {
        lockPiece();
      }
    }
  }

  function tickEffects(deltaTime) {
    if (!deltaTime) return;
    for (const fx of cellEffects) {
      fx.timer -= deltaTime;
    }
    cellEffects = cellEffects.filter((fx) => fx.timer > 0);
  }

  function getGridOrigin() {
    const cols = GRID_WIDTH;
    const rows = GRID_HEIGHT;
    const gridPixelWidth = HEX_SIZE * (1.5 * (cols - 1) + 2);
    const gridPixelHeight =
      HEX_SIZE * (Math.sqrt(3) * (rows + (cols - 1) / 2)) + HEX_SIZE;

    const margin = 20;
    const availableWidth = gameWidth - margin * 2;
    const availableHeight = gameHeight - margin * 2;

    let scale = Math.min(
      availableWidth / gridPixelWidth,
      availableHeight / gridPixelHeight
    );
    if (!isFinite(scale) || scale <= 0) scale = 1;

    const scaledWidth = gridPixelWidth * scale;
    const scaledHeight = gridPixelHeight * scale;

    const originX = (gameWidth - scaledWidth) / 2 + HEX_SIZE * scale;
    const originY = (gameHeight - scaledHeight) / 2 + HEX_SIZE * scale;

    return { originX, originY, scale };
  }

  function drawHex(ctx, centerX, centerY, size, fillStyle, strokeStyle) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i + 30);
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
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function renderGame(ctx) {
    if (!canvas) return;
    const dpr = global.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gameWidth, gameHeight);

    // Background
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
      } catch (e) {
        // Ignore background errors
      }
    }


    const { originX, originY, scale } = getGridOrigin();
    const hexSize = HEX_SIZE * scale;

    // Draw static cells
    for (let q = 0; q < GRID_WIDTH; q++) {
      for (let r = 0; r < GRID_HEIGHT; r++) {
        const pos = global.axialToPixel(q, r, originX, originY);
        const cell = grid[q][r];

        if (cell === null) {
          // Empty outline
          drawHex(
            ctx,
            pos.x,
            pos.y,
            hexSize * 0.94,
            null,
            "rgba(255,255,255,0.06)"
          );
        } else {
          const colorIndex = cell % HONEY_COLORS.length;
          const img = images.hexFilled[colorIndex];
          if (isImageReady(img)) {
            const sizePx = hexSize * 2;
            ctx.save();
            ctx.translate(pos.x - sizePx / 2, pos.y - sizePx / 2);
            ctx.drawImage(img, 0, 0, sizePx, sizePx);
            ctx.restore();
          } else {
            const fill = HONEY_COLORS[colorIndex];
            drawHex(ctx, pos.x, pos.y, hexSize * 0.94, fill, "#1c0f12");
          }
        }
      }
    }

    // Effects overlay
    for (const fx of cellEffects) {
      if (!isCellInside(fx.q, fx.r)) continue;
      const pos = global.axialToPixel(fx.q, fx.r, originX, originY);
      const colorIndex = fx.colorIndex % HONEY_COLORS.length;
      const fill = HONEY_COLORS[colorIndex] || HONEY_COLORS[0];
      const t = Math.max(0, Math.min(1, fx.timer / fx.duration));
      const scaleFx = fx.type === "clear" ? 1 + 0.18 * (1 - t) : 1 + 0.12 * (1 - t);
      ctx.save();
      ctx.globalAlpha = fx.type === "clear" ? t : 0.5 + 0.5 * t;
      drawHex(ctx, pos.x, pos.y, hexSize * 0.96 * scaleFx, fill, "rgba(255,255,255,0.5)");
      ctx.restore();
    }

    // Draw ghost piece
    if (currentPiece) {
      let ghost = clonePiece(currentPiece);
      while (true) {
        const test = clonePiece(ghost);
        test.pivotR += 1;
        if (canPieceExist(test)) {
          ghost = test;
        } else {
          break;
        }
      }
      const ghostCells = getPieceCells(ghost);
      ctx.globalAlpha = 0.22;
      for (const c of ghostCells) {
        if (!isCellInside(c.q, c.r)) continue;
        const pos = global.axialToPixel(c.q, c.r, originX, originY);
        const colorIndex = ghost.colorIndex % HONEY_COLORS.length;
        const fill = HONEY_COLORS[colorIndex];
        drawHex(ctx, pos.x, pos.y, hexSize * 0.9, fill, null);
      }
      ctx.globalAlpha = 1;
    }

    // Draw current piece
    if (currentPiece) {
      const cells = getPieceCells(currentPiece);
      for (const c of cells) {
        if (!isCellInside(c.q, c.r)) continue;
        const pos = global.axialToPixel(c.q, c.r, originX, originY);
        const colorIndex = currentPiece.colorIndex % HONEY_COLORS.length;
        const img = images.hexFilled[colorIndex];
        if (isImageReady(img)) {
          const sizePx = hexSize * 2;
          ctx.save();
          ctx.translate(pos.x - sizePx / 2, pos.y - sizePx / 2);
          ctx.drawImage(img, 0, 0, sizePx, sizePx);
          ctx.restore();
        } else {
          const fill = HONEY_COLORS[colorIndex];
          drawHex(ctx, pos.x, pos.y, hexSize * 0.94, fill, "#120910");
        }
      }
    }

    ctx.restore();

    // Render next piece preview
    renderNextPreview();
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
      const rotated = global.rotateAxial(offset.q, offset.r, nextPiece.rotation || 0);
      const x = centerX + rotated.q * size * 1.5;
      const y = centerY + (rotated.r + rotated.q / 2) * size * Math.sqrt(3);
      const colorIndex = nextPiece.colorIndex % HONEY_COLORS.length;
      const img = images.hexFilled[colorIndex];
      if (isImageReady(img)) {
        const sizePx = size * 2;
        ctxNext.save();
        ctxNext.translate(x - sizePx / 2, y - sizePx / 2);
        ctxNext.drawImage(img, 0, 0, sizePx, sizePx);
        ctxNext.restore();
      } else {
        drawHex(ctxNext, x, y, size, HONEY_COLORS[colorIndex], "#1a0c10");
      }
    }

    ctxNext.restore();
  }

  // Public API

  function initGame(mainCanvas, previewCanvas) {
    canvas = mainCanvas;
    nextCanvas = previewCanvas;
    ctxNext = nextCanvas ? nextCanvas.getContext("2d") : null;
    const rect = canvas.getBoundingClientRect();
    gameWidth = rect.width || 600;
    gameHeight = rect.height || 800;
    initAssets();
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
    if (movePiece(-1, 0)) {
      safePlaySound("move");
    }
  }

  function handleMoveRight() {
    if (gameState !== GAME_STATES.PLAYING) return;
    if (movePiece(1, 0)) {
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
    const moved = movePiece(0, 1);
    if (!moved) {
      lockPiece();
    }
  }

  function handleHardDrop() {
    if (gameState !== GAME_STATES.PLAYING) return;
    hardDropCurrentPiece();
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
    getStats,
    getState,
    GAME_STATES
  };

  global.HexHiveGame = HexHiveGame;
})(window);
