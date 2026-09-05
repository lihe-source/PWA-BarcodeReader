const Updater=(()=>{
  const $=id=>document.getElementById(id);let reg=null,checking=false,applying=false,reloading=false,waitingTimer=null,latest=null;
  function compare(a,b){const p=v=>String(v).replace(/^v/i,'').split(/[^0-9]+/).filter(Boolean).map(Number),x=p(a),y=p(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return Math.sign(d);}return 0;}
  async function init(){
    $('headerVersion').textContent=APP_VERSION;$('currentVersionText').textContent=APP_VERSION;
    $('checkUpdateBtn').onclick=()=>check(true);$('updateNowBtn').onclick=()=>apply(true);
    let controlled=Boolean(navigator.serviceWorker?.controller);
    navigator.serviceWorker?.addEventListener('controllerchange',()=>{
      if(!controlled){controlled=true;offlineStatus();return;}
      queueReload();
    });
    if(!navigator.serviceWorker){$('versionNote').textContent='此環境不支援離線安裝；請使用 HTTPS。';return;}
    try{
      reg=await navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'});
      reg.addEventListener('updatefound',()=>{const w=reg.installing;w?.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)available();if(w.state==='redundant')$('versionNote').textContent='新版本下載未完成，目前版本仍可使用；請稍後檢查。';});});
      if(reg.waiting)available();await check(false);offlineStatus();
    }catch(e){Utils.report(e,'更新初始化');$('versionNote').textContent='離線元件註冊失敗；請確認 HTTPS 與檔案上傳完整。';}
    window.addEventListener('online',()=>check(false));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check(false);});
  }
  async function check(manual=false){
    if(checking)return;checking=true;$('checkUpdateBtn').disabled=true;$('latestVersionText').textContent='檢查中';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const r=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('Version unavailable');const data=await r.json();if(!/^V\d+(?:[._]\d+)*$/i.test(data.version))throw new Error('Invalid version');latest=data.version;$('latestVersionText').textContent=latest;
      const time=new Date().toLocaleTimeString('zh-TW',{hour12:false});
      $('versionNote').textContent=compare(latest,APP_VERSION)>0?`發現 ${latest}，正在準備更新；操作完成後自動套用。`:`已查證目前版本，最後檢查 ${time}`;
      await reg?.update();if(reg?.waiting)available();else if(manual&&compare(latest,APP_VERSION)<=0)Utils.toast('目前已是最新版本','success');
    }catch(e){$('latestVersionText').textContent=latest?`${latest}（上次查詢）`:'無法確認';$('versionNote').textContent='目前無法查證最新版本，恢復連線後會重新檢查。';if(manual)Utils.toast('更新檢查失敗，目前資料與已備妥的離線功能不受影響','error');}
    finally{clearTimeout(timer);checking=false;$('checkUpdateBtn').disabled=false;offlineStatus();}
  }
  function available(){
    $('updateBanner').hidden=false;$('updateBannerText').textContent='新版本已備妥，操作完成後自動更新';
    clearTimeout(waitingTimer);waitingTimer=setTimeout(()=>apply(false),1500);
  }
  async function apply(manual=false){
    if(applying)return;
    if(!reg?.waiting){if(manual)await check(true);return;}
    if(!App.safeToUpdate()){if(manual)Utils.toast('請先完成輸入或關閉編輯視窗，將自動更新');waitingTimer=setTimeout(()=>apply(false),1500);return;}
    applying=true;
    if(!App.checkpoint()){applying=false;$('updateBannerText').textContent='無法暫存操作，請先匯出資料並重新開啟；不會強制更新';return;}
    Scanner.stop();reg.waiting.postMessage({type:'SKIP_WAITING'});
  }
  function queueReload(){
    if(reloading)return;reloading=true;
    const attempt=()=>{if(!App.safeToUpdate()){setTimeout(attempt,1000);return;}if(!App.checkpoint()){reloading=false;Utils.toast('請先匯出資料，再重新開啟以完成更新','error');return;}Scanner.stop();location.reload();};attempt();
  }
  async function offlineStatus(){
    const worker=reg?.active||navigator.serviceWorker?.controller;if(!worker){$('offlineStatus').textContent='離線資源尚未就緒';return;}
    try{const data=await new Promise((resolve,reject)=>{const ch=new MessageChannel(),t=setTimeout(()=>{ch.port1.close();reject(new Error('Timeout'));},4000);ch.port1.onmessage=e=>{clearTimeout(t);ch.port1.close();resolve(e.data);};worker.postMessage({type:'STATUS'},[ch.port2]);});$('offlineStatus').textContent=data.offlineReady?`✓ 核心離線資源完整（${data.version}）`:'離線資源尚未完整，請保持連線並重新檢查';}catch{$('offlineStatus').textContent='離線資源狀態尚未確認';}
  }
  return {init,check,compare,offlineStatus};
})();
