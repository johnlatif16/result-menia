require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'my_secret_key';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// الرابط الرسمي للـ API
const API_URL = 'https://www.natega4dk.net/api/governorates/menia/search';
// خدمة Proxy لتجاوز الحظر
const PROXY_URL = 'https://api.allorigins.win/get?url=';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// سجل البحث في الذاكرة
let searchLogs = [];

// دالة لجلب البيانات عبر الـ Proxy
function fetchJSONviaProxy(apiUrl) {
    return new Promise((resolve, reject) => {
        const proxyFullUrl = `${PROXY_URL}${encodeURIComponent(apiUrl)}`;
        
        https.get(proxyFullUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const proxyResponse = JSON.parse(data);
                    if (proxyResponse.contents) {
                        const originalData = JSON.parse(proxyResponse.contents);
                        resolve(originalData);
                    } else {
                        reject(new Error('Proxy response has no contents'));
                    }
                } catch(e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// 🔍 البحث من الـ API (عبر Proxy)
app.get('/api/search', async (req, res) => {
    const seatNumber = req.query.seat;
    
    if (!seatNumber) {
        return res.json({ success: false, message: '⚠️ من فضلك أدخل رقم الجلوس' });
    }
    
    try {
        const url = `${API_URL}?q=${seatNumber}&type=seat_number&page=1&per_page=20`;
        console.log('جاري الاتصال عبر Proxy بـ:', url);
        
        // جلب البيانات عبر الـ Proxy
        const data = await fetchJSONviaProxy(url);
        
        if (data.data && data.data.length > 0) {
            const result = data.data[0];
            
            // تنسيق النتيجة
            const formattedResult = `
                <div style="background: #e8f5e9; padding: 20px; border-radius: 10px; text-align: right;">
                    <h3 style="color: #2e7d32; margin-bottom: 15px;">✅ نتيجة رقم الجلوس: ${result.seat_number}</h3>
                    <hr style="margin: 10px 0;">
                    <p><strong>👤 الاسم:</strong> ${result.student_name || 'غير متوفر'}</p>
                    <p><strong>🏫 المدرسة:</strong> ${result.school || 'غير متوفر'}</p>
                    <p><strong>📍 الإدارة التعليمية:</strong> ${result.administration || 'غير متوفر'}</p>
                    <p><strong>📊 المجموع الكلي:</strong> <span style="font-size: 20px; color: #d32f2f; font-weight: bold;">${result.total_score || 0}</span></p>
                    <p><strong>📅 الفصل الدراسي:</strong> ${result.term === 1 ? 'الأول' : result.term === 2 ? 'الثاني' : result.term || 'غير محدد'}</p>
                </div>
            `;
            
            searchLogs.unshift({ 
                seat: seatNumber, 
                found: true, 
                student_name: result.student_name,
                total_score: result.total_score,
                time: Date.now() 
            });
            if (searchLogs.length > 100) searchLogs.pop();
            
            return res.json({ success: true, result: formattedResult });
        } else {
            searchLogs.unshift({ seat: seatNumber, found: false, time: Date.now() });
            return res.json({ 
                success: false, 
                message: '❌ لا توجد نتيجة لهذا الرقم. تأكد من رقم الجلوس ثم حاول مرة أخرى.' 
            });
        }
        
    } catch (error) {
        console.error('خطأ مفصل:', error.message);
        return res.json({ 
            success: false, 
            message: '⚠️ حدث خطأ في الاتصال بخادم النتائج. يرجى المحاولة لاحقاً.' 
        });
    }
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
app.get('/api/verify-token', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false });
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(403).json({ success: false });
        res.json({ success: true });
    });
});

// 📊 إحصائيات لوحة التحكم
app.get('/api/admin/stats', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false });
    
    const token = authHeader.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(403).json({ success: false });
        
        const totalSearches = searchLogs.length;
        const successfulSearches = searchLogs.filter(log => log.found).length;
        
        res.json({ 
            totalSearches,
            successfulSearches,
            successRate: totalSearches > 0 ? ((successfulSearches / totalSearches) * 100).toFixed(1) : 0,
            logs: searchLogs.slice(0, 30) 
        });
    });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin login: ${ADMIN_USER} / ${ADMIN_PASS}`);
    console.log(`🔗 Using Proxy for API: ${API_URL}`);
});
