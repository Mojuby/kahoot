// Small helpers shared by the player and host screens.
// No build step, no bundler -- loaded as a plain <script> before the page-specific script.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Renders the segmented LED countdown strip and returns a controller
// with a .start(seconds) method and a .stop() method.
function createLedTimer(containerEl, segmentCount = 20) {
  containerEl.innerHTML = '';
  const segments = [];
  for (let i = 0; i < segmentCount; i++) {
    const span = document.createElement('span');
    containerEl.appendChild(span);
    segments.push(span);
  }

  let intervalId = null;

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  function render(remainingRatio) {
    const litCount = Math.round(remainingRatio * segmentCount);
    containerEl.classList.toggle('danger', remainingRatio <= 0.25);
    segments.forEach((span, i) => {
      span.classList.toggle('off', i >= litCount);
    });
  }

  function start(totalSeconds) {
    stop();
    const startTime = Date.now();
    render(1);
    intervalId = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const ratio = Math.max(0, 1 - elapsed / totalSeconds);
      render(ratio);
      if (ratio <= 0) stop();
    }, 100);
  }

  return { start, stop };
}

function renderLeaderboardList(containerEl, entries, myName = null) {
  containerEl.innerHTML = entries
    .map((entry, i) => {
      const isMe = myName && entry.name === myName;
      return `
        <div class="leaderboard-row ${isMe ? 'me' : ''}" style="animation-delay:${i * 70}ms">
          <span class="leaderboard-rank">${i + 1}</span>
          <span class="leaderboard-name">${escapeHtml(entry.name)}</span>
          <span class="leaderboard-score">${entry.score}</span>
        </div>`;
    })
    .join('');
}

// Renders the per-round "who got it right, fastest first" list.
// Entries are { name, timeTakenMs, points }, already sorted fastest-first by the server.
function renderRoundTopFive(containerEl, entries) {
  if (!entries || entries.length === 0) {
    containerEl.innerHTML = '<p class="subtitle" style="text-align:center;">Nobody answered correctly this round.</p>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  containerEl.innerHTML = entries
    .map((entry, i) => {
      const seconds = (entry.timeTakenMs / 1000).toFixed(1);
      const rankLabel = medals[i] || `${i + 1}`;
      return `
        <div class="leaderboard-row" style="animation-delay:${i * 90}ms">
          <span class="leaderboard-rank">${rankLabel}</span>
          <span class="leaderboard-name">${escapeHtml(entry.name)}</span>
          <span class="leaderboard-score">${seconds}s · +${entry.points}</span>
        </div>`;
    })
    .join('');
}

function renderPodium(containerEl, entries) {
  const top3 = entries.slice(0, 3);
  // Visual order left-to-right: 2nd, 1st, 3rd (classic podium arrangement).
  // Animation delay builds suspense from 3rd -> 2nd -> 1st place.
  const order = [top3[1], top3[0], top3[2]];
  const revealDelay = { 3: 0, 2: 350, 1: 700 };
  containerEl.innerHTML = order
    .map((entry) => {
      if (!entry) return '<div class="podium-step"></div>';
      const rank = top3.indexOf(entry) + 1;
      return `
        <div class="podium-step rank-${rank}">
          <div class="podium-name">${escapeHtml(entry.name)}</div>
          <div class="podium-score">${entry.score} pts</div>
          <div class="podium-bar" style="animation-delay:${revealDelay[rank]}ms">${rank}</div>
        </div>`;
    })
    .join('');
}
