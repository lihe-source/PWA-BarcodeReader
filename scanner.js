// scanner.js — V1_6
// Optimizations vs V1_5:
//  1. Prefer native BarcodeDetector API (iOS 17+ Safari uses Vision framework, near-native speed)
//  2. ZXing fallback adds TRY_HARDER + ALSO_INVERTED hints
//  3. Higher resolution camera constraints (1920x1080 ideal)
//  4. Continuous focus + exposure + white balance via applyConstraints
//  5. requestVideoFrameCallback decode loop (sync to camera frames, ~33ms)
//  6. ROI center crop for native path to reduce work and improve hit rate
//  7. Result debounce to prevent duplicate triggers
// Public API unchanged: start, pause, resume, stop, flipCamera, toggleTorch

const Scanner = (() => {
  let reader = null;
  let nativeDetector = null;
  let useNative = false;
  let currentStream = null;
  let currentDeviceId = null;
  let scanning = false;
  let torchOn = false;
  let streamAlive = false;
  let rvfcHandle = 0;
  let lastText = null;
  let lastTime = 0;
  let workCanvas = null;
  let workCtx = null;

  const ZX_FORMATS = () => {
    const F = ZXing.BarcodeFormat;
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
            F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE,
            F.DATA_MATRIX, F.PDF_417];
  };
  const NATIVE_FORMATS = [
    'ean_13','ean_8','upc_a','upc_e',
    'code_128','code_39','itf',
    'qr_code','data_matrix','pdf417'
  ];
  const NATIVE_TO_ZX = {
    'ean_13':'EAN_13','ean_8':'EAN_8','upc_a':'UPC_A','upc_e':'UPC_E',
    'code_128':'CODE_128','code_39':'CODE_39','itf':'ITF',
    'qr_code':'QR_CODE','data_matrix':'DATA_MATRIX','pdf417':'PDF_417'
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

  function flashSuccess() {
    const overlay = document.getElementById('scanOverlay');
    if (!overlay) return;
    overlay.style.background = 'rgba(39,174,96,0.35)';
    setTimeout(() => { overlay.style.background = 'rgba(0,0,0,0.4)'; }, 350);
  }

  function handleHit(text, fmtName) {
    const now = Date.now();
    if (text === lastText && now - lastTime < 1500) return;
    lastText = text; lastTime = now;
    scanning = false;
    if (navigator.vibrate) navigator.vibrate(200);
    showResult(text, fmtName);
  }

  function showResult(content, fmt) {
    const cat = fmtCat(fmt);
    const extra = detectExtra(content, fmt);
    const isURL = /^https?:\/\//i.test(content);

    flashSuccess();

    document.getElementById('resultContent').textContent = content;
    const meta = document.getElementById('resultMeta');
    meta.innerHTML = '';
    const addTag = (cls, txt) => {
      const s = document.createElement('span');
      s.className = 'result-tag ' + cls; s.textContent = txt; meta.appendChild(s);
    };
    addTag(cat === '2D' ? 'tag-2d' : 'tag-1d', fmt.replace(/_/g,'-'));
    addTag('tag-time', new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}));
    if (extra) addTag('tag-extra', extra);

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
      lastText = null;
      scanning = true;
    };
    document.getElementById('scanResultWrap').style.display = '';
  }

  function clearStream() {
    scanning = false; streamAlive = false; torchOn = false;
    rvfcHandle = 0;
    if (reader) { try { reader.reset(); } catch(_){} reader = null; }
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    const video = document.getElementById('scan-video');
    if (video) video.srcObject = null;
  }

  async function tuneCamera(track) {
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const advanced = [];
    if (caps.focusMode && caps.focusMode.includes('continuous'))
      advanced.push({ focusMode: 'continuous' });
    if (caps.exposureMode && caps.exposureMode.includes('continuous'))
      advanced.push({ exposureMode: 'continuous' });
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous'))
      advanced.push({ whiteBalanceMode: 'continuous' });
    if (advanced.length) {
      try { await track.applyConstraints({ advanced }); } catch(_){}
    }
  }

  function startNativeLoop(video) {
    if (!workCanvas) {
      workCanvas = document.createElement('canvas');
      workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    }
    const tick = async () => {
      if (!streamAlive) return;
      if (scanning && video.readyState >= 2 && nativeDetector) {
        try {
          const vw = video.videoWidth, vh = video.videoHeight;
          if (vw && vh) {
            // ROI center crop: 70% width, 50% height (matches typical scan box area)
            const cw = Math.floor(vw * 0.70);
            const ch = Math.floor(vh * 0.50);
            const cx = Math.floor((vw - cw) / 2);
            const cy = Math.floor((vh - ch) / 2);
            if (workCanvas.width !== cw) workCanvas.width = cw;
            if (workCanvas.height !== ch) workCanvas.height = ch;
            workCtx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
            const codes = await nativeDetector.detect(workCanvas);
            if (codes && codes.length > 0) {
              const c = codes[0];
              handleHit(c.rawValue, NATIVE_TO_ZX[c.format] || c.format.toUpperCase());
            }
          }
        } catch(_){}
      }
      if (!streamAlive) return;
      if (video.requestVideoFrameCallback) {
        rvfcHandle = video.requestVideoFrameCallback(tick);
      } else {
        rvfcHandle = requestAnimationFrame(tick);
      }
    };
    tick();
  }

  async function startCamera(deviceId) {
    clearStream();
    await new Promise(r => setTimeout(r, 120));

    const video = document.getElementById('scan-video');

    // Detect native BarcodeDetector once
    if (!nativeDetector && 'BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        const usable = NATIVE_FORMATS.filter(f => supported.includes(f));
        if (usable.length >= 5) {
          nativeDetector = new BarcodeDetector({ formats: usable });
          useNative = true;
          console.log('[Scanner] Using native BarcodeDetector:', usable.join(','));
        }
      } catch(_){}
    }

    try {
      const baseVideo = deviceId
        ? { deviceId: { exact: deviceId },
            width: { ideal: 1920 }, height: { ideal: 1080 },
            frameRate: { ideal: 30 } }
        : { facingMode: { ideal: 'environment' },
            width: { ideal: 1920 }, height: { ideal: 1080 },
            frameRate: { ideal: 30 } };
      try {
        currentStream = await navigator.mediaDevices.getUserMedia({ video: baseVideo });
      } catch(e1) {
        const fallback = deviceId
          ? { deviceId: { exact: deviceId }, width:{ideal:1280}, height:{ideal:720} }
          : { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} };
        currentStream = await navigator.mediaDevices.getUserMedia({ video: fallback });
      }

      const track = currentStream.getVideoTracks()[0];
      currentDeviceId = (track.getSettings ? track.getSettings().deviceId : null) || deviceId || null;

      video.srcObject = currentStream;
      video.setAttribute('playsinline','true');
      video.muted = true;
      await video.play();

      tuneCamera(track);

      streamAlive = true;
      scanning = true;
      lastText = null; lastTime = 0;
      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';

      if (useNative) {
        startNativeLoop(video);
      } else {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS());
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        try { hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true); } catch(_){}
        reader = new ZXing.BrowserMultiFormatReader(hints, 100);
        reader.decodeFromStream(currentStream, video, (result) => {
          if (!scanning || !result) return;
          handleHit(result.getText(), fmtStr(result.getBarcodeFormat()));
        });
      }
    } catch (err) {
      console.error('Camera:', err);
      document.getElementById('scanError').style.display = 'flex';
      document.getElementById('scanOverlay').style.display = 'none';
    }
  }

  function pause() { scanning = false; }

  function resume() {
    if (streamAlive && currentStream) {
      document.getElementById('scanResultWrap').style.display = 'none';
      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';
      lastText = null;
      scanning = true;
    } else {
      return startCamera(currentDeviceId);
    }
  }

  function stop() { clearStream(); }

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
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      document.getElementById('btnTorch').classList.toggle('active', torchOn);
    } catch { UI.toast('此裝置不支援閃光燈'); torchOn = false; }
  }

  return { start: startCamera, pause, resume, stop, flipCamera, toggleTorch };
})();
