const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sampleQuestions = require('./data/questions.json');

let hostConfig;
try {
  hostConfig = require('./host-config.json');
} catch {
  hostConfig = {};
}
// In production, set HOST_PASSWORD as a secret env var on your hosting
// platform instead of relying on host-config.json -- that file is meant for
// local use only and should never hold your real password if this repo (or
// its deployment) is public.
const HOST_PASSWORD = process.env.HOST_PASSWORD || hostConfig.hostPassword || 'changeme123';
if (!process.env.HOST_PASSWORD && !hostConfig.hostPassword) {
  console.warn(
    'WARNING: No HOST_PASSWORD env var and no hostPassword in host-config.json.\n' +
    '         Using the default password "changeme123". Set one of those before sharing this link.'
  );
}

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 150;
const MAX_QUESTIONS_PER_GAME = 50;
const DEFAULT_TIME_LIMIT = 20; // seconds, used if a question omits its own timeLimit
const RESULTS_GRACE_MS = 600; // small server-side buffer after the visual timer ends
const TOP_FASTEST_COUNT = 5;
const STANDINGS_COUNT = 5;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

/**
 * All game state lives in this Map, keyed by PIN.
 * Kept isolated behind the functions below so it can be swapped for a
 * shared store (e.g. Redis) later without touching the socket handlers,
 * if this ever needs to run across more than one server process.
 */
const games = new Map();

function generatePin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (games.has(pin));
  return pin;
}

function createGame(hostSocketId, questionSet) {
  const pin = generatePin();
  const game = {
    pin,
    hostSocketId,
    status: 'lobby', // lobby -> question -> results -> (question...) -> ended
    players: new Map(), // socketId -> { name, score }
    questions: questionSet.map((q) => ({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      timeLimit: q.timeLimit || DEFAULT_TIME_LIMIT
    })),
    currentQuestionIndex: -1,
    questionStartTime: null,
    answers: new Map(), // socketId -> { choiceIndex, timeTakenMs, correct, points }
    questionTimer: null
  };
  games.set(pin, game);
  return game;
}

// Validates a host-submitted question set. Returns { ok, error } or { ok, questions }.
function validateQuestionSet(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'Add at least one question.' };
  }
  if (input.length > MAX_QUESTIONS_PER_GAME) {
    return { ok: false, error: `Keep it under ${MAX_QUESTIONS_PER_GAME} questions per game.` };
  }

  const cleaned = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] || {};
    const questionText = String(raw.question || '').trim();
    const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o || '').trim()) : [];
    const correctIndex = Number(raw.correctIndex);
    const timeLimit = Number(raw.timeLimit) || DEFAULT_TIME_LIMIT;

    if (!questionText) return { ok: false, error: `Question ${i + 1} is missing its text.` };
    if (options.length !== 4 || options.some((o) => !o)) {
      return { ok: false, error: `Question ${i + 1} needs all 4 answer options filled in.` };
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      return { ok: false, error: `Question ${i + 1} needs a correct answer selected.` };
    }
    if (timeLimit < 5 || timeLimit > 120) {
      return { ok: false, error: `Question ${i + 1}'s time limit should be between 5 and 120 seconds.` };
    }

    cleaned.push({ question: questionText, options, correctIndex, timeLimit });
  }

  return { ok: true, questions: cleaned };
}

function destroyGame(pin) {
  const game = games.get(pin);
  if (game && game.questionTimer) clearTimeout(game.questionTimer);
  games.delete(pin);
}

function getLeaderboard(game, limit = null) {
  const entries = Array.from(game.players.values())
    .map((p) => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
  return limit ? entries.slice(0, limit) : entries;
}

function sanitizeName(name) {
  return String(name || '').trim().slice(0, 20);
}

function nameTaken(game, name) {
  const lower = name.toLowerCase();
  return Array.from(game.players.values()).some((p) => p.name.toLowerCase() === lower);
}

function calculateScore(correct, timeTakenMs, timeLimitMs) {
  if (!correct) return 0;
  // Reward speed, but never punish a correct answer below a 500pt floor.
  const ratio = Math.max(0, Math.min(1, 1 - timeTakenMs / timeLimitMs));
  return Math.round(500 + 500 * ratio);
}

function broadcastLobby(game) {
  io.to(game.hostSocketId).emit('host:playerJoined', {
    players: Array.from(game.players.values()).map((p) => p.name),
    count: game.players.size
  });
}

function sendQuestion(game) {
  game.currentQuestionIndex += 1;
  const q = game.questions[game.currentQuestionIndex];
  game.status = 'question';
  game.answers = new Map();
  game.questionStartTime = Date.now();

  io.to(game.pin).emit('question:show', {
    index: game.currentQuestionIndex,
    total: game.questions.length,
    question: q.question,
    options: q.options,
    timeLimit: q.timeLimit
  });

  if (game.questionTimer) clearTimeout(game.questionTimer);
  game.questionTimer = setTimeout(() => {
    endQuestion(game);
  }, q.timeLimit * 1000 + RESULTS_GRACE_MS);
}

function endQuestion(game) {
  if (game.status !== 'question') return; // already ended (e.g. everyone answered early)
  game.status = 'results';
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = null;
  }

  const q = game.questions[game.currentQuestionIndex];

  for (const [socketId, player] of game.players.entries()) {
    const answer = game.answers.get(socketId);
    io.to(socketId).emit('question:personalResult', {
      correct: !!(answer && answer.correct),
      points: answer ? answer.points : 0,
      totalScore: player.score,
      correctIndex: q.correctIndex
    });
  }

  // Who got it right, ranked by how fast they answered (fastest first).
  const topFastest = [];
  for (const [socketId, answer] of game.answers.entries()) {
    if (!answer.correct) continue;
    const player = game.players.get(socketId);
    if (!player) continue;
    topFastest.push({ name: player.name, timeTakenMs: answer.timeTakenMs, points: answer.points });
  }
  topFastest.sort((a, b) => a.timeTakenMs - b.timeTakenMs);

  io.to(game.hostSocketId).emit('host:questionResults', {
    correctIndex: q.correctIndex,
    answeredCount: game.answers.size,
    playerCount: game.players.size,
    isLastQuestion: game.currentQuestionIndex + 1 >= game.questions.length,
    topFastest: topFastest.slice(0, TOP_FASTEST_COUNT),
    leaderboard: getLeaderboard(game, STANDINGS_COUNT)
  });
}

io.on('connection', (socket) => {
  socket.on('host:login', ({ password } = {}, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (String(password || '') !== HOST_PASSWORD) {
      return respond({ ok: false, error: 'Incorrect password.' });
    }
    socket.data.isHostAuthenticated = true;
    respond({ ok: true });
  });

  socket.on('host:getSampleQuestions', (_payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (!socket.data.isHostAuthenticated) return respond({ ok: false, error: 'Log in first.' });
    respond({ ok: true, questions: sampleQuestions });
  });

  socket.on('host:create', ({ questions: customQuestions } = {}, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (!socket.data.isHostAuthenticated) {
      return respond({ ok: false, error: 'Log in first.' });
    }

    const questionSource = Array.isArray(customQuestions) && customQuestions.length > 0
      ? customQuestions
      : sampleQuestions;
    const validated = validateQuestionSet(questionSource);
    if (!validated.ok) return respond({ ok: false, error: validated.error });

    const game = createGame(socket.id, validated.questions);
    socket.join(game.pin);
    socket.data.role = 'host';
    socket.data.pin = game.pin;
    respond({ ok: true, pin: game.pin, questionCount: game.questions.length });
  });

  socket.on('player:join', ({ pin, name } = {}, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const game = games.get(String(pin || '').trim());

    if (!game) return respond({ ok: false, error: 'Game not found. Check the PIN and try again.' });
    if (game.status !== 'lobby') return respond({ ok: false, error: 'This game has already started.' });
    if (game.players.size >= MAX_PLAYERS) {
      return respond({ ok: false, error: 'This game is full (150 players max).' });
    }

    const cleanName = sanitizeName(name);
    if (!cleanName) return respond({ ok: false, error: 'Enter a nickname.' });
    if (nameTaken(game, cleanName)) return respond({ ok: false, error: 'That nickname is taken. Pick another.' });

    game.players.set(socket.id, { name: cleanName, score: 0 });
    socket.join(game.pin);
    socket.data.role = 'player';
    socket.data.pin = game.pin;

    respond({ ok: true, pin: game.pin, name: cleanName });
    broadcastLobby(game);
  });

  socket.on('host:start', () => {
    const game = games.get(socket.data.pin);
    if (!game || game.hostSocketId !== socket.id) return;
    if (game.status !== 'lobby') return;
    if (game.players.size === 0) return;
    sendQuestion(game);
  });

  socket.on('player:answer', ({ choiceIndex } = {}) => {
    const game = games.get(socket.data.pin);
    if (!game || game.status !== 'question') return;
    if (!game.players.has(socket.id)) return;
    if (game.answers.has(socket.id)) return; // already answered this question

    const q = game.questions[game.currentQuestionIndex];
    const timeTakenMs = Date.now() - game.questionStartTime;
    const correct = choiceIndex === q.correctIndex;
    const points = calculateScore(correct, timeTakenMs, q.timeLimit * 1000);

    game.answers.set(socket.id, { choiceIndex, timeTakenMs, correct, points });
    const player = game.players.get(socket.id);
    player.score += points;

    io.to(game.hostSocketId).emit('host:answerCount', {
      answeredCount: game.answers.size,
      playerCount: game.players.size
    });

    if (game.answers.size >= game.players.size) {
      endQuestion(game); // everyone's in, no need to wait for the clock
    }
  });

  socket.on('host:next', () => {
    const game = games.get(socket.data.pin);
    if (!game || game.hostSocketId !== socket.id) return;
    if (game.status !== 'results') return;

    if (game.currentQuestionIndex + 1 < game.questions.length) {
      sendQuestion(game);
    } else {
      game.status = 'ended';
      io.to(game.pin).emit('game:over', { leaderboard: getLeaderboard(game) });
    }
  });

  socket.on('disconnect', () => {
    const pin = socket.data.pin;
    if (!pin) return;
    const game = games.get(pin);
    if (!game) return;

    if (socket.data.role === 'host') {
      socket.to(game.pin).emit('game:hostDisconnected');
      destroyGame(pin);
    } else if (socket.data.role === 'player') {
      game.players.delete(socket.id);
      game.answers.delete(socket.id);
      broadcastLobby(game);
    }
  });
});

// Safety net: reap any game that finished (or was abandoned) a while ago so
// memory doesn't grow forever across a long-running server process.
setInterval(() => {
  for (const [pin, game] of games.entries()) {
    if (game.status === 'ended') destroyGame(pin);
  }
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Quiz server running at http://localhost:${PORT}`);
});
