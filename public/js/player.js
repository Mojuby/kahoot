(function () {
  const socket = io();

  const screens = {
    join: document.getElementById('screen-join'),
    waiting: document.getElementById('screen-waiting'),
    question: document.getElementById('screen-question'),
    answered: document.getElementById('screen-answered'),
    result: document.getElementById('screen-result'),
    final: document.getElementById('screen-final'),
    fatal: document.getElementById('screen-fatal')
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    const target = screens[name];
    target.classList.remove('hidden');
    target.classList.remove('screen-enter');
    void target.offsetWidth; // reflow, so the entrance animation replays every time
    target.classList.add('screen-enter');
  }

  let myName = null;
  const ledStrip = createLedTimer(document.getElementById('led-strip'));

  // ---- Join form ----
  const joinForm = document.getElementById('join-form');
  const joinBtn = document.getElementById('join-btn');
  const joinError = document.getElementById('join-error');

  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin-input').value.trim();
    const name = document.getElementById('name-input').value.trim();
    joinError.textContent = '';

    if (!/^\d{6}$/.test(pin)) {
      joinError.textContent = 'Enter the 6-digit PIN from the host screen.';
      return;
    }
    if (!name) {
      joinError.textContent = 'Enter a nickname.';
      return;
    }

    joinBtn.disabled = true;
    socket.emit('player:join', { pin, name }, (res) => {
      joinBtn.disabled = false;
      if (!res.ok) {
        joinError.textContent = res.error;
        return;
      }
      myName = res.name;
      document.getElementById('waiting-name').textContent = res.rejoined
        ? `Welcome back, ${myName}!`
        : `You're in, ${myName}!`;
      showScreen('waiting');
    });
  });

  // ---- Question ----
  const buzzerGrid = document.getElementById('buzzer-grid');
  const buzzers = Array.from(buzzerGrid.querySelectorAll('.buzzer'));
  let hasAnsweredThisQuestion = false;

  socket.on('question:show', (data) => {
    hasAnsweredThisQuestion = false;
    document.getElementById('q-progress').textContent = `Question ${data.index + 1}/${data.total}`;
    document.getElementById('q-text').textContent = data.question;

    buzzers.forEach((btn, i) => {
      const label = btn.querySelector('span:last-child');
      label.textContent = data.options[i] || '';
      btn.disabled = false;
      btn.classList.remove('dimmed', 'correct-reveal', 'pressed');
      btn.style.visibility = data.options[i] ? 'visible' : 'hidden';
    });

    ledStrip.start(data.timeLimit);
    showScreen('question');
  });

  buzzers.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (hasAnsweredThisQuestion) return;
      hasAnsweredThisQuestion = true;
      ledStrip.stop();
      const choiceIndex = Number(btn.dataset.choice);

      btn.classList.add('pressed');
      buzzers.forEach((b) => {
        b.disabled = true;
        if (b !== btn) b.classList.add('dimmed');
      });

      socket.emit('player:answer', { choiceIndex });
      setTimeout(() => showScreen('answered'), 220);
    });
  });

  // ---- Personal result ----
  socket.on('question:personalResult', (data) => {
    const banner = document.getElementById('result-banner');
    const emoji = document.getElementById('result-emoji');
    if (data.correct) {
      banner.textContent = 'Correct!';
      banner.className = 'result-banner correct';
      emoji.textContent = '🎯';
    } else {
      banner.textContent = 'Not quite';
      banner.className = 'result-banner incorrect';
      emoji.textContent = '❌';
    }
    document.getElementById('result-points').textContent = `+${data.points} points`;
    document.getElementById('result-total').textContent = data.totalScore;
    document.getElementById('result-rank').textContent =
      `Currently ranked #${data.rank} of ${data.totalPlayers}`;

    emoji.classList.remove('pop');
    void emoji.offsetWidth;
    emoji.classList.add('pop');

    showScreen('result');
  });

  // ---- Final leaderboard ----
  socket.on('game:over', (data) => {
    renderPodium(document.getElementById('final-podium'), data.leaderboard);
    renderLeaderboardList(document.getElementById('final-list'), data.leaderboard.slice(3, 10), myName, 4);
    document.getElementById('final-my-rank').textContent =
      `Your final rank: #${data.myRank} of ${data.totalPlayers}`;
    showScreen('final');
  });

  // ---- Host disconnected ----
  socket.on('game:hostDisconnected', () => {
    document.getElementById('fatal-title').textContent = 'Host left the game';
    document.getElementById('fatal-message').textContent =
      'The host disconnected, so this game has ended.';
    showScreen('fatal');
  });

  socket.on('disconnect', () => {
    if (screens.fatal.classList.contains('hidden') && screens.join.classList.contains('hidden')) {
      document.getElementById('fatal-title').textContent = 'Connection lost';
      document.getElementById('fatal-message').textContent =
        'Lost the connection to the server. Check your network and rejoin.';
      showScreen('fatal');
    }
  });
})();
