const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static('public'));

const rooms = {}, SPECIAL = ['mafia', 'doctor', 'detective'];
const BOTN = ['Raj', 'Simran', 'Vikram', 'Anjali', 'Kabir', 'Meera', 'Arjun', 'Zoya', 'Ishaan', 'Naina', 'Dev', 'Rhea', 'Ayaan', 'Tara', 'Neel', 'Sana', 'Rohan', 'Kavya', 'Aryan', 'Mira'];
const LINES = [n => `I'm suspicious of ${n}...`, n => `${n}, you've been very quiet.`,
  () => 'It is not me, I promise!', n => `Let's not rush. What about ${n}?`];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const alive = r => r.players.filter(p => p.alive);
const later = (r, ms, fn) => { clearTimeout(r.timer); r.timer = setTimeout(fn, ms); };
const mode = a => {
  if (!a.length) return null;
  const c = {}; a.forEach(x => c[x] = (c[x] || 0) + 1);
  const m = Math.max(...Object.values(c));
  return rnd(Object.keys(c).filter(k => c[k] === m));
};
const newCode = () => {
  let c; do c = Array.from({ length: 4 }, () => rnd([...'ABCDEFGHJKLMNPQRSTUVWXYZ'])).join(''); while (rooms[c]);
  return c;
};

function view(r, p) {
  const over = r.phase === 'over', mafia = p.role === 'mafia', tally = {};
  Object.values(r.votes).forEach(t => tally[t] = (tally[t] || 0) + 1);
  return {
    code: r.code, phase: r.phase, day: r.day, left: Math.max(0, r.until - Date.now()), winner: r.winner,
    you: { id: p.id, name: p.name, role: p.role, alive: p.alive, isHost: r.host === p.id },
    players: r.players.map(q => ({
      id: q.id, name: q.name, alive: q.alive, isBot: !!q.bot, isHost: r.host === q.id,
      role: (over || !q.alive || (mafia && q.role === 'mafia')) ? q.role : undefined
    })),
    tally, myAct: r.acts[p.id], myVote: r.votes[p.id], known: r.known[p.id] || [], log: r.log,
    chat: r.chat.filter(m => m.c !== 'mafia' || mafia || over)
  };
}
function push(r) { r.players.filter(p => p.sid).forEach(p => io.to(p.sid).emit('state', view(r, p))); }
function say(r, p, t, c = 'all') { r.chat.push({ n: p.name, t, c }); if (r.chat.length > 150) r.chat.shift(); push(r); }

function win(r) {
  const a = alive(r), m = a.filter(p => p.role === 'mafia').length;
  if (!m) return 'Town';
  if (m >= a.length - m) return 'Mafia';
  return null;
}
function end(r, w) {
  clearTimeout(r.timer); r.phase = 'over'; r.winner = w;
  r.log.push(`Game over: ${w === 'Town' ? 'the town' : 'the Mafia'} wins.`); push(r);
}

function start(r) {
  const n = r.players.length, m = Math.max(1, Math.floor(n / 4));
  const roles = [...Array(m).fill('mafia'), 'doctor', ...(n >= 10 ? ['detective', 'detective'] : (n >= 5 ? ['detective'] : []))];
  while (roles.length < n) roles.push('villager');
  roles.sort(() => Math.random() - .5);
  r.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; });
  r.day = 0; r.known = {}; r.winner = null; r.chat = [];
  r.log = [`The game begins with ${n} players, ${m} of them Mafia.`];
  startNight(r);
}

function botAct(r, p) {
  const a = alive(r);
  if (p.role === 'mafia') return rnd(a.filter(x => x.role !== 'mafia')).id;
  if (p.role === 'doctor') return rnd(a).id;
  const k = (r.known[p.id] || []).map(x => x.id);
  const c = a.filter(x => x !== p && !k.includes(x.id));
  return rnd(c.length ? c : a.filter(x => x !== p)).id;
}
function startNight(r) {
  r.phase = 'night'; r.day++; r.acts = {}; r.until = Date.now() + 45e3;
  r.log.push(`Night ${r.day} falls.`);
  later(r, 45e3, () => resolveNight(r));
  alive(r).filter(p => p.bot && SPECIAL.includes(p.role)).forEach(p => r.acts[p.id] = botAct(r, p));
  push(r); checkNight(r);
}
function checkNight(r) {
  if (r.phase !== 'night') return;
  const need = alive(r).filter(p => SPECIAL.includes(p.role) && (p.bot || p.sid));
  if (need.every(p => r.acts[p.id])) later(r, need.some(p => !p.bot) ? 1500 : 5000, () => resolveNight(r));
}
function resolveNight(r) {
  if (r.phase !== 'night') return;
  const al = alive(r);
  const kill = mode(al.filter(p => p.role === 'mafia' && r.acts[p.id]).map(p => r.acts[p.id]));
  const doc = al.find(p => p.role === 'doctor'), saved = doc && r.acts[doc.id];
  al.filter(p => p.role === 'detective' && r.acts[p.id]).forEach(p => {
    const t = r.players.find(x => x.id === r.acts[p.id]);
    (r.known[p.id] = r.known[p.id] || []).push({ id: t.id, name: t.name, mafia: t.role === 'mafia' });
  });
  const v = r.players.find(p => p.id === kill);
  if (v && kill !== saved) { v.alive = false; r.log.push(`Day ${r.day}: ${v.name} was killed in the night. They were ${v.role}.`); }
  else r.log.push(`Day ${r.day}: nobody died last night.`);
  const w = win(r); if (w) return end(r, w);
  startDay(r);
}

function botVote(r, p) {
  const o = alive(r).filter(x => x !== p);
  if (p.role === 'mafia') return rnd(o.filter(x => x.role !== 'mafia')).id;
  const k = (r.known[p.id] || []).find(x => x.mafia && o.some(y => y.id === x.id));
  return k ? k.id : rnd(o).id;
}
function startDay(r) {
  r.phase = 'day'; r.votes = {}; r.until = Date.now() + 9e4;
  later(r, 9e4, () => resolveVote(r));
  const d = r.day, live = (p) => r.phase === 'day' && r.day === d && p.alive;
  alive(r).filter(p => p.bot).forEach(p => {
    setTimeout(() => { if (live(p)) say(r, p, rnd(LINES)(rnd(alive(r).filter(x => x !== p)).name)); }, 3e3 + Math.random() * 2e4);
    setTimeout(() => { if (live(p)) vote(r, p, botVote(r, p)); }, 2e4 + Math.random() * 4e4);
  });
  push(r);
}
function vote(r, p, t) {
  if (r.phase !== 'day' || !p.alive) return;
  if (t !== 'skip' && !alive(r).some(x => x.id === t && x !== p)) return;
  r.votes[p.id] = t; push(r);
  if (alive(r).filter(x => x.bot || x.sid).every(x => r.votes[x.id])) later(r, 1500, () => resolveVote(r));
}
function resolveVote(r) {
  if (r.phase !== 'day') return;
  const c = {}; Object.values(r.votes).forEach(t => c[t] = (c[t] || 0) + 1);
  const m = Math.max(0, ...Object.values(c)), top = Object.keys(c).filter(k => c[k] === m);
  const v = top.length === 1 && top[0] !== 'skip' && r.players.find(p => p.id === top[0]);
  if (v) { v.alive = false; r.log.push(`The town voted out ${v.name}. They were ${v.role}.`); }
  else r.log.push('No majority: nobody was voted out.');
  const w = win(r); if (w) return end(r, w);
  startNight(r);
}

io.on('connection', s => {
  let r, p;
  const clean = n => String(n || 'Player').trim().slice(0, 14) || 'Player';
  const join = (room, name, pid, silent) => {
    const R = rooms[room];
    if (!R) return s.emit(silent ? 'gone' : 'err', 'Room not found.');
    let P = R.players.find(x => x.id === pid);
    if (!P) {
      if (R.phase !== 'lobby') return s.emit(silent ? 'gone' : 'err', 'That game has already started.');
      if (R.players.length >= 20) return s.emit('err', 'Room is full (20 players max).');
      while (R.players.some(x => x.name === name)) name += '*';
      P = { id: pid, name, alive: true }; R.players.push(P);
    }
    if (!R.host) R.host = P.id;
    P.sid = s.id; r = R; p = P; s.join(room); push(R);
  };
  s.on('create', d => {
    const c = newCode();
    rooms[c] = { code: c, players: [], host: null, phase: 'lobby', day: 0, log: [], chat: [], acts: {}, votes: {}, known: {}, until: 0 };
    join(c, clean(d.name), String(d.pid));
  });
  s.on('join', d => join(String(d.room || '').toUpperCase(), clean(d.name), String(d.pid), d.silent));
  s.on('addbot', fill => {
    if (!r || r.phase !== 'lobby' || r.host !== p.id) return;
    const add = () => {
      const n = BOTN.find(b => !r.players.some(x => x.name === b));
      if (n && r.players.length < 20) r.players.push({ id: 'b' + Math.random().toString(36).slice(2), name: n, bot: true, alive: true });
    };
    if (fill) for (let i = 0; i < 20 && r.players.length < 20; i++) add(); else add();
    push(r);
  });
  s.on('start', () => { if (r && r.phase === 'lobby' && r.host === p.id && r.players.length >= 4) start(r); });
  s.on('act', t => {
    if (!r || r.phase !== 'night' || !p.alive || !SPECIAL.includes(p.role)) return;
    const T = r.players.find(x => x.id === t && x.alive); if (!T) return;
    if (p.role === 'mafia' && T.role === 'mafia') return;
    if (p.role === 'detective' && T === p) return;
    r.acts[p.id] = t; push(r); checkNight(r);
  });
  s.on('vote', t => { if (r && p) vote(r, p, t); });
  s.on('chat', t => {
    if (!r || !p) return;
    t = String(t).trim().slice(0, 200); if (!t) return;
    const ok = r.phase === 'lobby' || r.phase === 'over' || (r.phase === 'day' && p.alive) || (r.phase === 'night' && p.alive && p.role === 'mafia');
    if (ok) say(r, p, t, r.phase === 'night' ? 'mafia' : 'all');
  });
  s.on('again', () => {
    if (!r || !p || r.phase !== 'over' || r.host !== p.id) return;
    r.phase = 'lobby'; r.players = r.players.filter(x => x.bot || x.sid);
    r.players.forEach(x => { delete x.role; x.alive = true; }); r.log = []; r.chat = []; push(r);
  });
  s.on('disconnect', () => {
    if (!r || !p || p.sid !== s.id) return;
    p.sid = null;
    if (r.phase === 'lobby') r.players = r.players.filter(x => x !== p);
    if (r.host === p.id) r.host = (r.players.find(x => x.sid) || {}).id;
    const R = r;
    if (!R.players.some(x => x.sid)) setTimeout(() => {
      if (!R.players.some(x => x.sid)) { clearTimeout(R.timer); delete rooms[R.code]; }
    }, 6e5);
    else push(R);
  });
});

srv.listen(process.env.PORT || 3000, () => console.log('Mafia server running'));
