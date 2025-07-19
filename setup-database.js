const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const db = new Database('icarus.db', { verbose: console.log });
const saltRounds = 10; // Şifreleme gücü

function setupDb() {
    const setupTransaction = db.transaction(() => {
        // KULLANICILAR TABLOSU
        db.prepare(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
        `).run();

        // PROJELER TABLOSUNA user_id SÜTUNU EKLENDİ
        db.prepare(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `).run();
        
        // SEGMENTLER TABLOSU (Değişiklik yok)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_text TEXT NOT NULL,
                translation_text TEXT,
                project_id INTEGER NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        `).run();

        // Veritabanı boşsa, bir test kullanıcısı ve ona ait projeler ekle
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        if (userCount === 0) {
            console.log('Test kullanıcısı ve verileri ekleniyor...');
            // Şifreyi hash'leyerek kaydet
            const hashedPassword = bcrypt.hashSync('12345', saltRounds);
            const userInfo = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
                                .run('testuser', hashedPassword);
            const userId = userInfo.lastInsertRowid;

            // Bu kullanıcıya ait projeleri ekle
            const projectInfo = db.prepare('INSERT INTO projects (name, user_id) VALUES (?, ?)')
                                  .run('Kurumsal Web Sitesi', userId);
            const projectId1 = projectInfo.lastInsertRowid;
            // ... (diğer projeler ve segmentler de aynı şekilde eklenebilir)
        }
    });
    setupTransaction();
    console.log('Veritabanı kurulumu (kullanıcı desteğiyle) tamamlandı.');
}
setupDb();