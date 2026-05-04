// =====================================================
// ArenaLink — Serveur (Groupes, Tournois, UNO)
// =====================================================
// Lancement : node server.js
// Dépendances : npm install socket.io
// =====================================================

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

// ── Persistance ───────────────────────────────────────
const DATA_DIR         = path.join(__dirname, 'data');
const UPLOADS_DIR      = path.join(DATA_DIR, 'uploads');
const GROUPS_FILE      = path.join(DATA_DIR, 'groups.json');
const USERS_FILE       = path.join(DATA_DIR, 'users.json');
const TOURNAMENTS_FILE = path.join(DATA_DIR, 'tournaments.json');
const DMS_FILE         = path.join(DATA_DIR, 'dms.json');


if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const loadJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};
const saveJSON = (file, data) => {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.error(`[💾] Erreur ${file}:`, e.message); }
};

const users       = loadJSON(USERS_FILE, {});
const groups      = loadJSON(GROUPS_FILE, {});
const tournaments = loadJSON(TOURNAMENTS_FILE, {});
const dms         = loadJSON(DMS_FILE, {});

const persistGroups      = () => saveJSON(GROUPS_FILE, groups);
const persistUsers       = () => saveJSON(USERS_FILE, users);
const persistTournaments = () => saveJSON(TOURNAMENTS_FILE, tournaments);
const persistDms         = () => saveJSON(DMS_FILE, dms); 

// ── Utils ─────────────────────────────────────────────
const makeAvatar = (seed) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;

const genId = () => crypto.randomBytes(8).toString('hex');

const genInviteCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (Object.values(groups).some(g => g.inviteCode === code));
  return code;
};

const findUserById = (id) =>
  Object.values(users).find(u => String(u.id) === String(id));

const getInitials = (name) =>
  name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'GP';

// Migration douce : assure les champs sur un groupe existant
const ensureGroupShape = (g) => {
  if (!Array.isArray(g.admins))      g.admins      = [g.ownerId];
  if (!Array.isArray(g.members))     g.members     = [];
  if (!Array.isArray(g.bannedUsers)) g.bannedUsers = [];
  if (!Array.isArray(g.messages))    g.messages    = [];
  if (typeof g.chatLocked !== 'boolean') g.chatLocked = false;
  if (!g.inviteCode) g.inviteCode = genInviteCode();
};
Object.values(groups).forEach(ensureGroupShape);

const publicGroup = (g) => ({
  id: g.id,
  name: g.name,
  type: g.type,
  initials: g.initials,
  logo: g.logo || null,
  ownerId: g.ownerId,
  admins: g.admins,
  members: g.members,
  inviteCode: g.inviteCode,
  chatLocked: g.chatLocked || false,
  createdAt: g.createdAt,
});

// ── Parsers ───────────────────────────────────────────
const parseBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { resolve(JSON.parse(body || '{}')); }
    catch { reject(new Error('JSON invalide')); }
  });
});

const parseMultipart = (req) => new Promise((resolve, reject) => {
  const ct = req.headers['content-type'] || '';
  const m  = ct.match(/boundary=(.+)$/);
  if (!m) return reject(new Error('No boundary'));
  const boundary = '--' + m[1];
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      const bnd = Buffer.from(boundary);
      const end = Buffer.from(boundary + '--');
      let start = buf.indexOf(bnd);
      if (start < 0) return reject(new Error('Boundary not found'));
      start += bnd.length + 2;
      let next = buf.indexOf(bnd, start);
      if (next < 0) next = buf.indexOf(end, start);
      if (next < 0) return reject(new Error('Closing boundary not found'));
      const part = buf.slice(start, next - 2);
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) return reject(new Error('Headers separator not found'));
      const headers = part.slice(0, sep).toString('utf8');
      const body = part.slice(sep + 4);
      const fnMatch = headers.match(/filename="([^"]+)"/);
      const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      if (!fnMatch) return reject(new Error('No filename'));
      resolve({
        filename: fnMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
        data: body,
      });
    } catch (e) { reject(e); }
  });
});

const ALLOWED_MIME = [
  'image/png','image/jpeg','image/jpg','image/gif','image/webp',
  'video/mp4','video/webm','video/quicktime',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// =====================================================
// TOURNOIS — utilitaires bracket
// =====================================================
const VALID_GAMES = ['pong', 'tictactoe', 'snake', 'penalty', 'uno'];

const publicTournament = (t) => ({
  id: t.id, name: t.name, gameId: t.gameId, format: t.format,
  maxPlayers: t.maxPlayers, status: t.status,
  organizerId: t.organizerId, organizerName: t.organizerName,
  groupId: t.groupId || null, groupName: t.groupName || null,
  participants: t.participants, bracket: t.bracket, standings: t.standings || [],
  winner: t.winner || null, createdAt: t.createdAt, startedAt: t.startedAt || null,
});

const buildEliminationBracket = (participants) => {
  const n = participants.length;
  let bracketSize = 1;
  while (bracketSize < n) bracketSize *= 2;
  const byes = bracketSize - n;
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const rounds = [];
  const round1 = [];
  let pIdx = 0;
  for (let i = 0; i < bracketSize / 2; i++) {
    const p1 = shuffled[pIdx++] || null;
    let p2 = null;
    if (byes > i) p2 = null;
    else          p2 = shuffled[pIdx++] || null;
    round1.push({
      id: genId(), round: 0, matchIndex: i,
      p1, p2,
      winner: !p2 ? p1 : null,
      score1: null, score2: null,
      status: !p2 ? 'done' : 'pending',
    });
  }
  rounds.push(round1);
  let prevSize = round1.length;
  while (prevSize > 1) {
    const nextSize = prevSize / 2;
    const round = [];
    for (let i = 0; i < nextSize; i++) {
      round.push({
        id: genId(), round: rounds.length, matchIndex: i,
        p1: null, p2: null, winner: null,
        score1: null, score2: null, status: 'waiting',
      });
    }
    rounds.push(round);
    prevSize = nextSize;
  }
  propagateByes(rounds);
  return { type: 'elimination', rounds };
};

const propagateByes = (rounds) => {
  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].forEach((match, i) => {
      if (match.status === 'done' && match.winner) {
        const nextMatch = rounds[r + 1][Math.floor(i / 2)];
        if (i % 2 === 0) nextMatch.p1 = match.winner;
        else             nextMatch.p2 = match.winner;
        if (nextMatch.p1 && nextMatch.p2) nextMatch.status = 'pending';
      }
    });
  }
};

const buildRoundRobinBracket = (participants) => {
  const matches = [];
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      matches.push({
        id: genId(), p1: participants[i], p2: participants[j],
        winner: null, score1: null, score2: null, status: 'pending',
      });
    }
  }
  return { type: 'round-robin', matches };
};

const computeStandings = (tournament) => {
  if (tournament.bracket.type !== 'round-robin') return [];
  const stats = {};
  tournament.participants.forEach(p => {
    stats[p.id] = { ...p, wins: 0, losses: 0, played: 0 };
  });
  tournament.bracket.matches.forEach(m => {
    if (m.status === 'done' && m.winner) {
      stats[m.winner.id].wins++;
      stats[m.winner.id].played++;
      const loserId = m.winner.id === m.p1.id ? m.p2.id : m.p1.id;
      stats[loserId].losses++;
      stats[loserId].played++;
    }
  });
  return Object.values(stats).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
};

const checkTournamentEnd = (tournament) => {
  if (tournament.bracket.type === 'elimination') {
    const finalRound = tournament.bracket.rounds[tournament.bracket.rounds.length - 1];
    if (finalRound[0].status === 'done' && finalRound[0].winner) {
      tournament.status = 'finished';
      tournament.winner = finalRound[0].winner;
    }
  } else {
    const allDone = tournament.bracket.matches.every(m => m.status === 'done');
    if (allDone) {
      tournament.status = 'finished';
      tournament.standings = computeStandings(tournament);
      tournament.winner = tournament.standings[0] || null;
    }
  }
};

// =====================================================
// SERVEUR HTTP
// =====================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ───── Sert les uploads ─────
  if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const filename = path.basename(req.url.replace('/uploads/', ''));
    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filename).toLowerCase();
    const mime = {
      '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
      '.gif':'image/gif','.webp':'image/webp',
      '.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control':'public, max-age=31536000' });
    return fs.createReadStream(filepath).pipe(res);
  }

  res.setHeader('Content-Type', 'application/json');

  // ═════════════════ AUTH ═════════════════
  if (req.method === 'POST' && req.url === '/api/register') {
    try {
      const { username, email, password } = await parseBody(req);
      if (!username || !email || !password) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Tous les champs sont requis.' }));
      }
      if (password.length < 3) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Mot de passe trop court (3 min).' }));
      }
      if (users[email]) {
        res.writeHead(409); return res.end(JSON.stringify({ error:'Email déjà utilisé.' }));
      }
      if (Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase())) {
        res.writeHead(409); return res.end(JSON.stringify({ error:'Pseudo déjà pris.' }));
      }
      // users[email] = {
      //   id: Date.now().toString(),
      //   username, email, password,
      //   avatar: makeAvatar(username),
      //   elo:1000, wins:0, losses:0,
      // };

      users[email] = {
        id: Date.now().toString(),
        username, email, password,
        avatar:      makeAvatar(username),
        avatarStyle: 'avataaars',
        avatarSeed:  username,
        bio:         '',
        elo:1000, wins:0, losses:0,
      };






      // 
      persistUsers();
      res.writeHead(201); return res.end(JSON.stringify({ message:'Compte créé !' }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }
// login 
  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const { email, password } = await parseBody(req);
      const user = users[email];
      if (!user || user.password !== password) {
        res.writeHead(401); return res.end(JSON.stringify({ error:'Email ou mot de passe incorrect.' }));
      }
        console.log('[POST /login] RENVOIE user:', {
        username: user.username,
        avatar: user.avatar?.slice(0, 80),
        avatarStyle: user.avatarStyle,
        avatarSeed: user.avatarSeed,   });


      res.writeHead(200);

        return res.end(JSON.stringify({
        message: 'Connexion réussie',
        user: {
          id:          user.id,
          username:    user.username,
          name:        user.name || user.username,
          email:       user.email,
          avatar:      user.avatar,
          avatarStyle: user.avatarStyle || 'avataaars',
          avatarSeed:  user.avatarSeed  || user.username,
          bio:         user.bio || '',
          elo:         user.elo,
          wins:        user.wins,
          losses:      user.losses,
              },
            }));
          } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
        }
    

  // ═════════════════ GROUPES ═════════════════

  // GET /api/groups/user/:userId → groupes où le user est membre
  if (req.method === 'GET' && req.url.startsWith('/api/groups/user/')) {
    const userId = req.url.split('/').pop();
    const userGroups = Object.values(groups)
      .filter(g => g.members.some(m => String(m.id) === String(userId)))
      .map(publicGroup);
    res.writeHead(200);
    return res.end(JSON.stringify({ groups: userGroups }));
  }

  // POST /api/groups/create
  if (req.method === 'POST' && req.url === '/api/groups/create') {
    try {
      const { name, type, creatorId } = await parseBody(req);
      if (!name?.trim() || !creatorId) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Nom et créateur requis.' }));
      }
      const creator = findUserById(creatorId);
      if (!creator) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Créateur introuvable.' }));
      }
      const id = genId();
      const group = {
        id,
        name: name.trim(),
        type: type === 'private' ? 'private' : 'public',
        initials: getInitials(name.trim()),
        logo: null,
        ownerId: creator.id,
        admins: [creator.id],
        members: [{ id:creator.id, username:creator.username, avatar:creator.avatar }],
        inviteCode: genInviteCode(),
        chatLocked: false,
        bannedUsers: [],
        messages: [],
        createdAt: Date.now(),
      };
      groups[id] = group;
      persistGroups();
      res.writeHead(201);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/join → rejoindre via code
  if (req.method === 'POST' && req.url === '/api/groups/join') {
    try {
      const { code, userId } = await parseBody(req);
      if (!code || !userId) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Code et userId requis.' }));
      }
      const group = Object.values(groups).find(g => g.inviteCode === code.toUpperCase());
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Code invalide.' }));
      }
      if (group.bannedUsers.includes(String(userId))) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Tu as été banni de ce groupe.' }));
      }
      if (group.members.some(m => String(m.id) === String(userId))) {
        res.writeHead(200);
        return res.end(JSON.stringify({ group: publicGroup(group), already: true }));
      }
      const user = findUserById(userId);
      if (!user) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Utilisateur introuvable.' }));
      }
      group.members.push({ id:user.id, username:user.username, avatar:user.avatar });
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      io.to(`group-${group.id}`).emit('group-system-message', {
        groupId: group.id,
        text: `🎉 ${user.username} a rejoint le groupe.`,
      });
      // Notifier le user lui-même (pour mise à jour de sa liste)
      io.to(`user-${user.id}`).emit('group-joined', { group: publicGroup(group) });
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/leave
  const leaveMatch = req.url.match(/^\/api\/groups\/([^/]+)\/leave$/);
  if (req.method === 'POST' && leaveMatch) {
    try {
      const { userId } = await parseBody(req);
      const group = groups[leaveMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      group.members = group.members.filter(m => String(m.id) !== String(userId));
      group.admins  = group.admins.filter(a => String(a) !== String(userId));
      // Si le owner part → transfert au prochain admin/membre, sinon supprime le groupe
      if (String(group.ownerId) === String(userId)) {
        const newOwner = group.admins[0] || (group.members[0] && group.members[0].id);
        if (newOwner) {
          group.ownerId = newOwner;
          if (!group.admins.includes(newOwner)) group.admins.push(newOwner);
        } else {
          delete groups[group.id];
          persistGroups();
          io.to(`group-${group.id}`).emit('group-deleted', { groupId: group.id });
          res.writeHead(200);
          return res.end(JSON.stringify({ deleted:true }));
        }
      }
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      const user = findUserById(userId);
      if (user) {
        io.to(`group-${group.id}`).emit('group-system-message', {
          groupId: group.id,
          text: `👋 ${user.username} a quitté le groupe.`,
        });
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/update → admins seulement (nom, logo, lock chat, regen code)
  const updateMatch = req.url.match(/^\/api\/groups\/([^/]+)\/update$/);
  if (req.method === 'POST' && updateMatch) {
    try {
      const { userId, name, logo, chatLocked, regenerateCode } = await parseBody(req);
      const group = groups[updateMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (!group.admins.includes(String(userId))) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Action réservée aux admins.' }));
      }
      if (typeof name === 'string' && name.trim()) {
        group.name = name.trim();
        group.initials = getInitials(name.trim());
      }
      if (typeof logo === 'string') group.logo = logo;
      if (typeof chatLocked === 'boolean') {
        const wasLocked = group.chatLocked;
        group.chatLocked = chatLocked;
        if (wasLocked !== chatLocked) {
          io.to(`group-${group.id}`).emit('group-system-message', {
            groupId: group.id,
            text: chatLocked ? '🔒 Le chat a été verrouillé par un admin.' : '🔓 Le chat a été déverrouillé.',
          });
        }
      }
      if (regenerateCode) group.inviteCode = genInviteCode();
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/kick → exclure (sans bannir)
  const kickMatch = req.url.match(/^\/api\/groups\/([^/]+)\/kick$/);
  if (req.method === 'POST' && kickMatch) {
    try {
      const { adminId, targetId } = await parseBody(req);
      const group = groups[kickMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (!group.admins.includes(String(adminId))) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Action réservée aux admins.' }));
      }
      if (String(group.ownerId) === String(targetId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:"Impossible d'exclure le propriétaire." }));
      }
      const target = group.members.find(m => String(m.id) === String(targetId));
      if (!target) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Membre introuvable.' }));
      }
      group.members = group.members.filter(m => String(m.id) !== String(targetId));
      group.admins  = group.admins.filter(a => String(a) !== String(targetId));
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      io.to(`group-${group.id}`).emit('group-system-message', {
        groupId: group.id,
        text: `👢 ${target.username} a été exclu du groupe.`,
      });
      io.to(`user-${targetId}`).emit('group-kicked', {
        groupId: group.id, groupName: group.name,
      });
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/ban → bannir définitivement
  const banMatch = req.url.match(/^\/api\/groups\/([^/]+)\/ban$/);
  if (req.method === 'POST' && banMatch) {
    try {
      const { adminId, targetId } = await parseBody(req);
      const group = groups[banMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (!group.admins.includes(String(adminId))) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Action réservée aux admins.' }));
      }
      if (String(group.ownerId) === String(targetId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:"Impossible de bannir le propriétaire." }));
      }
      const target = group.members.find(m => String(m.id) === String(targetId));
      group.members = group.members.filter(m => String(m.id) !== String(targetId));
      group.admins  = group.admins.filter(a => String(a) !== String(targetId));
      if (!group.bannedUsers.includes(String(targetId))) {
        group.bannedUsers.push(String(targetId));
      }
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      if (target) {
        io.to(`group-${group.id}`).emit('group-system-message', {
          groupId: group.id,
          text: `🚫 ${target.username} a été banni du groupe.`,
        });
        io.to(`user-${targetId}`).emit('group-banned', {
          groupId: group.id, groupName: group.name,
        });
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/unban
  const unbanMatch = req.url.match(/^\/api\/groups\/([^/]+)\/unban$/);
  if (req.method === 'POST' && unbanMatch) {
    try {
      const { adminId, targetId } = await parseBody(req);
      const group = groups[unbanMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (!group.admins.includes(String(adminId))) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Action réservée aux admins.' }));
      }
      group.bannedUsers = group.bannedUsers.filter(b => String(b) !== String(targetId));
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/promote → owner promeut un membre admin
  const promoteMatch = req.url.match(/^\/api\/groups\/([^/]+)\/promote$/);
  if (req.method === 'POST' && promoteMatch) {
    try {
      const { ownerId, targetId } = await parseBody(req);
      const group = groups[promoteMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (String(group.ownerId) !== String(ownerId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Réservé au propriétaire.' }));
      }
      if (!group.members.some(m => String(m.id) === String(targetId))) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Membre introuvable.' }));
      }
      if (!group.admins.includes(String(targetId))) {
        group.admins.push(String(targetId));
      }
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      const target = group.members.find(m => String(m.id) === String(targetId));
      if (target) {
        io.to(`group-${group.id}`).emit('group-system-message', {
          groupId: group.id,
          text: `⭐ ${target.username} est maintenant admin.`,
        });
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/groups/:id/demote → owner retire admin
  const demoteMatch = req.url.match(/^\/api\/groups\/([^/]+)\/demote$/);
  if (req.method === 'POST' && demoteMatch) {
    try {
      const { ownerId, targetId } = await parseBody(req);
      const group = groups[demoteMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (String(group.ownerId) !== String(ownerId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Réservé au propriétaire.' }));
      }
      if (String(group.ownerId) === String(targetId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Impossible de rétrograder le propriétaire.' }));
      }
      group.admins = group.admins.filter(a => String(a) !== String(targetId));
      persistGroups();
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
      res.writeHead(200);
      return res.end(JSON.stringify({ group: publicGroup(group) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // DELETE /api/groups/:id → owner supprime le groupe
  const delMatch = req.url.match(/^\/api\/groups\/([^/]+)$/);
  if (req.method === 'DELETE' && delMatch) {
    try {
      const { userId } = await parseBody(req);
      const group = groups[delMatch[1]];
      if (!group) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
      }
      if (String(group.ownerId) !== String(userId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:"Seul le propriétaire peut fermer le groupe." }));
      }
      io.to(`group-${group.id}`).emit('group-deleted', { groupId: group.id, name: group.name });
      delete groups[group.id];
      persistGroups();
      res.writeHead(200);
      return res.end(JSON.stringify({ deleted:true }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // GET /api/groups/:id/messages → historique persisté
  const msgMatch = req.url.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (req.method === 'GET' && msgMatch) {
    const group = groups[msgMatch[1]];
    if (!group) {
      res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
    }
    res.writeHead(200);
    return res.end(JSON.stringify({ messages: group.messages || [] }));
  }


// PUT /api/profile mise à jour profil (avatar, bio, name)
if (req.method === 'PUT' && req.url === '/api/profile') {
  const { userId, name, avatar, avatarStyle, avatarSeed, bio } = await parseBody(req);
    console.log('[PUT /profile] REÇU:', { userId, name, avatarStyle, avatarSeed, avatar: avatar?.slice(0, 80) });
  try {
    // const { userId, name, avatar, avatarStyle, avatarSeed, bio } = await parseBody(req);
    console.log('[PUT /profile] REÇU:', { userId, name, avatarStyle, avatarSeed });

    if (!userId) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'userId requis.' }));
    }
    const user = findUserById(userId);
    if (!user) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Utilisateur introuvable.' }));
    }

    // Vérif unicité du pseudo si changé
    if (name && name.trim() && name.trim() !== user.username) {
      const taken = Object.values(users).find(u =>
        String(u.id) !== String(userId) &&
        u.username.toLowerCase() === name.trim().toLowerCase()
      );
      if (taken) {
        res.writeHead(409);
        return res.end(JSON.stringify({ error: 'Pseudo déjà pris.' }));
      }
      user.username = name.trim();
    }
    // ===============================
    // ==  // ═════════════════ DIRECT MESSAGES (DMs) ═════════════════

  // GET /api/dms/:userId → Liste des conversations d'un utilisateur
  const dmsListMatch = req.url.match(/^\/api\/dms\/([^/]+)$/);
  if (req.method === 'GET' && dmsListMatch) {
    const userId = dmsListMatch[1];
    const conversations = [];
    
    for (const [convId, messages] of Object.entries(dms)) {
      if (convId.includes(userId) && messages.length > 0) {
        const ids = convId.split('_');
        const otherId = ids[0] === userId ? ids[1] : ids[0];
        const otherUser = findUserById(otherId);
        
        if (otherUser) {
          const lastMsg = messages[messages.length - 1];
          conversations.push({
            otherId: otherUser.id,
            otherName: otherUser.username,
            otherAvatar: otherUser.avatar,
            lastMessage: { text: lastMsg.text, time: lastMsg.time, from: lastMsg.from },
            unread: 0
          });
        }
      }
    }
    
    // Trier de la plus récente à la plus ancienne
    conversations.sort((a, b) => new Date(b.lastMessage.time) - new Date(a.lastMessage.time));
    
    res.writeHead(200);
    return res.end(JSON.stringify({ conversations }));
  }

  // GET /api/dms/:userId/:otherId → Historique précis
  const dmHistMatch = req.url.match(/^\/api\/dms\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && dmHistMatch) {
    const userId = dmHistMatch[1];
    const otherId = dmHistMatch[2];
    
    // ID unique : toujours trié alphabétiquement (ex: "id1_id2")
    const convId = [userId, otherId].sort().join('_');
    const otherUser = findUserById(otherId);
    
    if (!otherUser) {
      res.writeHead(404); return res.end(JSON.stringify({ error: 'Utilisateur introuvable.' }));
    }

    const messages = dms[convId] || [];
    res.writeHead(200);
    return res.end(JSON.stringify({ 
      messages,
      other: { id: otherUser.id, username: otherUser.username, avatar: otherUser.avatar }
    }));
  }







    // Mise à jour des propriétés d'avatar

    if (typeof avatarStyle === 'string') user.avatarStyle = avatarStyle;
    if (typeof avatarSeed === 'string')  user.avatarSeed  = avatarSeed;
    if (typeof bio === 'string')         user.bio         = bio;
    // L'avatar est TOUJOURS recalculé depuis style seed
    if (user.avatarStyle && user.avatarSeed) {
      user.avatar = `https://api.dicebear.com/7.x/${user.avatarStyle}/svg?seed=${encodeURIComponent(user.avatarSeed)}`;
    } else if (typeof avatar === 'string') {
      user.avatar = avatar;
    }

      console.log('[PUT /profile] AVANT SAVE user en DB:', {
      username: user.username,
      avatar: user.avatar?.slice(0, 80),
      avatarStyle: user.avatarStyle,
      avatarSeed: user.avatarSeed,
    });
    persistUsers();

    // Propager le nouvel avatar/nom dans les groupes où il est membre
    Object.values(groups).forEach(group => {
      const member = group.members.find(m => String(m.id) === String(userId));
      if (member) {
        member.username = user.username;
        member.avatar   = user.avatar;
      }
      io.to(`group-${group.id}`).emit('group-updated', { group: publicGroup(group) });
    });
    persistGroups();

    res.writeHead(200);
    return res.end(JSON.stringify({
      user: {
        id:          user.id,
        username:    user.username,
        name:        user.username,
        email:       user.email,
        avatar:      user.avatar,
        avatarStyle: user.avatarStyle,
        avatarSeed:  user.avatarSeed,
        bio:         user.bio || '',
        elo:         user.elo,
        wins:        user.wins,
        losses:      user.losses,
      },
    }));
  } catch (e) {
    console.error('PUT /api/profile error:', e);
    res.writeHead(500);
    return res.end(JSON.stringify({ error: 'Erreur serveur.' }));
  }
}


  // ═════════════════ TOURNOIS ═════════════════

  // GET /api/tournaments?userId=xxx OU /api/tournaments/:id
  if (req.method === 'GET' && req.url.startsWith('/api/tournaments')) {
    const url = new URL(req.url, 'http://x');
    const single = req.url.match(/^\/api\/tournaments\/([^/?]+)$/);
    if (single) {
      const t = tournaments[single[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ tournament: publicTournament(t) }));
    }
    const userId = url.searchParams.get('userId');
    let list = Object.values(tournaments);
    if (userId) {
      const userGroupIds = Object.values(groups)
        .filter(g => g.members.some(m => String(m.id) === String(userId)))
        .map(g => g.id);
      list = list.filter(t => !t.groupId || userGroupIds.includes(t.groupId));
    } else {
      list = list.filter(t => !t.groupId);
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.writeHead(200);
    return res.end(JSON.stringify({ tournaments: list.map(publicTournament) }));
  }

  // POST /api/tournaments/create
  if (req.method === 'POST' && req.url === '/api/tournaments/create') {
    try {
      const { name, gameId, format, maxPlayers, organizerId, groupId } = await parseBody(req);
      if (!name?.trim() || !gameId || !format || !maxPlayers || !organizerId) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Tous les champs sont requis.' }));
      }
      if (!VALID_GAMES.includes(gameId)) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Jeu invalide.' }));
      }
      if (!['elimination','round-robin'].includes(format)) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Format invalide.' }));
      }
      const max = parseInt(maxPlayers, 10);
      if (isNaN(max) || max < 3 || max > 64) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Le nombre de joueurs doit être entre 3 et 64.' }));
      }
      const organizer = findUserById(organizerId);
      if (!organizer) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Organisateur introuvable.' }));
      }

      let group = null;
      if (groupId) {
        group = groups[groupId];
        if (!group) {
          res.writeHead(404); return res.end(JSON.stringify({ error:'Groupe introuvable.' }));
        }
        if (!group.admins.includes(String(organizerId))) {
          res.writeHead(403); return res.end(JSON.stringify({ error:"Seuls les admins du groupe peuvent y créer un tournoi." }));
        }
      }

      const id = genId();
      const tournament = {
        id, name: name.trim(), gameId, format, maxPlayers: max,
        status: 'open',
        organizerId: organizer.id, organizerName: organizer.username,
        groupId: group?.id || null, groupName: group?.name || null,
        participants: [{ id:organizer.id, username:organizer.username, avatar:organizer.avatar }],
        bracket: null, standings: [], winner: null,
        createdAt: Date.now(), startedAt: null,
      };
      tournaments[id] = tournament;
      persistTournaments();

      if (group) io.to(`group-${group.id}`).emit('tournament-created', { tournament: publicTournament(tournament) });
      else       io.emit('tournament-created', { tournament: publicTournament(tournament) });

      res.writeHead(201);
      return res.end(JSON.stringify({ tournament: publicTournament(tournament) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/tournaments/:id/join
  const tJoinMatch = req.url.match(/^\/api\/tournaments\/([^/]+)\/join$/);
  if (req.method === 'POST' && tJoinMatch) {
    try {
      const { userId } = await parseBody(req);
      const t = tournaments[tJoinMatch[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      if (t.status !== 'open') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Inscriptions fermées.' }));
      }
      if (t.participants.some(p => String(p.id) === String(userId))) {
        res.writeHead(200); return res.end(JSON.stringify({ tournament: publicTournament(t), already:true }));
      }
      if (t.participants.length >= t.maxPlayers) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Tournoi complet.' }));
      }
      if (t.groupId) {
        const group = groups[t.groupId];
        if (!group || !group.members.some(m => String(m.id) === String(userId))) {
          res.writeHead(403); return res.end(JSON.stringify({ error:'Réservé aux membres du groupe.' }));
        }
      }
      const user = findUserById(userId);
      if (!user) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Utilisateur introuvable.' }));
      }
      t.participants.push({ id:user.id, username:user.username, avatar:user.avatar });
      persistTournaments();
      io.emit('tournament-updated', { tournament: publicTournament(t) });
      res.writeHead(200);
      return res.end(JSON.stringify({ tournament: publicTournament(t) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/tournaments/:id/leave
  const tLeaveMatch = req.url.match(/^\/api\/tournaments\/([^/]+)\/leave$/);
  if (req.method === 'POST' && tLeaveMatch) {
    try {
      const { userId } = await parseBody(req);
      const t = tournaments[tLeaveMatch[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      if (t.status !== 'open') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Tournoi déjà lancé.' }));
      }
      t.participants = t.participants.filter(p => String(p.id) !== String(userId));
      persistTournaments();
      io.emit('tournament-updated', { tournament: publicTournament(t) });
      res.writeHead(200);
      return res.end(JSON.stringify({ tournament: publicTournament(t) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/tournaments/:id/start
  const tStartMatch = req.url.match(/^\/api\/tournaments\/([^/]+)\/start$/);
  if (req.method === 'POST' && tStartMatch) {
    try {
      const { userId } = await parseBody(req);
      const t = tournaments[tStartMatch[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      if (String(t.organizerId) !== String(userId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:"Seul l'organisateur peut démarrer." }));
      }
      if (t.status !== 'open') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Déjà lancé.' }));
      }
      if (t.participants.length < 3) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Minimum 3 joueurs.' }));
      }

      t.bracket = t.format === 'elimination'
        ? buildEliminationBracket(t.participants)
        : buildRoundRobinBracket(t.participants);
      t.status = 'running';
      t.startedAt = Date.now();
      persistTournaments();
      io.emit('tournament-updated', { tournament: publicTournament(t) });
      res.writeHead(200);
      return res.end(JSON.stringify({ tournament: publicTournament(t) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // POST /api/tournaments/:id/result
  const tResultMatch = req.url.match(/^\/api\/tournaments\/([^/]+)\/result$/);
  if (req.method === 'POST' && tResultMatch) {
    try {
      const { userId, matchId, winnerId, score1, score2 } = await parseBody(req);
      const t = tournaments[tResultMatch[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      if (t.status !== 'running') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Tournoi pas en cours.' }));
      }

      let match = null;
      if (t.bracket.type === 'elimination') {
        for (const round of t.bracket.rounds) {
          const m = round.find(x => x.id === matchId);
          if (m) { match = m; break; }
        }
      } else {
        match = t.bracket.matches.find(m => m.id === matchId);
      }
      if (!match) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Match introuvable.' }));
      }
      if (match.status === 'done') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Match déjà terminé.' }));
      }
      if (match.status === 'waiting') {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Match pas encore prêt.' }));
      }

      const isPlayer = match.p1 && match.p2 &&
        (String(match.p1.id) === String(userId) || String(match.p2.id) === String(userId));
      const isOrganizer = String(t.organizerId) === String(userId);
      if (!isPlayer && !isOrganizer) {
        res.writeHead(403); return res.end(JSON.stringify({ error:'Action non autorisée.' }));
      }

      let winner = null;
      if (winnerId) {
        if (String(match.p1.id) === String(winnerId))      winner = match.p1;
        else if (String(match.p2.id) === String(winnerId)) winner = match.p2;
      } else if (typeof score1 === 'number' && typeof score2 === 'number') {
        if (score1 > score2)      winner = match.p1;
        else if (score2 > score1) winner = match.p2;
      }
      if (!winner) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Vainqueur indéterminé.' }));
      }

      match.winner = winner;
      match.score1 = typeof score1 === 'number' ? score1 : null;
      match.score2 = typeof score2 === 'number' ? score2 : null;
      match.status = 'done';

      if (t.bracket.type === 'elimination') propagateByes(t.bracket.rounds);
      checkTournamentEnd(t);
      if (t.bracket.type === 'round-robin') t.standings = computeStandings(t);
      persistTournaments();

      io.emit('tournament-updated', { tournament: publicTournament(t) });
      res.writeHead(200);
      return res.end(JSON.stringify({ tournament: publicTournament(t) }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // DELETE /api/tournaments/:id
  const tDelMatch = req.url.match(/^\/api\/tournaments\/([^/]+)$/);
  if (req.method === 'DELETE' && tDelMatch) {
    try {
      const { userId } = await parseBody(req);
      const t = tournaments[tDelMatch[1]];
      if (!t) {
        res.writeHead(404); return res.end(JSON.stringify({ error:'Tournoi introuvable.' }));
      }
      if (String(t.organizerId) !== String(userId)) {
        res.writeHead(403); return res.end(JSON.stringify({ error:"Seul l'organisateur peut supprimer." }));
      }
      delete tournaments[t.id];
      persistTournaments();
      io.emit('tournament-deleted', { id: t.id });
      res.writeHead(200);
      return res.end(JSON.stringify({ deleted:true }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:'Erreur serveur.' })); }
  }

  // ═════════════════ UPLOAD ═════════════════
  if (req.method === 'POST' && req.url === '/api/upload') {
    try {
      const cl = parseInt(req.headers['content-length'] || '0', 10);
      if (cl > MAX_FILE_SIZE + 4096) {
        res.writeHead(413); return res.end(JSON.stringify({ error:'Fichier trop volumineux (max 10 Mo).' }));
      }
      const file = await parseMultipart(req);
      if (!ALLOWED_MIME.includes(file.contentType.toLowerCase())) {
        res.writeHead(400); return res.end(JSON.stringify({ error:'Type de fichier non autorisé.' }));
      }
      if (file.data.length > MAX_FILE_SIZE) {
        res.writeHead(413); return res.end(JSON.stringify({ error:'Fichier trop volumineux.' }));
      }
      const ext = path.extname(file.filename).toLowerCase() ||
        ('.' + (file.contentType.split('/')[1] || 'bin'));
      const safeName = `${genId()}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, safeName), file.data);
      const url = `/uploads/${safeName}`;
      const isVideo = file.contentType.startsWith('video/');
      res.writeHead(201);
      return res.end(JSON.stringify({
        url, type: isVideo ? 'video' : 'image',
        mime: file.contentType, size: file.data.length,
      }));
    } catch { res.writeHead(500); return res.end(JSON.stringify({ error:"Échec de l'upload." })); }
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error:'Route introuvable.' }));
});

// =====================================================
// SOCKET.IO
// =====================================================
const io = new Server(server, { cors: { origin:'*', methods:['GET','POST'] } });

const rooms        = {};
const leaderboard  = {};
const socketToName = {};
const nameToSocket = {};
const socketToUser = {};

// ── UNO state global (par roomCode) ──
const unoRooms = {};

const getPublicRooms = () => Object.entries(rooms)
  .filter(([, r]) => r.isPublic && r.players.length < 2)
  .map(([code, r]) => ({
    code, gameId: r.gameId, gameName: r.gameName, players: r.players.length,
  }));

// ── UNO helpers ──
const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];
const buildUnoDeck = () => {
  const deck = [];
  // 1 zéro par couleur, 2 de 1-9, 2 de chaque action (skip/reverse/+2)
  UNO_COLORS.forEach(c => {
    deck.push({ color: c, value: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color: c, value: String(n) });
      deck.push({ color: c, value: String(n) });
    }
    ['skip', 'reverse', '+2'].forEach(a => {
      deck.push({ color: c, value: a });
      deck.push({ color: c, value: a });
    });
  });
  // 4 wild + 4 wild+4
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: '+4' });
  }
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const initUnoGame = (code, players) => {
  const deck = buildUnoDeck();
  const hands = {};
  players.forEach(p => {
    hands[p.id] = [];
    for (let i = 0; i < 7; i++) hands[p.id].push(deck.pop());
  });
  // Première carte non-spéciale
  let top;
  do {
    top = deck.pop();
    if (top.color === 'wild') { deck.unshift(top); top = null; }
  } while (!top);
  unoRooms[code] = {
    deck,
    discard: [top],
    hands,
    players: players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
    turnIdx: 0,
    direction: 1,
    currentColor: top.color,
    pendingDraw: 0, // pour cumul +2 / +4
    winner: null,
    started: Date.now(),
  };
  return unoRooms[code];
};

const unoStateForPlayer = (code, playerId) => {
  const g = unoRooms[code];
  if (!g) return null;
  return {
    discard: g.discard[g.discard.length - 1],
    currentColor: g.currentColor,
    direction: g.direction,
    deckSize: g.deck.length,
    pendingDraw: g.pendingDraw,
    turnPlayerId: g.players[g.turnIdx]?.id || null,
    myHand: g.hands[playerId] || [],
    players: g.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      handSize: (g.hands[p.id] || []).length,
    })),
    winner: g.winner,
  };
};

const broadcastUnoState = (code) => {
  const g = unoRooms[code];
  if (!g) return;
  g.players.forEach(p => {
    const sid = nameToSocket[p.name];
    if (sid) io.to(sid).emit('uno-state', unoStateForPlayer(code, p.id));
  });
};

const canPlayUno = (card, top, currentColor) => {
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === top.value) return true;
  return false;
};

const advanceUnoTurn = (g, steps = 1) => {
  const n = g.players.length;
  g.turnIdx = ((g.turnIdx + g.direction * steps) % n + n) % n;
};

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('identify', ({ userId, username }) => {
    if (userId)   { socketToUser[socket.id] = String(userId); socket.join(`user-${userId}`); }
    if (username) { socketToName[socket.id] = username; nameToSocket[username] = socket.id; }
  });

  // ─── Groupes ───
  socket.on('group-subscribe',   ({ groupId }) => groupId && socket.join(`group-${groupId}`));
  socket.on('group-unsubscribe', ({ groupId }) => groupId && socket.leave(`group-${groupId}`));

  socket.on('group-message', (data) => {
    const { groupId, userId, username, avatar, text, media } = data;
    const group = groups[groupId];
    if (!group) return;
    const member = group.members.find(m => String(m.id) === String(userId));
    if (!member) return;
    if (group.chatLocked && !group.admins.includes(String(userId))) {
      socket.emit('group-message-error', { groupId, error:'🔒 Le chat est verrouillé.' });
      return;
    }
    const msg = {
      id: genId(),
      userId, username, avatar,
      text: text || '', media: media || null,
      time: new Date().toISOString(),
    };
    if (!group.messages) group.messages = [];
    group.messages.push(msg);
    if (group.messages.length > 500) group.messages = group.messages.slice(-500);
    persistGroups();
    io.to(`group-${groupId}`).emit('group-message', { groupId, message: msg });
  });




  // =======================
  // ─── Direct Messages (DM) ───
  socket.on('dm-send', (data) => {
    const { fromId, toId, fromName, fromAvatar, text } = data;
    if (!text || !fromId || !toId) return;
    
    const convId = [String(fromId), String(toId)].sort().join('_');
    
    const msg = {
      id: genId(),
      from: String(fromId),
      to: String(toId),
      fromName,
      fromAvatar,
      text,
      time: new Date().toISOString(),
    };

    if (!dms[convId]) dms[convId] = [];
    dms[convId].push(msg);
    if (dms[convId].length > 500) dms[convId] = dms[convId].slice(-500);
    persistDms();

    // Renvoie à l'expéditeur pour l'affichage
    socket.emit('dm-message', { message: msg });
    
    // Envoie au destinataire (s'il est connecté)
    io.to(`user-${toId}`).emit('dm-message', { message: msg });
  });





  // ─── Salles de jeu génériques ───
  socket.on('join-game-room', (data) => {
    const code = typeof data === 'string' ? data : data.code;
    const isSpec = data.spectator || false;
    const playerName = data.playerName || 'Joueur';
    const avatar = data.avatar || '';
    const elo = data.elo || 1000;
    socket.join(code);
    socketToName[socket.id]  = playerName;
    nameToSocket[playerName] = socket.id;
    if (!rooms[code]) {
      rooms[code] = {
        players: [], spectators: [],
        gameId: data.gameId || '', gameName: data.gameName || '',
        isPublic: data.isPublic || false,
      };
    }
    if (isSpec) {
      if (!rooms[code].spectators.find(s => s.name === playerName)) {
        rooms[code].spectators.push({ name: playerName, avatar });
      }
      socket.to(code).emit('spectator-joined', { name: playerName, avatar });
    } else {
      if (!rooms[code].players.find(p => p.name === playerName)) {
        rooms[code].players.push({ name: playerName, avatar, elo });
      }
      if (rooms[code].players.length === 1) {
        socket.emit('game-status', { status:'waiting' });
      } else if (rooms[code].players.length === 2) {
        const p2 = rooms[code].players[1];
        io.to(code).emit('game-status', {
          status:'ready', playerName:p2.name, avatar:p2.avatar, elo:p2.elo,
        });
        rooms[code].isPublic = false;
      }
    }
  });

  socket.on('game-action',     d => socket.to(d.roomCode).emit('opponent-action', d));
  socket.on('channel-message', d => socket.broadcast.emit('channel-message', d));
  socket.on('send-invite', d => {
    const sid = nameToSocket[d.to];
    if (sid) io.to(sid).emit('room-invite', {
      from: d.from, roomCode: d.roomCode, gameId: d.gameId, game: d.game,
    });
  });
  socket.on('update-leaderboard', d => {
    leaderboard[d.name] = d;
    const sorted = Object.values(leaderboard).sort((a, b) => b.elo - a.elo).slice(0, 20);
    io.emit('leaderboard-update', { players: sorted });
  });
  socket.on('get-leaderboard', () =>
    socket.emit('leaderboard-update', {
      players: Object.values(leaderboard).sort((a, b) => b.elo - a.elo).slice(0, 20),
    })
  );
  socket.on('list-public-rooms', () =>
    socket.emit('public-rooms-list', { rooms: getPublicRooms() })
  );

  // ─── Voice (WebRTC signaling) ───
  socket.on('join-voice', ({ roomId }) => {
    socket.join(`voice-${roomId}`);
    socket.to(`voice-${roomId}`).emit('user-joined-voice', { socketId: socket.id });
  });
  socket.on('leave-voice', ({ roomId }) => {
    socket.leave(`voice-${roomId}`);
    socket.to(`voice-${roomId}`).emit('user-left-voice', socket.id);
  });
  socket.on('webrtc-offer',  d => io.to(d.to).emit('webrtc-offer',  { from: socket.id, offer: d.offer }));
  socket.on('webrtc-answer', d => io.to(d.to).emit('webrtc-answer', { from: socket.id, answer: d.answer }));
  socket.on('webrtc-ice',    d => io.to(d.to).emit('webrtc-ice',    { from: socket.id, candidate: d.candidate }));

  // ─── SNIPER 1v1 ───
  // socket.on('sniper-state', d => socket.to(d.roomCode).emit('sniper-opponent-state', d));
  // socket.on('sniper-shot',  d => socket.to(d.roomCode).emit('sniper-opponent-shot',  d));
  // socket.on('sniper-hit',   d => socket.to(d.roomCode).emit('sniper-opponent-hit',   d));

  // ═══ UNO ═══
  socket.on('uno-start', ({ roomCode, players }) => {
    if (!players || players.length < 2) return;
    initUnoGame(roomCode, players);
    broadcastUnoState(roomCode);
  });

  socket.on('uno-play', ({ roomCode, playerId, cardIdx, chosenColor }) => {
    const g = unoRooms[roomCode];
    if (!g || g.winner) return;
    const currentPlayer = g.players[g.turnIdx];
    if (String(currentPlayer.id) !== String(playerId)) return;
    const hand = g.hands[playerId];
    const card = hand[cardIdx];
    if (!card) return;
    const top = g.discard[g.discard.length - 1];
    if (g.pendingDraw > 0 && card.value !== '+2' && card.value !== '+4') return;
    if (!canPlayUno(card, top, g.currentColor)) return;

    hand.splice(cardIdx, 1);
    g.discard.push(card);
    g.currentColor = card.color === 'wild' ? (chosenColor || 'red') : card.color;

    if (hand.length === 0) {
      g.winner = { id: playerId, name: currentPlayer.name };
      broadcastUnoState(roomCode);
      io.to(`uno-${roomCode}`).emit('uno-end', { winner: g.winner });
      return;
    }

    if (card.value === '+2')  g.pendingDraw += 2;
    if (card.value === '+4')  g.pendingDraw += 4;
    if (card.value === 'skip')    advanceUnoTurn(g, 2);
    else if (card.value === 'reverse') {
      g.direction *= -1;
      if (g.players.length === 2) advanceUnoTurn(g, 0);
      else                        advanceUnoTurn(g, 1);
    } else {
      advanceUnoTurn(g, 1);
    }

    broadcastUnoState(roomCode);
  });

  socket.on('uno-draw', ({ roomCode, playerId }) => {
    const g = unoRooms[roomCode];
    if (!g || g.winner) return;
    const currentPlayer = g.players[g.turnIdx];
    if (String(currentPlayer.id) !== String(playerId)) return;

    const drawCount = g.pendingDraw > 0 ? g.pendingDraw : 1;
    for (let i = 0; i < drawCount; i++) {
      if (g.deck.length === 0) {
        // recycler la défausse (sauf le top)
        const top = g.discard.pop();
        g.deck = g.discard;
        for (let k = g.deck.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1));
          [g.deck[k], g.deck[j]] = [g.deck[j], g.deck[k]];
        }
        g.discard = [top];
      }
      const card = g.deck.pop();
      if (card) g.hands[playerId].push(card);
    }
    g.pendingDraw = 0;
    advanceUnoTurn(g, 1);
    broadcastUnoState(roomCode);
  });

  socket.on('uno-join-room', ({ roomCode }) => {
    socket.join(`uno-${roomCode}`);
  });

  // ─── Disconnect ───
  socket.on('disconnect', () => {
    const name = socketToName[socket.id];
    if (name) {
      delete nameToSocket[name];
      delete socketToName[socket.id];
      for (const [code, room] of Object.entries(rooms)) {
        room.players    = room.players.filter(p => p.name !== name);
        room.spectators = room.spectators.filter(s => s.name !== name);
        if (!room.players.length && !room.spectators.length) delete rooms[code];
      }
    }
    delete socketToUser[socket.id];
    console.log(`[-] ${socket.id} (${name || '?'})`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 ArenaLink Server → http://localhost:${PORT}`);
  console.log(`   📁 Data : ${DATA_DIR}`);
  console.log(`   👥 ${Object.keys(users).length} users · ${Object.keys(groups).length} groups · ${Object.keys(tournaments).length} tournaments\n`);
});