let allHeroes = [];
let lastPlayed = {};
let currentDraftData = null;
let timerAnimationTimeout = null;
let ws = null; // Variabel global WS
let reconnectInterval = null;

// --- STATE TRACKING ---
let lastRunningState = false; 
let lastPhaseIndex = -1;

// --- 1. LOAD HERO DATA ---
async function loadHeroes() {
    try {
        const response = await fetch('/database/herolist.json');
        allHeroes = await response.json();
    } catch (e) { console.error("Error loading herolist", e); }
}

function getVoiceByImg(imgSrc) {
    if (!imgSrc || !allHeroes.length) return null;
    const hero = allHeroes.find(h => h.img === imgSrc);
    return hero ? hero.voice : null;
}

// --- 2. WEBSOCKET MANAGER (AUTO RECONNECT) ---

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${window.location.host}`);

    ws.onopen = () => {
        console.log('Connected to Server');
        fetchDraftData(); 
        
        if (reconnectInterval) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // 1. UPDATE DATA FULL (Phase ganti, Pick/Ban Hero)
            if (msg.type === 'draftdata_update' && msg.data) {
                console.log("Menerima update full langsung via Socket");
                processData(msg.data);
            } 
            else if (msg.type === 'draftdata_update') {
                fetchDraftData();
            }
            // 2. TANGKAP DETAK TIMER TERISOLASI DARI CONTROLLER (Tick / Detik)
            else if (msg.type === 'update' && msg.data && msg.data.draftdata) {
                // Jangan timpa seluruh data, cukup update angka dan barnya saja
                syncTimerTick(msg.data.draftdata.timer, msg.data.draftdata.timer_running, false);
            }
        } catch (e) {
            console.error("WS Parse Error", e);
        }
    };

    ws.onclose = () => {
        console.log('Koneksi terputus. Mencoba reconnect dalam 3 detik...');
        if (!reconnectInterval) {
            reconnectInterval = setInterval(connectWebSocket, 3000);
        }
    };

    ws.onerror = (err) => {
        console.error('Socket error:', err);
        ws.close();
    };
}

async function fetchDraftData() {
    try {
        const response = await fetch('/api/matchdraft');
        const data = await response.json();
        if (data && data.draftdata) {
            processData(data.draftdata);
        }
    } catch (error) {
        console.error("Error fetch draft data:", error);
    }
}

function processData(newDraftData) {
    currentDraftData = newDraftData;
    updateDisplay(newDraftData);
    updateGameLogic(newDraftData);
}

// --- INITIALIZE ---
loadHeroes().then(() => connectWebSocket());


// --- 3. DISPLAY UPDATE LOGIC ---

function playVoice(voiceSrc, index) {
    if (!voiceSrc) return;
    let audio = document.getElementById("hero-voice");
    let phaseIdx = (currentDraftData && currentDraftData.current_phase) ? parseInt(currentDraftData.current_phase) : 0;
    
    if (phaseIdx >= phases.length - 1) {
        audio.volume = 0;
    } else {
        audio.volume = 1;
    }
    
    audio.pause();
    audio.currentTime = 0;
    audio.src = voiceSrc;
    var playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.log('Auto-play prevented (User must interact first)');
        });
    }
}

function updateDisplay(newData) {
    if (!newData) return;

    const map = [];
    const safePickBlue = newData.blueside.pick || [];
    const safePickRed = newData.redside.pick || [];
    const safeBanBlue = newData.blueside.ban || [];
    const safeBanRed = newData.redside.ban || [];

    safePickBlue.forEach((p, i) => map[1+i] = p.hero);
    safePickRed.forEach((p, i) => map[6+i] = p.hero);
    safeBanBlue.forEach((p, i) => map[11+i] = p.hero);
    safeBanRed.forEach((p, i) => map[16+i] = p.hero);

    for (let i = 1; i <= 20; i++) {
        let imgSrc = map[i];
        let imgElement = document.getElementById(`image-display-${i}`);
        let boxElement = document.getElementById(`image-box-${i}`);
        
        if (imgElement && boxElement) { 
            if (imgSrc) {
                if (!imgElement.src.endsWith(imgSrc)) {
                     imgElement.src = imgSrc;
                     const voiceSrc = getVoiceByImg(imgSrc);
                     if (voiceSrc && lastPlayed[i] !== imgSrc) {
                         playVoice(voiceSrc, i);
                         lastPlayed[i] = imgSrc;
                     }
                }
                imgElement.style.opacity = "1";
                boxElement.classList.add("show");
            } else {
                imgElement.src = ""; 
                imgElement.style.opacity = "0";
                boxElement.classList.remove("show");
                lastPlayed[i] = null;
            }
        }
    }
}

// --- 4. TIMER & PHASE UI LOGIC ---

const phaseElement = document.getElementById('phase');
const arrowElement = document.getElementById('arrow');
const timerElement = document.getElementById('timer');
const timerBar = document.getElementById('timer-bar');

const phases = [
    { type: "", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "", direction: "/Assets/Other/RightBanning.gif" },
    { type: "", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "", direction: "/Assets/Other/RightBanning.gif" },
    { type: "", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "", direction: "/Assets/Other/RightPicking.gif" },
    { type: "", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "", direction: "/Assets/Other/RightPicking.gif" },
    { type: "", direction: "/Assets/Other/RightBanning.gif" },
    { type: "", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "", direction: "/Assets/Other/RightPicking.gif" },
    { type: "", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "", direction: "/Assets/Other/RightPicking.gif" },
    { type: "", direction: "/Assets/Other/Adjustment.gif" }
];

const phasesActiveBoxes = [
    ["ban-left-1"],
    ["ban-right-1"],
    ["ban-left-2"],
    ["ban-right-2"],
    ["pick-left-1"],
    ["pick-right-1", "pick-right-2"],
    ["pick-left-2", "pick-left-3"],
    ["pick-right-3"],
    ["ban-right-3"],
    ["ban-left-3"],
    ["pick-right-4"],
    ["pick-left-4", "pick-left-5"],
    ["pick-right-5"],
    []
];

function updateGameLogic(data) {
    if (!data) return;

    let currentPhaseIndex = parseInt(data.current_phase) || 0;
    
    // Deteksi apakah fase berpindah
    let phaseChanged = (currentPhaseIndex !== lastPhaseIndex);
    lastPhaseIndex = currentPhaseIndex;

    // Sinkronkan Timer dari Full Update (Reset & Restart Bar jika perlu)
    syncTimerTick(data.timer, data.timer_running, phaseChanged);

    // Logic Tampilan Phase
    if (phaseElement && arrowElement) {
        if (currentPhaseIndex < phases.length) {
            const currentPhase = phases[currentPhaseIndex];
            phaseElement.textContent = currentPhase.type;
            
            if (!arrowElement.src.endsWith(currentPhase.direction)) {
                arrowElement.src = currentPhase.direction;
            }
        } else {
            phaseElement.textContent = "ADJUSTMENT";
            arrowElement.src = "";
        }
    }

    // Logic Active Box
    document.querySelectorAll(".box").forEach(box => {
        box.classList.remove("active-ban", "active-pick");
    });

    if (currentPhaseIndex < phasesActiveBoxes.length) {
        phasesActiveBoxes[currentPhaseIndex].forEach(boxId => {
            const phaseBox = document.getElementById(boxId);
            if (phaseBox) {
                const isBanPhase = (currentPhaseIndex < 4) || (currentPhaseIndex >= 8 && currentPhaseIndex <= 9);
                phaseBox.classList.add(isBanPhase ? "active-ban" : "active-pick");
            }
        });
    }
}

// --- MURNI DIKONTROL SERVER (TANPA setInterval LOKAL) ---
function syncTimerTick(timerValue, isRunning, phaseChanged = false) {
    if (currentDraftData) {
        currentDraftData.timer = timerValue;
        currentDraftData.timer_running = isRunning;
    }

    let timerNum = parseInt(timerValue) || 60;

    // 1. Update Teks Detik Langsung (Anti drift)
    if (timerElement) {
        timerElement.textContent = String(timerNum).padStart(2, '0');
    }

    // 2. Logic Animasi CSS Bar
    // Hanya picu animasi kalau baru di-start (false -> true) atau pindah fase
    if ((isRunning && !lastRunningState) || (isRunning && phaseChanged)) {
        animateTimerBar(timerNum);
    } 
    // Reset bar kalau di-stop (true -> false)
    else if (!isRunning && lastRunningState) {
        stopTimerBar();
    }
    
    lastRunningState = isRunning;
}

function animateTimerBar(duration) {
    if (!timerBar) return;
    if (timerAnimationTimeout) clearTimeout(timerAnimationTimeout);

    // Kembalikan ke penuh secara instant
    timerBar.style.transition = "none"; 
    timerBar.style.width = "100%";
    
    // Mulai animasi menyusut sesuai durasi yang tersisa
    timerAnimationTimeout = setTimeout(() => {
        void timerBar.offsetWidth; // Force Reflow
        timerBar.style.transition = `width ${duration}s linear`;
        timerBar.style.width = "0%";
    }, 50); // Delay sangat singkat agar DOM sempat merespon 'width 100%'
}

function stopTimerBar() {
    if (!timerBar) return;
    if (timerAnimationTimeout) clearTimeout(timerAnimationTimeout);
    
    // Bekukan bar kembali ke 100% jika dihentikan/reset
    timerBar.style.transition = 'width 0.5s ease';
    timerBar.style.width = '100%';
}