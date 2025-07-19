const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;
const db = new Database('icarus.db');
const saltRounds = 10;

app.use(express.json());
const upload = multer({ dest: 'uploads/' });

app.use(session({
    secret: 'bu-cok-gizli-bir-anahtar-olmalı',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 gün
}));

const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Lütfen giriş yapın.' });
    }
};

// --- KULLANICI API'LERİ ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Kullanıcı adı ve şifre gerekli.' });
    try {
        const hashedPassword = bcrypt.hashSync(password, saltRounds);
        const info = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);
        req.session.userId = info.lastInsertRowid;
        res.json({ success: true, username: username });
    } catch (error) {
        res.status(409).json({ message: 'Bu kullanıcı adı zaten alınmış.' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.userId = user.id;
        res.json({ success: true, username: user.username });
    } else {
        res.status(401).json({ message: 'Geçersiz kullanıcı adı veya şifre.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ message: 'Çıkış yapılamadı.' });
        res.json({ success: true });
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
        res.json({ loggedIn: true, user: user });
    } else {
        res.json({ loggedIn: false });
    }
});

// --- GÜVENLİ PROJE API'LERİ ---
app.get('/api/projects', isAuthenticated, (req, res) => {
    try {
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(req.session.userId);
        res.json(projects);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/segments/:projectId', isAuthenticated, (req, res) => {
    try {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.projectId, req.session.userId);
        if (!project) return res.status(403).json({ error: 'Yetkisiz erişim.' });
        const segments = db.prepare('SELECT id, source_text AS source, translation_text AS translation FROM segments WHERE project_id = ?').all(req.params.projectId);
        res.json(segments);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/save', isAuthenticated, (req, res) => {
    try {
        const { id, newTranslation } = req.body;
        db.prepare('UPDATE segments SET translation_text = ? WHERE id = ?').run(newTranslation, id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === GÜNCELLENMİŞ VE AKILLI YÜKLEME API'Sİ ===
app.post('/api/upload', isAuthenticated, upload.single('projectFile'), (req, res) => {
    try {
        const projectName = req.body.projectName;
        const file = req.file;
        if (!projectName || !file) { return res.status(400).json({ success: false, message: 'Eksik bilgi.' }); }
        
        const filePath = file.path;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        let segmentsToInsert = [];

        if (path.extname(file.originalname).toLowerCase() === '.json') {
            const jsonObject = JSON.parse(fileContent);
            for (const key in jsonObject) { segmentsToInsert.push({ source: key, translation: jsonObject[key] || '' }); }
        } else if (path.extname(file.originalname).toLowerCase() === '.txt') {
            // Metni hem satırlara hem de cümlelere göre bölen mantık
            const paragraphs = fileContent.split(/\r?\n/);
            paragraphs.forEach(paragraph => {
                if (paragraph.trim() === '') return;
                const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) || [paragraph];
                sentences.forEach(sentence => {
                    const trimmedSentence = sentence.trim();
                    if (trimmedSentence) {
                        segmentsToInsert.push({ source: trimmedSentence, translation: '' });
                    }
                });
            });
        } else {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Desteklenmeyen format.' });
        }
        
        const transaction = db.transaction(() => {
            const projectInfo = db.prepare('INSERT INTO projects (name, user_id) VALUES (?, ?)').run(projectName, req.session.userId);
            const newProjectId = projectInfo.lastInsertRowid;
            const insertSegment = db.prepare('INSERT INTO segments (source_text, translation_text, project_id) VALUES (?, ?, ?)');
            for (const seg of segmentsToInsert) { insertSegment.run(seg.source, seg.translation, newProjectId); }
            return newProjectId;
        });

        const newProjectId = transaction();
        fs.unlinkSync(filePath);
        res.json({ success: true, newProjectId: newProjectId });
    } catch (e) {
        console.error("Yükleme hatası:", e);
        res.status(500).json({ success: false, message: 'Proje oluşturulamadı.' });
    }
});

app.delete('/api/projects/:projectId', isAuthenticated, (req, res) => {
    try {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(req.params.projectId, req.session.userId);
        if (!project) {
            return res.status(403).json({ message: 'Bu projeyi silme yetkiniz yok.' });
        }
        const info = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.projectId);
        if (info.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`ICARUS sunucusu http://localhost:${PORT} adresinde çalışıyor!`));