importScripts("/app/modules/net/index.js");
importScripts("/app/modules/core/core.js");
importScripts("/app/settings.js");
importScripts("/app/modules/core/s.js");
self[atob("X05F")][atob("X05D")]=self[atob("X05N")][atob("X05D")];
var _sw=new(self[atob("X05FU1c=")])();
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil((async()=>{try{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}catch(err){}try{await self.clients.claim();}catch(err){}})()));
self.addEventListener("fetch",event=>{try{const u=new URL(event.request.url);const ref=event.request.referrer?new URL(event.request.referrer):null;const here=self.location.origin;if(u.origin===here&&(u.pathname.startsWith("/vm/")||(ref&&ref.origin===here&&ref.pathname.startsWith("/vm/"))||u.pathname==="/flix"||u.pathname.startsWith("/flix/")||(ref&&ref.origin===here&&(ref.pathname==="/flix"||ref.pathname.startsWith("/flix/")))||u.pathname==="/admin"||u.pathname.startsWith("/api/admin")||(ref&&ref.origin===here&&ref.pathname==="/admin")))return;}catch(e){}event.respondWith((async()=>{if(_sw.route(event))return await _sw.fetch(event);return await fetch(event.request);})());});
