const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const db = new sqlite3.Database('./hub_coran.db', (err) => {
    if (err) {
        console.error(err.message);
        return;
    }
    console.log('Connecté à la base de données SQLite.');
});

const createTables = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS surahs (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                revelation_type TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS ayahs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                surah_id INTEGER NOT NULL,
                verse_number INTEGER NOT NULL,
                text_warsh TEXT NOT NULL,
                FOREIGN KEY (surah_id) REFERENCES surahs (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS progress (
                ayah_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                is_memorized INTEGER DEFAULT 0,
                memorized_at DATE,
                PRIMARY KEY (ayah_id, user_name),
                FOREIGN KEY (ayah_id) REFERENCES ayahs (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ayah_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                note_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ayah_id) REFERENCES ayahs (id)
            )`, (err) => {
                if (err) reject(err);
                else {
                    console.log('Tables créées avec succès.');
                    resolve();
                }
            });
        });
    });
};

const populateData = async () => {
    console.log('Début du téléchargement du fichier Coran (Warsh)... Soyez patient.');
    const url = 'https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/main/warsh/data/warshData_v10.json';

    try {
        const response = await axios.get(url);
        const quranData = response.data;

        const surahInsertSql = `INSERT INTO surahs (id, name, revelation_type) VALUES (?, ?, ?)`;
        const ayahInsertSql = `INSERT INTO ayahs (surah_id, verse_number, text_warsh) VALUES (?, ?, ?)`;

        for (const surah of quranData) {
            if (!surah || !surah.surah_name) continue;

            await new Promise((resolve, reject) => {
                db.run(surahInsertSql, [surah.surah_number, surah.surah_name, surah.revelation_place], function(err) {
                    if (err) reject(err); else resolve();
                });
            });

            for (const verse of surah.verses) {
                await new Promise((resolve, reject) => {
                    db.run(ayahInsertSql, [surah.surah_number, verse.verse_number, verse.verse_text], function(err) {
                        if (err) reject(err); else resolve();
                    });
                });
            }
            console.log(`Sourate ${surah.surah_number} (${surah.surah_name}) chargée.`);
        }

        console.log('Remplissage de la base de données terminé.');
    } catch (error) {
        console.error('Erreur lors du téléchargement ou du traitement du fichier:', error.message);
    }
};

const run = async () => {
    await createTables();

    // Vérifier si la table surahs est vide avant de la remplir
    const count = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM surahs", (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });

    if (count === 0) {
        await populateData();
    } else {
        console.log('Base de données déjà remplie. Saut du remplissage.');
    }

    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Connexion à la base de données fermée.');
    });
};

run();
