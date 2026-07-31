// src/tokenBlacklist.js
// In-memory store of revoked tokens. Survives the request cycle but resets on
// server restart — acceptable because all JWTs expire in ≤1h anyway.

const blacklist = new Map(); // token → expiresAt (ms)

function blacklistToken(token, expiresAtMs) {
    blacklist.set(token, expiresAtMs);
}

function isBlacklisted(token) {
    const exp = blacklist.get(token);
    if (exp === undefined) return false;
    if (Date.now() > exp) {
        blacklist.delete(token);
        return false;
    }
    return true;
}

// Purge stale entries every 10 minutes so the Map doesn't grow unboundedly
setInterval(() => {
    const now = Date.now();
    for (const [token, exp] of blacklist) {
        if (now > exp) blacklist.delete(token);
    }
}, 10 * 60 * 1000);

module.exports = {
    blacklistToken,
    isBlacklisted
};