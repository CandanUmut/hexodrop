// supabase.js
// Lightweight Supabase helpers for Hex Hive Drop.
// Game should still run if Supabase is not configured.

(function (global) {
  const SUPABASE_URL = "https://rnatxpcjqszgjlvznhwd.supabase.co";
  const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuYXR4cGNqcXN6Z2psdnpuaHdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzMTA4OTEsImV4cCI6MjA4MDg4Njg5MX0.rwuFyq0XdXDG822d2lUqdxHvTq4OAIUtdXebh0aXCCc";

  let supabaseClient = null;
  let playerId = null;
  let deviceId = null;
  let nickname = null;

  const STORAGE_KEYS = {
    PLAYER_ID: "hhd_player_id",
    DEVICE_ID: "hhd_device_id",
    NICKNAME: "hhd_nickname"
  };

  function initClient() {
    try {
      if (
        typeof supabase !== "undefined" &&
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        SUPABASE_URL !== "https://rnatxpcjqszgjlvznhwd.supabase.co" &&
        SUPABASE_ANON_KEY !== "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJuYXR4cGNqcXN6Z2psdnpuaHdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzMTA4OTEsImV4cCI6MjA4MDg4Njg5MX0.rwuFyq0XdXDG822d2lUqdxHvTq4OAIUtdXebh0aXCCc"
      ) {
        supabaseClient = supabase.createClient(
          SUPABASE_URL,
          SUPABASE_ANON_KEY
        );
      } else {
        supabaseClient = null;
      }
    } catch (e) {
      supabaseClient = null;
    }

    try {
      playerId = global.localStorage.getItem(STORAGE_KEYS.PLAYER_ID) || null;
      deviceId = global.localStorage.getItem(STORAGE_KEYS.DEVICE_ID) || null;
      nickname = global.localStorage.getItem(STORAGE_KEYS.NICKNAME) || null;
    } catch (e) {
      playerId = null;
      deviceId = null;
      nickname = null;
    }

    if (!deviceId) {
      deviceId = generateDeviceId();
      try {
        global.localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
      } catch (e) {
        // ignore
      }
    }
  }

  function generateDeviceId() {
    if (global.crypto && global.crypto.randomUUID) {
      return global.crypto.randomUUID();
    }
    return (
      "dev-" +
      Math.random().toString(36).slice(2) +
      "-" +
      Date.now().toString(36)
    );
  }

  async function getOrCreatePlayer(newNickname) {
    nickname = newNickname || nickname || "BeePlayer";

    try {
      global.localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname);
    } catch (e) {
      // ignore
    }

    if (!supabaseClient) {
      return null;
    }

    if (playerId) {
      return playerId;
    }

    try {
      const { data, error } = await supabaseClient
        .from("players")
        .insert([{ nickname, device_id: deviceId }])
        .select()
        .single();

      if (error) {
        console.warn("Supabase create player error:", error);
        return null;
      }

      playerId = data.id;
      try {
        global.localStorage.setItem(STORAGE_KEYS.PLAYER_ID, playerId);
      } catch (e) {
        // ignore
      }
      return playerId;
    } catch (e) {
      console.warn("Supabase create player exception:", e);
      return null;
    }
  }

  async function submitScore(scoreData) {
    if (!supabaseClient) return;
    if (!scoreData) return;

    if (!playerId) {
      await getOrCreatePlayer(nickname || "BeePlayer");
    }
    if (!playerId) return;

    const payload = {
      player_id: playerId,
      score: scoreData.score || 0,
      level_reached: scoreData.level || 1,
      lines_cleared: scoreData.lines || 0
    };

    try {
      const { error } = await supabaseClient.from("scores").insert([payload]);
      if (error) {
        console.warn("Supabase submit score error:", error);
      }
    } catch (e) {
      console.warn("Supabase submit score exception:", e);
    }
  }

  async function fetchLeaderboard(limit = 10) {
    if (!supabaseClient) {
      return [];
    }

    try {
      // Assuming you have a view or join to include nickname, or denormalize nickname into scores
      const { data, error } = await supabaseClient
        .from("scores_view")
        .select("nickname, score, level_reached, lines_cleared")
        .order("score", { ascending: false })
        .limit(limit);

      if (error) {
        console.warn("Supabase fetch leaderboard error:", error);
        return [];
      }

      return data || [];
    } catch (e) {
      console.warn("Supabase fetch leaderboard exception:", e);
      return [];
    }
  }

  function getStoredNickname() {
    return nickname || "";
  }

  function setStoredNickname(name) {
    nickname = name;
    try {
      global.localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname);
    } catch (e) {
      // ignore
    }
  }

  initClient();

  global.HexHiveSupabase = {
    getOrCreatePlayer,
    submitScore,
    fetchLeaderboard,
    getStoredNickname,
    setStoredNickname
  };
})(window);
