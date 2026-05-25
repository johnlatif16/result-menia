require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'my_secret_key_change_it';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ========================
// إدارة الملفات (محاكاة قاعدة بيانات)
// ========================
const DATA_DIR = path.join(__dirname, 'data');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');

// التأكد من وجود مجلد البيانات
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// تحميل البيانات
function loadJSON(filePath, defaultValue = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath));
        }
    } catch(e) { console.error(e); }
    return defaultValue;
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// بيانات الطلاب (جدول واحد يحتوي على كل الطلاب)
let studentsDB = loadJSON(STUDENTS_FILE, {});
// إعدادات النظام (الترم، مجموع الدرجات، إلخ)
let settings = loadJSON(SETTINGS_FILE, {
    term: 'first', // 'first' or 'second'
    mainSubjects: [
        { name: "اللغة العربية", max: 40 },
        { name: "اللغة الإنجليزية", max: 30 },
        { name: "الجبر", max: 15 },
        { name: "الهندسة", max: 15 },
        { name: "العلوم", max: 20 },
        { name: "الدراسات الاجتماعية", max: 20 },
        { name: "فرانساوي", max: 10 }
    ],
    extraSubjects: [
        { name: "التربية الدينية", max: 20 },
        { name: "التربية الفنية", max: 10 },
        { name: "الحاسب الآلي", max: 10 },
        { name: "نشاط 2", max: 10 }
    ]
});
let searchLogs = loadJSON(LOGS_FILE, []);
let subscribers = loadJSON(SUBSCRIBERS_FILE, []); // لتخزين اشتراكات الإشعارات

// دوال الحفظ
function saveAll() {
    saveJSON(STUDENTS_FILE, studentsDB);
    saveJSON(SETTINGS_FILE, settings);
    saveJSON(LOGS_FILE, searchLogs.slice(0, 500));
    saveJSON(SUBSCRIBERS_FILE, subscribers);
}

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// التحقق من التوكن
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: 'Invalid token' });
        req.user = decoded;
        next();
    });
}

// ========================
// API Routes
// ========================

// 🔍 البحث عن طالب (للواجهة الأمامية)
app.get('/api/search', async (req, res) => {
    const seatNumber = req.query.seat;
    if (!seatNumber) {
        return res.json({ success: false, message: '⚠️ من فضلك أدخل رقم الجلوس' });
    }

    // البحث أولا في قاعدة البيانات المحلية
    if (studentsDB[seatNumber]) {
        const student = studentsDB[seatNumber];
        // تسجيل سجل البحث
        searchLogs.unshift({ seat: seatNumber, found: true, student_name: student.student_name, total_score: student.total_score, time: Date.now() });
        saveAll();
        return res.json({ success: true, student, source: 'local' });
    }

    // إذا لم يوجد، نبحث من API الخارجي
    const apiUrl = `https://www.natega4dk.net/api/governorates/menia/search?q=${seatNumber}&type=seat_number&page=1&per_page=20`;
    
    function fetchJSON(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                });
            }).on('error', reject);
        });
    }

    try {
        const data = await fetchJSON(apiUrl);
        if (data.data && data.data.length > 0) {
            const apiStudent = data.data[0];
            // تحويل البيانات إلى شكلنا
            const newStudent = {
                seat_number: apiStudent.seat_number,
                student_name: apiStudent.student_name,
                school: apiStudent.school,
                administration: apiStudent.administration,
                term: apiStudent.term,
                scores: {
                    "اللغة العربية": 0, "اللغة الإنجليزية": 0, "الجبر": 0, "الهندسة": 0,
                    "العلوم": 0, "الدراسات الاجتماعية": 0, "فرانساوي": 0,
                    "التربية الدينية": 0, "التربية الفنية": 0, "الحاسب الآلي": 0, "نشاط 2": 0
                },
                total_score: 0
            };
            
            searchLogs.unshift({ seat: seatNumber, found: true, student_name: newStudent.student_name, total_score: 0, time: Date.now() });
            saveAll();
            return res.json({ success: true, student: newStudent, source: 'api' });
        } else {
            searchLogs.unshift({ seat: seatNumber, found: false, time: Date.now() });
            saveAll();
            return res.json({ success: false, message: '❌ لا توجد نتيجة لهذا الرقم' });
        }
    } catch (error) {
        return res.json({ success: false, message: '⚠️ حدث خطأ في الاتصال بخادم النتائج' });
    }
});

// 📝 الحصول على كل الطلاب (للأدمن)
app.get('/api/admin/students', verifyToken, (req, res) => {
    const studentsList = Object.values(studentsDB);
    res.json({ success: true, students: studentsList, settings });
});

// ✏️ تعديل بيانات طالب معين
app.post('/api/admin/update-student', verifyToken, (req, res) => {
    const { seat_number, scores, total_score, student_name, school, administration } = req.body;
    if (!studentsDB[seat_number]) {
        studentsDB[seat_number] = {};
    }
    studentsDB[seat_number] = {
        ...studentsDB[seat_number],
        seat_number,
        student_name,
        school,
        administration,
        scores,
        total_score,
        updatedAt: Date.now()
    };
    saveAll();
    res.json({ success: true });
});

// ⚙️ تحديث الإعدادات العامة (المواد، مجموع الدرجات، الترم)
app.post('/api/admin/settings', verifyToken, (req, res) => {
    const { mainSubjects, extraSubjects, term } = req.body;
    if (mainSubjects) settings.mainSubjects = mainSubjects;
    if (extraSubjects) settings.extraSubjects = extraSubjects;
    if (term) settings.term = term;
    saveAll();
    res.json({ success: true, settings });
});

// 📊 إحصائيات لوحة التحكم
app.get('/api/admin/stats', verifyToken, (req, res) => {
    const totalSearches = searchLogs.length;
    const successfulSearches = searchLogs.filter(log => log.found).length;
    res.json({ 
        totalSearches,
        successfulSearches,
        successRate: totalSearches > 0 ? ((successfulSearches / totalSearches) * 100).toFixed(1) : 0,
        logs: searchLogs.slice(0, 50),
        totalStudents: Object.keys(studentsDB).length
    });
});

// 🔐 تسجيل الدخول
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ success: true, token });
    } else {
        res.json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    }
});

// ✅ التحقق من صحة التوكن
app.get('/api/verify-token', verifyToken, (req, res) => {
    res.json({ success: true });
});

// 🔔 تسجيل اشتراك للإشعارات
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    const existing = subscribers.find(s => s.endpoint === subscription.endpoint);
    if (!existing) {
        subscribers.push(subscription);
        saveAll();
    }
    res.json({ success: true });
});

// 🔔 إرسال إشعار لجميع المشتركين
app.post('/api/notify-all', verifyToken, async (req, res) => {
    const { title, body, url } = req.body;
    const webpush = require('web-push');
    
    // مفاتيح VAPID (لازم تولدها مرة واحدة وتحطها في .env)
    const vapidKeys = {
        publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUY5uU3xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6xGqF6',
        privateKey: process.env.VAPID_PRIVATE_KEY || 'your-private-key'
    };
    
    webpush.setVapidDetails(
        'mailto:admin@example.com',
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
    
    const notifications = subscribers.map(sub => 
        webpush.sendNotification(sub, JSON.stringify({ title, body, url })).catch(e => console.log(e))
    );
    
    await Promise.all(notifications);
    res.json({ success: true, count: subscribers.length });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
    console.log(`💾 Students loaded: ${Object.keys(studentsDB).length}`);
});