export function createHistoryLoader(db) {
    const slots = Array(100).fill('?').join(',');
    const replies = db.prepare('SELECT id, username, text, deleted FROM chat_messages WHERE id IN (' + slots + ')');
    const reactions = db.prepare('SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id IN (' + slots + ')');
    function params(ids) { return [...ids, ...Array(100 - ids.length).fill(null)]; }
    return function load(rows, userId) {
        const replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))];
        const preview = new Map(replyIds.length ? replies.all(...params(replyIds)).map(r => [r.id, {
            id: r.id, username: r.username, text: r.deleted ? null : String(r.text || '').slice(0, 140), deleted: !!r.deleted
        }]) : []);
        const grouped = new Map();
        if (rows.length) for (const r of reactions.all(...params(rows.map(r => r.id)))) {
            let map = grouped.get(r.message_id);
            if (!map) { map = {}; grouped.set(r.message_id, map); }
            if (!Object.hasOwn(map, r.emoji)) Object.defineProperty(map, r.emoji, { value: { count: 0, me: false }, enumerable: true });
            map[r.emoji].count++;
            if (userId != null && r.user_id === userId) map[r.emoji].me = true;
        }
        return { preview, grouped };
    };
}
