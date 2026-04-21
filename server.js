// server.js - Unified Server (Overlay + Draft + Admin)
// Single service for Railway/Render deployment

require('dotenv').config();

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Health check for Railway/Render
app.get('/health', (req, res) => res.json({ status: 'ok', version: '4.8.0' }));
// Root redirect → admin panel
app.get('/', (req, res) => res.redirect('/admin.html'));

// Heavy assets — cache for 7 days (hero images, fonts, sounds)
app.use('/Assets', express.static(path.join(__dirname, 'public/Assets'), { maxAge: '7d', etag: true }));
app.use('/database/herolist.json', express.static(path.join(__dirname, 'public/database/herolist.json'), { maxAge: '1d' }));
// Serve user-uploaded files from persistent volume
app.use('/Assets/costum/Theme', express.static(unifiedDir));
app.use('/Assets/nationalflag', express.static(flagDir));

// Serve draft public files first (admin.html, captain.html)
app.use(express.static(path.join(__dirname, 'draft/public')));
// Then main overlay public files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// WRITE QUEUE — prevents race conditions on file writes
// ============================================================
class AsyncQueue {
    constructor() { this.queue = Promise.resolve(); }
    enqueue(task) {
        this.queue = this.queue.then(task).catch(err => console.error('Queue Error:', err));
        return this.queue;
    }
}
const fileQueue = new AsyncQueue();

// ============================================================
// PATHS & FOLDERS
// ============================================================
// Use /data (Railway persistent volume) when available, otherwise fall back to __dirname
const DATA_ROOT    = fsSync.existsSync('/data') ? '/data' : __dirname;

const dbDir        = path.join(DATA_ROOT, 'database');
const savedMatchDir= path.join(dbDir, 'savedmatch');
const unifiedDir   = path.join(DATA_ROOT, 'theme');
const flagDir      = path.join(DATA_ROOT, 'nationalflag');
const draftDbPath  = path.join(DATA_ROOT, 'tournament_db.json');

[dbDir, savedMatchDir, unifiedDir, flagDir].forEach(d => {
    if (!fsSync.existsSync(d)) fsSync.mkdirSync(d, { recursive: true });
});

const matchDataPath     = path.join(dbDir, 'matchdatateam.json');
const draftDataPath     = path.join(dbDir, 'matchdraft.json');
const prevDraftPath     = path.join(dbDir, 'previousmatchdraft.json');
const mapDrawPath       = path.join(dbDir, 'mapdraw.json');
const mvpDataPath       = path.join(dbDir, 'mvpdata.json');
const notifPath         = path.join(dbDir, 'notification.json');
const schedulePath      = path.join(dbDir, 'schedule.json');
const itemsPath         = path.join(dbDir, 'items.json');
const flagJsonPath      = path.join(dbDir, 'flags.json');
const tableSchedulePath = path.join(dbDir, 'tableschedule.json');
const themePath         = path.join(unifiedDir, 'theme.json');
const draftBgDataPath   = path.join(dbDir, 'draftbgdata.json');

// ============================================================
// MULTER UPLOAD CONFIG
// ============================================================
const uploadUnified = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, unifiedDir),
    filename:    (req, file, cb) => cb(null, file.originalname)
})});

const uploadFlag = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, flagDir),
    filename:    (req, file, cb) => cb(null, file.originalname)
})});

// ============================================================
// DEFAULT DATA
// ============================================================
const defaultMatchData = {
    game_duration: "00:00", game_number: 0, winmatches: "none",
    teamdata: {
        blueteam: { teamname: "BLUE TEAM", score: "0", logo: "", totalgold: 0, turret: 0, lord: 0, turtle: 0,
            playerlist: Array(5).fill(null).map(() => ({ name:"Player", hero:"", level:0, KDA:"0/0/0", gold:0, spell:"idle", banhero:"", itemlist:["idle","idle","idle","idle","idle","idle"] })) },
        redteam:  { teamname: "RED TEAM",  score: "0", logo: "", totalgold: 0, turret: 0, lord: 0, turtle: 0,
            playerlist: Array(5).fill(null).map(() => ({ name:"Player", hero:"", level:0, KDA:"0/0/0", gold:0, spell:"idle", banhero:"", itemlist:["idle","idle","idle","idle","idle","idle"] })) }
    }
};

const defaultTheme = {
    fontFile: "Renegade Pursuit.otf", useCustomFont: false, fontSizeMultiplier: 1.0,
    images: { heroPickBg: "", lowerBg: "", lowerMidBg: "" },
    colors: { bluePrimary:"#00d2ff", blueDark:"#003e4d", redPrimary:"#ff2a2a", redDark:"#4d0000", scoreBlue:"#00d2ff", scoreRed:"#ff2a2a", upperBg:"#000000", lowerBg:"#0a0a0a", lowerMidBg:"#111111", heroPickBg:"#1e1e1e", logoTeamBg:"#000000", postDraftBg:"#1a1a1a", playerNameBg:"#000000", laneLogoBg:"rgba(0,0,0,0.8)", timerBlue:"#00d2ff", timerMid:"#ffffff", timerRed:"#ff2a2a", playerName:"#ffffff", phaseText:"#ffffff", laneIconType:"white", laneLogoBorder:"#ffffff", auraBan:"#ff0000", auraPick:"#ffffff", globalBorder:"rgba(255,255,255,0.2)" },
    gradients: { upperBg:{enabled:false,colorB:"#333333",angle:90}, lowerBg:{enabled:false,colorB:"#333333",angle:90}, lowerMidBg:{enabled:false,colorB:"#333333",angle:90}, heroPickBg:{enabled:false,colorB:"#333333",angle:90}, logoTeamBg:{enabled:false,colorB:"#333333",angle:90}, sbBgTeamName:{enabled:false,colorB:"#333333",angle:90}, sbBgLogo:{enabled:false,colorB:"#333333",angle:90}, sbBgScore:{enabled:false,colorB:"#333333",angle:90}, sbBgCombined:{enabled:false,colorB:"#333333",angle:90}, sbBgBox1:{enabled:false,colorB:"#333333",angle:90}, sbBgSecondary:{enabled:false,colorB:"#333333",angle:90} },
    scoreboard: { teamNameBlue:"#00d2ff", teamNameRed:"#ff2a2a", bgTeamName:"#1e1e1e", bgLogo:"#000000", bgScore:"#000000", bgCombined:"#0a0a0a", bgBox1:"#1e1e1e", bgSecondary:"#1e1e1e", borderBottom:"rgba(255,255,255,0.2)", activeFlag:"indonesia.png", disableGlow:false, disableShadow:false },
    opacity: { upper:100, lower:100, heroPick:100, logoTeam:60, postDraft:100 },
    toggles: { hideLaneLogo:false, disableGlow:false, hidePattern:false, hidePostDraftBg:false, disableBoxShadow:false },
    animations: { banType:"pulse", pickType:"pulse", heroAnim:"fade" }
};

const defaultDraftBgData = {
    casters: ["Caster 1","Caster 2"],
    sponsors: [{ name:"Sponsor 1", amount:"" }],
    groups: [{ name:"Group A", teams: [{ name:"Team 1",wins:0,losses:0,points:0 },{ name:"Team 2",wins:0,losses:0,points:0 }] }],
    activeGroup: 0,
    bluePlayers: Array(5).fill(null).map((_,i) => ({ name:`Player ${i+1}`, hero1:"", hero2:"" })),
    redPlayers:  Array(5).fill(null).map((_,i) => ({ name:`Player ${i+1}`, hero1:"", hero2:"" }))
};

const defaultDraftData = {
    draftdata: {
        timer:"60", timer_running:false, current_phase:0,
        blueside: { ban:[{},{},{},{},{}], pick:[{},{},{},{},{}] },
        redside:  { ban:[{},{},{},{},{}], pick:[{},{},{},{},{}] }
    }
};

// Init files
const initFiles = [
    [matchDataPath,     defaultMatchData],
    [draftDataPath,     defaultDraftData],
    [prevDraftPath,     defaultDraftData],
    [themePath,         defaultTheme],
    [mapDrawPath,       { drawdata:{ status:"idle" } }],
    [mvpDataPath,       { mvp:null }],
    [schedulePath,      {}],
    [notifPath,         {}],
    [tableSchedulePath, { title:"MATCH SCHEDULE", colors:{}, matches:[] }],
    [draftBgDataPath,   defaultDraftBgData],
];
initFiles.forEach(([p, d]) => { if (!fsSync.existsSync(p)) fsSync.writeFileSync(p, JSON.stringify(d, null, 2)); });

if (!fsSync.existsSync(itemsPath)) {
    fsSync.writeFileSync(itemsPath, JSON.stringify(["winter_truncheon","immortality","athena_shield","blade_armor","antique_cuirass","oracle","radiant_armor","twilight_armor","guardian_helmet","sky_guardian_helmet","thunder_belt","cursed_helmet"], null, 2));
}

// ============================================================
// IN-MEMORY CACHE
// ============================================================
let cache = {
    matchdata:    defaultMatchData,
    matchdraft:   defaultDraftData,
    theme:        defaultTheme,
    mapdraw:      { drawdata:{ status:"idle" } },
    mvp:          { mvp:null },
    schedule:     {},
    tableschedule:{ title:"MATCH SCHEDULE", colors:{}, matches:[] },
    draftbgdata:  defaultDraftBgData
};

async function loadCache() {
    const loads = [
        [matchDataPath, 'matchdata'], [draftDataPath, 'matchdraft'],
        [themePath, 'theme'], [mapDrawPath, 'mapdraw'], [mvpDataPath, 'mvp'],
        [schedulePath, 'schedule'], [tableSchedulePath, 'tableschedule'], [draftBgDataPath, 'draftbgdata']
    ];
    for (const [p, k] of loads) {
        try { cache[k] = JSON.parse(await fs.readFile(p, 'utf8')); } catch(e) {}
    }
    console.log('>> Cache loaded');
}
loadCache();

// ============================================================
// TOURNAMENT DB (for draft autocomplete)
// ============================================================
let db = { teams:[], players:[], casters:[], sponsors:[] };
try {
    if (fsSync.existsSync(draftDbPath)) {
        const parsed = JSON.parse(fsSync.readFileSync(draftDbPath, 'utf8'));
        db = { teams:parsed.teams||[], players:parsed.players||[], casters:parsed.casters||[], sponsors:parsed.sponsors||[] };
    }
} catch(e) {}

function saveDB() { fileQueue.enqueue(() => fs.writeFile(draftDbPath, JSON.stringify(db, null, 2))); }
function learnTeam(name, logo)    { if (!name||name==='Blue Team'||name==='Red Team') return; const e=db.teams.find(t=>t.name.toLowerCase()===name.toLowerCase()); if(e){if(logo&&logo!==e.logo)e.logo=logo;}else db.teams.push({name,logo:logo||'',wins:0,losses:0}); saveDB(); }
function learnPlayer(name,team,role){ if(!name||name==='Player'||/^Player \d+$/.test(name)) return; const e=db.players.find(p=>p.name.toLowerCase()===name.toLowerCase()); if(e){if(team)e.team=team;if(role&&role!=='none')e.role=role;}else db.players.push({name,team:team||'',role:role||''}); saveDB(); }
function learnCaster(name)  { if(!name) return; if(!db.casters.find(c=>c.name.toLowerCase()===name.toLowerCase())){db.casters.push({name});saveDB();} }
function learnSponsor(name,amount){ if(!name) return; const e=db.sponsors.find(s=>s.name.toLowerCase()===name.toLowerCase()); if(e){if(amount)e.amount=amount;}else db.sponsors.push({name,amount:amount||''}); saveDB(); }

// ============================================================
// DRAFT STATE
// ============================================================
const TIMER_DURATION = parseInt(process.env.TIMER_DURATION) || 60;

let draft = {
    status: 'idle',
    blueHash: null, redHash: null,
    blueReady: false, redReady: false,
    blueTeamName: 'Blue Team', redTeamName: 'Red Team',
    currentPhase: 0, picksInPhase: 0,
    timer: TIMER_DURATION, timerRunning: false,
    blueside: { pick:['','','','',''], ban:['','','','',''] },
    redside:  { pick:['','','','',''], ban:['','','','',''] },
    selectedHero: { blue:null, red:null }
};

let timerInterval = null;

const PHASES = [
    { side:'blue', type:'ban',  target:'blueside', slot:'ban',  index:0, count:1 },
    { side:'red',  type:'ban',  target:'redside',  slot:'ban',  index:0, count:1 },
    { side:'blue', type:'ban',  target:'blueside', slot:'ban',  index:1, count:1 },
    { side:'red',  type:'ban',  target:'redside',  slot:'ban',  index:1, count:1 },
    { side:'blue', type:'ban',  target:'blueside', slot:'ban',  index:2, count:1 },
    { side:'red',  type:'ban',  target:'redside',  slot:'ban',  index:2, count:1 },
    { side:'blue', type:'pick', target:'blueside', slot:'pick', index:0, count:1 },
    { side:'red',  type:'pick', target:'redside',  slot:'pick', index:0, count:2 },
    { side:'blue', type:'pick', target:'blueside', slot:'pick', index:1, count:2 },
    { side:'red',  type:'pick', target:'redside',  slot:'pick', index:2, count:1 },
    { side:'red',  type:'ban',  target:'redside',  slot:'ban',  index:3, count:1 },
    { side:'blue', type:'ban',  target:'blueside', slot:'ban',  index:3, count:1 },
    { side:'red',  type:'ban',  target:'redside',  slot:'ban',  index:4, count:1 },
    { side:'blue', type:'ban',  target:'blueside', slot:'ban',  index:4, count:1 },
    { side:'red',  type:'pick', target:'redside',  slot:'pick', index:3, count:1 },
    { side:'blue', type:'pick', target:'blueside', slot:'pick', index:3, count:2 },
    { side:'red',  type:'pick', target:'redside',  slot:'pick', index:4, count:1 },
    { side:null,   type:'adjustment', target:null, slot:null,   index:0, count:0 }
];

function genHash()          { return crypto.randomBytes(4).toString('hex'); }
function getCurrentPhase()  { return draft.currentPhase < PHASES.length ? PHASES[draft.currentPhase] : null; }
function getActiveSide()    { const p=getCurrentPhase(); return p?p.side:null; }
function getAllUsedHeroes()  {
    return [
        ...draft.blueside.pick, ...draft.redside.pick,
        ...draft.blueside.ban,  ...draft.redside.ban
    ].filter(Boolean);
}

// ============================================================
// WEBSOCKET BROADCAST
// ============================================================
function heartbeat() { this.isAlive = true; }

wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    // Send current draft state on connect
    ws.send(JSON.stringify({ type:'state', data:getDraftState() }));

    ws.on('message', message => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'update') {
                wss.clients.forEach(c => {
                    if (c !== ws && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg));
                });
            }
        } catch(e) {}
    });
});

const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on('close', () => clearInterval(pingInterval));

function broadcast(data) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data));
    });
}

// ============================================================
// DRAFT → OVERLAY SYNC (in-memory, no HTTP)
// ============================================================
function syncDraftToOverlay() {
    const overlayData = {
        draftdata: {
            timer: String(draft.timer),
            timer_running: draft.timerRunning,
            current_phase: draft.currentPhase,
            selected_hero: draft.selectedHero,
            blueside: {
                ban:  draft.blueside.ban.map(h  => ({ hero: h||'' })),
                pick: draft.blueside.pick.map(h => ({ hero: h||'' }))
            },
            redside: {
                ban:  draft.redside.ban.map(h  => ({ hero: h||'' })),
                pick: draft.redside.pick.map(h => ({ hero: h||'' }))
            }
        }
    };
    cache.matchdraft = overlayData;
    fileQueue.enqueue(() => fs.writeFile(draftDataPath, JSON.stringify(overlayData, null, 2)));
    broadcast({ type:'draftdata_update', data: overlayData.draftdata });
}

// ============================================================
// DRAFT LOGIC
// ============================================================
function getDraftState() {
    return {
        status: draft.status,
        blueReady: draft.blueReady, redReady: draft.redReady,
        blueTeamName: draft.blueTeamName, redTeamName: draft.redTeamName,
        currentPhase: draft.currentPhase,
        phaseInfo: getCurrentPhase(),
        activeSide: getActiveSide(),
        timer: draft.timer, timerRunning: draft.timerRunning,
        blueside: draft.blueside, redside: draft.redside,
        usedHeroes: getAllUsedHeroes(),
        selectedHero: draft.selectedHero,
        picksInPhase: draft.picksInPhase
    };
}

function broadcastDraftState() {
    broadcast({ type:'state', data:getDraftState() });
}

function startTimer() {
    stopTimer();
    draft.timer = TIMER_DURATION;
    draft.timerRunning = true;
    timerInterval = setInterval(() => {
        draft.timer--;
        broadcastDraftState();
        syncDraftToOverlay();
        if (draft.timer <= 0) {
            const side = getActiveSide();
            if (side && draft.selectedHero[side]) lockHero(side, draft.selectedHero[side]);
            else advancePhase();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    draft.timerRunning = false;
}

function lockHero(side, heroImg) {
    const phase = getCurrentPhase();
    if (!phase || phase.side !== side) return;
    if (getAllUsedHeroes().includes(heroImg)) return;
    const slotIndex = phase.index + draft.picksInPhase;
    draft[phase.target][phase.slot][slotIndex] = heroImg;
    draft.selectedHero[side] = null;
    draft.picksInPhase++;
    broadcastDraftState();
    syncDraftToOverlay();
    if (draft.picksInPhase >= phase.count) {
        advancePhase();
    } else {
        // Double-pick: timer continues from where it is.
        // Give at least 8 seconds for the second pick if time is almost gone.
        if (draft.timer < 8) draft.timer = 8;
        broadcastDraftState();
        syncDraftToOverlay();
    }
}

function advancePhase() {
    stopTimer();
    draft.picksInPhase = 0;
    draft.currentPhase++;
    draft.selectedHero = { blue:null, red:null };
    if (draft.currentPhase >= PHASES.length || getCurrentPhase().type === 'adjustment') {
        draft.status = 'done';
        broadcastDraftState();
        syncDraftToOverlay();
        return;
    }
    startTimer();
    broadcastDraftState();
    syncDraftToOverlay();
}

function resetDraft() {
    stopTimer();
    draft.status = 'idle'; draft.blueReady = false; draft.redReady = false;
    draft.currentPhase = 0; draft.picksInPhase = 0;
    draft.timer = TIMER_DURATION; draft.timerRunning = false;
    draft.blueside = { pick:['','','','',''], ban:['','','','',''] };
    draft.redside  = { pick:['','','','',''], ban:['','','','',''] };
    draft.selectedHero = { blue:null, red:null };
    broadcastDraftState();
    syncDraftToOverlay();
}

function checkBothReady() {
    if (draft.blueReady && draft.redReady && draft.status === 'waiting') {
        draft.status = 'live';
        startTimer();
        broadcastDraftState();
        syncDraftToOverlay();
    }
}

// ============================================================
// API — OVERLAY (match data, draft, theme, mvp etc.)
// ============================================================
app.get('/api/matchdata', (req, res) => res.json(cache.matchdata));
app.post('/api/matchdata', (req, res) => {
    try {
        cache.matchdata = req.body;
        // Auto-learn teams/players
        const td = req.body?.teamdata;
        if (td) {
            if (td.blueteam) { learnTeam(td.blueteam.teamname, td.blueteam.logo); (td.blueteam.playerlist||[]).forEach(p=>learnPlayer(p.name,td.blueteam.teamname,'')); }
            if (td.redteam)  { learnTeam(td.redteam.teamname,  td.redteam.logo);  (td.redteam.playerlist||[]).forEach(p=>learnPlayer(p.name,td.redteam.teamname,'')); }
        }
        broadcast({ type:'matchdata_update', data:cache.matchdata });
        broadcast({ type:'update', data:{ matchdata:cache.matchdata } });
        fileQueue.enqueue(() => fs.writeFile(matchDataPath, JSON.stringify(cache.matchdata, null, 2)));
        res.json({ message:'Match data saved' });
    } catch(e) { res.status(500).json({ message:'Error saving match data' }); }
});

app.get('/api/matchdraft', (req, res) => res.json(cache.matchdraft));
app.post('/api/matchdraft', (req, res) => {
    try {
        cache.matchdraft = req.body;
        broadcast({ type:'draftdata_update', data:cache.matchdraft.draftdata });
        fileQueue.enqueue(() => fs.writeFile(draftDataPath, JSON.stringify(cache.matchdraft, null, 2)));
        res.json({ message:'Draft data saved' });
    } catch(e) { res.status(500).json({ message:'Error saving draft' }); }
});

app.get('/api/theme', (req, res) => res.json(cache.theme));
app.post('/api/theme', (req, res) => {
    try { cache.theme=req.body; broadcast({type:'theme_update',data:cache.theme}); fileQueue.enqueue(()=>fs.writeFile(themePath,JSON.stringify(cache.theme,null,2))); res.json({message:'Theme saved'}); }
    catch(e) { res.status(500).json({message:'Error'}); }
});
app.post('/api/theme-reset', (req, res) => {
    try { cache.theme=defaultTheme; broadcast({type:'theme_update',data:cache.theme}); fileQueue.enqueue(()=>fs.writeFile(themePath,JSON.stringify(cache.theme,null,2))); res.json({message:'Reset',theme:cache.theme}); }
    catch(e) { res.status(500).json({message:'Error'}); }
});

app.post('/api/upload-asset', uploadUnified.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({message:'No file'});
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!cache.theme.images) cache.theme.images = {};
    if (req.body.targetField==='font' && (ext==='.ttf'||ext==='.otf')) { cache.theme.fontFile=req.file.originalname; cache.theme.useCustomFont=true; }
    else if (['.png','.jpg','.jpeg'].includes(ext)) {
        if (req.body.targetField==='heroPickBg') cache.theme.images.heroPickBg=req.file.originalname;
        else if (req.body.targetField==='lowerBg') cache.theme.images.lowerBg=req.file.originalname;
        else if (req.body.targetField==='lowerMidBg') cache.theme.images.lowerMidBg=req.file.originalname;
    }
    broadcast({type:'theme_update',data:cache.theme});
    fileQueue.enqueue(()=>fs.writeFile(themePath,JSON.stringify(cache.theme,null,2)));
    res.json({message:'Uploaded',filename:req.file.originalname,updatedTheme:cache.theme});
});

app.get('/api/flags', async (req, res) => {
    try { const files=(await fs.readdir(flagDir)).filter(f=>/\.(png|jpg|jpeg|webp)$/i.test(f)); fileQueue.enqueue(()=>fs.writeFile(flagJsonPath,JSON.stringify(files,null,2))); res.json(files); }
    catch(e) { res.json([]); }
});
app.post('/api/upload-flag', uploadFlag.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({message:'No file'});
    try { const files=(await fs.readdir(flagDir)).filter(f=>/\.(png|jpg|jpeg|webp)$/i.test(f)); fileQueue.enqueue(()=>fs.writeFile(flagJsonPath,JSON.stringify(files,null,2))); res.json({message:'Uploaded',filename:req.file.originalname,list:files}); }
    catch(e) { res.status(500).json({message:'Error'}); }
});

app.get('/api/items',        async (req,res) => { try{res.json(JSON.parse(await fs.readFile(itemsPath,'utf8')))}catch(e){res.json([])} });
app.get('/api/schedule',     (req,res) => res.json(cache.schedule));
app.post('/api/schedule',    (req,res) => { try{cache.schedule=req.body;broadcast({type:'schedule_update',data:cache.schedule});fileQueue.enqueue(()=>fs.writeFile(schedulePath,JSON.stringify(cache.schedule,null,2)));res.json({message:'Saved'});}catch(e){res.status(500).json({message:'Error'})} });
app.get('/api/tableschedule',(req,res) => res.json(cache.tableschedule));
app.post('/api/tableschedule',(req,res) => { try{cache.tableschedule=req.body;broadcast({type:'tableschedule_update',data:cache.tableschedule});fileQueue.enqueue(()=>fs.writeFile(tableSchedulePath,JSON.stringify(cache.tableschedule,null,2)));res.json({message:'Saved'});}catch(e){res.status(500).json({message:'Error'})} });
app.get('/api/mapdraw',      (req,res) => res.json(cache.mapdraw));
app.post('/api/mapdraw',     (req,res) => { try{cache.mapdraw=req.body;broadcast({type:'mapdraw_update',data:cache.mapdraw.drawdata});fileQueue.enqueue(()=>fs.writeFile(mapDrawPath,JSON.stringify(cache.mapdraw,null,2)));res.json({message:'Saved'});}catch(e){res.status(500).json({message:'Error'})} });
app.get('/api/mvp',          (req,res) => res.json(cache.mvp));
app.post('/api/mvp',         (req,res) => { try{cache.mvp=req.body;broadcast({type:'mvp_update',data:cache.mvp.mvp});fileQueue.enqueue(()=>fs.writeFile(mvpDataPath,JSON.stringify(cache.mvp,null,2)));res.json({message:'Saved'});}catch(e){res.status(500).json({message:'Error'})} });
app.post('/api/notification', (req,res) => { try{broadcast({type:'notification_trigger',videoId:req.body.videoId});fileQueue.enqueue(()=>fs.writeFile(notifPath,JSON.stringify({currentVideo:req.body.videoId,timestamp:Date.now()},null,2)));res.json({message:'Triggered'});}catch(e){res.status(500).json({message:'Error'})} });
app.get('/api/draftbgdata',  (req,res) => res.json(cache.draftbgdata));
app.post('/api/draftbgdata', (req,res) => {
    try {
        cache.draftbgdata=req.body;
        (req.body.casters||[]).forEach(c=>learnCaster(c));
        (req.body.sponsors||[]).forEach(s=>learnSponsor(s.name,s.amount));
        (req.body.groups||[]).forEach(g=>(g.teams||[]).forEach(t=>{if(t.name)learnTeam(t.name,'')}));
        ['bluePlayers','redPlayers'].forEach(k=>(req.body[k]||[]).forEach(p=>{if(p.name)learnPlayer(p.name,'','')}));
        broadcast({type:'draftbgdata_update',data:cache.draftbgdata});
        fileQueue.enqueue(()=>fs.writeFile(draftBgDataPath,JSON.stringify(cache.draftbgdata,null,2)));
        res.json({message:'Saved'});
    } catch(e) { res.status(500).json({message:'Error'}); }
});

app.get('/api/previousdraft',  async (req,res) => { try{res.json(JSON.parse(await fs.readFile(prevDraftPath,'utf8')))}catch(e){res.status(500).json({message:'Error'})} });
app.post('/api/previousdraft', (req,res) => { try{fileQueue.enqueue(()=>fs.writeFile(prevDraftPath,JSON.stringify(req.body,null,2)));broadcast({type:'previousdraft_update',data:req.body});res.json({message:'Saved'});}catch(e){res.status(500).json({message:'Error'})} });
app.post('/api/archive-draft', (req,res) => { try{fileQueue.enqueue(()=>fs.writeFile(prevDraftPath,JSON.stringify(cache.matchdraft,null,2)));broadcast({type:'analyzer_update'});res.json({message:'Archived'});}catch(e){res.status(500).json({message:'Error'})} });
app.post('/api/analyzer-control', (req,res) => { broadcast({type:'analyzer_control',action:req.body.action}); res.json({message:'Sent'}); });

app.post('/api/save-match-record', async (req,res) => {
    try {
        fileQueue.enqueue(async () => {
            if (!fsSync.existsSync(savedMatchDir)) await fs.mkdir(savedMatchDir,{recursive:true});
            for (let i=6;i>=1;i--) { const cur=path.join(savedMatchDir,`matchdata${i}.json`),nxt=path.join(savedMatchDir,`matchdata${i+1}.json`); try{await fs.access(cur);await fs.rename(cur,nxt)}catch(e){} }
            await fs.writeFile(path.join(savedMatchDir,'matchdata1.json'),JSON.stringify(cache.matchdata,null,2));
        });
        res.json({message:'Archived'});
    } catch(e) { res.status(500).json({message:'Error'}); }
});

app.post('/api/delete-all-records', async (req,res) => {
    try {
        fileQueue.enqueue(async () => {
            if (fsSync.existsSync(savedMatchDir)) { const files=await fs.readdir(savedMatchDir); for(const f of files) await fs.unlink(path.join(savedMatchDir,f)); }
        });
        res.json({message:'Deleted'});
    } catch(e) { res.status(500).json({message:'Error'}); }
});

// ============================================================
// API — DRAFT (captain + admin)
// ============================================================
app.post('/api/draft/generate', (req, res) => {
    resetDraft();
    draft.blueHash = genHash(); draft.redHash = genHash();
    draft.blueTeamName = req.body.blueTeamName || 'Blue Team';
    draft.redTeamName  = req.body.redTeamName  || 'Red Team';
    draft.status = 'waiting';
    broadcastDraftState();
    res.json({ blueHash:draft.blueHash, redHash:draft.redHash, blueUrl:`/draft/${draft.blueHash}`, redUrl:`/draft/${draft.redHash}` });
});

app.get('/api/draft/state', (req, res) => res.json(getDraftState()));

app.post('/api/draft/reset',   (req, res) => { resetDraft(); res.json({message:'Reset'}); });
app.post('/api/draft/advance', (req, res) => { advancePhase(); res.json({message:'Advanced'}); });

app.post('/api/draft/pause', (req, res) => {
    if (draft.timerRunning) { stopTimer(); }
    else if (draft.status === 'live') {
        draft.timerRunning = true;
        timerInterval = setInterval(() => {
            draft.timer--;
            broadcastDraftState();
            syncDraftToOverlay();
            if (draft.timer <= 0) {
                const side = getActiveSide();
                if (side && draft.selectedHero[side]) lockHero(side, draft.selectedHero[side]);
                else advancePhase();
            }
        }, 1000);
    }
    broadcastDraftState(); syncDraftToOverlay();
    res.json({ paused:!draft.timerRunning });
});

app.get('/api/draft/validate/:hash', (req, res) => {
    const h = req.params.hash;
    if      (h === draft.blueHash) res.json({ valid:true, side:'blue', teamName:draft.blueTeamName });
    else if (h === draft.redHash)  res.json({ valid:true, side:'red',  teamName:draft.redTeamName });
    else                           res.json({ valid:false });
});

app.post('/api/draft/ready/:hash', (req, res) => {
    if      (req.params.hash === draft.blueHash) draft.blueReady = true;
    else if (req.params.hash === draft.redHash)  draft.redReady  = true;
    else return res.status(403).json({ error:'Invalid hash' });
    broadcastDraftState(); checkBothReady();
    res.json({ message:'Ready' });
});

app.post('/api/draft/select/:hash', (req, res) => {
    let side = null;
    if      (req.params.hash === draft.blueHash) side = 'blue';
    else if (req.params.hash === draft.redHash)  side = 'red';
    else return res.status(403).json({ error:'Invalid hash' });
    if (draft.status !== 'live') return res.status(400).json({ error:'Not live' });
    if (getActiveSide() !== side) return res.status(400).json({ error:'Not your turn' });
    if (getAllUsedHeroes().includes(req.body.hero)) return res.status(400).json({ error:'Already used' });
    draft.selectedHero[side] = req.body.hero;
    broadcastDraftState();
    syncDraftToOverlay(); // push pending preview to OBS overlay
    res.json({ message:'Selected' });
});

app.post('/api/draft/lock/:hash', (req, res) => {
    let side = null;
    if      (req.params.hash === draft.blueHash) side = 'blue';
    else if (req.params.hash === draft.redHash)  side = 'red';
    else return res.status(403).json({ error:'Invalid hash' });
    if (draft.status !== 'live') return res.status(400).json({ error:'Not live' });
    if (getActiveSide() !== side) return res.status(400).json({ error:'Not your turn' });
    if (getAllUsedHeroes().includes(req.body.hero)) return res.status(400).json({ error:'Already used' });
    lockHero(side, req.body.hero);
    res.json({ message:'Locked' });
});

// ============================================================
// API — TOURNAMENT DATABASE
// ============================================================
app.get('/api/db/search', (req, res) => {
    const q = (req.query.q||'').toLowerCase(), type = req.query.type;
    if (!type||!db[type]) return res.json([]);
    const results = q ? db[type].filter(i=>(i.name||'').toLowerCase().includes(q)) : db[type];
    res.json(results.slice(0,20));
});
app.get('/api/db',             (req, res) => res.json(db));
app.get('/api/db/:type',       (req, res) => { if(!db[req.params.type]) return res.status(400).json({error:'Invalid type'}); res.json(db[req.params.type]); });
app.get('/api/db/team-players/:teamName', (req, res) => { const n=decodeURIComponent(req.params.teamName).toLowerCase(); res.json(db.players.filter(p=>p.team&&p.team.toLowerCase()===n)); });
app.post('/api/db/:type', (req, res) => {
    const type=req.params.type; if(!db[type]) return res.status(400).json({error:'Invalid type'});
    const entry=req.body; if(!entry.name) return res.status(400).json({error:'Name required'});
    const existing=db[type].find(e=>e.name.toLowerCase()===entry.name.toLowerCase());
    if(existing) Object.assign(existing,entry); else db[type].push(entry);
    saveDB(); res.json({ok:true,data:db[type]});
});
app.delete('/api/db/:type/:name', (req, res) => {
    const type=req.params.type, name=decodeURIComponent(req.params.name).toLowerCase();
    if(!db[type]) return res.status(400).json({error:'Invalid type'});
    db[type]=db[type].filter(e=>e.name.toLowerCase()!==name); saveDB(); res.json({ok:true,data:db[type]});
});

// Captain page route
app.get('/draft/:hash', (req, res) => res.sendFile(path.join(__dirname, 'draft/public/captain.html')));

// ============================================================
// HELPERS
// ============================================================
function getLocalIp() {
    const nets = os.networkInterfaces();
    let candidate = 'localhost';
    const virtual = ['virtual','vmware','vbox','wsl','hyper-v','docker','vpn','tap','tun'];
    for (const name of Object.keys(nets)) {
        if (virtual.some(k=>name.toLowerCase().includes(k))) continue;
        for (const net of nets[name]) {
            if (net.family==='IPv4'&&!net.internal) {
                if (name.toLowerCase().includes('wi-fi')||name.toLowerCase().includes('ethernet')) return net.address;
                candidate = net.address;
            }
        }
    }
    return candidate;
}

// ============================================================
// START
// ============================================================
const PORT    = parseInt(process.env.PORT) || 3000;
const localIp = getLocalIp();

server.listen(PORT, async () => {
    console.log('=============================================');
    console.log(' ANONYMOUS v4.8 — Unified Server');
    console.log(` Local:    http://localhost:${PORT}`);
    console.log(` Network:  http://${localIp}:${PORT}`);
    console.log(` Admin:    http://localhost:${PORT}/admin.html`);
    console.log(` Captain:  http://localhost:${PORT}/draft/<hash>`);
    console.log('=============================================');
    try { await fs.writeFile(path.join(__dirname,'public/serverip.txt'), localIp); } catch(e) {}
});
