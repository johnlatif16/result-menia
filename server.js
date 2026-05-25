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
    if (process.env.FIREBASE_CONFIG) {
        firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    } else {
        firebaseConfig = require('./firebase-key.json');
    }
    
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(firebaseConfig)
        });
    }
    console.log('✅ Firebase initialized');
} catch (error) {
    console.error('❌ Firebase error:', error.message);
}

const db = admin.firestore();

// ========================
// Middleware
// ========================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ success: false });
        req.user = decoded;
        next();
    });
}

// ========================
// الإعدادات الافتراضية
// ========================
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

async function getSettings() {
    const doc = await db.collection('settings').doc('appSettings').get();
    if (!doc.exists) {
        await db.collection('settings').doc('appSettings').set(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
    return doc.data();
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
        const studentDoc = await db.collection('students').doc(seatNumber).get();
        
        if (!studentDoc.exists) {
            return res.json({ success: false, message: '❌ لا توجد نتيجة لهذا الرقم' });
        }
        
        const student = { id: studentDoc.id, ...studentDoc.data() };
        const settings = await getSettings();
        
        // حساب المجموع من المواد الأساسية
        let totalScore = 0;
        for (const sub of settings.mainSubjects) {
            totalScore += student.scores?.[sub.name] || 0;
        }
        
        res.json({ success: true, student, settings, totalScore });
        
    } catch (error) {
        console.error(error);
        res.json({ success: false, message: '⚠️ حدث خطأ' });
    }
});

// 📝 جلب كل الطلاب (للأدمن)
app.get('/api/admin/students', verifyToken, async (req, res) => {
    const snapshot = await db.collection('students').get();
    const students = [];
    snapshot.forEach(doc => {
        students.push({ id: doc.id, ...doc.data() });
    });
    const settings = await getSettings();
    res.json({ success: true, students, settings });
});

// ✏️ إضافة أو تعديل طالب
app.post('/api/admin/save-student', verifyToken, async (req, res) => {
    const { seat_number, student_name, school, administration, scores } = req.body;
    
    await db.collection('students').doc(seat_number).set({
        seat_number,
        student_name,
        school,
        administration,
        scores,
        updatedAt: Date.now()
    }, { merge: true });
    
    res.json({ success: true });
});

// 🗑️ حذف طالب
app.delete('/api/admin/delete-student/:seat', verifyToken, async (req, res) => {
    const seat = req.params.seat;
    await db.collection('students').doc(seat).delete();
    res.json({ success: true });
});

// ⚙️ تحديث الإعدادات
app.post('/api/admin/settings', verifyToken, async (req, res) => {
    const { mainSubjects, extraSubjects, term } = req.body;
    const settings = await getSettings();
    if (mainSubjects) settings.mainSubjects = mainSubjects;
    if (extraSubjects) settings.extraSubjects = extraSubjects;
    if (term) settings.term = term;
    await db.collection('settings').doc('appSettings').set(settings);
    res.json({ success: true });
});

// 📊 إحصائيات
app.get('/api/admin/stats', verifyToken, async (req, res) => {
    const studentsSnapshot = await db.collection('students').get();
    const totalStudents = studentsSnapshot.size;
    
    res.json({
        totalStudents,
        lastUpdated: Date.now()
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

// ✅ التحقق من التوكن
app.get('/api/verify-token', verifyToken, (req, res) => {
    res.json({ success: true });
});

// 🔔 تسجيل اشتراك إشعارات
app.post('/api/subscribe', async (req, res) => {
    const subscription = req.body;
    await db.collection('subscribers').doc(subscription.endpoint).set(subscription);
    res.json({ success: true });
});

// 🔔 إرسال إشعار للجميع
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
    
    const snapshot = await db.collection('subscribers').get();
    const subscriptions = [];
    snapshot.forEach(doc => subscriptions.push(doc.data()));
    
    const notifications = subscriptions.map(sub =>
        webpush.sendNotification(sub, JSON.stringify({ title, body, url }))
            .catch(e => console.log('Push error:', e.message))
    );
    
    await Promise.all(notifications);
    res.json({ success: true, count: subscriptions.length });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
});
