(function () {
  const socket = io();

  const screens = {
    login: document.getElementById('screen-login'),
    builder: document.getElementById('screen-builder'),
    lobby: document.getElementById('screen-lobby'),
    question: document.getElementById('screen-question'),
    results: document.getElementById('screen-results'),
    final: document.getElementById('screen-final')
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    const target = screens[name];
    target.classList.remove('hidden');
    target.classList.remove('screen-enter');
    void target.offsetWidth; // reflow, so the entrance animation replays every time
    target.classList.add('screen-enter');
  }

  const ledStrip = createLedTimer(document.getElementById('led-strip'));
  let isLastQuestion = false;
  let blockCounter = 0;

  // ---- Login ----
  const loginForm = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('password-input').value;
    loginError.textContent = '';
    loginBtn.disabled = true;
    socket.emit('host:login', { password }, (res) => {
      loginBtn.disabled = false;
      if (!res.ok) {
        loginError.textContent = res.error;
        return;
      }
      const builderList = document.getElementById('builder-list');
      builderList.innerHTML = '';
      builderList.appendChild(createQuestionBlock());
      showScreen('builder');
    });
  });

  // ---- Question builder ----
  function createQuestionBlock(prefill) {
    prefill = prefill || {};
    const uid = `q${blockCounter++}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'question-block';

    const header = document.createElement('div');
    header.className = 'qb-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'qb-title';
    titleSpan.textContent = 'Question';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'qb-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      wrapper.remove();
      renumberBlocks();
    });
    header.append(titleSpan, removeBtn);

    const textField = document.createElement('div');
    textField.className = 'field';
    const textLabel = document.createElement('label');
    textLabel.textContent = 'Question text';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'qb-text';
    textInput.placeholder = 'e.g. What is the capital of France?';
    textInput.value = prefill.question || '';
    textField.append(textLabel, textInput);

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'qb-options';
    const letters = ['A', 'B', 'C', 'D'];
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'qb-option-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `correct-${uid}`;
      radio.value = String(i);
      radio.className = 'qb-correct';
      if (prefill.correctIndex === i) radio.checked = true;
      const optInput = document.createElement('input');
      optInput.type = 'text';
      optInput.className = 'qb-option-text';
      optInput.placeholder = `Option ${letters[i]}`;
      optInput.value = (prefill.options && prefill.options[i]) || '';
      row.append(radio, optInput);
      optionsWrap.appendChild(row);
    }

    const timeField = document.createElement('div');
    timeField.className = 'field qb-timelimit-field';
    const timeLabel = document.createElement('label');
    timeLabel.textContent = 'Time limit (seconds)';
    const timeInput = document.createElement('input');
    timeInput.type = 'number';
    timeInput.className = 'qb-timelimit';
    timeInput.min = '5';
    timeInput.max = '120';
    timeInput.value = String(prefill.timeLimit || 20);
    timeField.append(timeLabel, timeInput);

    wrapper.append(header, textField, optionsWrap, timeField);
    return wrapper;
  }

  function renumberBlocks() {
    document.querySelectorAll('#builder-list .question-block .qb-title').forEach((el, i) => {
      el.textContent = `Question ${i + 1}`;
    });
  }

  function gatherQuestionsFromDOM() {
    const blocks = Array.from(document.querySelectorAll('#builder-list .question-block'));
    return blocks.map((block) => {
      const question = block.querySelector('.qb-text').value.trim();
      const options = Array.from(block.querySelectorAll('.qb-option-text')).map((i) => i.value.trim());
      const checkedRadio = block.querySelector('.qb-correct:checked');
      const correctIndex = checkedRadio ? Number(checkedRadio.value) : NaN;
      const timeLimit = Number(block.querySelector('.qb-timelimit').value) || 20;
      return { question, options, correctIndex, timeLimit };
    });
  }

  document.getElementById('add-question-btn').addEventListener('click', () => {
    document.getElementById('builder-list').appendChild(createQuestionBlock());
    renumberBlocks();
  });

  document.getElementById('load-sample-btn').addEventListener('click', () => {
    socket.emit('host:getSampleQuestions', {}, (res) => {
      if (!res.ok) return;
      const list = document.getElementById('builder-list');
      list.innerHTML = '';
      res.questions.forEach((q) => list.appendChild(createQuestionBlock(q)));
      renumberBlocks();
    });
  });

  const createBtn = document.getElementById('create-btn');
  const builderError = document.getElementById('builder-error');

  createBtn.addEventListener('click', () => {
    builderError.textContent = '';
    const questions = gatherQuestionsFromDOM();
    if (questions.length === 0) {
      builderError.textContent = 'Add at least one question.';
      return;
    }
    createBtn.disabled = true;
    socket.emit('host:create', { questions }, (res) => {
      createBtn.disabled = false;
      if (!res.ok) {
        builderError.textContent = res.error;
        return;
      }
      document.getElementById('lobby-pin').textContent = res.pin;
      showScreen('lobby');
    });
  });

  // ---- Lobby ----
  const startBtn = document.getElementById('start-btn');

  socket.on('host:playerJoined', (data) => {
    document.getElementById('lobby-count').textContent = data.count;
    document.getElementById('lobby-crowd').innerHTML = data.players
      .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
      .join('');
    if (data.count > 0) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start game';
    } else {
      startBtn.disabled = true;
      startBtn.textContent = 'Waiting for players...';
    }
  });

  startBtn.addEventListener('click', () => {
    socket.emit('host:start');
  });

  // ---- Question ----
  socket.on('question:show', (data) => {
    document.getElementById('q-progress').textContent = `Question ${data.index + 1}/${data.total}`;
    document.getElementById('q-answered').textContent = `0/? answered`;
    document.getElementById('q-text').textContent = data.question;
    data.options.forEach((opt, i) => {
      const el = document.getElementById(`opt-${i}`);
      if (el) el.textContent = opt || '';
    });
    ledStrip.start(data.timeLimit);
    showScreen('question');
  });

  socket.on('host:answerCount', (data) => {
    document.getElementById('q-answered').textContent =
      `${data.answeredCount}/${data.playerCount} answered`;
  });

  // ---- Results ----
  socket.on('host:questionResults', (data) => {
    ledStrip.stop();
    isLastQuestion = data.isLastQuestion;
    document.getElementById('results-heading').textContent =
      `${data.answeredCount}/${data.playerCount} answered · Correct answer: ${'ABCD'[data.correctIndex]}`;
    renderRoundTopFive(document.getElementById('fastest-list'), data.topFastest);
    renderLeaderboardList(document.getElementById('results-list'), data.leaderboard);
    document.getElementById('next-btn').textContent = isLastQuestion
      ? 'Show final results'
      : 'Next question';
    showScreen('results');
  });

  document.getElementById('next-btn').addEventListener('click', () => {
    socket.emit('host:next');
  });

  // ---- Final ----
  socket.on('game:over', (data) => {
    renderPodium(document.getElementById('final-podium'), data.leaderboard);
    renderLeaderboardList(document.getElementById('final-list'), data.leaderboard);
    showScreen('final');
  });
})();
