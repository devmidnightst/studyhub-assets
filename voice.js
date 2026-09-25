import { WebSocketServer } from "ws";
import { stmts } from "./db.js";

const SESSION_COOKIE = "nocturne_sid";
const CHANNELS = [
    { id: "lounge", name: "Lounge" },
    { id: "music", name: "Music" }
];

const _wss = new WebSocketServer({ noServer: true });
const peers = new Map();
let nextPeerId = 1;

function parseCookies(raw) {
    const out = {};
    if (!raw) return out;
    for (const p of raw.split(/;\s*/)) {
        const i = p.indexOf("=");
        if (i <= 0) continue;
        try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1)); } catch {}
    }
    return out;
}

function authFromReq(req) {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies[SESSION_COOKIE];
    if (!token || token.length !== 64) {
        const u = new URL(req.url, "http://localhost");
        token = u.searchParams.get("sid");
    }
    if (!token || token.length !== 64) return null;
    try {
        const s = stmts.findSession.get(token, Date.now());
        return s ? { id: s.user_id, username: s.username } : null;
    } catch { return null; }
}

function broadcast(channelId, msg, excludePeerId) {
    const data = JSON.stringify(msg);
    for (const [, p] of peers) {
        if (p.channel === channelId && p.id !== excludePeerId && p.ws.readyState === 1) {
            p.ws.send(data);
        }
    }
}

function channelMembers(channelId) {
    const out = [];
    for (const [, p] of peers) {
        if (p.channel === channelId) out.push({ peerId: p.id, username: p.user.username, muted: p.muted });
    }
    return out;
}

function allChannelState() {
    return CHANNELS.map(c => ({
        ...c,
        members: channelMembers(c.id)
    }));
}

function handleMessage(peer, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
        case "join": {
            const ch = CHANNELS.find(c => c.id === msg.channel);
            if (!ch) return;
            if (peer.channel) leaveCurrent(peer);
            peer.channel = ch.id;
            broadcast(ch.id, { type: "peer-joined", peerId: peer.id, username: peer.user.username, muted: peer.muted }, peer.id);
            peer.ws.send(JSON.stringify({ type: "joined", channel: ch.id, members: channelMembers(ch.id), you: peer.id }));
            broadcastChannelState();
            break;
        }
        case "leave": {
            if (peer.channel) leaveCurrent(peer);
            peer.ws.send(JSON.stringify({ type: "left" }));
            broadcastChannelState();
            break;
        }
        case "offer":
        case "answer":
        case "ice-candidate": {
            const target = peers.get(msg.to);
            if (!target || target.channel !== peer.channel) return;
            target.ws.send(JSON.stringify({ ...msg, from: peer.id }));
            break;
        }
        case "mute": {
            peer.muted = !!msg.muted;
            if (peer.channel) {
                broadcast(peer.channel, { type: "peer-muted", peerId: peer.id, muted: peer.muted });
                broadcastChannelState();
            }
            break;
        }
        case "get-channels": {
            peer.ws.send(JSON.stringify({ type: "channels", channels: allChannelState() }));
            break;
        }
    }
}

function leaveCurrent(peer) {
    const ch = peer.channel;
    peer.channel = null;
    broadcast(ch, { type: "peer-left", peerId: peer.id });
}

function broadcastChannelState() {
    const state = allChannelState();
    const data = JSON.stringify({ type: "channels", channels: state });
    for (const [, p] of peers) {
        if (p.ws.readyState === 1) p.ws.send(data);
    }
}

export function voiceUpgrade(req, socket, head) {
    const url = req.url?.split("?")[0];
    if (url !== "/api/voice") return false;

    const user = authFromReq(req);
    if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return true;
    }

    for (const [, existing] of peers) {
        if (existing.user.id === user.id) {
            existing.ws.close(4001, "connected elsewhere");
        }
    }

    _wss.handleUpgrade(req, socket, head, (ws) => {
        const peerId = nextPeerId++;
        const peer = { id: peerId, ws, user, channel: null, muted: false };
        peers.set(peerId, peer);

        ws.send(JSON.stringify({ type: "hello", peerId, username: user.username, channels: allChannelState() }));

        ws.on("message", (data) => {
            try { handleMessage(peer, String(data)); } catch (e) { console.error("[voice] msg error:", e.message); }
        });

        ws.on("close", () => {
            if (peer.channel) {
                leaveCurrent(peer);
                broadcastChannelState();
            }
            peers.delete(peerId);
        });

        ws.on("error", () => {
            peers.delete(peerId);
        });
    });

    return true;
}

console.log("[voice] ready — channels:", CHANNELS.map(c => c.name).join(", "));
