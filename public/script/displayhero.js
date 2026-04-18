let allHeroes = [];
let lastPlayed = {};
let currentDraftData = null;
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

    // Map image-box index to pick container class for flash/confirmed
    const pickBoxMap = {
        1: '.pickb1', 2: '.pickb2', 3: '.pickb3', 4: '.pickb4', 5: '.pickb5',
        6: '.pickr5', 7: '.pickr4', 8: '.pickr3', 9: '.pickr2', 10: '.pickr1'
    };
    // Map image-box index to ban container for banned class
    // Bans: 11-15 = blue bans (left), 16-20 = red bans (right)
    const banBoxMap = {};
    // Blue bans: image-box 11-15 -> ban divs (1st to 5th .ban on left)
    // Red bans: image-box 16-20 -> ban divs (right side, reversed)

    for (let i = 1; i <= 20; i++) {
        let imgSrc = map[i];
        let imgElement = document.getElementById(`image-display-${i}`);
        let boxElement = document.getElementById(`image-box-${i}`);

        if (imgElement && boxElement) {
            if (imgSrc) {
                const isNew = !imgElement.src.endsWith(imgSrc);
                if (isNew) {
                     imgElement.src = imgSrc;
                     const voiceSrc = getVoiceByImg(imgSrc);
                     if (voiceSrc && lastPlayed[i] !== imgSrc) {
                         playVoice(voiceSrc, i);
                         lastPlayed[i] = imgSrc;
                     }

                     // Trigger flash + confirmed for picks
                     if (i >= 1 && i <= 10 && pickBoxMap[i]) {
                         const pickEl = document.querySelector(pickBoxMap[i]);
                         if (pickEl) {
                             pickEl.classList.remove('flash');
                             void pickEl.offsetWidth; // force reflow
                             pickEl.classList.add('flash', 'confirmed');
                         }
                     }

                     // Trigger banned class for bans
                     if (i >= 11 && i <= 20) {
                         const banEl = boxElement.closest('.ban');
                         if (banEl) {
                             banEl.classList.add('banned');
                         }
                     }
                }
                // Remove pending if this slot is now locked
                boxElement.classList.remove('pending');
                imgElement.style.display = "";
                boxElement.classList.add("show");
            } else {
                imgElement.src = "";
                imgElement.style.opacity = "0";
                boxElement.classList.remove("show", "pending");
                lastPlayed[i] = null;

                // Remove confirmed/flash for picks
                if (i >= 1 && i <= 10 && pickBoxMap[i]) {
                    const pickEl = document.querySelector(pickBoxMap[i]);
                    if (pickEl) pickEl.classList.remove('flash', 'confirmed');
                }
                // Remove banned for bans
                if (i >= 11 && i <= 20) {
                    const banEl = boxElement.closest('.ban');
                    if (banEl) banEl.classList.remove('banned');
                }
            }
        }
    }

    // --- DIMMED PENDING PREVIEW (selected but not yet locked) ---
    const selectedHero = newData.selected_hero;
    const currentPhaseIndex = parseInt(newData.current_phase) || 0;

    if (selectedHero && typeof phasesActiveBoxes !== 'undefined' && currentPhaseIndex < phasesActiveBoxes.length - 1) {
        const activeBoxId = (phasesActiveBoxes[currentPhaseIndex] && phasesActiveBoxes[currentPhaseIndex][0]) || '';
        let pendingImgSrc = null;
        let slotRange = null;

        if (activeBoxId.startsWith('ban-left')) {
            pendingImgSrc = selectedHero.blue;
            slotRange = [11, 15];
        } else if (activeBoxId.startsWith('ban-right')) {
            pendingImgSrc = selectedHero.red;
            slotRange = [16, 20];
        } else if (activeBoxId.startsWith('pick-left')) {
            pendingImgSrc = selectedHero.blue;
            slotRange = [1, 5];
        } else if (activeBoxId.startsWith('pick-right')) {
            pendingImgSrc = selectedHero.red;
            slotRange = [6, 10];
        }

        if (pendingImgSrc && slotRange) {
            // Show dimmed preview on the first empty slot in range
            for (let i = slotRange[0]; i <= slotRange[1]; i++) {
                if (!map[i]) {
                    const img = document.getElementById(`image-display-${i}`);
                    const box = document.getElementById(`image-box-${i}`);
                    if (img && box && !box.classList.contains('show')) {
                        if (!img.src.endsWith(pendingImgSrc)) {
                            img.src = pendingImgSrc;
                        }
                        box.classList.add('pending');
                    }
                    break;
                }
            }
        }
    }
}

// --- 4. TIMER & PHASE UI LOGIC ---

const phaseElement = document.getElementById('phase');
const arrowElement = document.getElementById('arrow');
const timerElement = document.getElementById('timer');
const timerBar = document.getElementById('timer-bar');
const timerNumberEl = document.getElementById('timer-number');
const timerRingProgress = document.getElementById('timer-ring-progress');
const TIMER_MAX = 60; // max timer value for progress ring

const phases = [
    { type: "BANNING", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/RightBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/RightBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/RightBanning.gif" },
    { type: "PICKING", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "PICKING", direction: "/Assets/Other/RightPicking.gif" },
    { type: "PICKING", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "PICKING", direction: "/Assets/Other/RightPicking.gif" },
    { type: "BANNING", direction: "/Assets/Other/RightBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/RightBanning.gif" },
    { type: "BANNING", direction: "/Assets/Other/LeftBanning.gif" },
    { type: "PICKING", direction: "/Assets/Other/RightPicking.gif" },
    { type: "PICKING", direction: "/Assets/Other/LeftPicking.gif" },
    { type: "PICKING", direction: "/Assets/Other/RightPicking.gif" },
    { type: "ADJUSTMENT", direction: "/Assets/Other/Adjustment.gif" }
];

const phasesActiveBoxes = [
    ["ban-left-1"], ["ban-right-1"], ["ban-left-2"], ["ban-right-2"],
    ["ban-left-3"], ["ban-right-3"], ["pick-left-1"], ["pick-right-1", "pick-right-2"],
    ["pick-left-2", "pick-left-3"], ["pick-right-3"], ["ban-right-4"], ["ban-left-4"],
    ["ban-right-5"], ["ban-left-5"], ["pick-right-4"], ["pick-left-4", "pick-left-5"],
    ["pick-right-5"], []
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
    const isDraftDone = currentPhaseIndex >= phases.length - 1;

    if (phaseElement && arrowElement) {
        if (isDraftDone) {
            phaseElement.textContent = "";
            arrowElement.src = "";
        } else if (currentPhaseIndex < phases.length) {
            const currentPhase = phases[currentPhaseIndex];
            phaseElement.textContent = currentPhase.type;

            if (!arrowElement.src.endsWith(currentPhase.direction)) {
                arrowElement.src = currentPhase.direction;
            }
        }
    }

    // Show VS in center timer when draft is done
    const timerLabelEl = document.getElementById('timer-label');
    if (timerNumberEl) {
        if (isDraftDone) {
            timerNumberEl.textContent = 'VS';
            timerNumberEl.classList.remove('urgent');
            timerNumberEl.style.fontSize = '42px';
            timerNumberEl.style.color = '#c62828';
            if (timerLabelEl) timerLabelEl.style.display = 'none';
        } else {
            timerNumberEl.style.fontSize = '';
            timerNumberEl.style.color = '';
            if (timerLabelEl) timerLabelEl.style.display = '';
        }
    }
    // Hide timer bar when done
    if (timerBar && isDraftDone) {
        timerBar.style.width = '0%';
        timerBar.style.transition = 'width 1s ease';
        timerBar.classList.remove('urgent');
    }
    // Hide ring progress when done
    if (timerRingProgress && isDraftDone) {
        timerRingProgress.style.background = 'none';
    }

    // Logic Active Box
    document.querySelectorAll(".box").forEach(box => {
        box.classList.remove("active-ban", "active-pick");
    });

    if (currentPhaseIndex < phasesActiveBoxes.length) {
        phasesActiveBoxes[currentPhaseIndex].forEach(boxId => {
            const phaseBox = document.getElementById(boxId);
            if (phaseBox) {
                const isBanPhase = (currentPhaseIndex < 6) || (currentPhaseIndex >= 10 && currentPhaseIndex <= 13);
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

    // 1b. Update Big Center Timer
    if (timerNumberEl) {
        timerNumberEl.textContent = String(timerNum).padStart(2, '0');
        // Urgent mode when <= 10 seconds
        if (timerNum <= 10 && isRunning) {
            timerNumberEl.classList.add('urgent');
        } else {
            timerNumberEl.classList.remove('urgent');
        }
    }
    // Update ring progress
    if (timerRingProgress) {
        const pct = Math.max(0, (timerNum / TIMER_MAX) * 100);
        timerRingProgress.style.background = `conic-gradient(
            rgba(139,92,246,0.25) ${pct}%,
            transparent ${pct}%
        )`;
    }

    // 2. Sync bar width directly with timer value (no drift)
    if (timerBar) {
        const pct = Math.max(0, (timerNum / TIMER_MAX) * 100);

        if (!isRunning || phaseChanged) {
            // Instant jump (no transition) on stop or phase change
            timerBar.style.transition = 'none';
            timerBar.style.width = pct + '%';
        } else {
            // Smooth 1s transition between ticks
            timerBar.style.transition = 'width 1s linear';
            timerBar.style.width = pct + '%';
        }

        // Urgent styling when <= 10 seconds
        if (timerNum <= 10 && isRunning) {
            timerBar.classList.add('urgent');
        } else {
            timerBar.classList.remove('urgent');
        }
    }

    lastRunningState = isRunning;
}