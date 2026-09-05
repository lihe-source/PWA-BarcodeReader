/* Run with Node.js 20+: node verify.cjs
   Logic tests use a deliberately small transactional IDB double, not a browser.
   No runtime or production data is accessed. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,read=f=>fs.readFileSync(path.join(root,f),'utf8');let passed=0;
function ok(name,fn){return Promise.resolve().then(fn).then(()=>{passed++;console.log('PASS '+name);});}
function fakeIDB(){
  const databases=new Map();let failWrite=false;
  class DB{
    constructor(){this.stores=new Map();this.keys=new Map();this.waiting=[];this.active=false;this.objectStoreNames={contains:n=>this.stores.has(n)};}
    createObjectStore(n,{keyPath}){this.stores.set(n,new Map());this.keys.set(n,keyPath);return {createIndex(){}};}
    close(){}
    transaction(names,mode='readonly'){
      const db=this;let aborted=false,started=false,processing=false;const ops=[];let state;
      const tx={error:null,oncomplete:null,onabort:null,onerror:null,abort(){if(aborted)return;aborted=true;tx.error=tx.error||new Error('Abort');finish(false);},objectStore(n){return {
        get:k=>enqueue(()=>state.get(n).get(k)),getAll:()=>enqueue(()=>[...state.get(n).values()]),count:()=>enqueue(()=>state.get(n).size),
        put:r=>enqueue(()=>{if(failWrite){failWrite=false;throw new Error('QuotaExceededError');}state.get(n).set(r[db.keys.get(n)],structuredClone(r));return r[db.keys.get(n)];}),
        delete:k=>enqueue(()=>state.get(n).delete(k)),clear:()=>enqueue(()=>state.get(n).clear())
      };}};
      function enqueue(fn){const r={};ops.push({fn,r});if(started)run();return r;}
      function finish(commit){if(!started)return;if(commit&&mode==='readwrite')db.stores=state;setImmediate(()=>{commit?tx.oncomplete?.():tx.onabort?.();db.active=false;db.waiting.shift();db.waiting[0]?.();});}
      function run(){if(processing||aborted)return;processing=true;setImmediate(()=>{processing=false;if(aborted)return;const op=ops.shift();if(!op){finish(true);return;}try{op.r.result=structuredClone(op.fn());op.r.onsuccess?.();}catch(e){op.r.error=e;op.r.onerror?.();tx.error=e;aborted=true;finish(false);return;}run();});}
      function begin(){if(db.active)return;db.active=true;started=true;state=new Map([...db.stores].map(([n,s])=>[n,new Map([...s].map(([k,v])=>[k,structuredClone(v)]))]));run();}
      db.waiting.push(begin);setImmediate(()=>db.waiting[0]?.());return tx;
    }
  }
  return {fail(){failWrite=true;},open(name){const r={};setImmediate(()=>{let db=databases.get(name);if(!db){db=new DB();databases.set(name,db);r.result=db;r.transaction={abort(){r.error=new Error('Abort');r.onerror?.();}};r.onupgradeneeded?.();}r.result=db;r.onsuccess?.();});return r;}};
}
function context(){const memory=new Map(),idb=fakeIDB();const sandbox={console,URL,Blob,Map,Date,Math,Intl,Uint8ClampedArray,ArrayBuffer,DOMException,structuredClone,setTimeout,clearTimeout,setImmediate,crypto:require('node:crypto').webcrypto,indexedDB:idb,localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},window:{dispatchEvent(){}},CustomEvent:class{},navigator:{},document:{getElementById:()=>null},ZXing:require('./zxing.min.js')};const c=vm.createContext(sandbox);for(const f of ['version.js','utils.js','storage.js','decoder-core.js','generator.js','updater.js'])vm.runInContext(read(f),c,{filename:f});return {c,idb,memory,run:s=>vm.runInContext(s,c)};}
function pixels(bcid,text){
  const raw=require('./bwip-js.min.js').raw({bcid,text})[0],scale=4,pad=16;
  const mw=raw.pixx||raw.sbs.reduce((n,x)=>n+x,0),mh=raw.pixy||70,w=(mw+pad*2)*scale,h=(mh+pad*2)*scale,data=new Uint8ClampedArray(w*h*4).fill(255);
  function black(x,y){for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){const k=(((y+pad)*scale+yy)*w+(x+pad)*scale+xx)*4;data[k]=data[k+1]=data[k+2]=0;}}
  if(raw.pixs){for(let y=0;y<mh;y++)for(let x=0;x<mw;x++)if(raw.pixs[y*mw+x])black(x,y);}
  else{let x=0;raw.sbs.forEach((width,i)=>{if(i%2===0)for(let dx=0;dx<width;dx++)for(let y=0;y<mh;y++)black(x+dx,y);x+=width;});}
  return {data,w,h};
}
(async()=>{
  await ok('all authored JS syntax, local assets and duplicate IDs',()=>{
    for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.js')))new vm.Script(read(f),{filename:f});
    const html=read('index.html'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
    for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){assert(!/^https?:/.test(m[1]),'External asset');assert(fs.existsSync(path.join(root,m[1])),m[1]);}
    for(const f of fs.readdirSync(root).filter(f=>f.endsWith('.js')&&!f.endsWith('.min.js'))){for(const m of read(f).matchAll(/(?:\$|getElementById)\('([^']+)'\)/g))assert(ids.includes(m[1]),`${f}: missing ${m[1]}`);}
    const manifest=JSON.parse(read('manifest.json'));assert.equal(manifest.orientation,'any');for(const i of manifest.icons)assert(fs.existsSync(path.join(root,i.src)));
  });
  await ok('application initialization, navigation and regeneration contract (DOM double)',async()=>{
    class Element{
      constructor(tag='div'){this.tagName=tag.toUpperCase();this.value='';this.children=[];this.dataset={};this.hidden=false;this.style={};this.className='';this.textContent='';this.attributes={};this.listeners={};const set=new Set();this.classList={add:v=>set.add(v),remove:v=>set.delete(v),contains:v=>set.has(v),toggle:(v,yes)=>yes===false?set.delete(v):set.add(v)};}
      addEventListener(n,fn){this.listeners[n]=fn;}setAttribute(n,v){this.attributes[n]=v;}removeAttribute(n){delete this.attributes[n];}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}remove(){}select(){}focus(){}click(){this.onclick?.();}showModal(){this.open=true;}close(){this.open=false;}get options(){return this.children;}
      getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray(4)};}};}
    }
    const html=read('index.html'),els=new Map();
    for(const m of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){const e=new Element(m[1]);e.value=/\bvalue="([^"]*)"/.exec(m[0])?.[1]||'';els.set(m[2],e);}
    const pages=['scan','import','generate','history','settings'].map(p=>{const e=p==='scan'?els.get('page-scan'):new Element('section');e.dataset.page=p;return e;});
    const navs=pages.map(p=>{const e=new Element('button');e.dataset.pageTarget=p.dataset.page;e.classList.add('nav-item');return e;});
    const header=els.get('headerVersion');header.dataset.pageTarget='settings';
    const defaults={generateFormat:'QR-CODE',historyFilter:'all',themeSelect:'dark',allowedFormat:'all',printWidth:'60',printHeight:'40'};for(const [id,value]of Object.entries(defaults))els.get(id).value=value;
    const events=new Map(),local=new Map(),session=new Map();
    const doc={getElementById:id=>els.get(id)||null,createElement:t=>new Element(t),addEventListener(){},querySelectorAll:q=>q==='.page'?pages:q==='[data-page-target]'?[header,...navs]:[],querySelector:q=>q==='dialog[open]'?null:new Element('meta'),activeElement:{tagName:'BODY'},body:new Element('body'),documentElement:new Element('html'),hidden:false};
    const win={addEventListener:(n,fn)=>{if(!events.has(n))events.set(n,[]);events.get(n).push(fn);},dispatchEvent:e=>(events.get(e.type)||[]).forEach(fn=>fn(e)),scrollTo(){}};
    const c=vm.createContext({console:{...console,warn(){},error(){}},document:doc,window:win,navigator:{onLine:true},indexedDB:fakeIDB(),localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v)},location:{search:''},matchMedia:()=>({matches:false,addEventListener(){}}),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},URL,URLSearchParams,Map,Date,Math,Intl,setTimeout,clearTimeout,DOMException,Uint8ClampedArray,performance,crypto:require('node:crypto').webcrypto,bwipjs:{toCanvas(canvas){canvas.width=128;canvas.height=128;}}});
    for(const f of ['version.js','utils.js','storage.js','decoder-core.js','decoder.js','scanner.js','importer.js','generator.js','history.js','updater.js','app.js'])vm.runInContext(read(f),c,{filename:f});
    vm.runInContext('Utils.toast=()=>{}',c);await vm.runInContext('App.init()',c);await new Promise(r=>setImmediate(r));
    assert.equal(els.get('startupStatus').hidden,true);assert.equal(vm.runInContext('App.currentPage()',c),'scan');assert.equal(els.get('permissionNote').hidden,false);
    vm.runInContext('App.navigate("generate"); Generator.focusValue("  ABC123\\n","CODE-128")',c);assert.equal(els.get('generateValue').value,'  ABC123\n');assert.equal(els.get('generateFormat').value,'CODE-128');assert.equal(els.get('generateError').hidden,true);
    for(const page of ['history','settings','import'])vm.runInContext(`App.navigate('${page}')`,c);
    assert.equal(vm.runInContext('App.checkpoint()',c),true);assert.equal(vm.runInContext('App.safeToUpdate()',c),true);assert(local.has('barcodepro.v3.draft'));assert(session.has('barcodepro.v3.session'));
  });
  const {c,idb,memory,run}=context();
  run('Utils.toast=()=>{}');
  memory.set('barcodepro.history.v2',JSON.stringify([{id:'old-1',value:'  00123\n',format:'CODE_128',createdAt:'2026-07-01T00:00:00.000Z',source:'scan'}]));
  await ok('V2 migration preserves raw whitespace and original storage',async()=>{await run('Storage.init()');const rows=await run('Storage.getHistory()');assert.equal(rows[0].value,'  00123\n');assert(memory.has('barcodepro.history.v2'));assert.equal(await run('Storage.count()'),1);});
  await ok('501+ history rows retained without silent truncation',async()=>{c.rows=Array.from({length:550},(_,i)=>({value:`001${i}`,format:'CODE_128',source:'scan',createdAt:new Date(1700000000000+i).toISOString()}));await run('Storage.restore({app:"BarcodePro",history:rows})');assert.equal(await run('Storage.count()'),551);});
  await ok('backup merge is idempotent and malformed backup is rejected atomically',async()=>{const before=await run('Storage.count()');const r=await run('Storage.restore({app:"BarcodePro",history:rows})');assert.equal(r.added,0);assert.equal(r.duplicates,550);await assert.rejects(run('Storage.restore({app:"BarcodePro",history:[rows[0],{value:5}]})'));assert.equal(await run('Storage.count()'),before);});
  await ok('quota failure rolls back and clears busy state',async()=>{const before=await run('Storage.count()');idb.fail();await assert.rejects(run('Storage.addHistory({value:"quota-test",source:"scan"})'));assert.equal(await run('Storage.count()'),before);assert.equal(run('Storage.isBusy()'),false);});
  await ok('delete and undo preserves record IDs',async()=>{c.deleted=await run('Storage.removeHistory("old-1")');assert.equal(c.deleted.length,1);await run('Storage.restoreDeleted(deleted)');assert.equal((await run('Storage.getHistory()')).find(r=>r.id==='old-1').value,'  00123\n');});
  await ok('serialized settings, continuous autosave and validation rules',async()=>{await Promise.all([run('Storage.saveSettings({continuous:true})'),run('Storage.saveSettings({prefix:"ABC",minLength:5,maxLength:8,format:"CODE-128"})')]);const s=run('Storage.getSettings()');assert(s.continuous&&s.autoSave);assert(run('Storage.validate("00123","CODE-128")'));assert.equal(run('Storage.validate("ABC12","CODE-128")'),'');});
  await ok('URL allowlist and CSV formula / long identifier protection',()=>{assert.equal(run('Utils.normalizeOpenableUrl("javascript:alert(1)")'),'');assert.equal(run('Utils.normalizeOpenableUrl("text https://example.com")'),'');assert.equal(run('Utils.normalizeOpenableUrl("https://example.com")'),'https://example.com/');for(const v of ['=1+1','001234567890123456789','\t=1','+cmd']){c.value=v;assert(run('Utils.escapeCsv(value)').startsWith('"\''));}});
  await ok('EAN check digit and semantic version comparison',()=>{assert.equal(run('Generator.normalizeEAN("400638133393","EAN-13")'),'4006381333931');assert.throws(()=>run('Generator.normalizeEAN("4006381333932","EAN-13")'));assert(run('Updater.compare("V3_10","V3_2")')>0);assert.equal(run('Updater.compare("V3_0","V3.0.0")'),0);});
  await ok('all eight production renderer option sets accepted by bundled bwip-js',()=>{
    const b=require('./bwip-js.min.js');for(const [format,value]of [['QR-CODE','SMT-001'],['DATA-MATRIX','SMT-001'],['PDF-417','SMT-001'],['CODE-128','SMT-001'],['CODE-39','SMT-001'],['EAN-13','4006381333931'],['EAN-8','96385074'],['UPC-A','036000291452']]){c.format=format;c.value=value;assert(b.toSVG(run('Generator.optionsFor(format,value)')).includes('<svg'));}
  });
  for(const [bcid,value]of [['qrcode','  Rex\n'],['datamatrix','001234567890'],['pdf417','PCBA-AOI-2026'],['code128','001234567890'],['code39','SMT-001'],['ean13','4006381333931'],['ean8','96385074'],['upca','036000291452']])await ok(`${bcid} bundled encoder -> pixel raster -> ZXing round-trip`,()=>{const p=pixels(bcid,value);c.pixels=p.data;c.w=p.w;c.h=p.h;const decoded=run('DecoderCore.decode(pixels,w,h,{hard:true})');assert(decoded,bcid);assert.equal(decoded.value,value);});
  await ok('service worker install completeness, cache isolation, offline response',async()=>{
    const handlers={},maps=new Map(),deleted=[];const base='https://lihe-source.github.io/PWA-BarcodeReader/';let offline=false;
    const caches={open:async name=>{if(!maps.has(name))maps.set(name,new Map());const m=maps.get(name);return {put:async(k,r)=>m.set(k,r),match:async k=>m.get(k)?.clone()};},keys:async()=>[...maps.keys()],delete:async n=>{deleted.push(n);return maps.delete(n);}};
    maps.set('japanese-app-v1',new Map());maps.set('calendar-app-v1',new Map());maps.set('barcodepro-v2_0',new Map());
    const sw=vm.createContext({URL,Response,Promise,caches,importScripts(){},self:{registration:{scope:base},location:{origin:'https://lihe-source.github.io'},addEventListener:(n,fn)=>handlers[n]=fn,clients:{claim:async()=>{}},skipWaiting(){}},fetch:async u=>{if(offline)throw new Error('Offline');const filename=new URL(typeof u==='string'?u:u.url).pathname.split('/').at(-1)||'index.html';return new Response(fs.existsSync(path.join(root,filename))?read(filename):'',{status:fs.existsSync(path.join(root,filename))?200:404});}});
    vm.runInContext(read('version.js'),sw);vm.runInContext(read('service-worker.js'),sw);let job;handlers.install({waitUntil:p=>job=p});await job;handlers.activate({waitUntil:p=>job=p});await job;assert.deepEqual(deleted,['barcodepro-v2_0']);assert(maps.has('japanese-app-v1'));assert(maps.has('calendar-app-v1'));
    offline=true;let response;handlers.fetch({request:{url:base+'version.json?t=123',method:'GET',mode:'cors'},respondWith:p=>response=p});assert.equal((await response).status,503);
    handlers.fetch({request:{url:base+'?source=pwa',method:'GET',mode:'navigate'},respondWith:p=>response=p});assert((await (await response).text()).includes('BarcodePro'));
    maps.get('barcodepro-reader-'+vm.runInContext('APP_VERSION',sw)).delete(base+'scanner.js');handlers.fetch({request:{url:base+'scanner.js',method:'GET',mode:'cors'},respondWith:p=>response=p});assert.equal((await response).status,503);
  });
  console.log(`\n${passed} checks passed. Camera hardware, browser IndexedDB, audio and print require device QA.`);
})().catch(e=>{console.error('FAIL',e);process.exitCode=1;});
