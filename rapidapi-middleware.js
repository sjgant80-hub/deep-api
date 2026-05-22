/**
 * RapidAPI Tier Middleware — Deep API
 *
 * Validates RapidAPI proxy headers, enforces per-tier rate limits,
 * and tracks usage per subscriber. Drop-in for Express.
 *
 * Usage:
 *   const { rapidApiAuth, rapidApiLimiter } = require('./rapidapi-middleware');
 *   app.use('/v1', rapidApiAuth, rapidApiLimiter);
 *
 * Works alongside existing auth — if no RapidAPI headers are present,
 * falls through to your existing authentication middleware.
 */

const fs = require('fs');
const path = require('path');

/* CONFIG — set via env vars */
const RAPIDAPI_PROXY_SECRET = process.env.RAPIDAPI_PROXY_SECRET || '';
const USAGE_FILE = path.join(__dirname, '.storage', '.meta', 'rapidapi-usage.json');

/* TIER DEFINITIONS — match your RapidAPI pricing page */
const TIERS = {
  // RapidAPI subscription names map to these
  BASIC: {
    name: 'Free',
    price: 0,
    limits: { perMonth: 20, perDay: 5, perMinute: 3 },
    maxFileSizeMB: 5
  },
  PRO: {
    name: 'Pro',
    price: 29,
    limits: { perMonth: 200, perDay: 20, perMinute: 10 },
    maxFileSizeMB: 25
  },
  ULTRA: {
    name: 'Business',
    price: 99,
    limits: { perMonth: 2000, perDay: 200, perMinute: 30 },
    maxFileSizeMB: 50
  },
  MEGA: {
    name: 'Enterprise',
    price: -1,
    limits: { perMonth: Infinity, perDay: Infinity, perMinute: 300 },
    maxFileSizeMB: 100
  },
  CUSTOM: {
    name: 'Custom',
    price: -1,
    limits: { perMonth: Infinity, perDay: Infinity, perMinute: 300 },
    maxFileSizeMB: 100
  }
};

/* USAGE TRACKING — persisted to disk */
let usage = {};
try {
  const dir = path.dirname(USAGE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
} catch {}

function saveUsage() {
  try {
    const dir = path.dirname(USAGE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch {}
}

// auto-save every 60 seconds
setInterval(saveUsage, 60000);

function getSubscriberKey(user) {
  return `user:${user}`;
}

function getUsage(user) {
  const key = getSubscriberKey(user);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16);

  if (!usage[key]) {
    usage[key] = { months: {}, days: {}, minutes: {} };
  }
  const u = usage[key];

  return {
    month: u.months[month] || 0,
    day: u.days[day] || 0,
    minute: u.minutes[minute] || 0,
    _key: key, _month: month, _day: day, _minute: minute
  };
}

function incrementUsage(user) {
  const key = getSubscriberKey(user);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = now.toISOString().slice(0, 10);
  const minute = now.toISOString().slice(0, 16);

  if (!usage[key]) {
    usage[key] = { months: {}, days: {}, minutes: {} };
  }
  const u = usage[key];

  u.months[month] = (u.months[month] || 0) + 1;
  u.days[day] = (u.days[day] || 0) + 1;
  u.minutes[minute] = (u.minutes[minute] || 0) + 1;

  // cleanup old minute entries (keep last 10)
  const minuteKeys = Object.keys(u.minutes).sort();
  if (minuteKeys.length > 10) {
    minuteKeys.slice(0, minuteKeys.length - 10).forEach(k => delete u.minutes[k]);
  }
  // cleanup old day entries (keep last 60)
  const dayKeys = Object.keys(u.days).sort();
  if (dayKeys.length > 60) {
    dayKeys.slice(0, dayKeys.length - 60).forEach(k => delete u.days[k]);
  }
}


/**
 * Middleware 1: rapidApiAuth
 * Validates RapidAPI proxy headers and attaches tier info to req.
 * If no RapidAPI headers, calls next() to fall through to existing auth.
 */
function rapidApiAuth(req, res, next) {
  const proxySecret = req.headers['x-rapidapi-proxy-secret'];
  const subscription = req.headers['x-rapidapi-subscription'];
  const rapidUser = req.headers['x-rapidapi-user'];

  // no RapidAPI headers — fall through to existing auth
  if (!proxySecret && !subscription) {
    return next();
  }

  // verify proxy secret
  if (RAPIDAPI_PROXY_SECRET && proxySecret !== RAPIDAPI_PROXY_SECRET) {
    return res.status(403).json({
      error: 'Invalid proxy secret',
      message: 'This API is accessed through RapidAPI. Get your key at rapidapi.com'
    });
  }

  // map subscription to tier
  const tierKey = (subscription || 'BASIC').toUpperCase();
  const tier = TIERS[tierKey] || TIERS.BASIC;

  // attach to request
  req.rapidapi = true;
  req.rapidapiUser = rapidUser || 'anonymous';
  req.rapidapiSubscription = tierKey;
  req.tier = tier;
  req.tierName = tier.name;

  next();
}


/**
 * Middleware 2: rapidApiLimiter
 * Enforces per-tier rate limits. Only active for RapidAPI requests.
 */
function rapidApiLimiter(req, res, next) {
  // skip if not a RapidAPI request
  if (!req.rapidapi) return next();

  const tier = req.tier;
  const user = req.rapidapiUser;
  const current = getUsage(user);
  const limits = tier.limits;

  // check monthly limit
  if (current.month >= limits.perMonth) {
    saveUsage();
    return res.status(429).json({
      error: 'Monthly limit exceeded',
      limit: limits.perMonth,
      used: current.month,
      tier: req.tierName,
      upgrade: 'Upgrade your plan at rapidapi.com for higher limits',
      resets: 'First of next month'
    });
  }

  // check daily limit
  if (current.day >= limits.perDay) {
    saveUsage();
    return res.status(429).json({
      error: 'Daily limit exceeded',
      limit: limits.perDay,
      used: current.day,
      tier: req.tierName,
      upgrade: 'Upgrade your plan at rapidapi.com for higher limits',
      resets: 'Midnight UTC'
    });
  }

  // check per-minute limit
  if (current.minute >= limits.perMinute) {
    saveUsage();
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: limits.perMinute,
      used: current.minute,
      tier: req.tierName,
      retry_after: '60 seconds'
    });
  }

  // increment usage AFTER the request completes
  res.on('finish', () => {
    if (res.statusCode < 400) {
      incrementUsage(user);
    }
  });

  next();
}


/**
 * Helper: get usage stats for admin endpoint
 */
function getUsageStats() {
  const stats = {};
  for (const [key, data] of Object.entries(usage)) {
    const user = key.replace('user:', '');
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const day = now.toISOString().slice(0, 10);
    stats[user] = {
      this_month: data.months?.[month] || 0,
      today: data.days?.[day] || 0,
      all_time: Object.values(data.months || {}).reduce((a, b) => a + b, 0)
    };
  }
  return stats;
}


module.exports = {
  rapidApiAuth,
  rapidApiLimiter,
  getUsageStats,
  TIERS,
  saveUsage
};
