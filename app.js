const STORAGE_KEY = "musicquiz_played_indices";
const ROUND_SECONDS = 180;
const PASS_LIMIT = 3;

let teamCount = 4;
let teams = [];
let scores = {};
let passesLeft = PASS_LIMIT;
let playedSongs = [];
let remainingSongs = [];
let currentSongIndex = null;
let currentTeamIdx = 0;
let timerInterval = null;
let timeLeft = ROUND_SECONDS;
let songsPlayedCount = 0;
let gameRunning = false;

let player = null;
let playerReady = false;
let clipEndTimer = null;

function $(id) {
  return document.getElementById(id);
}

function loadPlayedFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const max = SONGS_DB.length;
    const valid = parsed.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < max);
    return [...new Set(valid)];
  } catch (error) {
    console.warn("Failed to load played songs:", error);
    return [];
  }
}

function savePlayedToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playedSongs));
}

function rebuildRemainingSongs() {
  const playedSet = new Set(playedSongs);
  remainingSongs = SONGS_DB.map((_, i) => i).filter((i) => !playedSet.has(i));
}

function resetStorage() {
  localStorage.removeItem(STORAGE_KEY);
  playedSongs = [];
  rebuildRemainingSongs();
  updateSongCounts();
}

function setupTeamCountButtons() {
  document.querySelectorAll(".team-count-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".team-count-btn").forEach((target) => {
        target.classList.remove("active");
      });

      btn.classList.add("active");
      teamCount = Number.parseInt(btn.dataset.count, 10);
      renderTeamInputs();
    });
  });
}

function renderTeamInputs() {
  const container = $("team-names");
  container.innerHTML = "";

  for (let i = 0; i < teamCount; i += 1) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "team-name-input";
    input.placeholder = `팀 ${i + 1}`;
    input.value = teams[i] || "";
    container.appendChild(input);
  }
}

function readTeamNames() {
  const rawNames = [];
  document.querySelectorAll(".team-name-input").forEach((input, i) => {
    rawNames.push(input.value.trim() || `팀 ${i + 1}`);
  });

  const seen = new Map();
  teams = rawNames.map((name) => {
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

function updateSongCounts() {
  $("remaining-songs").textContent = String(remainingSongs.length);
  $("total-songs").textContent = String(SONGS_DB.length);
}

function pickRandomSong() {
  if (remainingSongs.length === 0) {
    return null;
  }

  const randIdx = Math.floor(Math.random() * remainingSongs.length);
  const songIdx = remainingSongs.splice(randIdx, 1)[0];
  playedSongs.push(songIdx);
  savePlayedToStorage();
  updateSongCounts();
  return songIdx;
}

function getCurrentTeam() {
  return teams[currentTeamIdx] || "";
}

function updateTurnDisplay() {
  $("turn-team-name").textContent = getCurrentTeam();
  renderScoreboard();
}

function advanceTurn() {
  currentTeamIdx = (currentTeamIdx + 1) % teams.length;
  updateTurnDisplay();
}

function hideAnswer() {
  $("answer-reveal").classList.add("hidden");
}

function setNowPlaying(isPlaying, text) {
  const visual = $("music-visual");
  const status = $("playing-status");

  visual.classList.toggle("playing", isPlaying);
  status.textContent = text;
}

function setHostSongInfo(title, artist) {
  $("song-title").textContent = title;
  $("song-artist").textContent = artist;
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
  tag.onerror = () => {
    console.error("YouTube API load failed");
    $("btn-start").textContent = "YouTube API 로드 실패";
  };

  document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
  createPlayer();
};

function createPlayer() {
  if (player || !(window.YT && window.YT.Player)) {
    return;
  }

  const playerVars = {
    autoplay: 1,
    controls: 1,
    disablekb: 1,
    fs: 0,
    playsinline: 1,
    enablejsapi: 1,
    modestbranding: 1,
    rel: 0,
  };

  if (window.location.protocol !== "file:") {
    playerVars.origin = window.location.origin;
  }

  player = new YT.Player("youtube-player", {
    height: "100%",
    width: "100%",
    playerVars,
    events: {
      onReady: (event) => {
        playerReady = true;
        event.target.setVolume(100);
        $("btn-start").textContent = "게임 시작";
      },
      onStateChange: onPlayerStateChange,
      onError: (event) => {
        handlePlayerError(event.data);
      },
    },
  });
}

function onPlayerStateChange(event) {
  if (!window.YT) {
    return;
  }

  if (event.data === YT.PlayerState.ENDED) {
    replayClip();
  }
}

function handlePlayerError(code) {
  console.error("YouTube player error:", code);
  if (!gameRunning) {
    return;
  }

  // Some videos are not embeddable on mobile/web; move to next song automatically.
  setNowPlaying(false, "재생 불가 영상 감지, 다음 곡으로 이동");
  stopPlayback();
  setTimeout(() => {
    if (!gameRunning) {
      return;
    }
    playNextSong();
  }, 300);
}

function clearClipTimer() {
  if (clipEndTimer) {
    clearTimeout(clipEndTimer);
    clipEndTimer = null;
  }
}

function playSong(song) {
  if (!playerReady || !player || !song) {
    return;
  }

  clearClipTimer();

  player.loadVideoById({
    videoId: song.videoId,
    startSeconds: song.startTime,
    endSeconds: song.endTime,
  });

  const clipDuration = Math.max(1, song.endTime - song.startTime) * 1000 + 300;
  clipEndTimer = setTimeout(replayClip, clipDuration);
}

function replayClip() {
  if (!playerReady || !player || currentSongIndex === null) {
    return;
  }

  const song = SONGS_DB[currentSongIndex];
  clearClipTimer();

  player.seekTo(song.startTime, true);
  player.playVideo();

  const clipDuration = Math.max(1, song.endTime - song.startTime) * 1000 + 300;
  clipEndTimer = setTimeout(replayClip, clipDuration);
}

function stopPlayback() {
  clearClipTimer();

  if (playerReady && player) {
    player.stopVideo();
  }
}

function playNextSong() {
  if (!gameRunning) {
    return;
  }

  hideAnswer();

  const songIdx = pickRandomSong();
  if (songIdx === null) {
    alert("모든 곡을 재생했습니다.");
    endGame();
    return;
  }

  currentSongIndex = songIdx;
  songsPlayedCount += 1;
  $("game-song-count").textContent = String(songsPlayedCount);
  setHostSongInfo(SONGS_DB[songIdx].title, SONGS_DB[songIdx].artist);

  setNowPlaying(true, "음악 재생 중...");
  playSong(SONGS_DB[songIdx]);
}

function onReplay() {
  if (!gameRunning || currentSongIndex === null) {
    return;
  }

  replayClip();
  setNowPlaying(true, "음악 재생 중...");
}

function onReveal() {
  if (!gameRunning || currentSongIndex === null) {
    return;
  }

  const song = SONGS_DB[currentSongIndex];
  $("answer-title").textContent = song.title;
  $("answer-artist").textContent = song.artist;
  $("answer-reveal").classList.remove("hidden");
  setNowPlaying(false, "정답 공개");
}

function flashTeamScoreCard(teamName) {
  const target = Array.from(document.querySelectorAll(".score-card"))
    .find((card) => card.dataset.team === teamName);
  if (!target) {
    return;
  }

  target.classList.add("highlight");
  setTimeout(() => {
    target.classList.remove("highlight");
  }, 600);
}

function onNext() {
  if (!gameRunning || currentSongIndex === null) {
    return;
  }

  onReveal();
  stopPlayback();

  const team = getCurrentTeam();
  scores[team] = (scores[team] || 0) + 1;
  renderScoreboard();
  flashTeamScoreCard(team);

  setTimeout(() => {
    if (!gameRunning) {
      return;
    }
    advanceTurn();
    playNextSong();
  }, 1500);
}

function onPass() {
  if (!gameRunning || currentSongIndex === null || passesLeft <= 0) {
    return;
  }

  passesLeft -= 1;
  updatePassButton();

  onReveal();
  stopPlayback();

  setTimeout(() => {
    if (!gameRunning) {
      return;
    }
    advanceTurn();
    playNextSong();
  }, 1500);
}

function updatePassButton() {
  const btn = $("btn-pass");
  $("pass-count").textContent = String(passesLeft);
  btn.disabled = passesLeft <= 0;
}

function updateTimer() {
  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  const timerEl = $("timer");
  timerEl.textContent = `${min}:${String(sec).padStart(2, "0")}`;

  timerEl.classList.remove("warning", "danger");
  if (timeLeft <= 30) {
    timerEl.classList.add("danger");
  } else if (timeLeft <= 60) {
    timerEl.classList.add("warning");
  }
}

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 1);
    updateTimer();

    if (timeLeft <= 0) {
      endGame();
    }
  }, 1000);
}

function renderScoreboard() {
  const container = $("scoreboard-teams");
  container.innerHTML = "";

  teams.forEach((team, idx) => {
    const card = document.createElement("div");
    card.className = `score-card${idx === currentTeamIdx ? " active-team" : ""}`;
    card.dataset.team = team;
    card.innerHTML = `
      <div class="team-name">${team}</div>
      <div class="team-score">${scores[team] || 0}</div>
    `;
    container.appendChild(card);
  });
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });
  $(pageId).classList.add("active");
}

function startGame() {
  if (remainingSongs.length === 0) {
    alert("남은 곡이 없습니다. 곡 목록을 리셋해 주세요.");
    return;
  }

  if (!playerReady) {
    if (window.YT && window.YT.Player && !player) {
      createPlayer();
    }

    alert(
      "YouTube 플레이어를 로딩 중입니다. 잠시 후 다시 시도해 주세요.\n\n" +
      "모바일에서는 깃허브 페이지 주소(https://...github.io/...)로 접속하는 편이 안정적입니다.\n" +
      "file://로 직접 열면 브라우저 정책 때문에 재생이 막힐 수 있습니다."
    );
    return;
  }

  readTeamNames();
  scores = {};
  teams.forEach((team) => {
    scores[team] = 0;
  });

  passesLeft = PASS_LIMIT;
  songsPlayedCount = 0;
  timeLeft = ROUND_SECONDS;
  currentSongIndex = null;
  currentTeamIdx = 0;
  gameRunning = true;

  showPage("game-page");
  hideAnswer();
  setHostSongInfo("-", "-");
  updateTurnDisplay();
  renderScoreboard();
  updatePassButton();
  updateTimer();
  startTimer();
  playNextSong();
}

function endGame() {
  if (!gameRunning && !timerInterval) {
    return;
  }

  gameRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  stopPlayback();
  setNowPlaying(false, "게임 종료");
  setHostSongInfo("게임 종료", "결과를 확인하세요");
  hideAnswer();

  const sortedTeams = teams.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const ranks = ["1위", "2위", "3위", "4위", "5위", "6위"];

  const container = $("final-scores");
  container.innerHTML = "";

  sortedTeams.forEach((team, idx) => {
    const card = document.createElement("div");
    card.className = `final-score-card${idx === 0 ? " rank-1" : ""}`;
    card.innerHTML = `
      <span class="rank">${ranks[idx] || `${idx + 1}위`}</span>
      <div class="team-info">
        <div class="name">${team}</div>
      </div>
      <span class="score">${scores[team] || 0}점</span>
    `;
    container.appendChild(card);
  });

  showPage("result-page");
}

function goHome() {
  gameRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  stopPlayback();
  currentSongIndex = null;

  playedSongs = loadPlayedFromStorage();
  rebuildRemainingSongs();
  updateSongCounts();
  renderTeamInputs();
  showPage("start-page");
  setNowPlaying(false, "대기 중");
  setHostSongInfo("-", "-");
}

function bindEvents() {
  $("btn-start").addEventListener("click", startGame);

  $("btn-reset").addEventListener("click", () => {
    const ok = confirm("모든 곡의 재생 기록을 초기화할까요?");
    if (ok) {
      resetStorage();
    }
  });

  $("btn-replay").addEventListener("click", onReplay);
  $("btn-reveal").addEventListener("click", onReveal);
  $("btn-next").addEventListener("click", onNext);
  $("btn-pass").addEventListener("click", onPass);
  $("btn-end").addEventListener("click", endGame);
  $("btn-home").addEventListener("click", goHome);
}

function init() {
  if (!Array.isArray(SONGS_DB) || SONGS_DB.length === 0) {
    alert("songs.js를 불러오지 못했습니다.");
    return;
  }

  playedSongs = loadPlayedFromStorage();
  rebuildRemainingSongs();

  setupTeamCountButtons();
  renderTeamInputs();
  updateSongCounts();
  updatePassButton();
  setNowPlaying(false, "대기 중");
  setHostSongInfo("-", "-");

  bindEvents();
  loadYouTubeAPI();
}

document.addEventListener("DOMContentLoaded", init);
