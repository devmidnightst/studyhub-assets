// No token cache: deletion/revocation and expiry are still checked on every request.
// Refresh early near expiry even if last_seen was recently updated.
export function shouldTouchSession(session, now, ttl) {
    return now - session.last_seen >= 60_000 || session.expires_at - now <= Math.min(60_000, ttl / 2);
}
