const INSPECTOR_CLIP_LENGTH_SCALE = 0.5;
const INSPECTOR_MIN_CLIP_SECONDS = 5;
const INSPECTOR_CLIP_START_SHIFT_SECONDS = 8;

let inspectorPlayer = null;
let inspectorPlayerReady = false;
let selectedSongIndex = 0;
let filteredSongIndices = [];
let stopPreviewTimer = null;
let playheadPoller = null;
let currentPreviewLabel = "-";

function $(id) {
  return document.getElementById(id);
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(1)}s`;
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function getSong(index) {
  return SONGS_DB[index] || null;
}

function getGameClipBounds(song) {
  const baseDuration = Math.max(1, song.endTime - song.startTime);
  const duration = Math.max(
    INSPECTOR_MIN_CLIP_SECONDS,
    Math.round(baseDuration * INSPECTOR_CLIP_LENGTH_SCALE),
  );
  const startTime = Math.max(0, song.startTime + INSPECTOR_CLIP_START_SHIFT_SECONDS);

  return {
    startTime,
    endTime: startTime + duration,
    duration,
  };
}

function getEditedRange() {
  const startTime = Number.parseFloat($("edit-start").value);
  const endTime = Number.parseFloat($("edit-end").value);

  return {
    startTime,
    endTime,
    duration: endTime - startTime,
    valid: Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime,
  };
}

function updateSnippet(song, startTime, endTime) {
  $("snippet-output").value = `  { title: "${escapeJsString(song.title)}", artist: "${escapeJsString(song.artist)}", videoId: "${song.videoId}", startTime: ${Math.round(startTime)}, endTime: ${Math.round(endTime)} },`;
}

function updateEditedRangeState() {
  const range = getEditedRange();
  $("edit-duration").textContent = range.valid ? formatSeconds(range.duration) : "-";
  $("edit-validation").textContent = range.valid ? "Ready" : "End must be greater";

  const song = getSong(selectedSongIndex);
  if (song && range.valid) {
    updateSnippet(song, range.startTime, range.endTime);
  }
}

function populateSongList() {
  const searchTerm = $("song-search").value.trim().toLowerCase();
  filteredSongIndices = SONGS_DB
    .map((song, index) => ({ song, index }))
    .filter(({ song, index }) => {
      if (!searchTerm) {
        return true;
      }

      const label = `${index + 1} ${song.title} ${song.artist}`.toLowerCase();
      return label.includes(searchTerm);
    })
    .map(({ index }) => index);

  const select = $("song-select");
  select.innerHTML = "";

  filteredSongIndices.forEach((songIndex) => {
    const song = getSong(songIndex);
    const option = document.createElement("option");
    option.value = String(songIndex);
    option.textContent = `${songIndex + 1}. ${song.title} | ${song.artist}`;
    if (songIndex === selectedSongIndex) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  $("song-count").textContent = `${filteredSongIndices.length} songs`;

  if (!filteredSongIndices.includes(selectedSongIndex) && filteredSongIndices.length > 0) {
    selectedSongIndex = filteredSongIndices[0];
  }

  if (filteredSongIndices.length === 0) {
    clearSongView();
    return;
  }

  select.value = String(selectedSongIndex);
  renderSelectedSong();
}

function clearSongView() {
  $("meta-title").textContent = "-";
  $("meta-artist").textContent = "-";
  $("meta-video-id").textContent = "-";
  $("meta-index").textContent = "-";
  $("stored-start").textContent = "-";
  $("stored-end").textContent = "-";
  $("stored-duration").textContent = "-";
  $("game-start").textContent = "-";
  $("game-end").textContent = "-";
  $("game-duration").textContent = "-";
  $("edit-start").value = "";
  $("edit-end").value = "";
  $("edit-duration").textContent = "-";
  $("edit-validation").textContent = "-";
  $("snippet-output").value = "";
}

function renderSelectedSong() {
  const song = getSong(selectedSongIndex);
  if (!song) {
    clearSongView();
    return;
  }

  $("meta-title").textContent = song.title;
  $("meta-artist").textContent = song.artist;
  $("meta-video-id").textContent = song.videoId;
  $("meta-index").textContent = `${selectedSongIndex + 1} / ${SONGS_DB.length}`;

  $("stored-start").textContent = formatSeconds(song.startTime);
  $("stored-end").textContent = formatSeconds(song.endTime);
  $("stored-duration").textContent = formatSeconds(song.endTime - song.startTime);

  const gameClip = getGameClipBounds(song);
  $("game-start").textContent = formatSeconds(gameClip.startTime);
  $("game-end").textContent = formatSeconds(gameClip.endTime);
  $("game-duration").textContent = formatSeconds(gameClip.duration);

  $("edit-start").value = String(song.startTime);
  $("edit-end").value = String(song.endTime);
  updateEditedRangeState();
}

function moveSong(offset) {
  if (filteredSongIndices.length === 0) {
    return;
  }

  const currentPosition = Math.max(filteredSongIndices.indexOf(selectedSongIndex), 0);
  const nextPosition = Math.min(
    filteredSongIndices.length - 1,
    Math.max(0, currentPosition + offset),
  );

  selectedSongIndex = filteredSongIndices[nextPosition];
  $("song-select").value = String(selectedSongIndex);
  renderSelectedSong();
}

function clearStopPreviewTimer() {
  if (stopPreviewTimer) {
    clearTimeout(stopPreviewTimer);
    stopPreviewTimer = null;
  }
}

function clearPlayheadPoller() {
  if (playheadPoller) {
    clearInterval(playheadPoller);
    playheadPoller = null;
  }
}

function setPlayerStatus(text, muted = false) {
  const status = $("player-status");
  status.textContent = text;
  status.classList.toggle("muted", muted);
}

function setCurrentPreviewLabel(text) {
  currentPreviewLabel = text;
  $("current-preview-label").textContent = text;
}

function startPlayheadPoller() {
  clearPlayheadPoller();

  playheadPoller = setInterval(() => {
    if (!inspectorPlayerReady || !inspectorPlayer) {
      return;
    }

    try {
      $("current-time").textContent = formatSeconds(inspectorPlayer.getCurrentTime());
    } catch {
      // ignore polling errors while player is stabilizing
    }
  }, 200);
}

function stopPreview() {
  clearStopPreviewTimer();
  clearPlayheadPoller();

  if (inspectorPlayerReady && inspectorPlayer) {
    try {
      inspectorPlayer.pauseVideo();
    } catch {
      // ignore
    }
  }

  setPlayerStatus("Stopped", true);
  setCurrentPreviewLabel("-");
}

function previewRange(startTime, endTime, label) {
  const song = getSong(selectedSongIndex);
  if (!song) {
    return;
  }

  if (!inspectorPlayerReady || !inspectorPlayer) {
    setPlayerStatus("Player loading", true);
    return;
  }

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    setPlayerStatus("Invalid range", true);
    return;
  }

  clearStopPreviewTimer();
  clearPlayheadPoller();

  setPlayerStatus(`${label} playing`);
  setCurrentPreviewLabel(label);

  inspectorPlayer.loadVideoById({
    videoId: song.videoId,
    startSeconds: startTime,
    endSeconds: endTime,
  });

  startPlayheadPoller();
  stopPreviewTimer = setTimeout(() => {
    stopPreview();
  }, Math.max(1, endTime - startTime) * 1000 + 350);
}

function loadStoredValues() {
  const song = getSong(selectedSongIndex);
  if (!song) {
    return;
  }

  $("edit-start").value = String(song.startTime);
  $("edit-end").value = String(song.endTime);
  updateEditedRangeState();
}

function copySnippet() {
  const text = $("snippet-output").value.trim();
  if (!text) {
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => {
        setPlayerStatus("Snippet copied", true);
      })
      .catch(() => {
        $("snippet-output").select();
      });
    return;
  }

  $("snippet-output").focus();
  $("snippet-output").select();
}

function openMainQuiz() {
  window.location.href = "index.html";
}

function bindEvents() {
  $("song-search").addEventListener("input", populateSongList);

  $("song-select").addEventListener("change", (event) => {
    selectedSongIndex = Number.parseInt(event.target.value, 10);
    renderSelectedSong();
  });

  $("btn-prev").addEventListener("click", () => moveSong(-1));
  $("btn-next-song").addEventListener("click", () => moveSong(1));

  $("btn-load-stored").addEventListener("click", loadStoredValues);
  $("btn-reset-edit").addEventListener("click", loadStoredValues);

  $("edit-start").addEventListener("input", updateEditedRangeState);
  $("edit-end").addEventListener("input", updateEditedRangeState);

  $("btn-play-stored").addEventListener("click", () => {
    const song = getSong(selectedSongIndex);
    if (!song) {
      return;
    }
    previewRange(song.startTime, song.endTime, "Saved range");
  });

  $("btn-play-edit").addEventListener("click", () => {
    const range = getEditedRange();
    previewRange(range.startTime, range.endTime, "Edited range");
  });

  $("btn-play-game").addEventListener("click", () => {
    const song = getSong(selectedSongIndex);
    if (!song) {
      return;
    }
    const clip = getGameClipBounds(song);
    previewRange(clip.startTime, clip.endTime, "Game range");
  });

  $("btn-stop").addEventListener("click", stopPreview);
  $("btn-copy-snippet").addEventListener("click", copySnippet);
  $("btn-open-main").addEventListener("click", openMainQuiz);
}

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    createPlayer();
    return;
  }

  if (document.getElementById("youtube-api-script")) {
    return;
  }

  const tag = document.createElement("script");
  tag.id = "youtube-api-script";
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  createPlayer();
};

function createPlayer() {
  if (inspectorPlayer || !(window.YT && window.YT.Player)) {
    return;
  }

  const playerVars = {
    autoplay: 1,
    controls: 1,
    disablekb: 0,
    fs: 0,
    playsinline: 1,
    enablejsapi: 1,
    modestbranding: 1,
    rel: 0,
  };

  if (window.location.protocol !== "file:") {
    playerVars.origin = window.location.origin;
  }

  inspectorPlayer = new YT.Player("clip-inspector-player", {
    height: "100%",
    width: "100%",
    playerVars,
    events: {
      onReady: () => {
        inspectorPlayerReady = true;
        setPlayerStatus("Player ready", true);
      },
      onStateChange: (event) => {
        if (!window.YT) {
          return;
        }

        if (event.data === YT.PlayerState.ENDED) {
          stopPreview();
        }
      },
      onError: (event) => {
        setPlayerStatus(`Playback error (${event.data})`, true);
      },
    },
  });
}

function init() {
  if (!Array.isArray(window.SONGS_DB) || SONGS_DB.length === 0) {
    alert("Failed to load songs.js.");
    return;
  }

  bindEvents();
  populateSongList();
  loadYouTubeAPI();
  setCurrentPreviewLabel("-");
}

document.addEventListener("DOMContentLoaded", init);
