require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'my_secret_key';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ========================
// تهيئة Firebase
// ========================
let firebaseConfig;
try {
    // محاولة قراءة الـ config من الـ .env
    if (process.env.FIREBASE_CONFIG) {
        firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        // لو في بيئة محلية وحابب تستخدم ملف JSON مباشرة
        firebaseConfig = require('./firebase-key.json');
    }
    
    // تهيئة Firebase Admin
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(firebaseConfig),
            databaseURL: `https://${firebaseConfig.project_id}.firebaseio.com` // اختياري لـ Realtime DB
        });
    }
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    process.exit(1);
}

// استخدام Firestore (قاعدة بيانات مرنة)
const db = admin.firestore();

// ========================
// مراجع المجموعات (Collections)
// ========================
const studentsCollection = db.collection('students');
const logsCollection = db.collection('searchLogs');
const settingsCollection = db.collection('settings');
const subscribersCollection = db.collection('subscribers');

// الإعدادات الافتراضية
const DEFAULT_SETTINGS = {
    term: 'first',
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
};

// ========================
// دوال مساعدة Firebase
// ========================

// جلب الإعدادات
async function getSettings() {
    const doc = await settingsCollection.doc('appSettings').get();
    if (!doc.exists) {
        await settingsCollection.doc('appSettings').set(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
    return doc.data();
}

// حفظ الإعدادات
async function saveSettings(settings) {
    await settingsCollection.doc('appSettings').set(settings);
}

// جلب طالب برقم الجلوس
async function getStudent(seatNumber) {
    const doc = await studentsCollection.doc(seatNumber).get();
    if (doc.exists) {
        return { id: doc.id, ...doc.data() };
    }
    return null;
}

// حفظ أو تحديث طالب
async function saveStudent(seatNumber, studentData) {
    await studentsCollection.doc(seatNumber).set(studentData, { merge: true });
}

// جلب كل الطلاب
async function getAllStudents() {
    const snapshot = await studentsCollection.get();
    const students = [];
    snapshot.forEach(doc => {
        students.push({ id: doc.id, ...doc.data() });
    });
    return students;
}

// تسجيل عملية بحث
async function saveSearchLog(logData) {
    const logRef = logsCollection.doc(); // ID تلقائي
    await logRef.set({
        ...logData,
        time: logData.time || Date.now()
    });
}

// جلب سجل البحث (آخر 50)
async function getSearchLogs(limit = 50) {
    const snapshot = await logsCollection
        .orderBy('time', 'desc')
        .limit(limit)
        .get();
    const logs = [];
    snapshot.forEach(doc => {
        logs.push({ id: doc.id, ...doc.data() });
    });
    return logs;
}

// جلب عدد الوثائق في مجموعة
async function getCount(collection, filter = null) {
    let query = collection;
    if (filter) {
        query = collection.where(filter.field, filter.operator, filter.value);
    }
    const snapshot = await query.get();
    return snapshot.size;
}

// حفظ اشتراك إشعار
async function saveSubscription(subscription) {
    await subscribersCollection.doc(subscription.endpoint).set(subscription);
}

// جلب كل الاشتراكات
async function getAllSubscriptions() {
    const snapshot = await subscribersCollection.get();
    const subscriptions = [];
    snapshot.forEach(doc => {
        subscriptions.push(doc.data());
    });
    return subscriptions;
}

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// 🔍 البحث عن طالب
app.get('/api/search', async (req, res) => {
    const seatNumber = req.query.seat;
    if (!seatNumber) {
        return res.json({ success: false, message: '⚠️ من فضلك أدخل رقم الجلوس' });
    }

    try {
        // البحث في Firebase أولاً
        let student = await getStudent(seatNumber);
        
        if (!student) {
            // محاولة جلب من API الخارجي
            const https = require('https');
            const apiUrl = `https://www.natega4dk.net/api/governorates/menia/search?q=${seatNumber}&type=seat_number&page=1&per_page=20`;
            
            const fetchJSON = () => new Promise((resolve, reject) => {
                https.get(apiUrl, (resp) => {
                    let data = '';
                    resp.on('data', chunk => data += chunk);
                    resp.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                    });
                }).on('error', reject);
            });
            
            const data = await fetchJSON();
            if (data.data && data.data.length > 0) {
                const apiStudent = data.data[0];
                student = {
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
                    total_score: 0,
                    createdAt: Date.now()
                };
                await saveStudent(seatNumber, student);
            } else {
                await saveSearchLog({ seat: seatNumber, found: false });
                return res.json({ success: false, message: '❌ لا توجد نتيجة لهذا الرقم' });
            }
        }
        
        // تسجيل البحث
        await saveSearchLog({ 
            seat: seatNumber, 
            found: true, 
            student_name: student.student_name, 
            total_score: student.total_score || 0
        });
        
        const settings = await getSettings();
        res.json({ success: true, student, settings });
        
    } catch (error) {
        console.error('Search error:', error);
        res.json({ success: false, message: '⚠️ حدث خطأ في جلب البيانات' });
    }
});

// 📝 الحصول على كل الطلاب (للأدمن)
app.get('/api/admin/students', verifyToken, async (req, res) => {
    const students = await getAllStudents();
    const settings = await getSettings();
    res.json({ success: true, students, settings });
});

// ✏️ تعديل بيانات طالب
app.post('/api/admin/update-student', verifyToken, async (req, res) => {
    const { seat_number, student_name, school, administration, scores, total_score } = req.body;
    
    await saveStudent(seat_number, {
        seat_number,
        student_name,
        school,
        administration,
        scores,
        total_score,
        updatedAt: Date.now()
    });
    
    res.json({ success: true });
});

// ⚙️ تحديث الإعدادات العامة
app.post('/api/admin/settings', verifyToken, async (req, res) => {
    const { mainSubjects, extraSubjects, term } = req.body;
    const settings = await getSettings();
    
    if (mainSubjects) settings.mainSubjects = mainSubjects;
    if (extraSubjects) settings.extraSubjects = extraSubjects;
    if (term) settings.term = term;
    
    await saveSettings(settings);
    res.json({ success: true, settings });
});

// 📊 إحصائيات لوحة التحكم
app.get('/api/admin/stats', verifyToken, async (req, res) => {
    const totalSearches = await getCount(logsCollection);
    const successfulSearches = await getCount(logsCollection, { field: 'found', operator: '==', value: true });
    const logs = await getSearchLogs(50);
    const totalStudents = await getCount(studentsCollection);
    
    res.json({ 
        totalSearches,
        successfulSearches,
        successRate: totalSearches > 0 ? ((successfulSearches / totalSearches) * 100).toFixed(1) : 0,
        logs,
        totalStudents
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
app.post('/api/subscribe', async (req, res) => {
    const subscription = req.body;
    await saveSubscription(subscription);
    res.json({ success: true });
});

// 🔔 إرسال إشعار لجميع المشتركين
app.post('/api/notify-all', verifyToken, async (req, res) => {
    const { title, body, url } = req.body;
    
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        return res.json({ success: false, message: 'VAPID keys not configured' });
    }
    
    webpush.setVapidDetails(
        'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    
    const subscriptions = await getAllSubscriptions();
    
    const notifications = subscriptions.map(sub => 
        webpush.sendNotification(sub, JSON.stringify({ title, body, url }))
            .catch(e => console.log('Push error:', e.message))
    );
    
    await Promise.all(notifications);
    res.json({ success: true, count: subscriptions.length });
});

// ========================
// بدء الخادم
// ========================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
    console.log(`🔥 Firebase: ${admin.apps[0].options.projectId || 'Connected'}`);
});
