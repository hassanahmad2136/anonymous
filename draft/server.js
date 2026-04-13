require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve hero assets from the main overlay tool
const mainPublic = path.join(__dirname, '..', 'public');
app.use('/Assets', express.static(path.join(mainPublic, 'Assets')));
app.use('/database', express.static(path.join(mainPublic, 'database')));

const OVERLAY_URL    = process.env.OVERLAY_URL    || 'http://localhost:3000';
const TIMER_DURATION = parseInt(process.env.TIMER_DURATION) || 60;

// ============================================
// PERSISTENT DATABASE (teams, players, casters, sponsors)
// ============================================
const dbPath = path.join(__dirname, 'tournament_db.json');

const defaultDB = { teams: [], players: [], casters: [], sponsors: [] };
// teams: [{ name, logo, wins, losses }]
// players: [{ name, team, role }]
// casters: [{ name }]
// sponsors: [{ name, amount }]

let db = defaultDB;
try {
    if (fs.existsSync(dbPath)) {
        db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (!db.teams) db.teams = [];
        if (!db.players) db.players = [];
        if (!db.casters) db.casters = [];
        if (!db.sponsors) db.sponsors = [];
    }
} catch (e) { db = { ...defaultDB }; }

function saveDB() {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// Auto-learn: extract data from save operations and store in DB
function learnTeam(name, logo) {
    if (!name || name === 'Blue Team' || name === 'Red Team') return;
    const existing = db.teams.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        if (logo && logo !== existing.logo) existing.logo = logo;
    } else {
        db.teams.push({ name, logo: logo || '', wins: 0, losses: 0 });
    }
    saveDB();
}

function learnPlayer(name, team, role) {
    if (!name || name === 'Player' || /^Player \d+$/.test(name)) return;
    const existing = db.players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        if (team) existing.team = team;
        if (role && role !== 'none') existing.role = role;
    } else {
        db.players.push({ name, team: team || '', role: role || '' });
    }
    saveDB();
}

function learnCaster(name) {
    if (!name) return;
    if (!db.casters.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        db.casters.push({ name });
        saveDB();
    }
}

function learnSponsor(name, amount) {
    if (!name) return;
    const existing = db.sponsors.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        if (amount) existing.amount = amount;
    } else {
        db.sponsors.push({ name, amount: amount || '' });
    }
    saveDB();
}

// ============================================
// DRAFT STATE
// ============================================
let draft = {
    status: 'idle', // idle, waiting, live, done
    blueHash: null,
    redHash: null,
    blueReady: false,
    redReady: false,
    blueTeamName: 'Blue Team',
    redTeamName: 'Red Team',
    currentPhase: 0,
    picksInPhase: 0, // for double-pick phases
    timer: TIMER_DURATION,
    timerRunning: false,
    blueside: { pick: ['','','','',''], ban: ['','','','',''] },
    redside: { pick: ['','','','',''], ban: ['','','','',''] },
    selectedHero: { blue: null, red: null } // hero currently highlighted (not locked)
};

let timerInterval = null;

// Phase definitions: side, type, slots to fill
// For double picks, count > 1
const PHASES = [
    { side: 'blue', type: 'ban', target: 'blueside', slot: 'ban', index: 0, count: 1 },
    { side: 'red',  type: 'ban', target: 'redside',  slot: 'ban', index: 0, count: 1 },
    { side: 'blue', type: 'ban', target: 'blueside', slot: 'ban', index: 1, count: 1 },
    { side: 'red',  type: 'ban', target: 'redside',  slot: 'ban', index: 1, count: 1 },
    { side: 'blue', type: 'ban', target: 'blueside', slot: 'ban', index: 2, count: 1 },
    { side: 'red',  type: 'ban', target: 'redside',  slot: 'ban', index: 2, count: 1 },
    { side: 'blue', type: 'pick', target: 'blueside', slot: 'pick', index: 0, count: 1 },
    { side: 'red',  type: 'pick', target: 'redside',  slot: 'pick', index: 0, count: 2 }, // double
    { side: 'blue', type: 'pick', target: 'blueside', slot: 'pick', index: 1, count: 2 }, // double
    { side: 'red',  type: 'pick', target: 'redside',  slot: 'pick', index: 2, count: 1 },
    { side: 'red',  type: 'ban', target: 'redside',  slot: 'ban', index: 3, count: 1 },
    { side: 'blue', type: 'ban', target: 'blueside', slot: 'ban', index: 3, count: 1 },
    { side: 'red',  type: 'ban', target: 'redside',  slot: 'ban', index: 4, count: 1 },
    { side: 'blue', type: 'ban', target: 'blueside', slot: 'ban', index: 4, count: 1 },
    { side: 'red',  type: 'pick', target: 'redside',  slot: 'pick', index: 3, count: 1 },
    { side: 'blue', type: 'pick', target: 'blueside', slot: 'pick', index: 3, count: 2 }, // double
    { side: 'red',  type: 'pick', target: 'redside',  slot: 'pick', index: 4, count: 1 },
    { side: null,   type: 'adjustment', target: null, slot: null, index: 0, count: 0 }
];

function genHash() {
    return crypto.randomBytes(4).toString('hex'); // 8 chars
}

function getAllUsedHeroes() {
    const used = [];
    draft.blueside.pick.forEach(h => { if (h) used.push(h); });
    draft.redside.pick.forEach(h => { if (h) used.push(h); });
    draft.blueside.ban.forEach(h => { if (h) used.push(h); });
    draft.redside.ban.forEach(h => { if (h) used.push(h); });
    return used;
}

function getCurrentPhase() {
    if (draft.currentPhase >= PHASES.length) return null;
    return PHASES[draft.currentPhase];
}

function getActiveSide() {
    const phase = getCurrentPhase();
    return phase ? phase.side : null;
}

// ============================================
// SYNC TO OVERLAY (port 3000)
// ============================================
async function syncToOverlay() {
    const overlayData = {
        draftdata: {
            timer: String(draft.timer),
            timer_running: draft.timerRunning,
            current_phase: draft.currentPhase,
            blueside: {
                ban: draft.blueside.ban.map(h => ({ hero: h || '' })),
                pick: draft.blueside.pick.map(h => ({ hero: h || '' }))
            },
            redside: {
                ban: draft.redside.ban.map(h => ({ hero: h || '' })),
                pick: draft.redside.pick.map(h => ({ hero: h || '' }))
            }
        }
    };

    try {
        await fetch(`${OVERLAY_URL}/api/matchdraft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(overlayData)
        });
    } catch (e) {
        console.error('Failed to sync to overlay:', e.message);
    }
}

// ============================================
// BROADCAST TO ALL DRAFT CLIENTS
// ============================================
function broadcastState() {
    const state = getDraftState();
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'state', data: state }));
        }
    });
}

function getDraftState() {
    const phase = getCurrentPhase();
    return {
        status: draft.status,
        blueReady: draft.blueReady,
        redReady: draft.redReady,
        blueTeamName: draft.blueTeamName,
        redTeamName: draft.redTeamName,
        currentPhase: draft.currentPhase,
        phaseInfo: phase,
        activeSide: getActiveSide(),
        timer: draft.timer,
        timerRunning: draft.timerRunning,
        blueside: draft.blueside,
        redside: draft.redside,
        usedHeroes: getAllUsedHeroes(),
        selectedHero: draft.selectedHero,
        picksInPhase: draft.picksInPhase
    };
}

// ============================================
// TIMER
// ============================================
function startTimer() {
    stopTimer();
    draft.timer = TIMER_DURATION;
    draft.timerRunning = true;
    timerInterval = setInterval(() => {
        draft.timer--;
        broadcastState();
        syncToOverlay();

        if (draft.timer <= 0) {
            // Auto-lock: if a hero is selected, lock it. Otherwise skip.
            const side = getActiveSide();
            if (side && draft.selectedHero[side]) {
                lockHero(side, draft.selectedHero[side]);
            } else {
                // Time ran out with no selection — advance anyway
                advancePhase();
            }
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    draft.timerRunning = false;
}

// ============================================
// DRAFT LOGIC
// ============================================
function lockHero(side, heroImg) {
    const phase = getCurrentPhase();
    if (!phase || phase.side !== side) return;
    if (getAllUsedHeroes().includes(heroImg)) return;

    // Place the hero
    const slotIndex = phase.index + draft.picksInPhase;
    draft[phase.target][phase.slot][slotIndex] = heroImg;
    draft.selectedHero[side] = null;

    draft.picksInPhase++;

    broadcastState();
    syncToOverlay();

    // Check if this phase is complete
    if (draft.picksInPhase >= phase.count) {
        advancePhase();
    } else {
        // Reset timer for next pick in double-pick phase
        draft.timer = TIMER_DURATION;
    }
}

function advancePhase() {
    stopTimer();
    draft.picksInPhase = 0;
    draft.currentPhase++;
    draft.selectedHero = { blue: null, red: null };

    if (draft.currentPhase >= PHASES.length) {
        draft.status = 'done';
        broadcastState();
        syncToOverlay();
        return;
    }

    const nextPhase = getCurrentPhase();
    if (nextPhase.type === 'adjustment') {
        draft.status = 'done';
        broadcastState();
        syncToOverlay();
        return;
    }

    startTimer();
    broadcastState();
    syncToOverlay();
}

function resetDraft() {
    stopTimer();
    draft.status = 'idle';
    draft.blueReady = false;
    draft.redReady = false;
    draft.currentPhase = 0;
    draft.picksInPhase = 0;
    draft.timer = TIMER_DURATION;
    draft.timerRunning = false;
    draft.blueside = { pick: ['','','','',''], ban: ['','','','',''] };
    draft.redside = { pick: ['','','','',''], ban: ['','','','',''] };
    draft.selectedHero = { blue: null, red: null };
    broadcastState();
    syncToOverlay();
}

function checkBothReady() {
    if (draft.blueReady && draft.redReady && draft.status === 'waiting') {
        draft.status = 'live';
        startTimer();
        broadcastState();
        syncToOverlay();
    }
}

// ============================================
// API ROUTES
// ============================================

// Admin: generate new draft links
app.post('/api/draft/generate', (req, res) => {
    resetDraft();
    draft.blueHash = genHash();
    draft.redHash = genHash();
    draft.blueTeamName = req.body.blueTeamName || 'Blue Team';
    draft.redTeamName = req.body.redTeamName || 'Red Team';
    draft.status = 'waiting';
    broadcastState();
    res.json({
        blueHash: draft.blueHash,
        redHash: draft.redHash,
        blueUrl: `/draft/${draft.blueHash}`,
        redUrl: `/draft/${draft.redHash}`
    });
});

// Admin: get state
app.get('/api/draft/state', (req, res) => {
    res.json(getDraftState());
});

// Admin: reset
app.post('/api/draft/reset', (req, res) => {
    resetDraft();
    res.json({ message: 'Draft reset' });
});

// Admin: force advance phase
app.post('/api/draft/advance', (req, res) => {
    advancePhase();
    res.json({ message: 'Phase advanced' });
});

// Admin: pause/resume timer
app.post('/api/draft/pause', (req, res) => {
    if (draft.timerRunning) {
        stopTimer();
    } else if (draft.status === 'live') {
        draft.timerRunning = true;
        timerInterval = setInterval(() => {
            draft.timer--;
            broadcastState();
            syncToOverlay();
            if (draft.timer <= 0) {
                const side = getActiveSide();
                if (side && draft.selectedHero[side]) {
                    lockHero(side, draft.selectedHero[side]);
                } else {
                    advancePhase();
                }
            }
        }, 1000);
    }
    broadcastState();
    syncToOverlay();
    res.json({ paused: !draft.timerRunning });
});

// Captain: validate hash and get side
app.get('/api/draft/validate/:hash', (req, res) => {
    const hash = req.params.hash;
    if (hash === draft.blueHash) {
        res.json({ valid: true, side: 'blue', teamName: draft.blueTeamName });
    } else if (hash === draft.redHash) {
        res.json({ valid: true, side: 'red', teamName: draft.redTeamName });
    } else {
        res.json({ valid: false });
    }
});

// Captain: ready up
app.post('/api/draft/ready/:hash', (req, res) => {
    if (req.params.hash === draft.blueHash) {
        draft.blueReady = true;
    } else if (req.params.hash === draft.redHash) {
        draft.redReady = true;
    } else {
        return res.status(403).json({ error: 'Invalid hash' });
    }
    broadcastState();
    checkBothReady();
    res.json({ message: 'Ready' });
});

// Captain: select hero (highlight, not lock)
app.post('/api/draft/select/:hash', (req, res) => {
    const hero = req.body.hero;
    let side = null;
    if (req.params.hash === draft.blueHash) side = 'blue';
    else if (req.params.hash === draft.redHash) side = 'red';
    else return res.status(403).json({ error: 'Invalid hash' });

    if (draft.status !== 'live') return res.status(400).json({ error: 'Draft not live' });
    if (getActiveSide() !== side) return res.status(400).json({ error: 'Not your turn' });
    if (getAllUsedHeroes().includes(hero)) return res.status(400).json({ error: 'Hero already used' });

    draft.selectedHero[side] = hero;
    broadcastState();
    res.json({ message: 'Hero selected' });
});

// Captain: lock in hero
app.post('/api/draft/lock/:hash', (req, res) => {
    const hero = req.body.hero;
    let side = null;
    if (req.params.hash === draft.blueHash) side = 'blue';
    else if (req.params.hash === draft.redHash) side = 'red';
    else return res.status(403).json({ error: 'Invalid hash' });

    if (draft.status !== 'live') return res.status(400).json({ error: 'Draft not live' });
    if (getActiveSide() !== side) return res.status(400).json({ error: 'Not your turn' });
    if (getAllUsedHeroes().includes(hero)) return res.status(400).json({ error: 'Hero already used' });

    lockHero(side, hero);
    res.json({ message: 'Hero locked' });
});

// Proxy matchdata GET/POST so remote admin (ngrok) can reach port 3000
app.get('/api/matchdata', async (req, res) => {
    try {
        const r = await fetch(`${OVERLAY_URL}/api/matchdata`);
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});

app.post('/api/matchdata', async (req, res) => {
    try {
        // Auto-learn teams and players from matchdata saves
        const td = req.body?.teamdata;
        if (td) {
            if (td.blueteam) {
                learnTeam(td.blueteam.teamname, td.blueteam.logo);
                (td.blueteam.playerlist || []).forEach(p => {
                    if (p.name) learnPlayer(p.name, td.blueteam.teamname, '');
                });
            }
            if (td.redteam) {
                learnTeam(td.redteam.teamname, td.redteam.logo);
                (td.redteam.playerlist || []).forEach(p => {
                    if (p.name) learnPlayer(p.name, td.redteam.teamname, '');
                });
            }
        }

        const r = await fetch(`${OVERLAY_URL}/api/matchdata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});

app.get('/api/matchdraft', async (req, res) => {
    try {
        const r = await fetch(`${OVERLAY_URL}/api/matchdraft`);
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});

app.post('/api/matchdraft', async (req, res) => {
    try {
        const r = await fetch(`${OVERLAY_URL}/api/matchdraft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});

// Proxy MVP API
app.get('/api/mvp', async (req, res) => {
    try {
        const r = await fetch(`${OVERLAY_URL}/api/mvp`);
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});
app.post('/api/mvp', async (req, res) => {
    try {
        const r = await fetch(`${OVERLAY_URL}/api/mvp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(502).json({ error: 'Cannot reach overlay server' });
    }
});

// Proxy draftbgdata and previousdraft for remote admin
['draftbgdata', 'previousdraft'].forEach(endpoint => {
    app.get(`/api/${endpoint}`, async (req, res) => {
        try {
            const r = await fetch(`${OVERLAY_URL}/api/${endpoint}`);
            const data = await r.json();
            res.json(data);
        } catch (e) {
            res.status(502).json({ error: 'Cannot reach overlay server' });
        }
    });
    app.post(`/api/${endpoint}`, async (req, res) => {
        try {
            // Auto-learn from draftbgdata saves
            if (endpoint === 'draftbgdata') {
                (req.body.casters || []).forEach(c => learnCaster(c));
                (req.body.sponsors || []).forEach(s => learnSponsor(s.name, s.amount));
                (req.body.groups || []).forEach(g => {
                    (g.teams || []).forEach(t => { if (t.name) learnTeam(t.name, ''); });
                });
                ['bluePlayers', 'redPlayers'].forEach(key => {
                    (req.body[key] || []).forEach(p => { if (p.name) learnPlayer(p.name, '', ''); });
                });
            }

            const r = await fetch(`${OVERLAY_URL}/api/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await r.json();
            res.json(data);
        } catch (e) {
            res.status(502).json({ error: 'Cannot reach overlay server' });
        }
    });
});

// ============================================
// TOURNAMENT DATABASE API
// ============================================

// Search endpoints (used for autocomplete)
app.get('/api/db/search', (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const type = req.query.type; // teams, players, casters, sponsors
    if (!type || !db[type]) return res.json([]);
    if (!q) return res.json(db[type].slice(0, 20));
    const results = db[type].filter(item => {
        const name = item.name || '';
        return name.toLowerCase().includes(q);
    });
    res.json(results.slice(0, 20));
});

// Get all data for a type
app.get('/api/db/:type', (req, res) => {
    const type = req.params.type;
    if (!db[type]) return res.status(400).json({ error: 'Invalid type' });
    res.json(db[type]);
});

// Add/update entry
app.post('/api/db/:type', (req, res) => {
    const type = req.params.type;
    if (!db[type]) return res.status(400).json({ error: 'Invalid type' });
    const entry = req.body;
    if (!entry.name) return res.status(400).json({ error: 'Name required' });

    const existing = db[type].find(e => e.name.toLowerCase() === entry.name.toLowerCase());
    if (existing) {
        Object.assign(existing, entry);
    } else {
        db[type].push(entry);
    }
    saveDB();
    res.json({ ok: true, data: db[type] });
});

// Delete entry
app.delete('/api/db/:type/:name', (req, res) => {
    const type = req.params.type;
    const name = decodeURIComponent(req.params.name).toLowerCase();
    if (!db[type]) return res.status(400).json({ error: 'Invalid type' });
    db[type] = db[type].filter(e => e.name.toLowerCase() !== name);
    saveDB();
    res.json({ ok: true, data: db[type] });
});

// Get full DB dump
app.get('/api/db', (req, res) => {
    res.json(db);
});

// Get players by team
app.get('/api/db/team-players/:teamName', (req, res) => {
    const teamName = decodeURIComponent(req.params.teamName).toLowerCase();
    const players = db.players.filter(p => p.team && p.team.toLowerCase() === teamName);
    res.json(players);
});

// Serve captain page for hash URLs
app.get('/draft/:hash', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'captain.html'));
});

// ============================================
// WEBSOCKET
// ============================================
wss.on('connection', ws => {
    // Send current state on connect
    ws.send(JSON.stringify({ type: 'state', data: getDraftState() }));
});

// Heartbeat
const wsInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on('close', () => clearInterval(wsInterval));

// ============================================
// START
// ============================================
const PORT = parseInt(process.env.DRAFT_PORT) || 3001;
server.listen(PORT, () => {
    console.log('=============================================');
    console.log(' DRAFT SERVER STARTED (anonymous v4.8)');
    console.log(` Local:   http://localhost:${PORT}`);
    console.log(` Admin:   http://localhost:${PORT}/admin.html`);
    console.log(` Overlay: ${OVERLAY_URL}`);
    console.log('=============================================');
});
