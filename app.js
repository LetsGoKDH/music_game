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
let timerPaused = false;
let waitingForSongStart = false;
let songStartPoller = null;
let tournamentStarted = false;
let waitingNextTeamStart = false;
let setupLocked = false;

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
      if (setupLocked) {
        return;
      }

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
    input.disabled = setupLocked;
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

function setSetupLocked(locked) {
  setupLocked = locked;

  document.querySelectorAll(".team-count-btn").forEach((btn) => {
    btn.disabled = locked;
  });

  document.querySelectorAll(".team-name-input").forEach((input) => {
    input.disabled = locked;
  });

  $("btn-reset").disabled = locked;
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

function updateStartButtonLabel() {
  const btn = $("btn-start");
  if (!btn) {
    return;
  }

  if (!playerReady) {
    btn.textContent = "YouTube 로딩 중...";
    return;
  }

  if (!tournamentStarted) {
    btn.textContent = "게임 시작";
    return;
  }

  if (waitingNextTeamStart) {
    btn.textContent = `${getCurrentTeam()} 라운드 시작`;
    return;
  }

  btn.textContent = "게임 진행 중";
}

function clearSongStartPoller() {
  if (songStartPoller) {
    clearInterval(songStartPoller);
    songStartPoller = null;
  }
}

function clearSongStartWait(resumeTimer = true) {
  waitingForSongStart = false;
  clearSongStartPoller();
  if (resumeTimer) {
    timerPaused = false;
  }
  if (playerReady && player && typeof player.unMute === "function") {
    try {
      player.unMute();
    } catch {
      // ignore
    }
  }
}

function scheduleClipReplay(song) {
  clearClipTimer();
  const clipDuration = Math.max(1, song.endTime - song.startTime) * 1000 + 300;
  clipEndTimer = setTimeout(replayClip, clipDuration);
}

function beginSongStartWait(song) {
  waitingForSongStart = true;
  timerPaused = true;
  setNowPlaying(false, "광고/로딩 중... 타이머 일시정지");

  if (playerReady && player && typeof player.mute === "function") {
    try {
      player.mute();
    } catch {
      // ignore
    }
  }

  clearSongStartPoller();
  songStartPoller = setInterval(() => {
    if (!gameRunning || !waitingForSongStart || currentSongIndex === null || !playerReady || !player) {
      clearSongStartPoller();
      return;
    }

    let currentTime = 0;
    let playerState = -1;
    try {
      currentTime = player.getCurrentTime();
      playerState = player.getPlayerState();
    } catch {
      return;
    }

    const startThreshold = Math.max(0, song.startTime - 0.6);
    if (window.YT && playerState === YT.PlayerState.PLAYING && currentTime >= startThreshold) {
      clearSongStartWait(true);
      setNowPlaying(true, "음악 재생 중...");
      scheduleClipReplay(song);
    }
  }, 250);
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
        updateStartButtonLabel();
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

  if (waitingForSongStart && event.data === YT.PlayerState.PAUSED) {
    timerPaused = true;
  }

  if (event.data === YT.PlayerState.ENDED) {
    replayClip();
  }
}

function handlePlayerError(code) {
  const song = currentSongIndex !== null ? SONGS_DB[currentSongIndex] : null;
  console.error("YouTube player error:", code, song);
  if (!gameRunning) {
    return;
  }

  if (code === 153) {
    clearSongStartWait(true);
    setNowPlaying(false, "재생 환경 오류(153) - localhost 또는 GitHub Pages로 접속해 주세요");
    return;
  }

  if (code === 100 || code === 101 || code === 150) {
    setNowPlaying(false, `임베드 제한 영상(${code}) - 다음 곡으로 이동`);
    stopPlayback();
    setTimeout(() => {
      if (!gameRunning) {
        return;
      }
      playNextSong();
    }, 400);
    return;
  }

  clearSongStartWait(true);
  setNowPlaying(false, `재생 오류(${code}) - 플레이어 재생 버튼 또는 Replay를 눌러주세요`);
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
  beginSongStartWait(song);

  player.loadVideoById({
    videoId: song.videoId,
    startSeconds: song.startTime,
    endSeconds: song.endTime,
  });
}

function replayClip() {
  if (!playerReady || !player || currentSongIndex === null) {
    return;
  }

  const song = SONGS_DB[currentSongIndex];
  clearClipTimer();
  clearSongStartWait(true);

  player.seekTo(song.startTime, true);
  if (typeof player.unMute === "function") {
    try {
      player.unMute();
    } catch {
      // ignore
    }
  }
  player.playVideo();
  scheduleClipReplay(song);
}

function stopPlayback() {
  clearSongStartWait(true);
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

  setNowPlaying(false, "곡 준비 중...");
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
    // Pass only skips the song within the same team's timed round.
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
    if (timerPaused) {
      return;
    }

    timeLeft = Math.max(0, timeLeft - 1);
    updateTimer();

    if (timeLeft <= 0) {
      finishCurrentTeamRound();
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

function startTeamRound() {
  if (remainingSongs.length === 0) {
    alert("남은 곡이 없어 게임을 종료합니다.");
    endGame();
    return;
  }

  gameRunning = true;
  waitingNextTeamStart = false;
  passesLeft = PASS_LIMIT;
  timeLeft = ROUND_SECONDS;
  currentSongIndex = null;
  timerPaused = false;
  waitingForSongStart = false;
  clearSongStartPoller();

  showPage("game-page");
  hideAnswer();
  setHostSongInfo("-", "-");
  updateTurnDisplay();
  renderScoreboard();
  updatePassButton();
  updateTimer();
  setNowPlaying(false, "곡 준비 중...");
  updateStartButtonLabel();
  startTimer();
  playNextSong();
}

function finishCurrentTeamRound() {
  if (!gameRunning) {
    return;
  }

  if (currentTeamIdx >= teams.length - 1) {
    endGame();
    return;
  }

  const finishedTeam = getCurrentTeam();
  gameRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  stopPlayback();
  hideAnswer();

  currentTeamIdx += 1;
  waitingNextTeamStart = true;
  updateTurnDisplay();
  renderScoreboard();
  setNowPlaying(false, "대기 중");
  setHostSongInfo("-", "-");
  showPage("start-page");
  updateStartButtonLabel();

  alert(`${finishedTeam} 라운드 종료. 다음은 ${getCurrentTeam()} 차례입니다.`);
}

function startGame() {
  if (window.location.protocol === "file:") {
    alert(
      "현재 파일 경로(file://)로 열려 있어 YouTube 임베드가 차단됩니다.\n\n" +
      "아래 방식으로 접속해 주세요.\n" +
      "1) serve.bat 실행 후 http://localhost:8000\n" +
      "2) GitHub Pages 주소(https://...github.io/...)"
    );
    return;
  }

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

  if (!tournamentStarted) {
    readTeamNames();
    scores = {};
    teams.forEach((team) => {
      scores[team] = 0;
    });

    songsPlayedCount = 0;
    currentSongIndex = null;
    currentTeamIdx = 0;
    tournamentStarted = true;
    waitingNextTeamStart = true;
    setSetupLocked(true);
  }

  if (!waitingNextTeamStart) {
    return;
  }

  startTeamRound();
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
  tournamentStarted = false;
  waitingNextTeamStart = false;
  updateStartButtonLabel();
}

function goHome() {
  gameRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  stopPlayback();
  currentSongIndex = null;
  tournamentStarted = false;
  waitingNextTeamStart = false;
  songsPlayedCount = 0;
  currentTeamIdx = 0;
  passesLeft = PASS_LIMIT;
  timeLeft = ROUND_SECONDS;
  setSetupLocked(false);

  playedSongs = loadPlayedFromStorage();
  rebuildRemainingSongs();
  updateSongCounts();
  renderTeamInputs();
  updatePassButton();
  updateTimer();
  showPage("start-page");
  setNowPlaying(false, "대기 중");
  setHostSongInfo("-", "-");
  updateStartButtonLabel();
}

function bindEvents() {
  $("btn-start").addEventListener("click", startGame);

  $("btn-reset").addEventListener("click", () => {
    if (tournamentStarted) {
      alert("진행 중인 게임이 끝난 뒤에 곡 목록을 리셋해 주세요.");
      return;
    }

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
  updateTimer();
  setNowPlaying(false, "대기 중");
  setHostSongInfo("-", "-");
  updateStartButtonLabel();

  bindEvents();
  loadYouTubeAPI();
}

document.addEventListener("DOMContentLoaded", init);
