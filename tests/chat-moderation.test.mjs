
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { hasBlockedChatTerm, rejectBlockedChatText } from '../chat-moderation.js';
const hard = String.fromCharCode(110,105,103,103,101,114);
const allowed = String.fromCharCode(110,105,103,103,97);
test('targeted rule catches case, compatibility, accents, zero-width, plural, leet and bounded separators', () => {
    const fullwidth = [...hard].map(c=>String.fromCharCode(c.charCodeAt(0)+0xfee0)).join('');
    for (const value of [hard,hard.toUpperCase(),hard+'s','('+hard+')',hard.split('').join('.'),hard.split('').join(' - '),hard.replace('i','1').replace('e','3'),fullwidth,hard.split('').join('\u200b'),hard.replace('i','i\u0301'),hard[0].repeat(3)+hard.slice(1)]) assert.equal(hasBlockedChatTerm(value),true);
});
test('targeted rule permits requested variant and benign surrounding vocabulary', () => {
    for (const value of [allowed,allowed.toUpperCase(),allowed+'s','hello '+allowed+' friend','Nigeria','Niger','snigger','sniggering','trigger','vinegar','bigger','configure','hello world','x'+hard,hard+'ing','漢'+hard,hard+'漢']) assert.equal(hasBlockedChatTerm(value),false);
});
test('matching is bounded on long near-matches and returns a neutral response', () => {
    for(let i=0;i<20;i++)assert.equal(hasBlockedChatTerm(('n..i..g..g..e..x ').repeat(250)),false);
    let status,payload;const res={status:n=>{status=n;return res},json:v=>{payload=v}};
    assert.equal(rejectBlockedChatText(res,hard),true);assert.equal(status,400);assert.equal(payload.blocked,true);assert.equal(payload.error.includes(hard),false);
    assert.equal(rejectBlockedChatText(res,allowed),false);
});
const source=fs.readFileSync(new URL('../chat.js',import.meta.url),'utf8');
function route(method,url,context){
    const a=source.indexOf('    app.'+method+'("'+url+'"');assert.ok(a>=0);
    const b=source.indexOf('\n    });',a)+8;
    let handler;
    context.app={ [method]:(path,...handlers)=>{handler=handlers.at(-1)} };
    vm.createContext(context);vm.runInContext(source.slice(a,b),context);
    return handler;
}
const paths=[['post','/api/chat/send'],['put','/api/chat/messages/:id'],['post','/api/dm/with/:otherId/send'],['put','/api/dm/messages/:id'],['post','/api/chat/command']];
function setup(text,owner=true){
    let writes=0;
    const row={id:1,user_id:1,sender_id:1,recipient_id:2,username:'test',room:'general',text,convo_key:'1:2',deleted:0};
    const context={auth:()=>{},need:()=>true,sanitizeRoom:()=> 'general',checkSendRate:()=>({ok:true}),
        isOwnerName:()=>owner,activeTimeout:()=>null,MAX_LEN:4000,cleanText:s=>String(s||''),rejectBlockedChatText,
        resolveOther:()=>({id:2,username:'other'}),convoKey:()=> '1:2',deslugUrls:()=>'',roomPolicy:()=>({}),gateText:async t=>({blocked:false,clean:t,score:0,category:null}),
        serialize:r=>r,serializeDm:r=>r,broadcast:()=>{},pushToUser:()=>{},notifyMentions:()=>{},roleInfo:()=>({rank:0}),Date,parseInt,
        stmts:{chatGetById:{get:()=>row},dmGetById:{get:()=>row},dmSettingsGet:{get:()=>({filter_off:1})},findUserByName:{get:()=>row},
            chatInsert:{run:(...args)=>{writes++;row.text=args[3];return {lastInsertRowid:1}}},
            dmInsert:{run:(...args)=>{writes++;row.text=args[4];return {lastInsertRowid:1}}},
            chatEdit:{run:t=>{writes++;row.text=t}},dmEdit:{run:t=>{writes++;row.text=t}},dmThreadUpsert:{run:()=>{}}}};
    return {context,writeCount:()=>writes};
}
for(const [method,url] of paths)test('server route rejects targeted term: '+method.toUpperCase()+' '+url,async()=>{
    for(const owner of [true,false]){
        const fixture=setup(hard,owner),handler=route(method,url,fixture.context);
        let status=200,payload;const res={status:n=>{status=n;return res},json:v=>{payload=v}};
        await handler({user:{id:1,username:'test'},body:{text:url.includes('command')?'/timeout user '+hard:hard},params:{id:'1',otherId:'2'}},res);
        assert.equal(status,400);assert.equal(payload.blocked,true);assert.equal(fixture.writeCount(),0);
    }
});
test('forwarding rechecks historical content even for owner',async()=>{
    const fixture=setup(hard),handler=route('post','/api/chat/send',fixture.context);
    let status=200;const res={status:n=>{status=n;return res},json:()=>{}};
    await handler({user:{id:1,username:'test'},body:{forwardOf:1},params:{}},res);
    assert.equal(status,400);assert.equal(fixture.writeCount(),0);
});
for(const [method,url] of paths.filter(([,url])=>!url.includes('command')))test('server route accepts requested allowed variant: '+method.toUpperCase()+' '+url,async()=>{
    for(const owner of [true,false]){
        const fixture=setup(allowed,owner),handler=route(method,url,fixture.context);
        let status=200,payload;const res={status:n=>{status=n;return res},json:v=>{payload=v}};
        await handler({user:{id:1,username:'test'},body:{text:allowed},params:{id:'1',otherId:'2'}},res);
        assert.equal(status,200);assert.equal(payload.ok,true);assert.equal(fixture.writeCount(),1);
    }
});
