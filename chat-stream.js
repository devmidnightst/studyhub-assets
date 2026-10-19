const states = new WeakMap();
export function attachChatStream(res, cleanup, { maxBytes = 5 * 1024 * 1024, stallMs = 15_000 } = {}) {
    let closed = false, timer;
    const state = { blocked: false, maxBytes, close };
    function close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        states.delete(res);
        res.off('drain', drain);
        res.off('close', close);
        res.off('error', close);
        cleanup();
    }
    function drain() { state.blocked = false; clearTimeout(timer); }
    state.block = () => {
        state.blocked = true;
        timer = setTimeout(() => { close(); res.destroy(); }, stallMs);
        timer.unref?.();
    };
    states.set(res, state);
    res.on('drain', drain);
    res.on('close', close);
    res.on('error', close);
    return close;
}
export function writeChatEvent(res, payload) {
    const state = states.get(res);
    if (!state || res.destroyed || res.writableEnded) return false;
    if (state.blocked || res.writableLength + Buffer.byteLength(payload) > state.maxBytes) {
        state.close();
        res.destroy();
        return false;
    }
    try {
        if (!res.write(payload)) state.block();
        return true;
    } catch {
        state.close();
        res.destroy();
        return false;
    }
}
