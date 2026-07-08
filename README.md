# Quiz Live

A simple, self-hosted, open-source live quiz game (Kahoot-style). No accounts,
no database, no build step. One host creates a game and gets a 6-digit PIN;
players join with that PIN and a nickname. Supports up to 150 players per game.

## Stack

- **Backend:** Node.js + Express (serves static files) + Socket.IO (real-time game state)
- **Frontend:** Plain HTML/CSS/JS, no framework or bundler
- **State:** In-memory (one `Map` per running game) — no database required

This is intentionally not "enterprise scalable" infrastructure, because it
doesn't need to be: a single Node process handles far more than 150 concurrent
WebSocket connections. If you ever needed to run this across multiple server
instances (e.g. for thousands of simultaneous games), the game-state logic in
`server.js` is isolated behind a handful of functions specifically so it can
be swapped for a shared store like Redis without touching the socket handlers.

## Requirements

- Node.js 18 or newer ([nodejs.org](https://nodejs.org))

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

You should see:

```
Quiz server running at http://localhost:3000
```

## How to play

1. **Host:** open `http://localhost:3000/host.html` and log in with the host
   password (see below).
2. **Write your questions.** You'll land on a question builder — add as many
   questions as you like, each with 4 answer options and a time limit, or
   click **Load sample questions** to start from the built-in sample set and
   edit from there. Click **Create game** when ready. A 6-digit PIN appears.
3. **Players:** on any device on the same network, open
   `http://localhost:3000/` (or `http://<your-computer's-LAN-IP>:3000/` if
   joining from a phone — see below), enter the PIN and a nickname, and click
   **Join game**.
4. Once at least one player has joined, the host clicks **Start game**.
5. Questions appear on both host and player screens with a countdown. Players
   tap one of the four colored buzzer buttons. Points are awarded for correct
   answers, with a speed bonus for answering faster.
6. Between questions, the host screen shows the top 5 fastest correct answers
   for that round, plus the overall top-5 standings, then clicks **Next
   question** to continue. After the last question, everyone sees the final
   podium.

### Host password

By default, the host login password comes from `host-config.json` at the
project root:

```json
{
  "hostPassword": "changeme123"
}
```

Change this before you host anything you care about keeping private — it's
a single shared password for whoever runs the host screen, not a full
multi-account system (this app has no database; that's a deliberate
simplicity trade-off for a single-organizer, self-hosted tool). Restart the
server after editing this file.

**If you deploy this somewhere public** (see below), set a `HOST_PASSWORD`
environment variable on your hosting platform instead — it always takes
priority over `host-config.json`. This matters because if your code lives in
a public GitHub repo, anything committed in `host-config.json` is visible to
anyone; an environment variable set in your host's dashboard is not.

### Playing across multiple devices on the same network

`localhost` only works on the host computer itself. For players to join from
their own phones/laptops on the same Wi-Fi:

1. Find the host computer's local IP address:
   - Mac/Linux: `ifconfig | grep inet`
   - Windows: `ipconfig`
2. Have players open `http://<that-IP>:3000/` instead of `localhost`.

## Deploying so a group can join over the internet

Running on `localhost` only works for people on your own Wi-Fi. To share one
link with a remote group, this needs to run on a server somewhere. A few
things to know before picking where:

- **This needs a platform that runs one persistent Node process** — not
  serverless functions. Socket.IO holds live connections open, and the game
  state lives in that process's memory. **Vercel and Netlify will not work**
  for this reason. Good fits: **Render**, **Railway**, **Fly.io**, or a small
  VPS (DigitalOcean, Linode).
- **Run exactly one instance.** Don't turn on auto-scaling / multiple
  replicas — if a second instance spins up, it won't know about games
  created on the first one, and players could get routed to the wrong one.
  For 150 players this is a total non-issue for a single instance; you just
  don't need more than one.
- **Free tiers usually sleep when idle** and take ~20–30 seconds to wake up
  on the next request. Fine for testing. For an actual live session with a
  group, either use a small paid "always on" tier, or open the host screen
  a few minutes before you start so it's already awake.
- **Set `HOST_PASSWORD` as an environment variable**, not just in
  `host-config.json` (see above).

### Deploying to Render (easiest option)

This repo includes a `render.yaml`, so Render can set it up automatically:

1. Push this project to a GitHub repository.
2. Go to [render.com](https://render.com), sign in, click **New** → **Blueprint**,
   and point it at your repo. It'll read `render.yaml` automatically.
3. When prompted, set the `HOST_PASSWORD` environment variable to whatever
   you want the host login password to be.
4. Deploy. Render gives you a URL like `https://quiz-live-xxxx.onrender.com`.

Once it's live:
- **Host link:** `https://quiz-live-xxxx.onrender.com/host.html`
- **Player link:** `https://quiz-live-xxxx.onrender.com/` (share this one
  with the group)

### Alternatives

- **Railway** — similarly simple GitHub-connect flow, no config file needed
  (just set the start command to `npm start` and the `HOST_PASSWORD` env var
  in its dashboard).
- **Fly.io** — more control, still straightforward, better if you want the
  app closer to your players geographically.
- **A VPS** (DigitalOcean, Linode, etc.) — most manual work (you manage the
  OS, a process manager like `pm2`, and a reverse proxy for HTTPS), but gives
  you full control and predictable always-on behavior without a platform's
  sleep policy to think about.

## Editing the sample question bank

Each game's questions are normally entered by the host in the question
builder at game-creation time. `data/questions.json` is only the **starter
set** loaded by the "Load sample questions" button — edit it if you want a
different default to build from. Each entry looks like:

```json
{
  "question": "What is the capital of France?",
  "options": ["Berlin", "Madrid", "Paris", "Rome"],
  "correctIndex": 2,
  "timeLimit": 15
}
```

`correctIndex` is zero-based (0 = first option). `timeLimit` is in seconds and
is optional (defaults to 20s if omitted). Restart the server after editing.

## Known limitations (by design, for a simple MVP)

- **No reconnection support.** If a player's browser refreshes or drops
  connection mid-game, they're removed and can't rejoin that same game.
- **No persistence.** All game state lives in memory and is lost if the
  server restarts.
- **Single host device controls the game.** There's no separate "big screen"
  display distinct from the host's control panel in this MVP — the host
  device shows both. Casting that screen to a TV/projector works fine.
- **One process only.** Fine for a single game night; would need a shared
  store (Redis) behind the same function boundaries if you wanted multiple
  server instances behind a load balancer.

## License

MIT — see `LICENSE`.
