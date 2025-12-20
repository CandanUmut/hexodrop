// main.js
// Wiring DOM, input, loop, and Supabase integration for Hex Hive Drop.

(function (global) {
  const HexHiveGame = global.HexHiveGame;
  const HexHiveSupabase = global.HexHiveSupabase;

  let canvas;
  let ctx;
  let nextCanvas;

  let lastTimestamp = 0;
  let lastGameState = null;

  let nicknameModal;
  let nicknameInput;
  let nicknameSaveBtn;

  let leaderboardModal;
  let leaderboardList;
  let leaderboardCloseBtn;

  let gameoverModal;
  let gameoverScore;
  let gameoverLevel;
  let gameoverLines;
  let gameoverRestartBtn;
  let gameoverMenuBtn;

  let statScore;
  let statLevel;
  let statLines;
  let lastStatValues = { score: null, level: null, lines: null };

  const statFlashTimers = new Map();

  let btnPlay;
  let btnPause;
  let btnRestart;
  let btnLeaderboard;
  let btnRotateHiveLeft;
  let btnDrop;
  let btnRotateHiveRight;

  function initDom() {
    canvas = document.getElementById("game-canvas");
    nextCanvas = document.getElementById("next-canvas");
    ctx = canvas.getContext("2d");

    nicknameModal = document.getElementById("nickname-modal");
    nicknameInput = document.getElementById("nickname-input");
    nicknameSaveBtn = document.getElementById("nickname-save");

    leaderboardModal = document.getElementById("leaderboard-modal");
    leaderboardList = document.getElementById("leaderboard-list");
    leaderboardCloseBtn = document.getElementById("leaderboard-close");

    gameoverModal = document.getElementById("gameover-modal");
    gameoverScore = document.getElementById("gameover-score");
    gameoverLevel = document.getElementById("gameover-level");
    gameoverLines = document.getElementById("gameover-lines");
    gameoverRestartBtn = document.getElementById("gameover-restart");
    gameoverMenuBtn = document.getElementById("gameover-menu");

    statScore = document.getElementById("stat-score");
    statLevel = document.getElementById("stat-level");
    statLines = document.getElementById("stat-lines");

    btnPlay = document.getElementById("btn-play");
    btnPause = document.getElementById("btn-pause");
    btnRestart = document.getElementById("btn-restart");
    btnLeaderboard = document.getElementById("btn-leaderboard");
    btnRotateHiveLeft = document.getElementById("btn-rotate-hive-left");
    btnDrop = document.getElementById("btn-drop");
    btnRotateHiveRight = document.getElementById("btn-rotate-hive-right");

    setupButtons();
    setupKeyboard();
    setupTouchZones();
    setupMobileControls();
    setupNicknameModal();
    setupLeaderboardModal();
    setupGameoverModal();
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    HexHiveGame.setSize(rect.width, rect.height);
  }

  function setupButtons() {
    btnPlay.addEventListener("click", () => {
      HexHiveGame.startGame();
      resetStatTracking();
      updateButtonStates();
    });

    btnPause.addEventListener("click", () => {
      HexHiveGame.togglePause();
      updateButtonStates();
    });

    btnRestart.addEventListener("click", () => {
      HexHiveGame.resetGame();
      HexHiveGame.startGame();
      resetStatTracking();
      hideModal(gameoverModal);
      updateButtonStates();
    });

    btnLeaderboard.addEventListener("click", async () => {
      await openLeaderboard();
    });
  }

  function setupKeyboard() {
    window.addEventListener("keydown", (e) => {
      const state = HexHiveGame.getState();
      if (state === HexHiveGame.GAME_STATES.MENU) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          HexHiveGame.handleMoveLeft();
          break;
        case "ArrowRight":
          e.preventDefault();
          HexHiveGame.handleMoveRight();
          break;
        case "ArrowDown":
          e.preventDefault();
          HexHiveGame.handleSoftDrop();
          break;
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          HexHiveGame.handleRotateCW();
          break;
        case "z":
        case "Z":
          e.preventDefault();
          HexHiveGame.handleRotateCCW();
          break;
        case " ":
          e.preventDefault();
          HexHiveGame.handleHardDrop();
          break;
        case "p":
        case "P":
          e.preventDefault();
          HexHiveGame.togglePause();
          updateButtonStates();
          break;
      }
    });
  }

  function setupTouchZones() {
    const leftZone = document.getElementById("touch-left");
    const rightZone = document.getElementById("touch-right");
    const topZone = document.getElementById("touch-top");
    const bottomZone = document.getElementById("touch-bottom");

    function attach(zone, handler) {
      zone.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        handler();
      });
    }

    attach(leftZone, () => HexHiveGame.handleMoveLeft());
    attach(rightZone, () => HexHiveGame.handleMoveRight());
    attach(topZone, () => HexHiveGame.handleRotateCW());
    attach(bottomZone, () => HexHiveGame.handleSoftDrop());
  }

  function setupMobileControls() {
    if (btnRotateHiveLeft) {
      btnRotateHiveLeft.addEventListener("click", () => {
        HexHiveGame.handleRotateHiveLeft();
      });
    }

    if (btnDrop) {
      btnDrop.addEventListener("click", () => {
        const state = HexHiveGame.getState();
        if (state === HexHiveGame.GAME_STATES.MENU) {
          HexHiveGame.startGame();
        } else if (state === HexHiveGame.GAME_STATES.GAMEOVER) {
          HexHiveGame.resetGame();
          HexHiveGame.startGame();
        } else if (state === HexHiveGame.GAME_STATES.PLAYING) {
          HexHiveGame.handleHardDrop();
        }
      });
    }

    if (btnRotateHiveRight) {
      btnRotateHiveRight.addEventListener("click", () => {
        HexHiveGame.handleRotateHiveRight();
      });
    }
  }

  function setupNicknameModal() {
    const stored = HexHiveSupabase.getStoredNickname();
    if (stored) {
      nicknameInput.value = stored;
      hideModal(nicknameModal);
    } else {
      nicknameInput.value = "";
      showModal(nicknameModal);
    }

    nicknameSaveBtn.addEventListener("click", async () => {
      const value = nicknameInput.value.trim() || "BeePlayer";
      HexHiveSupabase.setStoredNickname(value);
      try {
        await HexHiveSupabase.getOrCreatePlayer(value);
      } catch (e) {
        // ignore
      }
      hideModal(nicknameModal);
    });
  }

  function setupLeaderboardModal() {
    leaderboardCloseBtn.addEventListener("click", () => {
      hideModal(leaderboardModal);
    });
  }

  function setupGameoverModal() {
    gameoverRestartBtn.addEventListener("click", () => {
      HexHiveGame.resetGame();
      HexHiveGame.startGame();
      resetStatTracking();
      hideModal(gameoverModal);
      updateButtonStates();
    });

    gameoverMenuBtn.addEventListener("click", () => {
      HexHiveGame.resetGame();
      resetStatTracking();
      hideModal(gameoverModal);
      updateButtonStates();
    });
  }

  function showModal(el) {
    el.classList.remove("hidden");
  }

  function hideModal(el) {
    el.classList.add("hidden");
  }

  async function openLeaderboard() {
    showModal(leaderboardModal);
    leaderboardList.innerHTML = "<p>Loading...</p>";

    let rows = [];
    try {
      rows = await HexHiveSupabase.fetchLeaderboard(15);
    } catch (e) {
      rows = [];
    }

    if (!rows || rows.length === 0) {
      leaderboardList.innerHTML =
        "<p style='font-size:0.85rem;color:rgba(255,255,255,0.7)'>No scores yet. Be the first bee in the hive!</p>";
      return;
    }

    leaderboardList.innerHTML = "";
    rows.forEach((row, idx) => {
      const div = document.createElement("div");
      div.className = "leaderboard-row";
      const rankSpan = document.createElement("span");
      rankSpan.textContent = idx + 1;
      const nameSpan = document.createElement("span");
      nameSpan.textContent = row.nickname || "BeePlayer";
      const scoreSpan = document.createElement("span");
      scoreSpan.textContent = row.score ?? 0;
      const levelSpan = document.createElement("span");
      levelSpan.textContent = "Lv " + (row.level_reached ?? 1);

      div.appendChild(rankSpan);
      div.appendChild(nameSpan);
      div.appendChild(scoreSpan);
      div.appendChild(levelSpan);
      leaderboardList.appendChild(div);
    });
  }

  function updateStatsPanel() {
    const stats = HexHiveGame.getStats();
    applyStatValue(statScore, "score", stats.score);
    applyStatValue(statLevel, "level", stats.level);
    applyStatValue(statLines, "lines", stats.lines);
  }

  function resetStatTracking() {
    const stats = HexHiveGame.getStats();
    lastStatValues = {
      score: stats.score,
      level: stats.level,
      lines: stats.lines
    };
    statFlashTimers.forEach((t) => clearTimeout(t));
    statFlashTimers.clear();
    [statScore, statLevel, statLines].forEach((el) => {
      if (el) el.classList.remove("bump");
    });
  }

  function applyStatValue(el, key, value) {
    if (!el) return;
    const previous = lastStatValues[key];
    el.textContent = value;
    if (previous !== null && value > previous) {
      triggerStatFlash(el);
    }
    lastStatValues[key] = value;
  }

  function triggerStatFlash(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
    if (statFlashTimers.has(el)) {
      clearTimeout(statFlashTimers.get(el));
    }
    const timer = setTimeout(() => {
      el.classList.remove("bump");
      statFlashTimers.delete(el);
    }, 220);
    statFlashTimers.set(el, timer);
  }

  async function handleGameStateChange(newState) {
    if (newState === HexHiveGame.GAME_STATES.GAMEOVER) {
      const stats = HexHiveGame.getStats();
      gameoverScore.textContent = stats.score;
      gameoverLevel.textContent = stats.level;
      gameoverLines.textContent = stats.lines;
      showModal(gameoverModal);
      try {
        await HexHiveSupabase.submitScore(stats);
      } catch (e) {
        // ignore
      }
    }
    updateButtonStates();
  }

  function updateButtonStates() {
    const state = HexHiveGame.getState();
    if (state === HexHiveGame.GAME_STATES.PLAYING) {
      btnPlay.disabled = true;
      btnPause.disabled = false;
    } else if (state === HexHiveGame.GAME_STATES.PAUSED) {
      btnPlay.disabled = false;
      btnPause.disabled = false;
    } else {
      btnPlay.disabled = false;
      btnPause.disabled = true;
    }
  }

  function gameLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const delta = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    HexHiveGame.updateGame(delta);
    HexHiveGame.renderGame(ctx);
    updateStatsPanel();

    const state = HexHiveGame.getState();
    if (state !== lastGameState) {
      handleGameStateChange(state);
      lastGameState = state;
    }

    requestAnimationFrame(gameLoop);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initDom();
    resizeCanvas();
    HexHiveGame.initGame(canvas, nextCanvas);
    resetStatTracking();
    updateButtonStates();
    lastGameState = HexHiveGame.getState();

    window.addEventListener("resize", () => {
      resizeCanvas();
    });

    window.addEventListener("load", () => {
      resizeCanvas();
    });

    requestAnimationFrame(gameLoop);
  });
})(window);
