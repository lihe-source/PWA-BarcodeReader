// scanner.js — V1_2: manage getUserMedia directly, fixes flip-camera black screen

const Scanner = (() => {
  let reader = null;
  let currentStream = null;
  let currentDeviceId = null;
  let scanning = false;
  let torchOn = false;

  const FORMATS = () => {
    const F = ZXing.BarcodeFormat;
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
            F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE,
            F.DATA_MATRIX, F.PDF_417];
  };

  function fmtStr(num) {
    return Object.keys(ZXing.BarcodeFormat).find(k => ZXing.BarcodeFormat[k] === num) || 'UNKNOWN';
  }

  function fmtCat(s) {
    return ['QR_CODE','DATA_MATRIX','PDF_417','AZTEC'].includes(s) ? '2D' : '1D';
  }

  function detectExtra(content, fmt) {
    if (fmt === 'EAN_13') {
      if (/^97[89]/.test(content)) return 'ISBN';
      if (/^977/.test(content)) return 'ISSN';
    }
    return null;
  }

  function showResult(result) {
    const content = result.getText();
    const fmt = fmtStr(result.getBarcodeFormat());
    const cat = fmtCat(fmt);
    const extra = detectExtra(content, fmt);

    document.getElementById('resultContent').textContent = content;
    const meta = document.getElementById('resultMeta');
    meta.innerHTML = '';
    const addTag = (cls, txt) => {
      const s = document.createElement('span');
      s.className = 'result-tag ' + cls; s.textContent = txt;
      meta.appendChild(s);
    };
    addTag(cat === '2D' ? 'tag-2d' : 'tag-1d', fmt.replace(/_/g,'-'));
    addTag('tag-time', new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}));
    if (extra) addTag('tag-extra', extra);

    const isURL = /^https?:\/\//i.test(content);
    const btnUrl = document.getElementById('btnOpenUrl');
    btnUrl.style.display = isURL ? '' : 'none';
    if (isURL) btnUrl.onclick = () => window.open(content,'_blank');

    document.getElementById('btnCopy').onclick = () => {
      navigator.clipboard.writeText(content).catch(()=>{});
      UI.toast('已複製');
    };
    const btnSave = document.getElementById('btnSaveScan');
    btnSave.disabled = false;
    btnSave.onclick = async () => {
      await DB.add({ content, format: extra||fmt, category: cat, source: 'scan' });
      UI.toast('已儲存'); btnSave.disabled = true;
    };
    document.getElementById('btnContinueScan').onclick = () => {
      document.getElementById('scanResultWrap').style.display = 'none';
      scanning = true;
    };
    document.getElementById('scanResultWrap').style.display = '';
  }

  function stopAll() {
    scanning = false; torchOn = false;
    if (reader) { try { reader.reset(); } catch(_){} reader = null; }
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  }

  async function startCamera(deviceId) {
    stopAll();
    const video = document.getElementById('scan-video');
    video.srcObject = null;
    await new Promise(r => setTimeout(r, 120)); // let iOS release camera

    try {
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = currentStream.getVideoTracks()[0];
      currentDeviceId = (track.getSettings ? track.getSettings().deviceId : null) || deviceId || null;

      video.srcObject = currentStream;
      await video.play();

      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS());
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      reader = new ZXing.BrowserMultiFormatReader(hints);

      reader.decodeFromStream(currentStream, video, (result, err) => {
        if (!scanning) return;
        if (result) { scanning = false; if (navigator.vibrate) navigator.vibrate(200); showResult(result); }
      });

      scanning = true;
      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';
    } catch (err) {
      console.error('Camera:', err);
      document.getElementById('scanError').style.display = 'flex';
      document.getElementById('scanOverlay').style.display = 'none';
    }
  }

  async function flipCamera() {
    let devices = [];
    try { const all = await navigator.mediaDevices.enumerateDevices(); devices = all.filter(d => d.kind === 'videoinput'); } catch(_){}
    if (devices.length < 2) { UI.toast('此裝置只有一個鏡頭'); return; }
    const idx = devices.findIndex(d => d.deviceId === currentDeviceId);
    await startCamera(devices[(idx + 1) % devices.length].deviceId);
  }

  async function toggleTorch() {
    if (!currentStream) return;
    const track = currentStream.getVideoTracks()[0];
    if (!track) return;
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      document.getElementById('btnTorch').classList.toggle('active', torchOn);
    } catch { UI.toast('此裝置不支援閃光燈'); torchOn = false; }
  }

  return {
    start: (id) => startCamera(id),
    stop: stopAll,
    flipCamera,
    toggleTorch
  };
})();
