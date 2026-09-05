'use strict';
const Scanner=(()=>{
  const nativeNames=['aztec','codabar','code_39','code_93','code_128','data_matrix','ean_8','ean_13','itf','pdf417','qr_code','upc_a','upc_e'];
  const $=id=>document.getElementById(id);
  let video,canvas,ctx,stream=null,track=null,detector=null,nativeSupported=[];
  let token=0,running=false,scanning=false,starting=false,frameTimer=0,idleTimer=0,lastAttempt=0,failures=0,processing=false,wake=null;
  let result=null,candidate={value:null,hits:0,at:0},engine='未啟動',audio=null,torch=false,deviceId='',sessionCount=0,rejectedAt=0;
  const seen=new Map();
  function status(t){$('cameraStatus').textContent=t;}
  function init(){
    video=$('scanVideo');canvas=$('scanCanvas');ctx=canvas.getContext('2d',{willReadFrequently:true});
    $('cameraStartOverlay').onclick=()=>start();$('retryCameraBtn').onclick=()=>start();
    $('flipCameraBtn').onclick=()=>flip();$('cameraSelect').onchange=e=>start(e.target.value);
    $('torchBtn').onclick=()=>toggleTorch();$('zoomRange').oninput=Utils.debounce(e=>zoom(Number(e.target.value)),100);
    $('continueScanBtn').onclick=()=>continueScan();$('pauseCameraBtn').onclick=()=>{stop();status('已停止相機');$('cameraStartOverlay').hidden=false;};
    $('copyScanBtn').onclick=()=>result&&Utils.copyText(result.value);
    $('shareScanBtn').onclick=()=>result&&Utils.shareText('條碼讀值',result.value);
    $('saveScanBtn').onclick=()=>save();$('openScanUrlBtn').onclick=()=>result&&Utils.openUrl(result.url);
    $('scanResultUrl').onclick=e=>{e.preventDefault();if(result)Utils.openUrl(result.url);};
    $('continuousToggle').onchange=e=>Storage.saveSettings({continuous:e.target.checked}).catch(e=>Utils.busyError(e,'設定未儲存'));
    document.addEventListener('pointerdown',unlockAudio,{once:true});document.addEventListener('keydown',unlockAudio,{once:true});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){stop();}
      else if(App.currentPage()==='scan'&&!result)start();
      else if(App.currentPage()==='scan'){status('結果已保留，按繼續掃描啟動相機');$('cameraStartOverlay').hidden=false;}
    });
    window.addEventListener('pagehide',()=>stop());
    video.onclick=async()=>{if(track){await tune(track);status('已要求連續對焦；請調整距離');}};
    window.addEventListener('barcode-settings-changed',()=>{if(running){failures=0;candidate={value:null,hits:0,at:0};}});
  }
  async function makeDetector(){
    nativeSupported=[];if(!window.BarcodeDetector)return null;
    try{nativeSupported=typeof BarcodeDetector.getSupportedFormats==='function'?await BarcodeDetector.getSupportedFormats():nativeNames;const names=nativeNames.filter(f=>nativeSupported.includes(f));return names.length?new BarcodeDetector({formats:names}):null;}catch{return null;}
  }
  async function start(requested=''){
    const mine=++token;stopResources();starting=true;status('正在啟動相機…');$('permissionNote').hidden=true;$('cameraStartOverlay').hidden=true;
    let owned=null;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('請使用 HTTPS 網址及支援相機的 Safari／Chrome。');
      const constraints={audio:false,video:{...(requested?{deviceId:{exact:requested}}:{facingMode:{ideal:'environment'}}),width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}};
      try{owned=await navigator.mediaDevices.getUserMedia(constraints);}catch(e){if(e.name!=='OverconstrainedError')throw e;owned=await navigator.mediaDevices.getUserMedia({audio:false,video:requested?{deviceId:{exact:requested}}:{facingMode:'environment'}});}
      if(mine!==token){owned.getTracks().forEach(t=>t.stop());return;}
      stream=owned;track=owned.getVideoTracks()[0];deviceId=track.getSettings?.().deviceId||requested;video.srcObject=owned;await video.play();
      if(mine!==token){owned.getTracks().forEach(t=>t.stop());return;}
      await tune(track);const newDetector=await makeDetector();
      if(mine!==token){owned.getTracks().forEach(t=>t.stop());return;}
      detector=newDetector;running=true;scanning=true;starting=false;failures=0;candidate={value:null,hits:0,at:0};
      result=null;App.saveSessionResult(null);$('scanResultCard').hidden=true;$('page-scan').classList.remove('has-result');
      setupCapabilities();await listCameras(mine);if(mine!==token)return;requestWake(mine);schedule(mine);status('請將條碼放入框內');
      track.addEventListener('ended',()=>{if(mine===token){stop();status('相機已中斷，請重新啟動');$('cameraStartOverlay').hidden=false;}});
    }catch(e){owned?.getTracks().forEach(t=>t.stop());if(mine!==token)return;starting=false;stopResources();const messages={NotAllowedError:'相機權限未允許，請到瀏覽器網站設定允許相機。',NotFoundError:'找不到可用相機，可改用圖片解碼。',NotReadableError:'相機可能正被其他程式使用，請關閉後重試。'};$('permissionMessage').textContent=messages[e.name]||e.message;$('permissionNote').hidden=false;$('cameraStartOverlay').hidden=false;status('相機尚未啟動');Utils.report(e,'相機啟動');}
  }
  function stopResources(){
    clearTimeout(frameTimer);clearTimeout(idleTimer);running=false;scanning=false;starting=false;processing=false;Decoder.cancel();
    stream?.getTracks().forEach(t=>t.stop());stream=null;track=null;if(video)video.srcObject=null;releaseWake();torch=false;
    $('torchBtn')?.classList.remove('active');$('zoomPanel')?.setAttribute('hidden','');
  }
  function stop(){++token;stopResources();}
  function schedule(mine){clearTimeout(frameTimer);if(running&&scanning&&mine===token)frameTimer=setTimeout(()=>scanFrame(mine),engine.startsWith('原生')?100:180);}
  function crop(){
    const vr=video.getBoundingClientRect(),fr=$('scanFrame').getBoundingClientRect();
    const scale=Math.max(vr.width/video.videoWidth,vr.height/video.videoHeight);
    const ox=(video.videoWidth*scale-vr.width)/2,oy=(video.videoHeight*scale-vr.height)/2;
    const x=Math.max(0,(fr.left-vr.left+ox)/scale),y=Math.max(0,(fr.top-vr.top+oy)/scale);
    const w=Math.min(video.videoWidth-x,fr.width/scale),h=Math.min(video.videoHeight-y,fr.height/scale);
    const width=Math.max(1,Math.min(1280,Math.round(w))),height=Math.max(1,Math.round(width*h/w));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.drawImage(video,x,y,w,h,0,0,width,height);return canvas;
  }
  async function scanFrame(mine){
    if(mine!==token||!running||!scanning)return;
    const began=performance.now();processing=true;
    try{
      if(video.readyState<2||!video.videoWidth)return;
      const frame=crop(),wanted=Storage.getSettings().format;let decoded=null;
      if(detector&&failures%4!==3){
        engine='原生辨識';const codes=await detector.detect(frame);
        if(mine!==token)return;
        const mapped=codes.map(c=>({value:c.rawValue,format:Utils.formatLabel(c.format==='pdf417'?'PDF_417':c.format),box:c.boundingBox}));
        const eligible=mapped.filter(c=>wanted==='all'||c.format===wanted);
        eligible.sort((a,b)=>{const d=c=>c.box?Math.hypot(c.box.x+c.box.width/2-frame.width/2,c.box.y+c.box.height/2-frame.height/2):Infinity;return d(a)-d(b);});decoded=eligible[0]||null;
      }
      if(!decoded&&(!detector||failures%4===3)){
        engine=`ZXing・${Decoder.mode()}`;decoded=await Decoder.decode(frame,{hard:failures>8,format:wanted});
      }
      if(mine!==token||!scanning)return;
      $('scanEnginePill').textContent=engine;
      if(decoded&&decoded.value.length){failures=0;await accept(decoded,mine);}else failures++;
    }catch(e){if(e.name!=='AbortError')failures++;}
    finally{if(mine===token){processing=false;lastAttempt=Math.round(performance.now()-began);schedule(mine);}}
  }
  async function accept(decoded,mine){
    const value=String(decoded.value),format=Utils.formatLabel(decoded.format),now=Date.now();
    const reason=Storage.validate(value,format);
    if(reason){status(reason);if(now-rejectedAt>1800){beep(false);rejectedAt=now;}return;}
    if(candidate.value===value&&candidate.format===format&&now-candidate.at<1800)candidate.hits++;else candidate={value,format,hits:1,at:now};candidate.at=now;
    if(candidate.hits<2){status('已讀取，正在交叉確認…');return;}
    const s=Storage.getSettings(),key=JSON.stringify([value,format]);
    if(s.continuous&&now-(seen.get(key)||0)<s.cooldown*1000){status('重複條碼冷卻中，請換下一個');return;}
    seen.set(key,now);for(const [k,at]of seen)if(now-at>60000)seen.delete(k);
    candidate={value:null,hits:0,at:0};scanning=false;
    result=Storage.normalize({value,format,source:'scan'});sessionCount++;$('sessionCount').textContent=`本次 ${sessionCount} 筆`;
    renderResult();App.saveSessionResult(result);beep(true);
    if(s.vibration&&navigator.vibrate)navigator.vibrate(60);
    let saved=false;
    if(s.autoSave){try{await save(false);saved=true;}catch{}}
    if(mine!==token)return;
    status(saved?'已保存，請換下一個條碼':'結果已保留');
    if(s.continuous&&(!s.autoSave||saved)){scanning=true;}
    else{releaseWake();idleTimer=setTimeout(()=>{if(mine===token&&!scanning){stop();status('相機已休眠，結果已保留');$('cameraStartOverlay').hidden=false;}},15000);}
  }
  function renderResult(){
    if(!result)return;$('scanResultCard').hidden=false;$('page-scan').classList.add('has-result');
    $('scanResultType').textContent=result.type;$('scanResultFormat').textContent=result.format;$('scanResultValue').textContent=result.value;
    $('scanResultMeta').textContent=`${result.value.length} 字元 · ${Utils.formatDateTime(result.createdAt)}`;
    const link=$('scanResultUrl');link.textContent=result.url;link.href=result.url||'#';link.hidden=!result.url;$('scanNoUrl').hidden=Boolean(result.url);$('openScanUrlBtn').disabled=!result.url;
    $('saveScanBtn').disabled=false;$('saveScanBtn').textContent='存入歷史';
  }
  async function save(showToast=true){
    if(!result)return;const entry=result;
    try{await Storage.addHistory(entry);if(result?.id===entry.id){$('saveScanBtn').disabled=true;$('saveScanBtn').textContent='已存入歷史';}if(showToast)Utils.toast('已存入歷史','success');}
    catch(e){Utils.busyError(e,'未能保存，請先複製或匯出結果');if(!showToast)throw e;}
  }
  function continueScan(){
    if(!running){start(deviceId);return;}clearTimeout(idleTimer);result=null;App.saveSessionResult(null);$('scanResultCard').hidden=true;$('page-scan').classList.remove('has-result');candidate={value:null,hits:0,at:0};scanning=true;requestWake(token);status('請對準下一個條碼');schedule(token);
  }
  async function tune(t){try{const c=t?.getCapabilities?.()||{};const advanced=[];for(const k of ['focusMode','exposureMode','whiteBalanceMode'])if(c[k]?.includes('continuous'))advanced.push({[k]:'continuous'});if(advanced.length)await t.applyConstraints({advanced});}catch{}}
  function setupCapabilities(){
    let c={};try{c=track?.getCapabilities?.()||{};}catch{}
    $('torchBtn').disabled=!c.torch;$('torchBtn').title=c.torch?'補光燈':'目前鏡頭不支援補光燈';
    if(c.zoom&&c.zoom.max>c.zoom.min){const r=$('zoomRange');r.min=c.zoom.min;r.max=c.zoom.max;r.step=c.zoom.step||0.1;r.value=track.getSettings().zoom||c.zoom.min;$('zoomValue').value=`${Number(r.value).toFixed(1)}×`;$('zoomPanel').hidden=false;}
  }
  async function zoom(value){const t=track;try{await t?.applyConstraints({advanced:[{zoom:value}]});if(t===track)$('zoomValue').value=`${value.toFixed(1)}×`;}catch{Utils.toast('鏡頭無法套用此縮放值');}}
  async function toggleTorch(){const t=track;if(!t)return;try{const next=!torch;await t.applyConstraints({advanced:[{torch:next}]});if(t===track){torch=next;$('torchBtn').classList.toggle('active',next);}}catch{Utils.toast('無法切換補光燈','error');}}
  async function listCameras(mine){try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(mine!==token)return;const select=$('cameraSelect');select.replaceChildren();devices.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`鏡頭 ${i+1}`;select.append(o);});select.value=deviceId;select.hidden=devices.length<2;}catch{}}
  function flip(){const options=[...$('cameraSelect').options];if(options.length<2)return;const at=options.findIndex(o=>o.value===deviceId);start(options[(at+1)%options.length].value);}
  async function requestWake(mine){releaseWake();try{if(navigator.wakeLock&&!document.hidden){const w=await navigator.wakeLock.request('screen');if(mine===token&&scanning)wake=w;else w.release();}}catch{}}
  function releaseWake(){wake?.release().catch(()=>{});wake=null;}
  async function unlockAudio(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audio||audio.state==='closed')audio=new C();if(audio.state==='suspended')await audio.resume();}catch{}}
  async function beep(success=true,force=false){
    if(!force&&!Storage.getSettings().sound)return;await unlockAudio();if(!audio||audio.state!=='running'){if(force)Utils.toast('無法播放，請確認音量與瀏覽器音訊權限');return;}
    const o=audio.createOscillator(),g=audio.createGain(),at=audio.currentTime;o.frequency.value=success?1040:260;g.gain.setValueAtTime(0.13,at);g.gain.exponentialRampToValueAtTime(.001,at+.16);o.connect(g).connect(audio.destination);o.start();o.stop(at+.17);o.onended=()=>{o.disconnect();g.disconnect();};
  }
  function restoreResult(r){if(!r)return;try{result=Storage.normalize(r);renderResult();status('已還原上次結果，按繼續掃描啟動');$('cameraStartOverlay').hidden=false;}catch{}}
  function diagnostics(){return {engine,processingMs:lastAttempt,worker:Decoder.mode(),nativeFormats:nativeSupported.join(', ')||'無／尚未初始化',camera:track?.getSettings?.()?`${track.getSettings().width} × ${track.getSettings().height}`:'未啟動'};}
  return {init,start,stop,beep,restoreResult,diagnostics,isBusy:()=>processing||starting,isRunning:()=>running,getResult:()=>result};
})();
