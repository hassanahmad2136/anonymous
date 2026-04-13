// script/matchrecorder.js

// Variabel global untuk melacak status konfirmasi dan timer pada tombol hapus
let deleteConfirmTimeout;
let isDeleteConfirmed = false;

async function handleSaveDraft(buttonElement) {
    // Simpan teks & warna asli tombol untuk feedback visual
    const originalText = buttonElement.innerText;
    const originalColor = buttonElement.style.color;
    const originalBorder = buttonElement.style.borderColor;

    // Ubah status tombol jadi "Saving..."
    buttonElement.innerText = "SAVING...";
    buttonElement.disabled = true;
    buttonElement.style.color = "yellow";
    buttonElement.style.borderColor = "yellow";
    buttonElement.style.cursor = "wait";

    try {
        const response = await fetch('/api/save-match-record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            // Sukses
            buttonElement.innerText = "SAVED!";
            buttonElement.style.color = "#00FF8C"; // Hijau cerah
            buttonElement.style.borderColor = "#00FF8C";
            console.log("Match data successfully archived.");
        } else {
            // Gagal dari server
            buttonElement.innerText = "ERROR";
            buttonElement.style.color = "red";
            buttonElement.style.borderColor = "red";
            console.error("Server failed to archive match data.");
        }

    } catch (error) {
        // Error koneksi/jaringan
        console.error("Network error:", error);
        buttonElement.innerText = "NET ERR";
        buttonElement.style.color = "red";
        buttonElement.style.borderColor = "red";
    }

    // Kembalikan tombol ke kondisi semula setelah 2 detik
    setTimeout(() => {
        buttonElement.innerText = originalText;
        buttonElement.style.color = originalColor;
        buttonElement.style.borderColor = originalBorder;
        buttonElement.disabled = false;
        buttonElement.style.cursor = "pointer";
    }, 2000);
}

// Fitur Delete All Records dengan Double Confirmation
async function handleDeleteAllRecords(buttonElement) {
    // Simpan teks & warna asli tombol untuk feedback visual
    // Menggunakan dataset agar state original tidak hilang saat di-replace "ARE YOU SURE?"
    const originalText = buttonElement.dataset.origText || buttonElement.innerText;
    const originalColor = buttonElement.dataset.origColor || buttonElement.style.color;
    const originalBorder = buttonElement.dataset.origBorder || buttonElement.style.borderColor;

    // Simpan data original ke dataset pada interaksi pertama
    if (!buttonElement.dataset.origText) {
        buttonElement.dataset.origText = originalText;
        buttonElement.dataset.origColor = originalColor;
        buttonElement.dataset.origBorder = originalBorder;
    }

    // =====================================
    // KLIK PERTAMA: Minta Konfirmasi
    // =====================================
    if (!isDeleteConfirmed) {
        isDeleteConfirmed = true;
        
        // Ubah tampilan tombol untuk peringatan
        buttonElement.innerText = "ARE YOU SURE?";
        buttonElement.style.color = "red";
        buttonElement.style.borderColor = "red";

        // Jika tidak diklik lagi dalam 3 detik, kembalikan ke semula
        deleteConfirmTimeout = setTimeout(() => {
            isDeleteConfirmed = false;
            buttonElement.innerText = originalText;
            buttonElement.style.color = originalColor;
            buttonElement.style.borderColor = originalBorder;
        }, 3000);
        
        return; // Hentikan eksekusi di sini sampai user klik lagi
    }

    // =====================================
    // KLIK KEDUA: Eksekusi Penghapusan
    // =====================================
    
    // Batalkan timeout pengembalian tombol karena user sudah konfirmasi
    clearTimeout(deleteConfirmTimeout); 
    isDeleteConfirmed = false; // Reset status untuk penggunaan berikutnya

    // Ubah status tombol jadi "DELETING..."
    buttonElement.innerText = "DELETING...";
    buttonElement.disabled = true;
    buttonElement.style.color = "yellow";
    buttonElement.style.borderColor = "yellow";
    buttonElement.style.cursor = "wait";

    try {
        const response = await fetch('/api/delete-all-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            // Sukses
            buttonElement.innerText = "DELETED!";
            buttonElement.style.color = "#00FF8C"; // Hijau cerah
            buttonElement.style.borderColor = "#00FF8C";
            console.log("All saved matches have been deleted from database.");
        } else {
            // Gagal dari server
            buttonElement.innerText = "ERROR";
            buttonElement.style.color = "red";
            buttonElement.style.borderColor = "red";
            console.error("Server failed to delete match data.");
        }

    } catch (error) {
        // Error koneksi/jaringan
        console.error("Network error:", error);
        buttonElement.innerText = "NET ERR";
        buttonElement.style.color = "red";
        buttonElement.style.borderColor = "red";
    }

    // Kembalikan tombol ke kondisi semula setelah 2 detik
    setTimeout(() => {
        buttonElement.innerText = originalText;
        buttonElement.style.color = originalColor;
        buttonElement.style.borderColor = originalBorder;
        buttonElement.disabled = false;
        buttonElement.style.cursor = "pointer";
    }, 2000);
}