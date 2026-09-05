'use strict';
const App=(()=>{
  const $=id=>document.getElementById(id);let page='scan',initialized=false,lastInteraction=0,restorePayload=null,restoreBusy=false,sessionResult=null;
  const DRAFT_KEY='barcodepro.v3.draft',SESSION_KEY='barcodepro.v3.session';
  const sessionFields=['categoriesInput','cooldownInput','allowedFormat','minLength','maxLength','prefixInput','historySearch','historyFilter','historyFrom','historyTo','printWidth','printHeight'];
  function readSession(){try{return Utils.safeJsonParse(sessionStorage.getItem(SESSION_KEY),null);}catch{return null;}}
  function getDraft(){try{return Utils.safeJsonParse(localStorage.getItem(DRAFT_KEY),null);}catch{return null;}}
  function persistDraft(){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify({value:$('generateValue').value,format:$('generateFormat').value}));return true;}
    catch(e){Utils.report(e,'草稿暫存');return false;}
  }
  function saveSessionResult(r){sessionResult=r;checkpoint();}
  function checkpoint(){
    if(!initialized)return true;
    try{if(!persistDraft())return false;sessionStorage.setItem(SESSION_KEY,JSON.stringify({page,scan:sessionResult||Scanner.getResult(),import:Importer.session(),fields:Object.fromEntries(sessionFields.map(id=>[id,$(id).value]))}));return true;}catch(e){Utils.report(e,'狀態暫存');return false;}
  }
  function safeToUpdate(){return initialized&&!restoreBusy&&!Storage.isBusy()&&!Scanner.isBusy()&&!Importer.isBusy()&&!Generator.isBusy()&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&Date.now()-lastInteraction>2000;}
  function navigate(target,{start=true}={}){
    if(!['scan','import','generate','history','settings'].includes(target))return;
    if(page==='scan'&&target!=='scan')Scanner.stop();if(page==='import'&&target!=='import')Importer.cancel();if(page==='generate'&&target!=='generate')Generator.cancel();
    page=target;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.dataset.page===target));
    document.querySelectorAll('[data-page-target]').forEach(el=>{if(el.classList.contains('nav-item')){el.classList.toggle('active',el.dataset.pageTarget===target);if(el.dataset.pageTarget===target)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}});
    window.scrollTo({top:0,behavior:'instant'});
    if(target==='scan'&&start&&!Scanner.isRunning()){if(Scanner.getResult())Scanner.restoreResult(Scanner.getResult());else Scanner.start();}
    if(target==='history')HistoryView.refresh();if(target==='generate')Generator.render();if(target==='settings')diagnostics();checkpoint();
  }
  function theme(s){let t=s.theme;if(t==='system')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]').content=t==='light'?'#f3f6fb':'#070b14';}
  function sync(s){
    for(const [id,k]of [['autoSaveToggle','autoSave'],['soundToggle','sound'],['vibrationToggle','vibration'],['continuousToggle','continuous']])$(id).checked=s[k];
    $('autoSaveToggle').disabled=s.continuous;
    for(const [id,k]of [['themeSelect','theme'],['cooldownInput','cooldown'],['allowedFormat','format'],['minLength','minLength'],['maxLength','maxLength'],['prefixInput','prefix']])$(id).value=s[k];
    $('categoriesInput').value=s.categories.filter(c=>c!=='未分類').join('\n');theme(s);
  }
  async function settingsChange(partial){try{await Storage.saveSettings(partial);return true;}catch(e){sync(Storage.getSettings());Utils.busyError(e,'設定未儲存');return false;}}
  function bindSettings(){
    for(const [id,k]of [['autoSaveToggle','autoSave'],['soundToggle','sound'],['vibrationToggle','vibration']])$(id).onchange=e=>settingsChange({[k]:e.target.checked});
    $('themeSelect').onchange=e=>settingsChange({theme:e.target.value});
    $('scanRulesForm').onsubmit=e=>{e.preventDefault();const min=Number($('minLength').value),max=Number($('maxLength').value);if(max&&min>max){Utils.toast('最大長度不可小於最小長度','error');return;}settingsChange({cooldown:Number($('cooldownInput').value),format:$('allowedFormat').value,minLength:min,maxLength:max,prefix:$('prefixInput').value}).then(ok=>{if(ok)Utils.toast('掃描檢核已更新','success');});};
    $('saveCategoriesBtn').onclick=()=>settingsChange({categories:$('categoriesInput').value.split('\n')}).then(ok=>{if(ok)Utils.toast('分類已保存','success');});
    $('testSoundBtn').onclick=()=>Scanner.beep(true,true);
    $('exportHistoryBtn').onclick=async()=>{try{const n=await Storage.exportHistory();Utils.toast(`已匯出 ${n} 筆紀錄與設定；請妥善保存 JSON`,'success');}catch(e){Utils.busyError(e,'備份失敗');}};
    $('restoreBackupBtn').onclick=()=>$('backupInput').click();$('backupInput').onchange=e=>{const f=e.target.files?.[0];e.target.value='';if(f)previewBackup(f);};
    $('restoreCancel').onclick=()=>{if(!restoreBusy){$('restoreDialog').close();restorePayload=null;}};
    $('restoreConfirm').onclick=async()=>{
      if(!restorePayload||restoreBusy)return;restoreBusy=true;$('restoreConfirm').disabled=true;$('restoreCancel').disabled=true;
      try{const r=await Storage.restore(restorePayload,{settings:$('restoreSettings').checked});$('restoreDialog').close();Utils.toast(`還原完成：新增 ${r.added} 筆，略過 ${r.duplicates} 筆重複資料`,'success');restorePayload=null;}catch(e){Utils.busyError(e,'還原失敗，原資料仍保留');}
      finally{restoreBusy=false;$('restoreConfirm').disabled=false;$('restoreCancel').disabled=false;}
    };
    $('restoreDialog').addEventListener('cancel',e=>{if(restoreBusy)e.preventDefault();});
    $('clearHistoryBtn').onclick=async()=>{if(!confirm('確定清除 V3 全部歷史？此操作無法復原，建議先匯出 JSON。\nV2 原始資料與產碼草稿不會被清除。'))return;try{await Storage.clearHistory();Utils.toast('V3 歷史已清除，僅能透過備份還原');}catch(e){Utils.busyError(e,'清除失敗');}};
    $('importLegacyBtn').onclick=async()=>{if(!confirm('讀取本瀏覽器的 BarcodePro V1 舊資料庫並合併？原資料不會刪除。'))return;try{const r=await Storage.importLegacyDatabase();Utils.toast(`已移轉 ${r.added} 筆，略過重複 ${r.duplicates} 筆`,'success');}catch(e){Utils.busyError(e,'V1 資料移轉失敗');}};
    $('diagnosticsBtn').onclick=diagnostics;
    $('persistStorageBtn').onclick=async()=>{try{const ok=await navigator.storage?.persist?.();Utils.toast(ok?'瀏覽器已允許持續儲存；仍建議定期匯出':'瀏覽器未授予持續儲存，請定期匯出 JSON');diagnostics();}catch(e){Utils.busyError(e,'無法請求持續儲存');}};
    window.addEventListener('barcode-settings-changed',e=>sync(e.detail));matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>theme(Storage.getSettings()));
  }
  async function previewBackup(file){
    if(file.size>50*1024*1024){Utils.toast('備份上限 50 MB','error');return;}restoreBusy=true;
    try{const p=JSON.parse(await file.text()),valid=Storage.validateBackup(p);restorePayload=p;$('restoreSummary').textContent=`備份含 ${valid.history.length} 筆紀錄${valid.settings?'及設定':''}。將合併到目前資料，完全相同的內容／格式／來源／時間只保留一份；不會清空現有紀錄。`;$('restoreSettings').checked=false;$('restoreSettings').disabled=!valid.settings;$('restoreDialog').showModal();}catch(e){Utils.busyError(e,'備份檢查失敗');}finally{restoreBusy=false;}
  }
  async function diagnostics(){
    try{const d=Scanner.diagnostics(),estimate=await navigator.storage?.estimate?.(),persisted=await navigator.storage?.persisted?.();const lines=[`程式版本：${APP_VERSION}（${BUILD_DATE}）`,`歷史紀錄：${await Storage.count()} 筆`,`相機：${d.camera}`,`辨識引擎：${d.engine}`,`最近解碼耗時：${d.processingMs} ms`,`背景解碼：${d.worker}`,`原生格式：${d.nativeFormats}`,`瀏覽器儲存：約 ${((estimate?.usage||0)/1048576).toFixed(1)} MB（同來源合計）`,`持續儲存：${persisted?'已授予':'尚未授予／不支援'}`,`網路狀態：${navigator.onLine?'連線中（不代表外部網站皆可達）':'離線'}`,`最近錯誤：${Utils.errors.map(e=>`${e.at} ${e.scope} ${e.name}`).join('\n')||'無'}`];$('diagnosticsText').textContent=lines.join('\n');Updater.offlineStatus();}catch(e){Utils.report(e,'診斷');}
  }
  async function init(){
    try{
      const s=await Storage.init();Scanner.init();Importer.init();Generator.init();HistoryView.init();bindSettings();sync(s);
      document.querySelectorAll('[data-page-target]').forEach(b=>b.onclick=()=>navigate(b.dataset.pageTarget));
      document.addEventListener('pointerdown',()=>lastInteraction=Date.now(),{passive:true});document.addEventListener('keydown',()=>lastInteraction=Date.now());
      const previous=readSession();initialized=true;
      if(previous?.scan){sessionResult=previous.scan;Scanner.restoreResult(previous.scan);}if(previous?.import)Importer.restoreSession(previous.import);
      if(previous?.fields)for(const id of sessionFields)if(typeof previous.fields[id]==='string')$(id).value=previous.fields[id];
      const target=new URLSearchParams(location.search).get('page')||previous?.page||'scan';navigate(target,{start:false});
      $('startupStatus').hidden=true;Updater.init();
      if(page==='scan'&&!previous?.scan)Scanner.start();
      window.addEventListener('pagehide',checkpoint);document.addEventListener('visibilitychange',()=>{if(document.hidden)checkpoint();});
      $('toTopBtn').onclick=()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }catch(e){Utils.report(e,'初始化');$('startupStatus').hidden=false;$('startupStatus').textContent=`程式未能完成初始化：${e.message}。請勿清除網站資料，可先確認瀏覽器儲存權限後重新開啟。`;}
  }
  return {init,navigate,currentPage:()=>page,getDraft,persistDraft,saveSessionResult,checkpoint,safeToUpdate};
})();
window.addEventListener('unhandledrejection',e=>{Utils.report(e.reason,'非同步操作');Utils.toast('操作未完成，請重試；原始資料不會主動清除','error');});
document.addEventListener('DOMContentLoaded',App.init);
