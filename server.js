// Phase 1: Le Cerveau (Backend)
// Ce fichier sera le coeur de notre serveur.

const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = '/mnt/data/hub_coran.db';

// Connexion à la base de données
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connecté à la base de données SQLite.');
});

// Middleware pour comprendre le JSON envoyé par le frontend
app.use(express.json());

// Middleware pour servir les fichiers statiques (HTML, CSS, JS du frontend)
app.use(express.static('public'));

// Première route API pour obtenir la liste des sourates
app.get('/api/surahs', (req, res) => {
    const sql = `SELECT * FROM surahs ORDER BY id`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ surahs: rows });
    });
});

// Nouvelle route pour obtenir la progression d'une sourate spécifique
app.get('/api/surah/:id/progress', (req, res) => {
    const surahId = req.params.id;
    const response = {
        total_verses: 0,
        progress: {
            Soukaina: 0,
            Siham: 0,
            Chaimaa: 0
        }
    };

    // 1. Compter le nombre total de versets dans la sourate
    const countSql = `SELECT COUNT(*) as total FROM ayahs WHERE surah_id = ?`;
    db.get(countSql, [surahId], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        response.total_verses = row.total;

        // 2. Compter les versets mémorisés par utilisateur
        const progressSql = `
            SELECT p.user_name, COUNT(p.ayah_id) as memorized_count
            FROM progress p
            JOIN ayahs a ON a.id = p.ayah_id
            WHERE a.surah_id = ? AND p.is_memorized = 1
            GROUP BY p.user_name`;
        
        db.all(progressSql, [surahId], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            rows.forEach(r => {
                if (response.progress.hasOwnProperty(r.user_name)) {
                    response.progress[r.user_name] = r.memorized_count;
                }
            });
            res.json(response);
        });
    });
});

// Route pour récupérer les versets d'une sourate avec la progression
app.get('/api/surah/:id/verses', (req, res) => {
    const surahId = req.params.id;
    const sql = `
        SELECT 
            a.id, a.verse_number, a.text_warsh,
            MAX(CASE WHEN p.user_name = 'Soukaina' THEN p.is_memorized ELSE 0 END) as soukaina_mem,
            MAX(CASE WHEN p.user_name = 'Siham' THEN p.is_memorized ELSE 0 END) as siham_mem,
            MAX(CASE WHEN p.user_name = 'Chaimaa' THEN p.is_memorized ELSE 0 END) as chaimaa_mem
        FROM ayahs a
        LEFT JOIN progress p ON a.id = p.ayah_id
        WHERE a.surah_id = ?
        GROUP BY a.id
        ORDER BY a.verse_number;
    `;
    db.all(sql, [surahId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ verses: rows });
    });
});

// Route pour mettre à jour la progression
app.post('/api/progress', (req, res) => {
    const { ayah_id, user_name, is_memorized } = req.body;
    // UPSERT: Met à jour si existant, sinon insère.
    const sql = `
        INSERT INTO progress (ayah_id, user_name, is_memorized, memorized_at)
        VALUES (?, ?, ?, CURRENT_DATE)
        ON CONFLICT(ayah_id, user_name) DO UPDATE SET
        is_memorized = excluded.is_memorized,
        memorized_at = CURRENT_DATE;
    `;
    db.run(sql, [ayah_id, user_name, is_memorized], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Progression mise à jour avec succès.' });
    });
});

// API pour les notes
app.get('/api/ayah/:id/notes', (req, res) => {
    const ayahId = req.params.id;
    const sql = `SELECT user_name, note_text, created_at FROM notes WHERE ayah_id = ? ORDER BY created_at DESC`;
    db.all(sql, [ayahId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ notes: rows });
    });
});

app.post('/api/notes', (req, res) => {
    const { ayah_id, user_name, note_text } = req.body;
    const sql = `INSERT INTO notes (ayah_id, user_name, note_text) VALUES (?, ?, ?)`;
    db.run(sql, [ayah_id, user_name, note_text], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Note ajoutée avec succès.', note_id: this.lastID });
    });
});

// API pour lancer le remplissage de la DB
app.post('/api/populate-database', async (req, res) => {
    console.log('Requête de remplissage de la base de données reçue.');
    res.status(202).json({ message: "Le remplissage de la base de données a commencé. Cela peut prendre quelques minutes." }); // Accepte la requête immédiatement

    // Lance le long processus en arrière-plan
    try {
        const url = 'https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/main/warsh/data/warshData_v10.json';
        const response = await axios.get(url);
        const quranData = response.data;

        const surahInsertSql = `INSERT INTO surahs (id, name, revelation_type) VALUES (?, ?, ?)`;
        const ayahInsertSql = `INSERT INTO ayahs (surah_id, verse_number, text_warsh) VALUES (?, ?, ?)`;

        for (const surah of quranData) {
            if (!surah || !surah.surah_name) continue;
            await new Promise((resolve, reject) => {
                db.run(surahInsertSql, [surah.surah_number, surah.surah_name, surah.revelation_place], (err) => err ? reject(err) : resolve());
            });
            for (const verse of surah.verses) {
                await new Promise((resolve, reject) => {
                    db.run(ayahInsertSql, [surah.surah_number, verse.verse_number, verse.verse_text], (err) => err ? reject(err) : resolve());
                });
            }
            console.log(`Sourate ${surah.surah_number} (${surah.surah_name}) chargée.`);
        }
        console.log('Remplissage de la base de données terminé.');
    } catch (error) {
        console.error('Erreur majeure lors du remplissage de la DB:', error.message);
    }
});


app.listen(port, () => {
  console.log(`L\'application est démarrée sur http://localhost:${port}`);
});