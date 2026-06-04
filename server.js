const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIG & DATABASE INITIALIZATION
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

if (supabase) {
    console.log('⚡ Terhubung ke Database Supabase cloud!');
}

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(express.json());
app.use(express.static('.')); 

// ==========================================
// EXPLICIT HTML ROUTING
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) res.status(404).send('File index.html tidak ditemukan!');
    });
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'), (err) => {
        if (err) res.status(404).send('File register.html tidak ditemukan!');
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'), (err) => {
        if (err) res.status(404).send('File login.html tidak ditemukan!');
    });
});

// ==========================================
// ROUTE / ENDPOINT API
// ==========================================

// 1. Endpoint mengambil Jadwal Pertandingan
app.get('/api/matches', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('matches')
            .select('*')
            .order('match_date', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data jadwal', details: error.message });
    }
});

// 2. Endpoint Kirim atau Update Tebakan Skor (Menggunakan UPSERT & FIX Kolom)
app.post('/api/predict', async (req, res) => {
    const { user_id, match_id, prediksi_home, prediksi_away } = req.body;

    if (!user_id || !match_id || prediksi_home === undefined || prediksi_away === undefined) {
        return res.status(400).json({ error: 'Data yang dikirim tidak lengkap, bro!' });
    }

    try {
        // Menggunakan .upsert() dengan onConflict menunjuk langsung ke nama kolom
        const { data, error } = await supabase
            .from('predictions')
            .upsert(
                { 
                    user_id, 
                    match_id, 
                    prediksi_home, 
                    prediksi_away 
                }, 
                { onConflict: 'user_id,match_id' }
            )
            .select();

        if (error) throw error;

        res.json({ message: 'Tebakan skor lo berhasil disimpan/diperbarui!', data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menyimpan tebakan', details: error.message });
    }
});

// 3. Endpoint Mengambil semua tebakan berdasarkan ID User tertentu
app.get('/api/predictions/:user_id', async (req, res) => {
    const { user_id } = req.params;
    try {
        const { data, error } = await supabase
            .from('predictions')
            .select('match_id, prediksi_home, prediksi_away')
            .eq('user_id', user_id);

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data tebakan user', details: error.message });
    }
});

// 4. Endpoint Register User (Mengembalikan Fungsi yang Sempat Hilang)
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Semua kolom pendaftaran wajib diisi, bro!' });
    }

    try {
        // Hash password menggunakan bcrypt sebelum disimpan ke database
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Memasukkan user baru ke tabel 'users' di Supabase
        const { data, error } = await supabase
            .from('users')
            .insert([
                { 
                    username, 
                    email, 
                    password_hash: passwordHash,
                    total_points: 0 
                }
            ])
            .select();

        if (error) {
            // Deteksi jika email atau username sudah terdaftar (Unique Constraint)
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Username atau Email sudah terdaftar!' });
            }
            throw error;
        }

        res.json({ message: 'Registrasi akun lo berhasil! Silakan login.', data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal melakukan registrasi akun', details: error.message });
    }
});

// 5. Endpoint Login User
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email dan password wajib diisi!' });
    }

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(400).json({ error: 'Email atau password salah!' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Email atau password salah!' });
        }

        res.json({
            message: 'Login berhasil!',
            user: { id: user.id, username: user.username, email: user.email }
        });
    } catch (error) {
        res.status(500).json({ error: 'Terjadi kesalahan pada server', details: error.message });
    }
});

// 6. Endpoint Admin: Update Skor & Hitung Poin Otomatis
app.post('/api/admin/update-match', async (req, res) => {
    const { match_id, score_home_actual, score_away_actual } = req.body;

    if (match_id === undefined || score_home_actual === undefined || score_away_actual === undefined) {
        return res.status(400).json({ error: 'Semua data skor wajib diisi!' });
    }

    const actualHome = parseInt(score_home_actual);
    const actualAway = parseInt(score_away_actual);

    try {
        const { data: matchData, error: matchError } = await supabase
            .from('matches')
            .update({ 
                home_score: actualHome, 
                away_score: actualAway,
                status: 'FINISHED' 
            })
            .eq('id', match_id)
            .select();

        if (matchError) throw matchError;

        const { data: predictions, error: predError } = await supabase
            .from('predictions')
            .select('*')
            .eq('match_id', match_id);

        if (predError) throw predError;

        if (predictions && predictions.length > 0) {
            for (const predict of predictions) {
                let poinTambahan = 0;

                // Aturan: Jika tebakan home dan away tepat sama dengan hasil asli, dapat 3 poin
                if (predict.prediksi_home === actualHome && predict.prediksi_away === actualAway) {
                    poinTambahan = 3;
                }

                if (poinTambahan > 0) {
                    const { data: userData } = await supabase
                        .from('users')
                        .select('total_points')
                        .eq('id', predict.user_id)
                        .single();

                    const poinBaru = (userData?.total_points || 0) + poinTambahan;

                    await supabase
                        .from('users')
                        .update({ total_points: poinBaru })
                        .eq('id', predict.user_id);
                }
            }
        }

        res.json({ 
            message: 'Skor berhasil diupdate & Poin user langsung dikalkulasi otomatis!', 
            data: matchData 
        });

    } catch (error) {
        res.status(500).json({ error: 'Gagal memproses skor dan poin', details: error.message });
    }
});

// 7. Endpoint Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('username, total_points')
            .order('total_points', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Gagal memuat leaderboard', details: error.message });
    }
});

// 8. Endpoint Admin: Tambah Jadwal Pertandingan Baru
app.post('/api/admin/add-match', async (req, res) => {
    const { stage, match_date, team_home, team_away } = req.body;

    if (!stage || !match_date || !team_home || !team_away) {
        return res.status(400).json({ error: 'Semua kolom jadwal wajib diisi, bro!' });
    }

    try {
        const { data, error } = await supabase
            .from('matches')
            .insert([
                { 
                    stage, 
                    match_date, 
                    home_team: team_home, 
                    away_team: team_away, 
                    status: 'SCHEDULED' 
                }
            ])
            .select();

        if (error) throw error;
        res.json({ message: 'Jadwal pertandingan baru berhasil ditambahkan!', data });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menambahkan jadwal', details: error.message });
    }
});

// 9. Endpoint Admin: Hapus Pertandingan & Tebakan Terkait (Aman dari Foreign Key Error)
app.delete('/api/admin/delete-match/:id', async (req, res) => {
    const matchId = req.params.id;

    if (!matchId) {
        return res.status(400).json({ error: 'ID Pertandingan tidak valid, bro!' });
    }

    try {
        // Langkah 1: Hapus semua tebakan user yang merujuk ke match ini terlebih dahulu
        const { error: predError } = await supabase
            .from('predictions')
            .delete()
            .eq('match_id', matchId);

        if (predError) throw predError;

        // Langkah 2: Hapus data pertandingan dari tabel matches
        const { data, error: matchError } = await supabase
            .from('matches')
            .delete()
            .eq('id', matchId)
            .select();

        if (matchError) throw matchError;

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Pertandingan tidak ditemukan di database.' });
        }

        res.json({ message: 'Pertandingan beserta seluruh tebakan user berhasil dihapus secara permanen!' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus pertandingan', details: error.message });
    }
});

// START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan mulus di http://localhost:${PORT}`);
});