let timerInterval;
let timerSeconds = 0;
let activeOcrUrl = null; // Variabel untuk menyimpan URL yang berhasil

// Fungsi untuk mengonversi format MM:SS ke detik dengan validasi (Mencegah NaN)
function timeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
        return 0; // Jika kosong atau format salah, kembalikan 0
    }
    const [minutes, seconds] = timeStr.split(':').map(Number);
    if (isNaN(minutes) || isNaN(seconds)) {
        return 0; // Jika hasilnya bukan angka, kembalikan 0
    }
    return minutes * 60 + seconds;
}

// Fungsi untuk mengonversi detik ke format MM:SS dengan validasi
function secondsToTime(seconds) {
    if (isNaN(seconds) || seconds <= 0) return "00:00"; // Fallback aman jika belum jalan
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Fungsi untuk memulai timer dari waktu awal + 2 detik
function startTimer(initialTime) {
    if (timerInterval) {
        clearInterval(timerInterval); // Hentikan interval sebelumnya
    }
    timerSeconds = timeToSeconds(initialTime) + 2; 
    document.getElementById('timer').textContent = secondsToTime(timerSeconds);
    
    timerInterval = setInterval(() => {
        timerSeconds++;
        document.getElementById('timer').textContent = secondsToTime(timerSeconds);
    }, 1000);
}

// Fungsi untuk mencari URL mana yang merespon (Localhost atau IP)
async function determineOcrUrl() {
    // Opsi 1: Coba koneksi ke localhost
    try {
        const resLocal = await fetch('http://localhost:14337/MLBB.json');
        if (resLocal.ok) return 'http://localhost:14337/MLBB.json';
    } catch (e) {
        console.log("Localhost tidak merespon, beralih mencoba IP Host...");
    }

    // Opsi 2: Baca file serverip.txt yang di-generate oleh server.js
    try {
        // Tambahkan cache buster saat membaca IP agar tidak nyangkut IP lama
        const resIp = await fetch(`/serverip.txt?t=${new Date().getTime()}`);
        if (resIp.ok) {
            const hostIp = await resIp.text();
            const lanUrl = `http://${hostIp.trim()}:14337/MLBB.json`;
            
            const resLan = await fetch(lanUrl);
            if (resLan.ok) return lanUrl;
        }
    } catch (e) {
        console.log("Gagal membaca IP dari serverip.txt atau koneksi LAN ditolak.");
    }

    return null; 
}

// Fungsi untuk mengambil data JSON dan memperbarui tampilan
async function fetchGameData() {
    try {
        if (!activeOcrUrl) {
            activeOcrUrl = await determineOcrUrl();
            
            if (!activeOcrUrl) {
                console.error('Data OCR tidak ditemukan baik di Localhost maupun IP LAN.');
                return; 
            }
            console.log(`Koneksi OCR berhasil menggunakan URL: ${activeOcrUrl}`);
        }

        // --- PERBAIKAN UTAMA: Cache-Busting ---
        // Menambahkan timestamp unik agar browser menganggap ini URL baru setiap detiknya
        const cacheBuster = new Date().getTime();
        const fetchUrl = `${activeOcrUrl}?t=${cacheBuster}`;

        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            cache: 'no-store' // Memaksa browser melewati cache
        });

        if (!response.ok) {
            throw new Error(`Gagal mengambil data, status HTTP: ${response.status}`);
        }

        const data = await response.json();

        const elementsToUpdate = {
            'homescore': data.killscore1,
            'awayscore': data.killscore2,
            'bluegold': data.gold1,
            'redgold': data.gold2,
            'bluetower': data.turret1,
            'redtower': data.turret2,
            'bluelord': data.lord1,
            'redlord': data.lord2
        };

        // Perbarui nilai untuk elemen di HTML
        for (const [id, value] of Object.entries(elementsToUpdate)) {
            const el = document.getElementById(id);
            if (el && value !== undefined) {
                el.textContent = value;
            }
        }

        // --- LOGIC TIMER BARU ---
        const currentTimerSeconds = timeToSeconds(data.timer);

        if (currentTimerSeconds === 0) {
            // Jika timer di game masih 00:00 atau OCR gagal baca (NaN)
            document.getElementById('timer').textContent = "00:00";
            
            // Matikan interval lokal agar fetchGameData terus mengecek/refresh data JSON tiap detik
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null; 
            }
        } else {
            // Jika timer sudah terbaca dan berjalan (> 0)
            if (!timerInterval) {
                // Mulai interval timer lokal agar berjalan mulus di overlay
                startTimer(data.timer);
            }
        }

    } catch (error) {
        console.error('Error fetching data:', error);
        // Jika koneksi putus, reset activeOcrUrl agar bisa mencari IP lagi di siklus berikutnya
        activeOcrUrl = null; 
    }
}

// Panggil fetchGameData pertama kali saat halaman dimuat
fetchGameData();

// Perbarui data setiap 1 detik
setInterval(fetchGameData, 1000);