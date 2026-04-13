// server.js - Overlay Server
// FULL REVISED VERSION - Fix WebSocket Freezing, Lag on LAN & Race Conditions

require('dotenv').config();

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Limit besar untuk handle upload data base64 jika ada
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS - allow admin panel on port 3001 to access APIs
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static('public'));

// ==========================================
// 1. KELAS ANTREAN PENULISAN (WRITE QUEUE)
// Mencegah Race Condition / File Corrupt saat banyak input bersamaan
// ==========================================
class AsyncQueue {
    constructor() {
        this.queue = Promise.resolve();
    }
    enqueue(task) {
        this.queue = this.queue.then(task).catch(err => {
            console.error('Queue Error:', err);
        });
        return this.queue;
    }
}
const fileQueue = new AsyncQueue();

// ==========================================
// 2. PERSIAPAN FOLDER & FILE DATABASE
// ==========================================
const dbDir = path.join(__dirname, 'public/database');
const savedMatchDir = path.join(dbDir, 'savedmatch'); 
const unifiedDir = path.join(__dirname, 'public/Assets/costum/Theme');
const flagDir = path.join(__dirname, 'public/Assets/nationalflag');

// Buat folder jika belum ada
if (!fsSync.existsSync(dbDir)) fsSync.mkdirSync(dbDir, { recursive: true });
if (!fsSync.existsSync(savedMatchDir)) fsSync.mkdirSync(savedMatchDir, { recursive: true });
if (!fsSync.existsSync(unifiedDir)) fsSync.mkdirSync(unifiedDir, { recursive: true });
if (!fsSync.existsSync(flagDir)) fsSync.mkdirSync(flagDir, { recursive: true });

// --- FILE PATHS ---
const matchDataPath = path.join(dbDir, 'matchdatateam.json');
const draftDataPath = path.join(dbDir, 'matchdraft.json');
const prevDraftPath = path.join(dbDir, 'previousmatchdraft.json');
const mapDrawPath   = path.join(dbDir, 'mapdraw.json');
const mvpDataPath   = path.join(dbDir, 'mvpdata.json');
const notifPath     = path.join(dbDir, 'notification.json');
const schedulePath  = path.join(dbDir, 'schedule.json');
const itemsPath     = path.join(dbDir, 'items.json');
const flagJsonPath  = path.join(dbDir, 'flags.json');
const tableSchedulePath = path.join(dbDir, 'tableschedule.json');
const themePath     = path.join(unifiedDir, 'theme.json');
const draftBgDataPath = path.join(dbDir, 'draftbgdata.json'); 

// --- KONFIGURASI UPLOAD ---
const storageUnified = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, unifiedDir); },
    filename: (req, file, cb) => { cb(null, file.originalname); }
});
const uploadUnified = multer({ storage: storageUnified });

const storageFlag = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, flagDir); },
    filename: (req, file, cb) => { cb(null, file.originalname); }
});
const uploadFlag = multer({ storage: storageFlag });

// ==========================================
// 3. DEFAULT DATA GENERATORS
// ==========================================
const defaultMatchData = {
    "game_duration": "00:00", "game_number": 0, "winmatches": "none",
    "teamdata": {
        "blueteam": { 
            "teamname": "BLUE TEAM", "score": "0", "logo": "", "totalgold": 0, "turret": 0, "lord": 0, "turtle": 0,
            "playerlist": Array(5).fill().map(() => ({ "name": "Player", "hero": "", "level": 0, "KDA": "0/0/0", "gold": 0, "spell": "idle", "banhero": "", "itemlist": ["idle","idle","idle","idle","idle","idle"] }))
        },
        "redteam": { 
            "teamname": "RED TEAM", "score": "0", "logo": "", "totalgold": 0, "turret": 0, "lord": 0, "turtle": 0,
            "playerlist": Array(5).fill().map(() => ({ "name": "Player", "hero": "", "level": 0, "KDA": "0/0/0", "gold": 0, "spell": "idle", "banhero": "", "itemlist": ["idle","idle","idle","idle","idle","idle"] }))
        }
    }
};

const defaultTheme = {
    fontFile: "Renegade Pursuit.otf", useCustomFont: false, fontSizeMultiplier: 1.0, 
    images: { heroPickBg: "", lowerBg: "", lowerMidBg: "" },
    colors: { bluePrimary: "#00d2ff", blueDark: "#003e4d", redPrimary: "#ff2a2a", redDark: "#4d0000", scoreBlue: "#00d2ff", scoreRed: "#ff2a2a", upperBg: "#000000", lowerBg: "#0a0a0a", lowerMidBg: "#111111", heroPickBg: "#1e1e1e", logoTeamBg: "#000000", postDraftBg: "#1a1a1a", playerNameBg: "#000000", laneLogoBg: "rgba(0,0,0,0.8)", timerBlue: "#00d2ff", timerMid: "#ffffff", timerRed: "#ff2a2a", playerName: "#ffffff", phaseText: "#ffffff", laneIconType: "white", laneLogoBorder: "#ffffff", auraBan: "#ff0000", auraPick: "#ffffff", globalBorder: "rgba(255, 255, 255, 0.2)" },
    gradients: { upperBg: { enabled: false, colorB: "#333333", angle: 90 }, lowerBg: { enabled: false, colorB: "#333333", angle: 90 }, lowerMidBg: { enabled: false, colorB: "#333333", angle: 90 }, heroPickBg: { enabled: false, colorB: "#333333", angle: 90 }, logoTeamBg: { enabled: false, colorB: "#333333", angle: 90 }, sbBgTeamName: { enabled: false, colorB: "#333333", angle: 90 }, sbBgLogo: { enabled: false, colorB: "#333333", angle: 90 }, sbBgScore: { enabled: false, colorB: "#333333", angle: 90 }, sbBgCombined: { enabled: false, colorB: "#333333", angle: 90 }, sbBgBox1: { enabled: false, colorB: "#333333", angle: 90 }, sbBgSecondary: { enabled: false, colorB: "#333333", angle: 90 } },
    scoreboard: { teamNameBlue: "#00d2ff", teamNameRed: "#ff2a2a", bgTeamName: "#1e1e1e", bgLogo: "#000000", bgScore: "#000000", bgCombined: "#0a0a0a", bgBox1: "#1e1e1e", bgSecondary: "#1e1e1e", borderBottom: "rgba(255, 255, 255, 0.2)", activeFlag: "indonesia.png", disableGlow: false, disableShadow: false },
    opacity: { upper: 100, lower: 100, heroPick: 100, logoTeam: 60, postDraft: 100 },
    toggles: { hideLaneLogo: false, disableGlow: false, hidePattern: false, hidePostDraftBg: false, disableBoxShadow: false },
    animations: { banType: "pulse", pickType: "pulse", heroAnim: "fade" }
};

const defaultDraftBgData = {
    casters: ["Caster 1", "Caster 2"],
    sponsors: [
        { name: "MolviMota", amount: "Pkr 5000" },
        { name: "Soul Eater", amount: "Pkr 5000" },
        { name: "Hifza", amount: "Pkr 5000" }
    ],
    groups: [
        {
            name: "Group A",
            teams: [
                { name: "Team 1", wins: 0, losses: 0, points: 0 },
                { name: "Team 2", wins: 0, losses: 0, points: 0 },
                { name: "Team 3", wins: 0, losses: 0, points: 0 },
                { name: "Team 4", wins: 0, losses: 0, points: 0 }
            ]
        }
    ],
    activeGroup: 0,
    bluePlayers: [
        { name: "Player 1", hero1: "", hero2: "" },
        { name: "Player 2", hero1: "", hero2: "" },
        { name: "Player 3", hero1: "", hero2: "" },
        { name: "Player 4", hero1: "", hero2: "" },
        { name: "Player 5", hero1: "", hero2: "" }
    ],
    redPlayers: [
        { name: "Player 1", hero1: "", hero2: "" },
        { name: "Player 2", hero1: "", hero2: "" },
        { name: "Player 3", hero1: "", hero2: "" },
        { name: "Player 4", hero1: "", hero2: "" },
        { name: "Player 5", hero1: "", hero2: "" }
    ]
};

const defaultDraftData = {
    "draftdata": {
        "timer": "60", "timer_running": false, "current_phase": 0,
        "blueside": { "ban": [{},{},{},{},{}], "pick": [{},{},{},{},{}] },
        "redside": { "ban": [{},{},{},{},{}], "pick": [{},{},{},{},{}] }
    }
};

// Inisialisasi File Fisik (Hanya berjalan sekali saat start)
if (!fsSync.existsSync(matchDataPath)) fsSync.writeFileSync(matchDataPath, JSON.stringify(defaultMatchData, null, 2));
if (!fsSync.existsSync(draftDataPath)) fsSync.writeFileSync(draftDataPath, JSON.stringify(defaultDraftData, null, 2));
if (!fsSync.existsSync(prevDraftPath)) fsSync.writeFileSync(prevDraftPath, JSON.stringify(defaultDraftData, null, 2));
if (!fsSync.existsSync(themePath)) fsSync.writeFileSync(themePath, JSON.stringify(defaultTheme, null, 2)); 
if (!fsSync.existsSync(mapDrawPath)) fsSync.writeFileSync(mapDrawPath, JSON.stringify({ "drawdata": { "status": "idle" } }, null, 2));
if (!fsSync.existsSync(mvpDataPath)) fsSync.writeFileSync(mvpDataPath, JSON.stringify({ "mvp": null }, null, 2));
if (!fsSync.existsSync(schedulePath)) fsSync.writeFileSync(schedulePath, JSON.stringify({}, null, 2));
if (!fsSync.existsSync(notifPath)) fsSync.writeFileSync(notifPath, JSON.stringify({}, null, 2));
if (!fsSync.existsSync(tableSchedulePath)) fsSync.writeFileSync(tableSchedulePath, JSON.stringify({ title: "MATCH SCHEDULE", colors: {}, matches: [] }, null, 2));

if (!fsSync.existsSync(draftBgDataPath)) fsSync.writeFileSync(draftBgDataPath, JSON.stringify(defaultDraftBgData, null, 2));

if (!fsSync.existsSync(itemsPath)) {
    const defaultItems = [ "winter_truncheon", "immortality", "athena_shield", "blade_armor", "antique_cuirass", "oracle", "radiant_armor", "twilight_armor", "guardian_helmet", "sky_guardian_helmet", "thunder_belt", "cursed_helmet" ];
    fsSync.writeFileSync(itemsPath, JSON.stringify(defaultItems, null, 2));
}

// ==========================================
// 4. IN-MEMORY CACHE (Sangat Cepat & Anti-Lag)
// ==========================================
let cache = {
    matchdata: defaultMatchData,
    matchdraft: defaultDraftData,
    theme: defaultTheme,
    mapdraw: { "drawdata": { "status": "idle" } },
    mvp: { "mvp": null },
    schedule: {},
    tableschedule: { title: "MATCH SCHEDULE", colors: {}, matches: [] },
    draftbgdata: defaultDraftBgData
};

// Fungsi Load Cache dari File saat server nyala
async function loadCache() {
    try { cache.matchdata = JSON.parse(await fs.readFile(matchDataPath, 'utf8')); } catch(e) {}
    try { cache.matchdraft = JSON.parse(await fs.readFile(draftDataPath, 'utf8')); } catch(e) {}
    try { cache.theme = JSON.parse(await fs.readFile(themePath, 'utf8')); } catch(e) {}
    try { cache.mapdraw = JSON.parse(await fs.readFile(mapDrawPath, 'utf8')); } catch(e) {}
    try { cache.mvp = JSON.parse(await fs.readFile(mvpDataPath, 'utf8')); } catch(e) {}
    try { cache.schedule = JSON.parse(await fs.readFile(schedulePath, 'utf8')); } catch(e) {}
    try { cache.tableschedule = JSON.parse(await fs.readFile(tableSchedulePath, 'utf8')); } catch(e) {}
    try { cache.draftbgdata = JSON.parse(await fs.readFile(draftBgDataPath, 'utf8')); } catch(e) {}
    console.log(">> In-Memory Cache Loaded!");
}
loadCache();

// Inisialisasi Database Flag (Auto Scan)
async function initFlagDB() {
    if (!fsSync.existsSync(flagJsonPath)) {
        try {
            const files = await fs.readdir(flagDir);
            const imageFiles = files.filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
            await fs.writeFile(flagJsonPath, JSON.stringify(imageFiles, null, 2));
        } catch (error) { await fs.writeFile(flagJsonPath, JSON.stringify([], null, 2)); }
    }
}
initFlagDB();

// ==========================================
// 5. FUNGSI HELPER (IP & BROADCAST)
// ==========================================
function getLocalIp() {
    const nets = os.networkInterfaces();
    let candidateIp = 'localhost';
    const virtualKeywords = ['virtual', 'vmware', 'vbox', 'virtualbox', 'wsl', 'hyper-v', 'vethernet', 'docker', 'vpn', 'zerotier', 'tap', 'tun'];
    for (const name of Object.keys(nets)) {
        const isVirtual = virtualKeywords.some(keyword => name.toLowerCase().includes(keyword));
        if (!isVirtual) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('ethernet')) { return net.address; }
                    candidateIp = net.address;
                }
            }
        }
    }
    return candidateIp;
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// ==========================================
// 6. WEBSOCKET SERVER (FIXED & OPTIMIZED)
// ==========================================
function heartbeat() { this.isAlive = true; }

wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    ws.on('message', message => {
        try {
            const msg = JSON.parse(message);
            // Broadcast ke client lain (kecuali pengirim) untuk cegah loop
            if (msg.type === 'update') {
                wss.clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(msg));
                    }
                });
            }
        } catch (e) { console.error('WebSocket Message Error:', e); }
    });
});

// Interval PING (Setiap 30 Detik) mencegah koneksi diputus otomatis
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate(); 
        ws.isAlive = false; 
        ws.ping(); 
    });
}, 30000);

wss.on('close', function close() { clearInterval(interval); });

// ==========================================
// 7. API ROUTES (Cache + Queue Implementations)
// ==========================================

// --- MATCH DATA API ---
app.get('/api/matchdata', (req, res) => {
    res.json(cache.matchdata); // Cepat! Baca dari RAM
});

app.post('/api/matchdata', (req, res) => {
    try {
        cache.matchdata = req.body; // 1. Update RAM langsung
        
        broadcast({ type: 'matchdata_update', data: cache.matchdata }); // 2. Broadcast instan
        broadcast({ type: 'update', data: { matchdata: cache.matchdata } }); // Fallback legacy
        
        // 3. Masukkan ke Antrean penulisan File (Background)
        const payload = JSON.stringify(cache.matchdata, null, 2);
        fileQueue.enqueue(() => fs.writeFile(matchDataPath, payload));
        
        res.json({ message: 'Match data saved' });
    } catch (error) { res.status(500).json({ message: 'Error saving match data' }); }
});

// --- MATCH DRAFT API ---
app.get('/api/matchdraft', (req, res) => {
    res.json(cache.matchdraft); // Baca dari RAM
});

app.post('/api/matchdraft', (req, res) => {
    try {
        cache.matchdraft = req.body; // Update RAM
        
        broadcast({ type: 'draftdata_update', data: cache.matchdraft.draftdata });
        
        const payload = JSON.stringify(cache.matchdraft, null, 2);
        fileQueue.enqueue(() => fs.writeFile(draftDataPath, payload));
        
        res.json({ message: 'Draft data saved' });
    } catch (error) { res.status(500).json({ message: 'Error saving draft' }); }
});

// --- THEME API ---
app.get('/api/theme', (req, res) => {
    res.json(cache.theme); // Baca dari RAM
});

app.post('/api/theme', (req, res) => {
    try {
        cache.theme = req.body; // Update RAM
        broadcast({ type: 'theme_update', data: cache.theme });
        
        const payload = JSON.stringify(cache.theme, null, 2);
        fileQueue.enqueue(() => fs.writeFile(themePath, payload));
        
        res.json({ message: 'Theme saved' });
    } catch (error) { res.status(500).json({ message: 'Error saving theme' }); }
});

app.post('/api/theme-reset', (req, res) => {
    try {
        cache.theme = defaultTheme; // Reset di RAM
        broadcast({ type: 'theme_update', data: cache.theme });
        
        const payload = JSON.stringify(cache.theme, null, 2);
        fileQueue.enqueue(() => fs.writeFile(themePath, payload));
        
        res.json({ message: 'Theme Reset to Default', theme: cache.theme });
    } catch (error) { res.status(500).json({ message: 'Error resetting theme' }); }
});

// --- UNIFIED UPLOAD API (Theme Assets) ---
app.post('/api/upload-asset', uploadUnified.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    
    const targetField = req.body.targetField; 
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    try {
        // Update langsung dari Cache
        if (!cache.theme.images) cache.theme.images = {};

        if (targetField === 'font' && (ext === '.ttf' || ext === '.otf')) {
            cache.theme.fontFile = req.file.originalname; 
            cache.theme.useCustomFont = true;
        } 
        else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
            if (targetField === 'heroPickBg') cache.theme.images.heroPickBg = req.file.originalname;
            else if (targetField === 'lowerBg') cache.theme.images.lowerBg = req.file.originalname;
            else if (targetField === 'lowerMidBg') cache.theme.images.lowerMidBg = req.file.originalname;
        }
        
        broadcast({ type: 'theme_update', data: cache.theme });
        
        const payload = JSON.stringify(cache.theme, null, 2);
        fileQueue.enqueue(() => fs.writeFile(themePath, payload));
        
        res.json({ message: 'Asset uploaded successfully', filename: req.file.originalname, updatedTheme: cache.theme });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ message: 'Error updating theme config' });
    }
});

// --- FLAG API ---
app.get('/api/flags', async (req, res) => {
    try {
        const files = await fs.readdir(flagDir);
        const imageFiles = files.filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
        // Flag tidak masuk main cache, cukup queue file write
        fileQueue.enqueue(() => fs.writeFile(flagJsonPath, JSON.stringify(imageFiles, null, 2)));
        res.json(imageFiles);
    } catch (error) { res.json([]); }
});

app.post('/api/upload-flag', uploadFlag.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    try {
        const files = await fs.readdir(flagDir);
        const imageFiles = files.filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
        fileQueue.enqueue(() => fs.writeFile(flagJsonPath, JSON.stringify(imageFiles, null, 2)));
        res.json({ message: 'Flag uploaded successfully', filename: req.file.originalname, list: imageFiles });
    } catch (error) { res.status(500).json({ message: 'Error uploading flag' }); }
});

// --- EXTRAS API (Schedule, MapDraw, MVP, Notifications) ---
app.get('/api/items', async (req, res) => {
    try { const data = await fs.readFile(itemsPath, 'utf8'); res.json(JSON.parse(data)); } catch (error) { res.json([]); }
});

app.get('/api/schedule', (req, res) => { res.json(cache.schedule); });
app.post('/api/schedule', (req, res) => {
    try {
        cache.schedule = req.body;
        broadcast({ type: 'schedule_update', data: cache.schedule });
        fileQueue.enqueue(() => fs.writeFile(schedulePath, JSON.stringify(cache.schedule, null, 2)));
        res.json({ message: 'Schedule saved' });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

// --- TABLE SCHEDULE API ---
app.get('/api/tableschedule', (req, res) => { res.json(cache.tableschedule); });
app.post('/api/tableschedule', (req, res) => {
    try {
        cache.tableschedule = req.body;
        broadcast({ type: 'tableschedule_update', data: cache.tableschedule });
        fileQueue.enqueue(() => fs.writeFile(tableSchedulePath, JSON.stringify(cache.tableschedule, null, 2)));
        res.json({ message: 'Table schedule saved' });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/mapdraw', (req, res) => { res.json(cache.mapdraw); });
app.post('/api/mapdraw', (req, res) => {
    try {
        cache.mapdraw = req.body;
        broadcast({ type: 'mapdraw_update', data: cache.mapdraw.drawdata });
        fileQueue.enqueue(() => fs.writeFile(mapDrawPath, JSON.stringify(cache.mapdraw, null, 2)));
        res.json({ message: 'Map saved' });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/mvp', (req, res) => { res.json(cache.mvp); });
app.post('/api/mvp', (req, res) => {
    try {
        cache.mvp = req.body;
        broadcast({ type: 'mvp_update', data: cache.mvp.mvp });
        fileQueue.enqueue(() => fs.writeFile(mvpDataPath, JSON.stringify(cache.mvp, null, 2)));
        res.json({ message: 'MVP saved' });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

app.post('/api/notification', (req, res) => {
    try {
        const payload = { currentVideo: req.body.videoId, timestamp: Date.now() };
        broadcast({ type: 'notification_trigger', videoId: req.body.videoId });
        fileQueue.enqueue(() => fs.writeFile(notifPath, JSON.stringify(payload, null, 2)));
        res.json({ message: 'Notification triggered' });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

// --- DRAFT BG DATA API (Sponsors & Players) ---
app.get('/api/draftbgdata', (req, res) => { res.json(cache.draftbgdata); });
app.post('/api/draftbgdata', (req, res) => {
    try {
        cache.draftbgdata = req.body;
        broadcast({ type: 'draftbgdata_update', data: cache.draftbgdata });
        fileQueue.enqueue(() => fs.writeFile(draftBgDataPath, JSON.stringify(cache.draftbgdata, null, 2)));
        res.json({ message: 'Draft BG data saved' });
    } catch (error) { res.status(500).json({ message: 'Error saving draft bg data' }); }
});

// --- FITUR ARSIP MATCH ---
app.post('/api/save-match-record', async (req, res) => {
    try {
        // Proses arsip aman menggunakan antrean agar tidak bentrok dengan penulisan lain
        fileQueue.enqueue(async () => {
            if (!fsSync.existsSync(savedMatchDir)) await fs.mkdir(savedMatchDir, { recursive: true });
            for (let i = 6; i >= 1; i--) {
                const currentFile = path.join(savedMatchDir, `matchdata${i}.json`);
                const nextFile = path.join(savedMatchDir, `matchdata${i + 1}.json`);
                try { await fs.access(currentFile); await fs.rename(currentFile, nextFile); } catch (err) {}
            }
            const destPath = path.join(savedMatchDir, 'matchdata1.json');
            await fs.writeFile(destPath, JSON.stringify(cache.matchdata, null, 2));
        });
        res.json({ message: 'Match archived successfully (Queued)' });
    } catch (error) { res.status(500).json({ message: 'Error archiving match data' }); }
});

app.post('/api/archive-draft', (req, res) => {
    try {
        fileQueue.enqueue(() => fs.writeFile(prevDraftPath, JSON.stringify(cache.matchdraft, null, 2)));
        broadcast({ type: 'analyzer_update' });
        res.json({ message: 'Draft archived (Queued)' });
    } catch (error) { res.status(500).json({ message: 'Error archiving draft' }); }
});

app.get('/api/previousdraft', async (req, res) => {
    try { const data = await fs.readFile(prevDraftPath, 'utf8'); res.json(JSON.parse(data)); } catch (error) { res.status(500).json({ message: 'Error reading prev draft' }); }
});

app.post('/api/previousdraft', (req, res) => {
    try {
        const payload = JSON.stringify(req.body, null, 2);
        fileQueue.enqueue(() => fs.writeFile(prevDraftPath, payload));
        broadcast({ type: 'previousdraft_update', data: req.body });
        res.json({ message: 'Previous draft saved' });
    } catch (error) { res.status(500).json({ message: 'Error saving prev draft' }); }
});

app.post('/api/analyzer-control', (req, res) => {
    broadcast({ type: 'analyzer_control', action: req.body.action });
    res.json({ message: `Analyzer command sent` });
});

// Endpoint untuk MENGHAPUS SEMUA arsip match data
app.post('/api/delete-all-records', async (req, res) => {
    try {
        // Masukkan ke antrean agar aman dari Race Condition
        fileQueue.enqueue(async () => {
            if (fsSync.existsSync(savedMatchDir)) {
                // Baca semua isi folder
                const files = await fs.readdir(savedMatchDir);
                // Hapus satu per satu file yang ada di dalamnya
                for (const file of files) {
                    await fs.unlink(path.join(savedMatchDir, file));
                }
            }
        });
        
        res.json({ message: 'All match records deleted successfully (Queued)' });
    } catch (error) {
        console.error("Delete all records error:", error);
        res.status(500).json({ message: 'Error deleting match records' });
    }
});

// ==========================================
// 8. START SERVER
// ==========================================
const port    = parseInt(process.env.PORT) || 3000;
const localIp = getLocalIp();

server.listen(port, async () => {
    console.log('=============================================');
    console.log(` OVERLAY SERVER STARTED (anonymous v4.8) `);
    console.log(` Local:   http://localhost:${port}`);
    console.log(` Network: http://${localIp}:${port}`);
    console.log(` Status:  Cache & Async Queue Active! `);
    console.log('=============================================');

    try { await fs.writeFile(path.join(__dirname, 'public/serverip.txt'), localIp); } catch (error) {}
});