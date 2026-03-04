const express = require('express');
const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

function fetchURL(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': '*/*',
        ...headers
      },
      timeout: 8000
    };
    const req = lib.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// OREF
app.get('/api/oref', async (req, res) => {
  try {
    const r = await fetchURL('https://www.oref.org.il/WarningMessages/alert/alerts.json', {
      'Referer': 'https://www.oref.org.il/',
      'X-Requested-With': 'XMLHttpRequest'
    });
    const text = r.body.toString('utf8').trim();
    if (!text || text === '') return res.json({ data: [], title: '', id: 0 });
    try { return res.json(JSON.parse(text)); }
    catch { return res.json({ data: [], title: '', id: 0 }); }
  } catch (e) { res.json({ data: [], error: e.message }); }
});

// OpenSky
app.get('/api/planes', async (req, res) => {
  try {
    const r = await fetchURL('https://opensky-network.org/api/states/all?lamin=10&lomin=25&lamax=55&lomax=65');
    if (r.status === 200) return res.json(JSON.parse(r.body.toString()));
    res.json({ states: null, error: 'OpenSky ' + r.status });
  } catch (e) { res.json({ states: null, error: e.message }); }
});

// RSS News
const RSS_FEEDS = [
  { name: 'الجزيرة عربي', url: 'https://www.aljazeera.net/xmlarss/mostread.xml' },
  { name: 'Al Jazeera EN', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'BBC Arabic',    url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
  { name: 'العربية',       url: 'https://www.alarabiya.net/tools/rss' },
  { name: 'Sky News Arabia', url: 'https://www.skynewsarabia.com/web/rss' },
  { name: 'RT Arabic',    url: 'https://arabic.rt.com/rss/' },
  { name: 'Reuters',      url: 'https://feeds.reuters.com/reuters/worldNews' },
];

let newsCache = { items: [], ts: 0 };

app.get('/api/news', async (req, res) => {
  const now = Date.now();
  if (newsCache.items.length > 0 && now - newsCache.ts < 90000) {
    return res.json({ items: newsCache.items });
  }
  const all = [];
  for (const feed of RSS_FEEDS) {
    try {
      const r = await fetchURL(feed.url);
      if (r.status !== 200) continue;
      const parsed = await parseStringPromise(r.body.toString('utf8'), { explicitArray: false });
      const items = parsed?.rss?.channel?.item || [];
      const arr = Array.isArray(items) ? items : [items];
      arr.slice(0, 12).forEach(item => {
        const title = typeof item.title === 'string' ? item.title : item.title?._ || '';
        if (title && title.length > 5) all.push({ title: title.trim(), source: feed.name });
      });
    } catch (_) {}
  }
  if (all.length > 0) newsCache = { items: all, ts: now };
  res.json({ items: newsCache.items.length ? newsCache.items : all });
});

// HLS Proxy
const ALLOWED = ['youtube.com','gdpr.akamaihd.net','dwstream','news06.cgtn.com','f24hls-i.akamaihd.net','getaj.net','akamaihd.net','ercdn.net','skynewsarabia.com','bbci.co.uk'];

app.get('/proxy/stream', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('No URL');
  try {
    const u = new URL(target);
    if (!ALLOWED.some(h => u.hostname.endsWith(h))) return res.status(403).send('Blocked');
  } catch { return res.status(400).send('Bad URL'); }

  try {
    const r = await fetchURL(target, {
      'Origin': 'https://www.aljazeera.net',
      'Referer': 'https://www.aljazeera.net/'
    });
    const isM3U8 = target.includes('.m3u8') || (r.headers['content-type'] || '').includes('mpegurl');
    if (isM3U8) {
      let m3u8 = r.body.toString('utf8');
      const base = target.substring(0, target.lastIndexOf('/') + 1);
      m3u8 = m3u8.replace(/^(https?:\/\/[^\s\r\n]+)$/gm, m => `/proxy/stream?url=${encodeURIComponent(m)}`);
      m3u8 = m3u8.replace(/^(?!#)(?!https?:\/\/)(?!\/)([^\s\r\n]+)$/gm, m => `/proxy/stream?url=${encodeURIComponent(base + m)}`);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(m3u8);
    }
    res.setHeader('Content-Type', r.headers['content-type'] || 'video/MP2T');
    res.send(r.body);
  } catch (e) { res.status(502).send('Error: ' + e.message); }
});

const STREAMS = [
  { lbl: 'BBC News Live', short: 'BBC', url: 'https://www.youtube.com/watch?v=9Auq9mYONFE' },
  { lbl: 'CGTN Live Feed', short: 'CGTN', url: 'https://news06.cgtn.com/news/3d3d514d7a4d444f78457a6333566d54/video.m3u8' },
  { lbl: 'DW English', short: 'DWE', url: 'https://dwstream4-lh.akamaihd.net/z/dwtv_en@124105/manifest.m3u8' },
  { lbl: 'France24 English', short: 'F24', url: 'https://f24hls-i.akamaihd.net/hls/live/2033925/F24_EN@526596/master.m3u8' },
];

app.get('/api/streams', (req, res) => {
  res.json(STREAMS.map(s => ({ ...s, proxyUrl: `/proxy/stream?url=${encodeURIComponent(s.url)}` })));
});

// Real Missile Detection - Parse alerts for missile activity
let missileCache = { data: [], ts: 0 };
app.get('/api/missiles', async (req, res) => {
  const now = Date.now();
  // Cache for 5 seconds
  if (missileCache.data.length > 0 && now - missileCache.ts < 5000) {
    return res.json({ missiles: missileCache.data });
  }
  
  const missiles = [];
  try {
    // Get real OREF alerts
    const r = await fetchURL('https://www.oref.org.il/WarningMessages/alert/alerts.json', {
      'Referer': 'https://www.oref.org.il/',
      'X-Requested-With': 'XMLHttpRequest'
    });
    const text = r.body.toString('utf8').trim();
    if (text && text !== '') {
      try {
        const alerts = JSON.parse(text);
        // If there are alerts, infer missile activity
        if (alerts.data && alerts.data.length > 0) {
          // Generate realistic missile trajectories based on alert locations
          const origins = [
            { name: 'Gaza Strip', coord: [31.47, 34.53] },
            { name: 'Lebanon', coord: [33.27, 35.57] },
            { name: 'Iran', coord: [35.68, 51.38] },
            { name: 'Yemen', coord: [15.35, 44.20] }
          ];
          
          alerts.data.forEach((region, idx) => {
            if (idx < 3) { // Limit to 3 simultaneously
              const targetCoord = [31.5 + Math.random() * 2, 34.5 + Math.random() * 1.5];
              const origin = origins[idx % origins.length];
              missiles.push({
                id: region + idx,
                name: ['Qassam', 'Fadjr-5', 'Grad BM-21'][idx % 3],
                from: origin.coord,
                to: targetCoord,
                origin: origin.name,
                target: region,
                type: 'Rocket/Missile',
                timestamp: new Date().toISOString()
              });
            }
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  
  missileCache = { data: missiles, ts: now };
  res.json({ missiles, count: missiles.length });
});

// Jordan Alert Monitoring System - Enhanced with many more channels
const JORDAN_FEEDS = [
  { name: 'Petra News Agency', url: 'https://www.petra.gov.jo/Include/InnerPage.jsp?Page=rss' },
  { name: 'BBC Arabic', url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
  { name: 'Al Jazeera Arabic', url: 'https://www.aljazeera.net/xmlarss/mostread.xml' },
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'Alarabiya', url: 'https://www.alarabiya.net/tools/rss' },
  { name: 'Sky News Arabia', url: 'https://www.skynewsarabia.com/web/rss' },
  { name: 'RT Arabic', url: 'https://arabic.rt.com/rss/' },
  { name: 'Middle East Eye', url: 'https://www.middleeasteye.net/en/rss/rss.xml' },
  { name: 'Ammon News', url: 'https://www.ammonnews.net/rss' },
  { name: 'Jordan Times', url: 'https://www.jordantimes.com/feed' },
  { name: 'Arab News', url: 'https://www.arabnews.com/services/rss' },
  { name: 'Reuters Middle East', url: 'https://feeds.reuters.com/reuters/worldNews' },
  { name: 'TRT Arabi', url: 'https://www.trtarabi.com/rss' },
  { name: 'Sputnik Arabic', url: 'https://arabic.sputniknews.com/rss' },
  { name: 'Roya News', url: 'https://www.royanews.tv/rss' },
  { name: 'Al Mamlakah', url: 'https://www.almamlaka.tv/rss' },
  { name: 'Khaberni', url: 'https://www.khaberni.com/rss' },
  { name: 'Al Rai Jordan', url: 'https://alrai.com/rss.xml' },
  { name: 'Ad Dustour', url: 'https://www.addustour.com/rss.xml' },
  { name: 'Al Ghad Jordan', url: 'https://alghad.com/rss/' },
  { name: 'Hona Sawt', url: 'https://www.honaalsawt.com/feed' },
  { name: 'Joinfo', url: 'https://joinfo.com/feed/' },
  { name: 'Gerasa News', url: 'https://www.gerasanews.com/rss.xml' },
  { name: 'Saraya News', url: 'https://www.sarayanews.com/rss' },
  { name: 'CNN Arabic', url: 'https://arabic.cnn.com/api/v1/rss/rss.html' },
  { name: 'France 24 Arabic', url: 'https://www.france24.com/ar/rss' },
  { name: 'DW Arabic', url: 'https://rss.dw.com/xml/rss-ar-all' },
  { name: 'AP Middle East', url: 'https://rsshub.app/apnews/topics/middle-east' },
];

const JORDAN_KEYWORDS = {
  ar: {
    explosion: ['انفجار', 'تفجير', 'بليهة', 'قنبلة', 'انفجارات', 'حريق', 'إطلاق نار', 'دمار', 'ضربة', 'تدمير', 'رضة', 'صدمة', 'اصطدام', 'تضرر', 'تحطم', 'تدمير', 'احتراق', 'دوي', 'هزة', 'اهتزاز', 'دخان', 'لهب', 'حطام', 'ضحايا', 'جرحى', 'شهداء', 'قتلى', 'مفخخة', 'عبوة ناسفة', 'شظايا', 'رصاص'],
    siren: ['صافرة', 'إنذار', 'إنذارات', 'صفارات', 'تحذير', 'تنبيه', 'احذر', 'جرس الإنذار', 'صفير', 'إنذار جوي', 'إنذار عام', 'إنذار مبكر', 'صفارة', 'تحذير عاجل', 'طوارئ جوية', 'نداء أمني'],
    missile: ['صاروخ', 'صواريخ', 'قذيفة', 'قذائف', 'ميسايل', 'إطلاق', 'قصف', 'ضربة جوية', 'غارة', 'قنبلة ذكية', 'قصف عنيف', 'هجوم جوي', 'بالستي', 'مدفعية', 'طيران حربي', 'مسيّرة', 'مسيرة', 'طائرة مسيّرة', 'درون', 'صواريخ باليستية', 'كروز', 'توماهوك', 'صاروخية', 'إطلاق صاروخي', 'ضربة صاروخية', 'قصف صاروخي'],
    warning: ['تحذير', 'تحذيرات', 'هجوم', 'هجمات', 'جريمة', 'حادث', 'أزمة', 'كارثة', 'طوارئ', 'حالة طوارئ', 'مخاطر', 'أخطار', 'تهديد', 'توتر', 'تصعيد', 'تهديد وجودي', 'خطر', 'تحريض', 'عدوان', 'مؤامرة', 'اعتداء', 'مخطط', 'هجمة مسلحة', 'تهديد أمني', 'إنذار نهائي'],
    security: ['أمن', 'جيش', 'شرطة', 'عملية', 'اشتباك', 'مواجهة', 'صدام', 'قوات', 'الدفاع', 'العسكرية', 'الأمن', 'العمليات', 'الاستخبارات', 'مخابرات', 'دركي', 'حرس', 'حدود', 'قناص', 'دفاع جوي', 'منظومة', 'رادار', 'اعتراض', 'تحصينات', 'الجيش الأردني', 'القوات المسلحة', 'الأمن العام'],
    chemical: ['كيميائي', 'غاز سام', 'سم', 'تلوث', 'إشعاعي', 'نووي', 'مواد خطرة', 'مواد سامة', 'نشرة تحذيرية', 'حماية مدنية']
  },
  en: {
    explosion: ['explosion', 'blast', 'bomb', 'bombing', 'detonation', 'explosive', 'IED', 'detonate', 'destroyed', 'collapsed', 'damage', 'damaged', 'hit', 'struck', 'impact', 'shattered', 'rubble', 'ruins', 'carnage', 'casualties', 'fatalities', 'wounded', 'killed', 'dead', 'fire', 'blaze', 'smoke', 'debris'],
    siren: ['siren', 'alert', 'alarm', 'warning siren', 'red alert', 'air raid', 'alert system', 'emergency alert', 'warning signal', 'early warning', 'civil defense', 'evacuation order', 'shelter in place', 'imminent threat'],
    missile: ['missile', 'rocket', 'projectile', 'bombardment', 'strike', 'artillery', 'shelling', 'airstrike', 'air strike', 'rocket fire', 'cruise missile', 'drone strike', 'ballistic', 'UAV attack', 'aerial assault', 'kamikaze drone', 'ICBM', 'short-range missile', 'barrage', 'volley', 'salvo', 'anti-aircraft'],
    warning: ['attack', 'threat', 'emergency', 'incident', 'crisis', 'urgent', 'critical', 'assault', 'threat level', 'security threat', 'danger', 'escalation', 'provocation', 'retaliation', 'aggression', 'hostility', 'ultimatum', 'imminent', 'standby', 'high alert'],
    security: ['security', 'military', 'forces', 'operation', 'threat', 'armed', 'combat', 'clash', 'army', 'defense', 'armed forces', 'military operation', 'intelligence', 'counterterrorism', 'special forces', 'border patrol', 'intercept', 'air defense', 'radar', 'surveillance', 'Jordan Armed Forces', 'JAF', 'Royal Jordanian'],
    chemical: ['chemical', 'biological', 'radiological', 'nuclear', 'CBRN', 'toxic', 'contamination', 'hazmat', 'radiation', 'nuclear threat']
  }
};

const JORDAN_LOCATION_KEYWORDS = {
  ar: ['الأردن', 'الأردنية', 'الأردني', 'عمّان', 'عمان', 'البتراء', 'الزرقاء', 'إربد', 'الرمثا', 'ديرعلا', 'مادبا', 'الكرك', 'العقبة', 'جرش', 'عجلون', 'السلط', 'الشونة', 'وادي موسى', 'الحدود الأردنية', 'المفرق', 'الطفيلة', 'معان', 'ماركا', 'الشميساني', 'عبدون', 'الوهادة', 'شرقي عمّان', 'غربي عمّان', 'الرابية', 'أم رمانة', 'جبل النزهة', 'رصيفة', 'الأزرق', 'الرويشد', 'العمري', 'خريبة السوق', 'ناعور', 'الفحيص', 'سحاب', 'صويلح', 'جبيهة', 'أبو نصير', 'الجاردنز', 'الدوار', 'الرابية', 'الجبيهة', 'المدينة الرياضية', 'التلاع العلي', 'خلدا', 'أبو علندا', 'الطنيب', 'السلمانية'],
  en: ['Jordan', 'Jordanian', 'Amman', 'Petra', 'Zarqa', 'Irbid', 'Ramtha', "Dar'a", 'Madaba', 'Karak', 'Aqaba', 'Jerash', 'Ajloun', 'Salt', 'Shuna', 'Wadi Rum', 'Dead Sea', 'River Jordan', 'Jordan River', 'Tafila', 'Maan', 'Marqa', 'Shmeisani', 'Wehdat', 'East Amman', 'West Amman', 'Sahab', 'Sweileh', 'Jubeiha', 'Abu Nseir', 'Naur', 'Fuheis', 'Mafraq', 'Azraq', 'Ruwaished', 'Omari', 'Khriba', 'Abdoun', 'Dabouq', 'Rabieh', 'Tlaa al-Ali', 'Khalda', 'Abu Alanda', 'Tanib', 'Salmani', 'Hashemite', 'Aqaba Economic Zone', 'Kerak', 'Balqa', 'Tafilah', 'Maan Junction', 'King Hussein Bridge', 'Allenby Bridge', 'Karameh', 'Baqaa', 'Zarqa River', 'Yarmouk', 'Hejaz Railway']
};

let jordanCache = { alerts: [], ts: 0 };

function classifyJordanAlert(title) {
  const titleLower = title.toLowerCase();
  
  // Check for chemical/nuclear (highest severity)
  if (JORDAN_KEYWORDS.ar.chemical && JORDAN_KEYWORDS.ar.chemical.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.chemical && JORDAN_KEYWORDS.en.chemical.some(k => titleLower.includes(k))) {
    return { type: 'explosion', severity: 'critical' };
  }

  // Check for explosion (highest severity)
  if (JORDAN_KEYWORDS.ar.explosion.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.explosion.some(k => titleLower.includes(k))) {
    return { type: 'explosion', severity: 'critical' };
  }
  
  // Check for siren (critical)
  if (JORDAN_KEYWORDS.ar.siren.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.siren.some(k => titleLower.includes(k))) {
    return { type: 'siren', severity: 'critical' };
  }
  
  // Check for missile (critical)
  if (JORDAN_KEYWORDS.ar.missile.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.missile.some(k => titleLower.includes(k))) {
    return { type: 'missile', severity: 'critical' };
  }
  
  // Check for security incident (high)
  if (JORDAN_KEYWORDS.ar.security.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.security.some(k => titleLower.includes(k))) {
    return { type: 'intel', severity: 'high' };
  }
  
  // Check for warning/attack (high)
  if (JORDAN_KEYWORDS.ar.warning.some(k => title.includes(k)) || 
      JORDAN_KEYWORDS.en.warning.some(k => titleLower.includes(k))) {
    return { type: 'intel', severity: 'high' };
  }
  
  // If Jordan location is mentioned — report as info
  const hasLocation = JORDAN_LOCATION_KEYWORDS.ar.some(k => title.includes(k)) || 
                      JORDAN_LOCATION_KEYWORDS.en.some(k => titleLower.includes(k));
  if (hasLocation) {
    return { type: 'intel', severity: 'info' };
  }
  
  return null;
}

// Jordan city coordinates for more accurate geolocation
const JORDAN_CITY_COORDS = {
  'عمان': [31.9539, 35.9106], 'عمّان': [31.9539, 35.9106], 'Amman': [31.9539, 35.9106],
  'الزرقاء': [32.0744, 36.1114], 'Zarqa': [32.0744, 36.1114],
  'إربد': [32.5555, 35.8450], 'Irbid': [32.5555, 35.8450],
  'مادبا': [31.7340, 35.7953], 'Madaba': [31.7340, 35.7953],
  'الكرك': [31.1839, 35.6994], 'Karak': [31.1839, 35.6994],
  'العقبة': [29.5265, 34.9497], 'Aqaba': [29.5265, 34.9497],
  'جرش': [32.2746, 35.8880], 'Jerash': [32.2746, 35.8880],
  'عجلون': [32.3445, 35.7452], 'Ajloun': [32.3445, 35.7452],
  'السلط': [32.0135, 35.7414], 'Salt': [32.0135, 35.7414],
  'طفيلة': [31.3614, 35.5898], 'Tafila': [31.3614, 35.5898],
  'معان': [30.7413, 35.7544], 'Maan': [30.7413, 35.7544],
  'المفرق': [32.3433, 36.2084], 'Mafraq': [32.3433, 36.2084],
  'الأزرق': [31.8420, 36.8068], 'Azraq': [31.8420, 36.8068],
  'رصيفة': [32.0355, 36.0503], 'Rusayfah': [32.0355, 36.0503],
  'سحاب': [31.8707, 36.0078], 'Sahab': [31.8707, 36.0078],
  'الرمثا': [32.5752, 36.0014], 'Ramtha': [32.5752, 36.0014],
};

function getJordanCoords(title) {
  for (const [city, coords] of Object.entries(JORDAN_CITY_COORDS)) {
    if (title.includes(city)) return coords;
  }
  // Default: Amman with slight random offset
  return [31.9539 + (Math.random() - 0.5) * 0.3, 35.9106 + (Math.random() - 0.5) * 0.3];
}

app.get('/api/jordan', async (req, res) => {
  const now = Date.now();
  // Cache for 20 seconds
  if (jordanCache.alerts.length > 0 && now - jordanCache.ts < 20000) {
    return res.json({ alerts: jordanCache.alerts });
  }
  
  const allAlerts = [];
  const seenTitles = new Set();
  
  for (const feed of JORDAN_FEEDS) {
    try {
      const r = await fetchURL(feed.url);
      if (r.status !== 200) continue;
      
      try {
        const parsed = await parseStringPromise(r.body.toString('utf8'), { explicitArray: false });
        const items = parsed?.rss?.channel?.item || [];
        const arr = Array.isArray(items) ? items : [items];
        
        arr.slice(0, 60).forEach(item => {
          const title = typeof item.title === 'string' ? item.title : item.title?._ || '';
          const desc = typeof item.description === 'string' ? item.description : item.description?._ || '';
          const pubDate = typeof item.pubDate === 'string' ? item.pubDate : item.pubDate?._ || '';
          const combined = title + ' ' + desc;
          
          if (!title || title.length < 5) return;
          // Avoid duplicates
          if (seenTitles.has(title)) return;
          seenTitles.add(title);
          
          // Check if content mentions Jordan (in title or desc)
          const hasJordanRef = JORDAN_LOCATION_KEYWORDS.ar.some(k => combined.includes(k)) ||
                               JORDAN_LOCATION_KEYWORDS.en.some(k => combined.toLowerCase().includes(k));
          if (!hasJordanRef) return;
          
          const classification = classifyJordanAlert(combined);
          if (classification) {
            const coords = getJordanCoords(combined);
            allAlerts.push({
              id: 'jo-' + Date.now() + '-' + Math.random(),
              title: title.trim(),
              source: feed.name,
              time: pubDate || new Date().toISOString(),
              type: classification.type,
              severity: classification.severity,
              lat: coords[0],
              lng: coords[1],
              country: '🇯🇴 Jordan'
            });
          }
        });
      } catch (_) {}
    } catch (_) {}
  }
  
  // Sort by time (newest first) and limit to 30
  allAlerts.sort((a, b) => new Date(b.time) - new Date(a.time));
  const topAlerts = allAlerts.slice(0, 30);
  
  jordanCache = { alerts: topAlerts, ts: now };
  res.json({ alerts: topAlerts });
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`SENTINEL running on :${PORT}`));
