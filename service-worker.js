/* Update version.js for every release. updateViaCache:none checks imported scripts. */
importScripts('./version.js');
const PREFIX='barcodepro-reader-';
const CACHE_NAME=PREFIX+APP_VERSION;
const CORE=['./','./index.html','./styles.css','./version.js','./utils.js','./storage.js','./decoder-core.js','./decoder.js','./decoder-worker.js','./scanner.js','./importer.js','./generator.js','./history.js','./updater.js','./app.js','./manifest.json','./zxing.min.js','./bwip-js.min.js','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
const base=self.registration.scope;
const urls=CORE.map(p=>new URL(p,base).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  // No CDN dependency; installation only succeeds when every core asset is ready.
  await Promise.all(urls.map(async url=>{const r=await fetch(url,{cache:'reload'});if(!r.ok)throw new Error('Missing required asset');await cache.put(url,r);}));
  const v=await cache.match(new URL('./version.js',base).href);if(!(await v.text()).includes(`'${APP_VERSION}'`))throw new Error('Mixed deployment versions');
  // The page activates a prepared update after saving state, not mid-operation.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>(n.startsWith(PREFIX)||/^barcodepro-(?:runtime-)?v2_0$/.test(n))&&n!==CACHE_NAME).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type==='STATUS')event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);const results=await Promise.all(urls.map(u=>cache.match(u)));event.ports[0]?.postMessage({version:APP_VERSION,offlineReady:results.every(Boolean)});})());
});
self.addEventListener('fetch',event=>{
  const r=event.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin||!u.href.startsWith(base))return;
  // Version checks never fall back to stale data and never create timestamp cache entries.
  if(u.pathname===new URL('version.json',base).pathname){event.respondWith(fetch(r,{cache:'no-store'}).catch(()=>new Response('{"error":"offline"}',{status:503,headers:{'Content-Type':'application/json'}})));return;}
  const canonical=new URL(u.pathname,u.origin).href;
  if(r.mode==='navigate'){
    event.respondWith((async()=>{const c=await caches.open(CACHE_NAME);return (await c.match(new URL('index.html',base).href))||fetch(r).catch(()=>new Response('離線資源尚未備妥，請連網後重新開啟。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}));})());return;
  }
  if(urls.includes(canonical))event.respondWith((async()=>{const c=await caches.open(CACHE_NAME),hit=await c.match(canonical);if(hit)return hit;try{const response=await fetch(r);if(response.ok)await c.put(canonical,response.clone());return response;}catch{return new Response('Offline asset unavailable',{status:503});}})());
});
