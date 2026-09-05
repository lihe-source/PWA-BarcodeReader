'use strict';
const Storage = (() => {
  const DB_NAME='BarcodePro-v3';
  const defaults={autoSave:true,sound:true,vibration:true,theme:'dark',continuous:false,cooldown:3,format:'all',minLength:0,maxLength:0,prefix:'',categories:['未分類']};
  let db, settings={...defaults}, queue=Promise.resolve(),writing=0,queued=0;
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('barcodepro-v3'):null;
  channel?.addEventListener('message',()=>window.dispatchEvent(new CustomEvent('barcode-history-changed')));
  function notify(){window.dispatchEvent(new CustomEvent('barcode-history-changed'));channel?.postMessage('changed');}
  function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  function complete(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('交易取消'));tx.onerror=()=>{};});}
  function transaction(names,mode,fn){
    if(!db)throw new Error('資料庫尚未就緒；請先匯出可見結果後重新開啟。');
    const tx=db.transaction(names,mode);writing++;const done=complete(tx).finally(()=>writing--);
    try{fn(tx);}catch(e){tx.abort();return done.catch(()=>{throw e;});}return done;
  }
  function serial(fn){queued++;const p=queue.then(fn).finally(()=>queued--);queue=p.catch(()=>{});return p;}
  async function init(){
    db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{const d=r.result;const s=d.createObjectStore('history',{keyPath:'id'});s.createIndex('createdAt','createdAt');d.createObjectStore('meta',{keyPath:'key'});};
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('資料庫被另一個視窗占用，請關閉其他視窗後重試。'));
    });
    db.onversionchange=()=>{db.close();Utils.toast('資料庫版本已變更，請重新開啟程式','error');};
    await migrate(); settings=cleanSettings(await getMeta('settings')||defaults);
    return settings;
  }
  async function getMeta(key){const row=await request(db.transaction('meta').objectStore('meta').get(key));return row?.value;}
  async function setMeta(key,value){await transaction(['meta'],'readwrite',tx=>tx.objectStore('meta').put({key,value}));}
  function cleanSettings(s={}){
    const n={...defaults};
    for(const k of ['autoSave','sound','vibration','continuous'])if(typeof s[k]==='boolean')n[k]=s[k];
    if(n.continuous)n.autoSave=true;
    if(['dark','light','system'].includes(s.theme))n.theme=s.theme;
    n.cooldown=Math.min(60,Math.max(1,Number(s.cooldown)||3));
    n.format=['all','QR-CODE','CODE-128','CODE-39','EAN-13','EAN-8','UPC-A','DATA-MATRIX','PDF-417','ITF'].includes(s.format)?s.format:'all';
    for(const k of ['minLength','maxLength'])n[k]=Math.min(10000,Math.max(0,Math.floor(Number(s[k])||0)));
    n.prefix=String(s.prefix||'').slice(0,256);
    n.categories=[...new Set(['未分類',...(Array.isArray(s.categories)?s.categories:[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim().slice(0,40))])].slice(0,101);
    return n;
  }
  function getSettings(){return {...settings,categories:[...settings.categories]};}
  async function saveSettings(partial){return serial(async()=>{const next=cleanSettings({...settings,...partial});await setMeta('settings',next);settings=next;window.dispatchEvent(new CustomEvent('barcode-settings-changed',{detail:getSettings()}));return getSettings();});}
  function normalize(e,{strict=false}={}){
    if(!e||typeof e!=='object'||typeof (e.value??e.content)!=='string')throw new Error('備份含有無效的條碼讀值。');
    const value=e.value??e.content;
    if(!value.length||value.length>100000)throw new Error('條碼內容不可為空或超過 100,000 字元。');
    const d=new Date(e.createdAt??e.timestamp??Date.now());if(Number.isNaN(d.getTime()))throw new Error('備份包含無效日期。');
    const source=['scan','import','generate'].includes(e.source)?e.source:'scan';
    return {id:typeof e.id==='string'&&e.id.length<150?e.id:Utils.uniqueId(),value,format:Utils.formatLabel(e.format),source,createdAt:d.toISOString(),url:Utils.normalizeOpenableUrl(value),type:Utils.classifyContent(value,e.format),note:String(e.note||'').slice(0,2000),category:String(e.category||'未分類').slice(0,40),quantity:Math.max(1,Math.min(1000000,Math.floor(Number(e.quantity)||1)))};
  }
  async function migrate(){
    if(await getMeta('migrated-v2'))return;
    let old=[],oldSettings={};
    try{
      const raw=localStorage.getItem('barcodepro.history.v2');
      if(raw){const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error('V2 歷史不是有效陣列');old=parsed.map(e=>normalize(e));}
      oldSettings=Utils.safeJsonParse(localStorage.getItem('barcodepro.settings.v2'),{});
    }catch(e){Utils.report(e,'舊資料遷移');throw new Error('舊資料無法完整讀取，已保留原資料，請勿清除網站資料。');}
    await transaction(['history','meta'],'readwrite',tx=>{
      for(const row of old)tx.objectStore('history').put(row);
      tx.objectStore('meta').put({key:'settings',value:cleanSettings(oldSettings)});
      tx.objectStore('meta').put({key:'migrated-v2',value:{at:new Date().toISOString(),count:old.length}});
    });
    // Keep V2 data intact for rollback; NEVER delete it automatically.
    if(old.length)Utils.toast(`已安全移轉 ${old.length} 筆舊紀錄；舊資料仍保留`,'success');
  }
  async function importLegacyDatabase(){
    // Only open after explicit user action; no automatic cross-project reads.
    const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('BarcodeProDB');r.onupgradeneeded=()=>r.transaction.abort();r.onerror=()=>reject(new Error('找不到 V1 資料庫'));r.onsuccess=()=>resolve(r.result);});
    try{if(!old.objectStoreNames.contains('scanHistory'))throw new Error('找不到 V1 歷史資料');const rows=await request(old.transaction('scanHistory').objectStore('scanHistory').getAll());return await restore({app:'BarcodePro',history:rows.map(e=>normalize({...e,id:`legacy-v1-${e.id}`}))});}finally{old.close();}
  }
  async function addHistory(entry){const item=normalize(entry);await transaction(['history'],'readwrite',tx=>tx.objectStore('history').put(item));notify();return item;}
  async function getHistory(){return (await request(db.transaction('history').objectStore('history').getAll())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async function count(){return request(db.transaction('history').objectStore('history').count());}
  async function removeHistory(ids){const keys=Array.isArray(ids)?ids:[ids];const removed=[];await transaction(['history'],'readwrite',tx=>{const s=tx.objectStore('history');keys.forEach(id=>{const r=s.get(id);r.onsuccess=()=>{if(r.result)removed.push(r.result);};s.delete(id);});});notify();return removed;}
  async function restoreDeleted(rows){await transaction(['history'],'readwrite',tx=>rows.forEach(row=>tx.objectStore('history').put(row)));notify();}
  async function clearHistory(){await transaction(['history'],'readwrite',tx=>tx.objectStore('history').clear());notify();}
  async function backup(){return {app:'BarcodePro',schema:3,version:APP_VERSION,exportedAt:new Date().toISOString(),settings:getSettings(),history:await getHistory()};}
  async function exportHistory(){const payload=await backup();Utils.downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`BarcodePro-${APP_VERSION}-${new Date().toISOString().slice(0,10)}.json`);return payload.history.length;}
  function validateBackup(p){
    if(p?.app!=='BarcodePro'||!Array.isArray(p.history))throw new Error('請選擇 BarcodePro 匯出的 JSON 備份。');
    if(p.schema&&![1,2,3].includes(p.schema))throw new Error('此備份版本較新，請先更新程式。');
    if(p.history.length>100000)throw new Error('備份超過 100,000 筆，請分批匯入。');
    return {history:p.history.map(e=>normalize(e,{strict:true})),settings:p.settings?cleanSettings(p.settings):null};
  }
  async function restore(payload,{settings:withSettings=false}={}){
    const p=validateBackup(payload);let added=0,duplicates=0;const tx=db.transaction(['history','meta'],'readwrite');writing++;const done=complete(tx).finally(()=>writing--);const s=tx.objectStore('history');
    const r=s.getAll();r.onsuccess=()=>{
      const signature=e=>JSON.stringify([e.value,e.format,e.source,e.createdAt]);
      const existing=new Set(r.result.map(signature));const ids=new Set(r.result.map(e=>e.id));
      p.history.forEach(row=>{const key=signature(row);if(existing.has(key)){duplicates++;return;}existing.add(key);if(ids.has(row.id))row.id=Utils.uniqueId();ids.add(row.id);s.put(row);added++;});
      if(withSettings&&p.settings)tx.objectStore('meta').put({key:'settings',value:p.settings});
    };
    await done;if(withSettings&&p.settings){settings=p.settings;window.dispatchEvent(new CustomEvent('barcode-settings-changed',{detail:getSettings()}));}notify();return {added,duplicates};
  }
  async function exportCSV(rows){const fields=['createdAt','source','format','value','quantity','category','note'];const lines=[['時間','來源','格式','原始讀值','數量','分類','備註'].map(Utils.escapeCsv).join(',')];for(const row of rows)lines.push(fields.map(f=>Utils.escapeCsv(f==='source'?Utils.sourceLabel(row[f]):row[f])).join(','));Utils.downloadBlob(new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),`BarcodePro-${Date.now()}.csv`);}
  function validate(value,format){const s=settings;if(s.format!=='all'&&Utils.formatLabel(format)!==s.format)return '條碼格式不符合設定';if(s.minLength&&value.length<s.minLength)return '讀值長度不足';if(s.maxLength&&value.length>s.maxLength)return '讀值超過長度限制';if(s.prefix&&!value.startsWith(s.prefix))return '讀值前綴不符合設定';return '';}
  function ready(){return Boolean(db);}
  return {init,ready,getSettings,saveSettings,normalize,getHistory,count,addHistory,removeHistory,restoreDeleted,clearHistory,exportHistory,backup,validateBackup,restore,exportCSV,getMeta,setMeta,validate,importLegacyDatabase,isBusy:()=>writing>0||queued>0};
})();
