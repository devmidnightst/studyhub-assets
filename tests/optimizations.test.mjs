import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import { createPasswordService } from '../password.js';
import { shouldTouchSession } from '../session-refresh.js';
import { createHistoryLoader } from '../chat-history.js';
import { attachChatStream, writeChatEvent } from '../chat-stream.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('async scrypt preserves existing hash format, rejects invalid passwords and malformed hashes', async () => {
    const service = createPasswordService();
    const salt = Buffer.alloc(16, 7);
    const old = 's1:' + salt.toString('hex') + ':' + scryptSync('old-password', salt, 64).toString('hex');
    assert.equal(await service.verifyPassword('old-password', old), true);
    assert.equal(await service.verifyPassword('wrong', old), false);
    for (const value of [null, '', 's1:xx:xx', 's1:00:00']) assert.equal(await service.verifyPassword('x', value), false);
    const hash = await service.hashPassword('new-password');
    assert.match(hash, /^s1:[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.equal(await service.verifyPassword('new-password', hash), true);
});
test('crypto concurrency and waiting queue are bounded; overload recovers', async () => {
    const callbacks = [];
    let active = 0, peak = 0;
    const service = createPasswordService({ concurrency: 2, maxQueue: 2, derive: (p,s,l,o,cb) => {
        active++; peak = Math.max(peak, active);
        callbacks.push(() => { active--; cb(null, Buffer.alloc(l)); });
    } });
    const jobs = Array.from({length:4}, () => service.hashPassword('password'));
    await assert.rejects(service.hashPassword('overflow'), e => e.status === 503);
    assert.equal(callbacks.length, 2);
    while (callbacks.length) callbacks.shift()();
    await Promise.all(jobs);
    assert.equal(peak, 2);
    const recovered = service.hashPassword('again'); callbacks.shift()(); await recovered;
});
test('password derivation leaves event loop available', async () => {
    let ticked = false;
    const promise = createPasswordService().hashPassword('password');
    await new Promise(resolve => setImmediate(() => { ticked = true; resolve(); }));
    await promise;
    assert.equal(ticked, true);
});
test('session refresh throttles within minute and refreshes early near expiry', () => {
    const now = 1_000_000, ttl = 86400000;
    assert.equal(shouldTouchSession({last_seen:now-59999,expires_at:now+ttl},now,ttl),false);
    assert.equal(shouldTouchSession({last_seen:now-60000,expires_at:now+ttl},now,ttl),true);
    assert.equal(shouldTouchSession({last_seen:now-1000,expires_at:now+20000},now,ttl),true);
});
test('actual auth middleware checks database every time and respects revocation', () => {
    const source = fs.readFileSync(path.join(root,'auth.js'),'utf8');
    const body = source.slice(source.indexOf('export function authMiddleware'),source.indexOf('export function requireAuth')).replace('export ','');
    let reads=0,writes=0,valid=true;
    const now=Date.now();
    const context={ shouldTouchSession, Date, SESSION_COOKIE:'sid', SESSION_TTL_MS:86400000,
      parseCookies:()=>({sid:'a'.repeat(64)}), _sessionLogCache:new Map(), SESSION_LOG_INTERVAL:1800000,logUserEvent:()=>{},
      stmts:{findSession:{get:()=>{reads++;return valid?{user_id:1,username:'test',last_seen:now,expires_at:now+86400000}:null}},
      touchSession:{run:()=>writes++}}};
    vm.createContext(context); vm.runInContext(body,context);
    const req={headers:{},query:{}};
    context.authMiddleware(req,{},()=>{}); assert.equal(req.user.id,1);
    context.authMiddleware(req,{},()=>{}); assert.equal(writes,0);
    valid=false;context.authMiddleware(req,{},()=>{});assert.equal(req.user,null);assert.equal(reads,3);
});
test('100-message batch preserves reply previews, deletion and per-user reactions with two auxiliary queries', () => {
    const db=new Database(':memory:');
    db.exec('CREATE TABLE chat_messages(id INTEGER PRIMARY KEY, username TEXT, text TEXT, deleted INTEGER); CREATE TABLE chat_reactions(message_id INTEGER,emoji TEXT,user_id INTEGER);');
    const insert=db.prepare('INSERT INTO chat_messages VALUES(?,?,?,?)');
    for(let id=1;id<=100;id++)insert.run(id,'user'+id,'x'.repeat(200),id===1?1:0);
    const reaction=db.prepare('INSERT INTO chat_reactions VALUES(?,?,?)');
    reaction.run(2,'heart',1);reaction.run(2,'heart',2);reaction.run(3,'wow',2);
    let queries=0;
    const wrapped={prepare:sql=>{const stmt=db.prepare(sql);return {all:(...args)=>{queries++;return stmt.all(...args)}}}};
    const load=createHistoryLoader(wrapped);
    const rows=Array.from({length:100},(_,i)=>({id:i+1,reply_to:i===99?999:(i>0?i:0)}));
    const batch=load(rows,1);
    assert.equal(queries,2);assert.equal(batch.preview.get(1).text,null);
    assert.equal(batch.preview.get(2).text.length,140);assert.equal(batch.preview.has(999),false);
    assert.deepEqual(batch.grouped.get(2),{heart:{count:2,me:true}});
    assert.deepEqual(batch.grouped.get(3),{wow:{count:1,me:false}});
    const blank=load([],1);assert.equal(queries,2);assert.equal(blank.preview.size,0);
    db.close();
});
class Response extends EventEmitter {
    writableLength=0; destroyed=false;writableEnded=false;payloads=[];accept=true;
    write(payload){this.payloads.push(payload);return this.accept}
    destroy(){this.destroyed=true;this.emit('close')}
}
test('stream preserves order and resumes after drain', () => {
    const res=new Response();let clean=0;
    attachChatStream(res,()=>clean++);
    assert.equal(writeChatEvent(res,'first'),true);res.accept=false;
    assert.equal(writeChatEvent(res,'second'),true);
    res.accept=true;res.emit('drain');assert.equal(writeChatEvent(res,'third'),true);
    assert.deepEqual(res.payloads,['first','second','third']);
    res.emit('close');res.emit('close');assert.equal(clean,1);
});
test('stream closes on additional writes while blocked or excessive buffered bytes', () => {
    for(const mode of ['blocked','large']){
        const res=new Response();let clean=0;attachChatStream(res,()=>clean++,{maxBytes:10});
        if(mode==='blocked'){res.accept=false;writeChatEvent(res,'one')}
        assert.equal(writeChatEvent(res,mode==='large'?'x'.repeat(11):'two'),false);
        assert.equal(res.destroyed,true);assert.equal(clean,1);assert.equal(res.listenerCount('drain'),0);
    }
});
test('stalled stream closes after deadline and cleanup runs once', async () => {
    const res=new Response();let clean=0;res.accept=false;
    attachChatStream(res,()=>clean++,{stallMs:10});writeChatEvent(res,'data');
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(res.destroyed,true);assert.equal(clean,1);
});
test('actual generated asset middleware serves GET, HEAD, conditional 304, and fails closed on missing artifacts', async () => {
    const source=fs.readFileSync(path.join(root,'index.js'),'utf8');
    const a=source.indexOf('app.use((req, res, next) => {',source.indexOf('const assetManifest'));
    const b=source.indexOf('\n});',a)+4;
    const app=express();
    const ASSET_DIR=path.join(root,'build/assets');
    const assetManifest=JSON.parse(fs.readFileSync(path.join(ASSET_DIR,'manifest.json'),'utf8'));
    const context={app,path,__dirname:root,ASSET_DIR,assetManifest};
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    try{
        const response=await fetch(url+'/app/main.mjs');
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-cache');
        const etag=response.headers.get('etag');assert.ok(etag);assert.ok((await response.text()).length);
        const status=await new Promise((resolve,reject)=>{http.get(url+'/app/main.mjs',{headers:{'If-None-Match':etag}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))}).on('error',reject)});assert.equal(status,304);
        const head=await fetch(url+'/app/main.mjs',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
        const absent=await fetch(url+'/src/js/missing.js');assert.equal(absent.status,503);
    } finally {await new Promise(resolve=>server.close(resolve));}
});

test('session cookie setter remains usable and auth routes await password checks', async () => {
    const source=fs.readFileSync(path.join(root,'auth.js'),'utf8');
    const cookie=source.slice(source.indexOf('export function setSessionCookie'),source.indexOf('function clearSessionCookie')).replace('export ','');
    let cookieSet=false;
    const cookieContext={SESSION_COOKIE:'sid',SESSION_TTL_MS:86400000};
    vm.createContext(cookieContext);vm.runInContext(cookie,cookieContext);
    cookieContext.setSessionCookie({secure:true,get:()=>''},{cookie:()=>{cookieSet=true}},'token');
    assert.equal(cookieSet,true);
    const routes=new Map();
    const user={id:1,username:'test',password_hash:'old'};
    let checks=0,inserts=0;
    const context={
        app:null,seedOwner:async()=>{},authMiddleware:()=>{},requireAuth:()=>{},
        burstLimited:()=>false,clientIp:()=>'',ipSanction:()=>null,verifyCaptcha:async()=>true,
        validateCredentials:()=>({username:'test',password:'wrong'}),verifyPassword:async()=>{checks++;return false},
        stmts:{findUserByName:{get:()=>user},insertSession:{run:()=>inserts++}},
        MAX_USERS:100,PASSWORD_MIN:8,PASSWORD_MAX:256,db:{},SESSION_TTL_MS:86400000
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('export async function mountAuth')).replace('export ',''),context);
    const app={post:(url,...handlers)=>routes.set(url,handlers.at(-1)),get:()=>{},use:()=>{}};
    await context.mountAuth(app);
    for(const [url,body] of [['/api/auth/login',{}],['/api/auth/password',{current:'wrong',next:'long-password'}],['/api/auth/delete',{password:'wrong'}]]){
        let status;
        const res={status:n=>{status=n;return res},json:()=>{}};
        await routes.get(url)({body,user:{username:'test'}},res);
        assert.equal(status,401);
    }
    assert.equal(checks,3);assert.equal(inserts,0);
});

test('chat reconnect refreshes visible history and DM threads after an error', async () => {
    const source=fs.readFileSync(path.join(root,'public/src/js/rb8350.js'),'utf8');
    const a=source.indexOf('e.onopen=async()=>'),b=source.indexOf(',e.onmessage=',a);
    let refreshed=0,rendered=0,badges=0;
    const context={e:{},reconnecting:false,ue:async()=>{refreshed++},
      fetch:async()=>({json:async()=>({threads:[{otherId:2,unread:3}]})}),D:new Map(),
      Je:()=>rendered++,ve:()=>badges++};
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    await context.e.onopen();assert.equal(refreshed,0);
    context.reconnecting=true;await context.e.onopen();
    assert.equal(refreshed,1);assert.equal(context.D.get(2).unread,3);
    assert.equal(rendered,1);assert.equal(badges,1);assert.equal(context.reconnecting,false);
});

test('console awaits verification, suppresses duplicate attempts, and checks owner session again', async () => {
    const source=fs.readFileSync(path.join(root,'webssh.js'),'utf8');
    const body=source.slice(source.indexOf('export function terminalUpgrade'),source.indexOf('// Owner-only endpoints')).replace('export ','');
    for(const scenario of ['wrong','correct','revoked']){
        const ws=new EventEmitter();ws.readyState=1;ws.send=()=>{};ws.close=()=>{ws.readyState=3};
        let resolveVerify,checks=0,spawns=0,owner=true;
        const context={wss:null,WebSocketServer:class{handleUpgrade(req,socket,head,cb){cb(ws)}},
            ownerFromReq:()=>owner,URL,Date,Math,JSON,process:{env:{}},__dirname:root,
            consolePasswordSet:()=>true,consoleLockedUntil:0,consoleFails:0,CONSOLE_MAX_TRIES:3,CONSOLE_LOCK_MS:120000,
            verifyConsolePassword:()=>{checks++;return new Promise(resolve=>{resolveVerify=resolve})},
            spawn:()=>{spawns++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={write:()=>{}};return child}
        };
        vm.createContext(context);vm.runInContext(body,context);
        assert.equal(context.terminalUpgrade({url:'/api/admin/term',headers:{}},{destroy:()=>{}},null),true);
        const handler=ws.listeners('message')[0];
        const first=handler(Buffer.from(JSON.stringify({type:'auth',password:'password'})));
        await handler(Buffer.from(JSON.stringify({type:'auth',password:'password'})));
        assert.equal(checks,1);assert.equal(spawns,0);
        if(scenario==='revoked')owner=false;
        resolveVerify(scenario!=='wrong');await first;
        assert.equal(spawns,scenario==='correct'?1:0);
    }
});
test('console password file stores an awaited hash and does not write on failure', async () => {
    const source=fs.readFileSync(path.join(root,'webssh.js'),'utf8');
    const a=source.indexOf('async function setConsolePassword'),b=source.indexOf('function clearConsolePassword',a);
    let written;
    const context={CONSOLE_PW_FILE:'/test/console-password',path,fs:{mkdirSync:()=>{},writeFileSync:(file,value)=>{written=value}},
        hashPassword:async()=> 's1:hash:value'};
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    await context.setConsolePassword('password');assert.equal(written,'s1:hash:value\n');
    written=undefined;context.hashPassword=async()=>{throw new Error('busy')};
    await assert.rejects(context.setConsolePassword('password'));assert.equal(written,undefined);
});

test('batch serialization matches existing message payloads and keeps history order', () => {
    const source=fs.readFileSync(path.join(root,'chat.js'),'utf8');
    const a=source.indexOf('function replyPreview'),b=source.indexOf('// Compassionate',a);
    let reads=0;
    const db=new Database(':memory:');db.exec('CREATE TABLE chat_messages(id INTEGER PRIMARY KEY,username TEXT,text TEXT,deleted INTEGER);CREATE TABLE chat_reactions(message_id INTEGER,emoji TEXT,user_id INTEGER)');
    const rows=Array.from({length:100},(_,i)=>({id:i+1,reply_to:i+1,username:'user',room:'general',text:'hello',deleted:i%7===0?1:0,created_at:i,avatar:null,edited_at:i%3===0?1:null}));
    const ins=db.prepare('INSERT INTO chat_messages VALUES(?,?,?,?)');
    for(const r of rows)ins.run(r.id,r.username,r.text,r.deleted);
    db.exec("INSERT INTO chat_reactions VALUES(2,'heart',1)");
    const reply=db.prepare('SELECT * FROM chat_messages WHERE id=?'),react=db.prepare('SELECT emoji,user_id FROM chat_reactions WHERE message_id=?');
    const context={stmts:{chatGetById:{get:id=>{reads++;return reply.get(id)}},chatReactList:{all:id=>{reads++;return react.all(id)}}},roleInfo:()=>({perm:'member',role:'member',roleColor:null})};
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    const old=rows.map(r=>context.serialize(r,1));assert.equal(reads+1,201);
    reads=0;
    const loader=createHistoryLoader({prepare:sql=>{const stmt=db.prepare(sql);return {all:(...args)=>{reads++;return stmt.all(...args)}}}});
    const batch=loader(rows,1);const optimized=rows.map(r=>context.serialize(r,1,batch));
    assert.equal(reads+1,3);assert.equal(JSON.stringify(optimized),JSON.stringify(old));db.close();
});
test('admin password reset awaits hashing before writing and handles overload', async () => {
    const source=fs.readFileSync(path.join(root,'admin.js'),'utf8');
    const a=source.indexOf('    app.post("/api/admin/password"'),b=source.indexOf('    app.post("/api/admin/delete-user"',a);
    let handler,written,resolveHash;
    const context={app:{post:(url,...handlers)=>{handler=handlers.at(-1)}},guard:[],
      resolveUser:()=>({id:1,username:'test'}),hashPassword:()=>new Promise(resolve=>{resolveHash=resolve}),
      stmts:{changePassword:{run:hash=>{written=hash}},deleteUserSessions:{run:()=>{}}}};
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    let status=200;
    const res={status:n=>{status=n;return res},set:()=>res,json:()=>{}};
    const pending=handler({body:{password:'new-password'}},res);assert.equal(written,undefined);
    resolveHash('s1:hash:value');await pending;assert.equal(written,'s1:hash:value');
    written=undefined;context.hashPassword=async()=>{const error=new Error('busy');error.status=503;throw error};
    await handler({body:{password:'new-password'}},res);assert.equal(status,503);assert.equal(written,undefined);
});
