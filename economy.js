import crypto from 'crypto';
import { db, stmts } from './db.js';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.NOCTURNE_DATA_DIR || './data';
const CONFIG_PATH = path.join(DATA_DIR, 'gem-config.json');

const DEFAULT_CONFIG = {
    houseEdge: { coinflip: 0.02, slots: 0.05, dice: 0.03, blackjack: 0.03, roulette: 0.027 },
    dailyEnabled: true,
    gamblingEnabled: true,
    begAmount: 15,
    maxBet: 50000,
    minBet: 1,
    betCooldownMs: 3000,
    blackjackTimeoutMs: 120000
};

let configCache = null;

export function getGemConfig() {
    if (configCache) return configCache;
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            configCache = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
        } else {
            configCache = { ...DEFAULT_CONFIG };
        }
    } catch { configCache = { ...DEFAULT_CONFIG }; }
    return configCache;
}

export function setGemConfig(patch) {
    const current = getGemConfig();
    if (patch.houseEdge) patch.houseEdge = { ...current.houseEdge, ...patch.houseEdge };
    const updated = { ...current, ...patch };
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
        configCache = updated;
        return true;
    } catch { return false; }
}

// ── Balance operations ──────────────────────────────────────────────────────

export function getBalance(userId) {
    const row = stmts.gemBalance.get(userId);
    return row ? row.gems : 250;
}

function logTx(userId, username, amount, balanceAfter, type, detail, otherUserId) {
    try { stmts.gemTxInsert.run(userId, username, amount, balanceAfter, type, detail || null, otherUserId || null, Date.now()); } catch {}
}

export function setBalance(userId, username, amount) {
    stmts.gemSet.run(Math.max(0, amount), userId);
    const bal = getBalance(userId);
    logTx(userId, username, amount, bal, 'admin_set', null, null);
    return bal;
}

export function addGems(userId, username, amount, type, detail, otherUserId) {
    stmts.gemAdd.run(amount, userId);
    const bal = getBalance(userId);
    logTx(userId, username, amount, bal, type, detail, otherUserId);
    return bal;
}

export function removeGems(userId, username, amount, type, detail) {
    stmts.gemDeduct.run(amount, userId);
    const bal = getBalance(userId);
    logTx(userId, username, -amount, bal, type, detail, null);
    return bal;
}

export function getLeaderboard(limit = 10) {
    return stmts.gemLeaderboard.all(limit).map((r, i) => ({
        rank: i + 1, username: r.username, gems: r.gems
    }));
}

export function getEconomyStats() {
    const total = stmts.gemTotalCirculating.get();
    return { totalGems: total?.total || 0 };
}

// ── Daily rewards ───────────────────────────────────────────────────────────

export const DAILY_TIERS = [
    { name: 'Common',    css: 'common',    min: 1,    max: 50,     weight: 60 },
    { name: 'Uncommon',  css: 'uncommon',  min: 51,   max: 200,    weight: 25 },
    { name: 'Rare',      css: 'rare',      min: 201,  max: 1000,   weight: 10 },
    { name: 'Epic',      css: 'epic',      min: 1001, max: 5000,   weight: 4  },
    { name: 'Legendary', css: 'legendary', min: 5001, max: 100000, weight: 1  }
];
const DAILY_CD = 24 * 60 * 60 * 1000;

export function claimDaily(userId, username) {
    const config = getGemConfig();
    if (!config.dailyEnabled) return { success: false, error: "Daily rewards are turned off." };
    const row = stmts.gemDailyClaim.get(userId);
    const last = row?.daily_claimed_at || 0;
    const remaining = DAILY_CD - (Date.now() - last);
    if (remaining > 0) return { success: false, cooldownMs: remaining };

    const rand = Math.random() * 100;
    let cum = 0, tier = DAILY_TIERS[0];
    for (const t of DAILY_TIERS) { cum += t.weight; if (rand <= cum) { tier = t; break; } }

    const amount = Math.floor(Math.random() * (tier.max - tier.min + 1)) + tier.min;
    stmts.gemDailySet.run(Date.now(), userId);
    addGems(userId, username, amount, 'daily', tier.name, null);
    return { success: true, amount, tier: tier.css, tierName: tier.name };
}

// ── Beg ─────────────────────────────────────────────────────────────────────

export function claimBeg(userId, username) {
    const config = getGemConfig();
    const row = stmts.gemBegClaim.get(userId);
    const last = row?.beg_claimed_at || 0;
    const remaining = DAILY_CD - (Date.now() - last);
    if (remaining > 0) return { success: false, cooldownMs: remaining };

    stmts.gemBegSet.run(Date.now(), userId);
    addGems(userId, username, config.begAmount, 'beg', null, null);
    return { success: true, amount: config.begAmount };
}

// ── Gift ────────────────────────────────────────────────────────────────────

export function giftGems(fromId, fromName, toId, toName, amount) {
    if (amount <= 0) return { success: false, error: 'Amount must be positive.' };
    if (fromId === toId) return { success: false, error: "You can't gift yourself." };
    if (getBalance(fromId) < amount) return { success: false, error: 'Insufficient gems.' };

    db.transaction(() => {
        removeGems(fromId, fromName, amount, 'gift_sent', `to @${toName}`);
        addGems(toId, toName, amount, 'gift_received', `from @${fromName}`, fromId);
    })();
    return { success: true };
}

// ── Gambling common ─────────────────────────────────────────────────────────

const betCooldowns = new Map();

function validateBet(userId, bet) {
    const config = getGemConfig();
    if (!config.gamblingEnabled) return 'Gambling is currently disabled.';
    if (typeof bet !== 'number' || isNaN(bet) || !Number.isInteger(bet)) return 'Bet must be a whole number.';
    if (bet < config.minBet) return `Minimum bet is ${config.minBet} 💎.`;
    if (bet > config.maxBet) return `Maximum bet is ${config.maxBet.toLocaleString()} 💎.`;
    const last = betCooldowns.get(userId) || 0;
    const wait = config.betCooldownMs - (Date.now() - last);
    if (wait > 0) return `Wait ${(wait / 1000).toFixed(1)}s between bets.`;
    if (getBalance(userId) < bet) return 'Insufficient gems.';
    betCooldowns.set(userId, Date.now());
    return null;
}

// ── Coinflip ────────────────────────────────────────────────────────────────

export function playCoinflip(userId, username, bet, call) {
    const pick = String(call || 'heads').toLowerCase();
    const sideCall = pick === 't' || pick === 'tails' ? 'tails' : (pick === 'h' || pick === 'heads' ? 'heads' : '');
    if (!sideCall) return { success: false, error: 'Call heads or tails. Usage: /coinflip <amount> [heads|tails]' };

    const err = validateBet(userId, bet);
    if (err) return { success: false, error: err };

    const config = getGemConfig();
    removeGems(userId, username, bet, 'gamble_loss', 'coinflip');

    const edge = Math.min(0.5, Math.max(0, Number(config.houseEdge.coinflip) || 0));
    const won = Math.random() < (0.5 - edge / 2);
    const side = won ? sideCall : (sideCall === 'heads' ? 'tails' : 'heads');
    let payout = 0;

    if (won) {
        payout = bet * 2;
        addGems(userId, username, payout, 'gamble_win', 'coinflip');
    }
    return { success: true, result: { game: 'coinflip', won, bet, payout, side, call: sideCall, balance: getBalance(userId) } };
}

// ── Slots ───────────────────────────────────────────────────────────────────

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];

export function playSlots(userId, username, bet) {
    const err = validateBet(userId, bet);
    if (err) return { success: false, error: err };

    removeGems(userId, username, bet, 'gamble_loss', 'slots');

    const reels = [
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    ];

    const counts = {};
    for (const s of reels) counts[s] = (counts[s] || 0) + 1;
    const best = Math.max(...Object.values(counts));

    let multiplier = 0;
    let push = false;
    if (reels[0] === '7️⃣' && best === 3) multiplier = 50;
    else if (reels[0] === '💎' && best === 3) multiplier = 25;
    else if (best === 3) multiplier = 10;
    else if (best === 2) multiplier = 3;
    else if (reels.includes('💎')) push = true;

    const config = getGemConfig();
    const edge = Math.min(0.5, Math.max(0, Number(config.houseEdge.slots) || 0));
    let payout = 0;
    let won = false;
    if (push) {
        payout = bet;
        addGems(userId, username, payout, 'gamble_win', 'slots push');
    } else if (multiplier > 0) {
        const profit = Math.floor(bet * (multiplier - 1) * (1 - edge));
        payout = bet + profit;
        won = true;
        addGems(userId, username, payout, 'gamble_win', `slots ${multiplier}x`);
    }

    return { success: true, result: { game: 'slots', won, push, bet, payout, reels, multiplier, balance: getBalance(userId) } };
}

// ── Dice ────────────────────────────────────────────────────────────────────

function roll2d6() { return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1; }

export function playDice(userId, username, bet) {
    const err = validateBet(userId, bet);
    if (err) return { success: false, error: err };

    removeGems(userId, username, bet, 'gamble_loss', 'dice');

    const playerRoll = roll2d6();
    const houseRoll = roll2d6();
    const config = getGemConfig();
    const edge = Math.min(0.5, Math.max(0, Number(config.houseEdge.dice) || 0));
    const won = playerRoll > houseRoll;
    const push = playerRoll === houseRoll;
    let payout = 0;
    if (won) {
        payout = bet + Math.floor(bet * (1 - edge));
        addGems(userId, username, payout, 'gamble_win', 'dice');
    } else if (push) {
        payout = bet;
        addGems(userId, username, payout, 'gamble_win', 'dice push');
    }

    return { success: true, result: { game: 'dice', won, push, bet, payout, playerRoll, houseRoll, balance: getBalance(userId) } };
}

// ── Blackjack ───────────────────────────────────────────────────────────────

const bjGames = new Map();
setInterval(() => {
    const now = Date.now(), cfg = getGemConfig();
    for (const [uid, g] of bjGames) {
        if (now - g.startedAt <= cfg.blackjackTimeoutMs) continue;
        bjGames.delete(uid);
        try { addGems(uid, g.username || 'player', g.bet, 'gamble_win', 'blackjack timeout refund'); } catch {}
    }
}, 60000).unref();

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function drawCard() {
    const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    return { rank, suit, display: rank + suit, red: suit === '♥' || suit === '♦' };
}
function handValue(cards) {
    let v = 0, aces = 0;
    for (const c of cards) {
        if (c.rank === 'A') { v += 11; aces++; }
        else if ('JQK'.includes(c.rank)) v += 10;
        else v += parseInt(c.rank, 10);
    }
    while (v > 21 && aces > 0) { v -= 10; aces--; }
    return v;
}

export function playBlackjack(userId, username, bet, action) {
    if (action === 'start') {
        if (bjGames.has(userId)) return { success: false, error: 'You have an active game. Use /blackjack hit or /blackjack stand.' };
        const err = validateBet(userId, bet);
        if (err) return { success: false, error: err };

        removeGems(userId, username, bet, 'gamble_loss', 'blackjack');
        const pH = [drawCard(), drawCard()], dH = [drawCard(), drawCard()];
        const pT = handValue(pH);

        // Natural blackjack
        if (pT === 21) {
            const dT = handValue(dH);
            if (dT === 21) {
                addGems(userId, username, bet, 'gamble_win', 'blackjack push');
                return { success: true, result: { game: 'blackjack', phase: 'result', playerHand: pH, dealerHand: dH, playerTotal: pT, dealerTotal: dT, won: false, push: true, bet, payout: bet, balance: getBalance(userId), canHit: false } };
            }
            const edge = Math.min(0.5, Math.max(0, Number(getGemConfig().houseEdge.blackjack) || 0));
            const payout = bet + Math.floor(bet * 1.5 * (1 - edge));
            addGems(userId, username, payout, 'gamble_win', 'blackjack natural');
            return { success: true, result: { game: 'blackjack', phase: 'result', playerHand: pH, dealerHand: dH, playerTotal: pT, dealerTotal: handValue(dH), won: true, push: false, bet, payout, balance: getBalance(userId), canHit: false } };
        }

        bjGames.set(userId, { bet, pH, dH, startedAt: Date.now(), username });
        return { success: true, result: { game: 'blackjack', phase: 'deal', playerHand: pH, dealerHand: [dH[0], { hidden: true }], playerTotal: pT, dealerTotal: '?', won: false, push: false, bet, payout: 0, balance: getBalance(userId), canHit: true } };
    }

    const g = bjGames.get(userId);
    if (!g) return { success: false, error: 'No active game. Use /blackjack <bet> to start.' };

    if (action === 'hit') {
        g.pH.push(drawCard());
        g.startedAt = Date.now();
        const pT = handValue(g.pH);
        if (pT > 21) {
            bjGames.delete(userId);
            return { success: true, result: { game: 'blackjack', phase: 'result', playerHand: g.pH, dealerHand: g.dH, playerTotal: pT, dealerTotal: handValue(g.dH), won: false, push: false, bet: g.bet, payout: 0, balance: getBalance(userId), canHit: false } };
        }
        return { success: true, result: { game: 'blackjack', phase: 'deal', playerHand: g.pH, dealerHand: [g.dH[0], { hidden: true }], playerTotal: pT, dealerTotal: '?', won: false, push: false, bet: g.bet, payout: 0, balance: getBalance(userId), canHit: true } };
    }

    if (action === 'stand') {
        let dT = handValue(g.dH);
        while (dT < 17) { g.dH.push(drawCard()); dT = handValue(g.dH); }
        const pT = handValue(g.pH);
        bjGames.delete(userId);

        const edge = Math.min(0.5, Math.max(0, Number(getGemConfig().houseEdge.blackjack) || 0));
        let won = false, payout = 0, push = false;
        if (dT > 21 || pT > dT) {
            won = true;
            payout = g.bet + Math.floor(g.bet * (1 - edge));
            addGems(userId, username, payout, 'gamble_win', 'blackjack');
        } else if (pT === dT) { push = true; payout = g.bet; addGems(userId, username, payout, 'gamble_win', 'blackjack push'); }

        return { success: true, result: { game: 'blackjack', phase: 'result', playerHand: g.pH, dealerHand: g.dH, playerTotal: pT, dealerTotal: dT, won, push, bet: g.bet, payout, balance: getBalance(userId), canHit: false } };
    }

    return { success: false, error: 'Use /blackjack hit or /blackjack stand.' };
}

// ── Roulette ────────────────────────────────────────────────────────────────

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

export function playRoulette(userId, username, bet, betType) {
    const err = validateBet(userId, bet);
    if (err) return { success: false, error: err };

    const bt = String(betType).toLowerCase().trim();
    const numBet = parseInt(bt, 10);
    const validColor = ['red', 'black', 'green'].includes(bt);
    const validNum = !isNaN(numBet) && numBet >= 0 && numBet <= 36 && String(numBet) === bt;
    if (!validColor && !validNum) return { success: false, error: 'Bet on red, black, green, or a number 0–36.' };

    removeGems(userId, username, bet, 'gamble_loss', 'roulette');

    const number = Math.floor(Math.random() * 37);
    const color = number === 0 ? 'green' : RED_NUMBERS.has(number) ? 'red' : 'black';

    let won = false, payout = 0;
    if (validColor && bt === color) {
        won = true;
        payout = color === 'green' ? bet * 36 : bet * 2;
    } else if (validNum && numBet === number) {
        won = true;
        payout = bet * 36;
    }
    if (won) addGems(userId, username, payout, 'gamble_win', `roulette ${bt}`);

    return { success: true, result: { game: 'roulette', won, bet, payout, number, color, betType: bt, balance: getBalance(userId) } };
}

// ── Crash (provably fair, max 25x) ──────────────────────────────────────────
// The crash point is fixed before the multiplier moves.
// Commitment: SHA-256(serverSeed) is shown first. The seed is revealed only
// after that round ends, and the next round already has a new seed.
// Point: HMAC-SHA256(serverSeed, clientSeed:nonce). The first 52 bits are h.
// If h is divisible by 20 the round crashes at 1.00x (house edge). Otherwise
// the bustabit formula is used and the result is capped at 25.00x.

export const CRASH_MAX = 25;
export const CRASH_GROWTH = 0.06;

const CRASH_FAIR_PATH = path.join(DATA_DIR, 'crash-fair.json');
const CRASH_ACTIVE_PATH = path.join(DATA_DIR, 'crash-active.json');

const crashRounds = new Map();
let crashFair = null;

// Every app process restores crash-active.json on boot, so the same round can
// be armed in more than one place. The first process to record the round id
// here settles it; any other copy just drops it, so nothing pays out twice.
db.exec('CREATE TABLE IF NOT EXISTS crash_settled (round_id TEXT PRIMARY KEY, settled_at INTEGER NOT NULL)');
const stmtCrashSettleClaim = db.prepare('INSERT OR IGNORE INTO crash_settled (round_id, settled_at) VALUES (?, ?)');
const stmtCrashSettlePrune = db.prepare('DELETE FROM crash_settled WHERE settled_at < ?');
let crashSettleHook = () => {};

function saveJson(file, data) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data));
    } catch {}
}

function newCommitment() {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    return { serverSeed, serverSeedHash };
}

function loadCrashFair() {
    try {
        const raw = JSON.parse(fs.readFileSync(CRASH_FAIR_PATH, 'utf8'));
        if (raw && raw.users && typeof raw.users === 'object') return raw;
    } catch {}
    return { users: {} };
}

function saveCrashFair() { saveJson(CRASH_FAIR_PATH, crashFair); }

function userFair(userId) {
    if (!crashFair) crashFair = loadCrashFair();
    const key = String(userId);
    let row = crashFair.users[key];
    if (!row || !row.serverSeed || !row.serverSeedHash) {
        row = { ...newCommitment(), nonce: 0, clientSeed: crypto.randomBytes(8).toString('hex'), history: [] };
        crashFair.users[key] = row;
        saveCrashFair();
    }
    if (!Array.isArray(row.history)) row.history = [];
    return row;
}

export function crashPointFrom(serverSeed, clientSeed, nonce) {
    const hash = crypto.createHmac('sha256', serverSeed).update(String(clientSeed) + ':' + String(nonce)).digest('hex');
    const h = BigInt('0x' + hash.slice(0, 13));
    if (h % 20n === 0n) return { hash, crashPoint: 1 };
    const e = 1n << 52n;
    let raw = (100n * e - h) / (e - h);
    if (raw > 2500n) raw = 2500n;
    if (raw < 100n) raw = 100n;
    return { hash, crashPoint: Number(raw) / 100 };
}

export function crashMultiplierAt(elapsedMs) {
    const t = Math.max(0, Number(elapsedMs) || 0) / 1000;
    const raw = Math.exp(CRASH_GROWTH * t);
    return Math.min(CRASH_MAX, Math.floor(raw * 100) / 100);
}

export function crashMsUntil(mult) {
    const m = Number(mult);
    if (!(m > 1)) return 0;
    return Math.log(Math.min(CRASH_MAX, m)) / CRASH_GROWTH * 1000;
}

function cleanClientSeed(seed, fallback) {
    const s = String(seed || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return s.length >= 4 ? s : fallback;
}

function publicRound(r) {
    return {
        id: r.id, bet: r.bet, startedAt: r.startedAt, auto: r.auto,
        serverSeedHash: r.serverSeedHash, clientSeed: r.clientSeed, nonce: r.nonce,
        max: CRASH_MAX, growth: CRASH_GROWTH
    };
}

function fairView(userId) {
    const row = userFair(userId);
    return {
        serverSeedHash: row.serverSeedHash,
        nonce: row.nonce,
        clientSeed: row.clientSeed,
        max: CRASH_MAX,
        growth: CRASH_GROWTH,
        history: row.history.slice(-12)
    };
}

export function getCrashState(userId) {
    const round = crashRounds.get(userId) || null;
    return {
        fair: fairView(userId),
        balance: getBalance(userId),
        active: round && !round.done ? publicRound(round) : null,
        last: round && round.done ? round.result : (userFair(userId).last || null)
    };
}

export function onCrashSettled(fn) { crashSettleHook = typeof fn === 'function' ? fn : () => {}; }

function persistActive() {
    const list = [];
    for (const r of crashRounds.values()) {
        if (r.done) continue;
        list.push({
            id: r.id, userId: r.userId, username: r.username, room: r.room, bet: r.bet,
            serverSeed: r.serverSeed, serverSeedHash: r.serverSeedHash, clientSeed: r.clientSeed,
            nonce: r.nonce, crashPoint: r.crashPoint, hmac: r.hmac, startedAt: r.startedAt, auto: r.auto
        });
    }
    saveJson(CRASH_ACTIVE_PATH, list);
}

function settleCrash(r, kind, mult) {
    if (!r || r.done) return r?.result || null;
    r.done = true;
    if (r.crashTimer) clearTimeout(r.crashTimer);
    if (r.autoTimer) clearTimeout(r.autoTimer);
    let claimed = true;
    try { claimed = stmtCrashSettleClaim.run(r.id, Date.now()).changes === 1; } catch {}
    if (!claimed) {
        if (crashRounds.get(r.userId) === r) crashRounds.delete(r.userId);
        return null;
    }
    const crashAt = r.startedAt + crashMsUntil(r.crashPoint);
    let won = false, push = false, payout = 0, cashMult = null;
    if (kind !== 'crash' && Date.now() < crashAt) {
        cashMult = Math.min(Math.floor(Number(mult) * 100) / 100, Math.round((r.crashPoint - 0.01) * 100) / 100);
        if (cashMult > 1) {
            payout = Math.floor(r.bet * cashMult);
            if (payout < r.bet) payout = r.bet;
            if (payout > r.bet) won = true;
            else push = true;
            addGems(r.userId, r.username, payout, won ? 'gamble_win' : 'gamble_push', 'crash ' + cashMult + 'x');
        } else cashMult = null;
    }
    const row = userFair(r.userId);
    const next = newCommitment();
    row.serverSeed = next.serverSeed;
    row.serverSeedHash = next.serverSeedHash;
    row.history.push({ crashPoint: r.crashPoint, cashed: cashMult, won, push });
    if (row.history.length > 20) row.history.splice(0, row.history.length - 20);
    const result = {
        game: 'crash', id: r.id, won, push, bet: r.bet, payout, multiplier: cashMult,
        crashPoint: r.crashPoint, serverSeed: r.serverSeed, serverSeedHash: r.serverSeedHash,
        clientSeed: r.clientSeed, nonce: r.nonce, hmac: r.hmac,
        nextServerSeedHash: row.serverSeedHash, balance: getBalance(r.userId),
        userId: r.userId, username: r.username, room: r.room
    };
    row.last = result;
    saveCrashFair();
    crashRounds.delete(r.userId);
    persistActive();
    r.result = result;
    try { crashSettleHook(result); } catch {}
    return result;
}

function armRound(r) {
    const crashIn = Math.max(0, r.startedAt + crashMsUntil(r.crashPoint) - Date.now());
    r.crashTimer = setTimeout(() => settleCrash(r, 'crash', null), crashIn);
    if (r.auto > 1 && r.auto < r.crashPoint) {
        const autoIn = Math.max(0, r.startedAt + crashMsUntil(r.auto) - Date.now());
        if (autoIn < crashIn) r.autoTimer = setTimeout(() => settleCrash(r, 'auto', r.auto), autoIn);
    }
}

export function startCrash(userId, username, bet, clientSeed, auto, room) {
    if (crashRounds.has(userId)) return { success: false, error: 'You already have a crash round running.' };
    let autoMult = null;
    if (auto != null && auto !== '') {
        autoMult = Math.round(Number(auto) * 100) / 100;
        if (!(autoMult >= 1.01 && autoMult <= CRASH_MAX)) return { success: false, error: 'Auto cashout must be between 1.01 and 25.' };
    }
    const err = validateBet(userId, bet);
    if (err) return { success: false, error: err };
    const row = userFair(userId);
    const seed = cleanClientSeed(clientSeed, row.clientSeed);
    row.clientSeed = seed;
    const nonce = row.nonce;
    row.nonce = nonce + 1;
    const { hash, crashPoint } = crashPointFrom(row.serverSeed, seed, nonce);
    const round = {
        id: crypto.randomBytes(8).toString('hex'),
        userId, username, room: room || 'general', bet,
        serverSeed: row.serverSeed, serverSeedHash: row.serverSeedHash,
        clientSeed: seed, nonce, crashPoint, hmac: hash,
        startedAt: Date.now(), auto: autoMult, done: false
    };
    removeGems(userId, username, bet, 'gamble_loss', 'crash');
    saveCrashFair();
    crashRounds.set(userId, round);
    persistActive();
    armRound(round);
    return { success: true, round: publicRound(round), fair: fairView(userId), balance: getBalance(userId) };
}

export function cashoutCrash(userId) {
    const r = crashRounds.get(userId);
    if (!r || r.done) return { success: false, error: 'No crash round is running.' };
    const mult = crashMultiplierAt(Date.now() - r.startedAt);
    if (mult < 1.01) return { success: false, error: 'Too early to cash out.' };
    const result = settleCrash(r, 'cashout', mult);
    if (!result) return { success: false, error: 'That round already ended.' };
    return { success: true, result };
}

export function armCrashRounds() {
    crashFair = loadCrashFair();
    try { stmtCrashSettlePrune.run(Date.now() - 7 * 24 * 60 * 60 * 1000); } catch {}
    let list = [];
    try { list = JSON.parse(fs.readFileSync(CRASH_ACTIVE_PATH, 'utf8')); } catch { list = []; }
    if (!Array.isArray(list)) return;
    for (const raw of list) {
        if (!raw || !raw.userId || crashRounds.has(raw.userId)) continue;
        const round = { ...raw, done: false };
        crashRounds.set(round.userId, round);
        armRound(round);
    }
}
