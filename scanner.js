const Scanner = (() => {
  const NATIVE_FORMATS = [
    'aztec', 'codabar', 'code_39', 'code_93', 'code_128',
    'data_matrix', 'ean_8', 'ean_13', 'itf', 'pdf417',
    'qr_code', 'upc_a', 'upc_e'
  ];

  const NATIVE_FORMAT_LABELS = {
    aztec: 'AZTEC', codabar: 'CODABAR', code_39: 'CODE_39', code_93: 'CODE_93',
    code_128: 'CODE_128', data_matrix: 'DATA_MATRIX', ean_8: 'EAN_8',
    ean_13: 'EAN_13', itf: 'ITF', pdf417: 'PDF_417', qr_code: 'QR_CODE',
    upc_a: 'UPC_A', upc_e: 'UPC_E'
  };

  let video;
  let canvas;
  let context;
  let stream = null;
  let videoTrack = null;
  let detector = null;
  let engine = 'none';
  let running = false;
  let scanning = false;
  let processing = false;
  let scheduledId = 0;
  let usingVideoFrameCallback = false;
  let currentDeviceId = '';
  let facingMode = 'environment';
  let torchOn = false;
  let wakeLock = null;
  let lastScanAt = 0;
  let candidate = { value: '', format: '', hits: 0, at: 0 };
  let lastResult = null;
  let initialized = false;
  let lifecycleToken = 0;

  function init() {
    if (initialized) return;
    initialized = true;
    video = document.getElementById('scanVideo');
    canvas = document.getElementById('scanCanvas');
    context = canvas.getContext('2d', { willReadFrequently: true });

    document.getElementById('cameraStartOverlay').addEventListener('click', () => start());
    document.getElementById('retryCameraBtn').addEventListener('click', () => start());
    document.getElementById('flipCameraBtn').addEventListener('click', flipCamera);
    document.getElementById('torchBtn').addEventListener('click', toggleTorch);
    document.getElementById('zoomRange').addEventListener('input', onZoomInput);
    document.getElementById('continueScanBtn').addEventListener('click', continueScan);
    document.getElementById('copyScanBtn').addEventListener('click', () => lastResult && Utils.copyText(lastResult.value));
    document.getElementById('shareScanBtn').addEventListener('click', () => {
      if (!lastResult) return;
      Utils.shareText('條碼讀值', lastResult.value, lastResult.url);
    });
    document.getElementById('openScanUrlBtn').addEventListener('click', () => lastResult && Utils.openUrl(lastResult.url));
    document.getElementById('saveScanBtn').addEventListener('click', saveLastResult);

    video.addEventListener('loadedmetadata', () => setCameraStatus('相機已啟動，請對準條碼'));
    video.addEventListener('click', refocus);
    document.addEventListener('visibilitychange', handleVisibility);
  }

  async function initEngine() {
    detector = null;
    engine = 'none';
    setEnginePill('載入辨識引擎…');

    if ('BarcodeDetector' in window) {
      try {
        const supported = typeof BarcodeDetector.getSupportedFormats === 'function'
          ? await BarcodeDetector.getSupportedFormats()
          : NATIVE_FORMATS;
        const formats = NATIVE_FORMATS.filter(format => supported.includes(format));
        if (formats.length) {
          detector = new BarcodeDetector({ formats });
          engine = 'native';
          setEnginePill('原生高速辨識', 'ready');
          return;
        }
      } catch (error) {
        console.warn('BarcodeDetector initialization failed:', error);
      }
    }

    if (!window.ZXing?.MultiFormatReader) await waitForGlobal('ZXing', 8000);
    if (window.ZXing?.MultiFormatReader) {
      engine = 'zxing';
      setEnginePill('ZXing 備援', 'fallback');
      return;
    }

    setEnginePill('無可用引擎', 'fallback');
  }


  function waitForGlobal(name, timeoutMs) {
    if (window[name]) return Promise.resolve(true);
    return new Promise(resolve => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window[name]) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 80);
    });
  }

  async function start(options = {}) {
    init();
    const token = ++lifecycleToken;
    await stop({ keepResult: true, preserveToken: true });
    hidePermissionError();
    setCameraStatus('正在啟動相機…');
    document.getElementById('cameraStartOverlay').hidden = true;
    document.getElementById('scanResultCard').hidden = true;
    document.getElementById('detectedBox').hidden = true;
    resetCandidate();

    if (!navigator.mediaDevices?.getUserMedia) {
      showPermissionError('此瀏覽器不支援即時相機。請改用 Safari／Chrome，並從 HTTPS 或 GitHub Pages 開啟。');
      return false;
    }

    const enginePromise = initEngine();

    const requestedDeviceId = options.deviceId || '';
    const requestedFacingMode = options.facingMode || facingMode || 'environment';
    const primaryConstraints = {
      audio: false,
      video: requestedDeviceId ? {
        deviceId: { exact: requestedDeviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 }
      } : {
        facingMode: { ideal: requestedFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 }
      }
    };

    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
      } catch (firstError) {
        console.warn('High resolution camera constraint failed:', firstError);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: requestedDeviceId
            ? { deviceId: { exact: requestedDeviceId } }
            : { facingMode: { ideal: requestedFacingMode } }
        });
      }

      videoTrack = stream.getVideoTracks()[0] || null;
      const settings = videoTrack?.getSettings?.() || {};
      currentDeviceId = settings.deviceId || requestedDeviceId;
      facingMode = settings.facingMode || requestedFacingMode;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      await tuneTrack(videoTrack);
      configureZoom(videoTrack);
      await enginePromise;
      if (token !== lifecycleToken) {
        currentStreamTracksStop();
        return false;
      }
      if (engine === 'none') {
        throw new Error('條碼解碼元件未載入，請確認網路連線後重新整理。');
      }
      running = true;
      scanning = true;
      lastScanAt = 0;
      await requestWakeLock();
      scheduleLoop();
      setCameraStatus('相機已啟動，請對準條碼');
      return true;
    } catch (error) {
      console.error('Camera start error:', error);
      if (token === lifecycleToken) {
        currentStreamTracksStop();
        const message = cameraErrorMessage(error);
        showPermissionError(message);
        document.getElementById('cameraStartOverlay').hidden = false;
      }
      return false;
    }
  }

  async function tuneTrack(track) {
    if (!track?.getCapabilities || !track.applyConstraints) return;
    const capabilities = track.getCapabilities();
    const advanced = [];
    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }
    if (advanced.length) {
      try { await track.applyConstraints({ advanced }); }
      catch (error) { console.debug('Camera tuning not fully supported:', error); }
    }
  }

  function configureZoom(track) {
    const panel = document.getElementById('zoomPanel');
    const range = document.getElementById('zoomRange');
    const output = document.getElementById('zoomValue');
    panel.hidden = true;
    if (!track?.getCapabilities) return;
    const zoom = track.getCapabilities().zoom;
    if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number' || zoom.max <= zoom.min) return;
    const current = track.getSettings?.().zoom || zoom.min;
    range.min = zoom.min;
    range.max = zoom.max;
    range.step = zoom.step || 0.1;
    range.value = current;
    output.value = `${Number(current).toFixed(1)}×`;
    panel.hidden = false;
  }

  async function onZoomInput(event) {
    const value = Number(event.target.value);
    document.getElementById('zoomValue').value = `${value.toFixed(1)}×`;
    if (!videoTrack?.applyConstraints) return;
    try { await videoTrack.applyConstraints({ advanced: [{ zoom: value }] }); }
    catch { /* ignore devices that expose but reject zoom */ }
  }

  function scheduleLoop() {
    cancelScheduledLoop();
    if (!running) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      usingVideoFrameCallback = true;
      scheduledId = video.requestVideoFrameCallback(scanFrame);
    } else {
      usingVideoFrameCallback = false;
      scheduledId = requestAnimationFrame(scanFrame);
    }
  }

  function cancelScheduledLoop() {
    if (!scheduledId) return;
    if (usingVideoFrameCallback && typeof video?.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(scheduledId);
    } else {
      cancelAnimationFrame(scheduledId);
    }
    scheduledId = 0;
  }

  async function scanFrame() {
    scheduledId = 0;
    if (!running) return;

    const now = performance.now();
    const interval = engine === 'native' ? 65 : 105;
    if (scanning && !processing && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastScanAt >= interval) {
      processing = true;
      lastScanAt = now;
      try {
        if (engine === 'native') await scanNativeFrame();
        else scanZxingFrame();
      } catch (error) {
        console.debug('Frame decode failed:', error);
      } finally {
        processing = false;
      }
    }
    if (running) scheduleLoop();
  }

  async function scanNativeFrame() {
    let codes = [];
    try { codes = await detector.detect(video); } catch { codes = []; }
    if (!codes?.length) {
      // Every few frames, retry with a centered crop and contrast enhancement.
      if (Math.floor(performance.now() / 400) % 2 === 0) codes = await detectNativeCrop();
    }
    if (!codes?.length) {
      fadeDetectedBox();
      return;
    }

    const best = pickBestNativeResult(codes);
    if (!best?.rawValue) return;
    showDetectedBox(best._fullBoundingBox || best.boundingBox);
    acceptCandidate(best.rawValue, NATIVE_FORMAT_LABELS[best.format] || best.format || 'UNKNOWN');
  }

  async function detectNativeCrop() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return [];
    const cropWidth = Math.floor(vw * 0.88);
    const cropHeight = Math.floor(vh * 0.58);
    const sourceX = Math.floor((vw - cropWidth) / 2);
    const sourceY = Math.floor((vh - cropHeight) / 2);
    canvas.width = Math.min(cropWidth, 1280);
    canvas.height = Math.round(canvas.width * cropHeight / cropWidth);
    context.filter = 'contrast(1.25) brightness(1.05)';
    context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';
    try {
      const codes = await detector.detect(canvas);
      return codes.map(code => {
        if (!code.boundingBox) return code;
        const scaleX = cropWidth / canvas.width;
        const scaleY = cropHeight / canvas.height;
        code._fullBoundingBox = {
          x: sourceX + code.boundingBox.x * scaleX,
          y: sourceY + code.boundingBox.y * scaleY,
          width: code.boundingBox.width * scaleX,
          height: code.boundingBox.height * scaleY
        };
        return code;
      });
    } catch { return []; }
  }

  function pickBestNativeResult(codes) {
    if (codes.length === 1) return codes[0];
    const frameCenterX = video.videoWidth / 2;
    const frameCenterY = video.videoHeight / 2;
    return [...codes].sort((a, b) => scoreNative(b) - scoreNative(a))[0];

    function scoreNative(code) {
      const box = code._fullBoundingBox || code.boundingBox;
      if (!box) return 0;
      const area = box.width * box.height;
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const distance = Math.hypot(centerX - frameCenterX, centerY - frameCenterY);
      return area - distance * 15;
    }
  }

  function scanZxingFrame() {
    if (!window.ZXing || !video.videoWidth || !video.videoHeight) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sourceX = Math.floor(vw * 0.06);
    const sourceY = Math.floor(vh * 0.18);
    const sourceWidth = Math.floor(vw * 0.88);
    const sourceHeight = Math.floor(vh * 0.64);
    const targetWidth = Math.min(1280, sourceWidth);
    const targetHeight = Math.max(1, Math.round(targetWidth * sourceHeight / sourceWidth));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.filter = 'contrast(1.18) brightness(1.04)';
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
    context.filter = 'none';

    const decoded = decodeCanvasWithZxing(canvas);
    if (!decoded) {
      fadeDetectedBox();
      return;
    }
    acceptCandidate(decoded.value, decoded.format);
  }

  function decodeCanvasWithZxing(targetCanvas) {
    try {
      const luminance = new ZXing.HTMLCanvasElementLuminanceSource(targetCanvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
      const hints = new Map();
      const formats = ZXing.BarcodeFormat;
      const possible = [
        formats.QR_CODE, formats.DATA_MATRIX, formats.PDF_417, formats.AZTEC,
        formats.CODE_128, formats.CODE_39, formats.CODE_93, formats.CODABAR,
        formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E, formats.ITF
      ].filter(value => value !== undefined);
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, possible);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      const reader = new ZXing.MultiFormatReader();
      const result = reader.decode(bitmap, hints);
      if (!result) return null;
      const numericFormat = result.getBarcodeFormat();
      const format = Object.keys(formats).find(key => formats[key] === numericFormat) || 'UNKNOWN';
      return { value: result.getText(), format };
    } catch { return null; }
  }

  function acceptCandidate(rawValue, rawFormat) {
    const value = String(rawValue ?? '').trim();
    const format = Utils.formatLabel(rawFormat);
    if (!value) return;

    const now = performance.now();
    if (candidate.value === value && candidate.format === format && now - candidate.at < 850) {
      candidate.hits += 1;
    } else {
      candidate = { value, format, hits: 1, at: now };
    }
    candidate.at = now;
    setCameraStatus(candidate.hits > 1 ? '已鎖定，正在確認…' : `讀取到 ${format}，確認中…`);

    const isTwoDimensional = ['QR-CODE', 'DATA-MATRIX', 'PDF-417', 'AZTEC'].includes(format);
    const requiredHits = engine === 'native' && isTwoDimensional ? 1 : 2;
    if (candidate.hits >= requiredHits) completeResult(value, format);
  }

  function completeResult(value, format) {
    scanning = false;
    const url = Utils.normalizeOpenableUrl(value);
    const type = Utils.classifyContent(value, format);
    lastResult = {
      value, url, format: Utils.formatLabel(format), type,
      source: 'scan', createdAt: new Date().toISOString()
    };

    setCameraStatus('掃描完成');
    pulseDetectedBox();
    provideFeedback();
    renderResult(lastResult);

    const saveButton = document.getElementById('saveScanBtn');
    if (Storage.getSettings().autoSave) {
      Storage.addHistory(lastResult);
      saveButton.disabled = true;
      saveButton.textContent = '已存入歷史';
      Utils.toast('掃描成功，已加入歷史', 'success');
    } else {
      saveButton.disabled = false;
      saveButton.textContent = '存入歷史';
      Utils.toast('掃描成功', 'success');
    }
  }

  function renderResult(result) {
    document.getElementById('scanResultType').textContent = result.type;
    document.getElementById('scanResultFormat').textContent = result.format;
    document.getElementById('scanResultValue').textContent = result.value;
    const urlEl = document.getElementById('scanResultUrl');
    const noUrlEl = document.getElementById('scanNoUrl');
    const openBtn = document.getElementById('openScanUrlBtn');
    if (result.url) {
      urlEl.textContent = result.url;
      urlEl.href = result.url;
      urlEl.hidden = false;
      noUrlEl.hidden = true;
      openBtn.disabled = false;
    } else {
      urlEl.textContent = '';
      urlEl.removeAttribute('href');
      urlEl.hidden = true;
      noUrlEl.hidden = false;
      openBtn.disabled = true;
    }

    const meta = document.getElementById('scanResultMeta');
    meta.replaceChildren(
      createMetaChip(Utils.sourceLabel(result.source)),
      createMetaChip(Utils.formatDateTime(result.createdAt)),
      createMetaChip(engine === 'native' ? '原生辨識' : 'ZXing 辨識')
    );
    const card = document.getElementById('scanResultCard');
    card.hidden = false;
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }

  function createMetaChip(text) {
    const el = document.createElement('span');
    el.className = 'meta-chip';
    el.textContent = text;
    return el;
  }

  function saveLastResult() {
    if (!lastResult) return;
    Storage.addHistory(lastResult);
    const button = document.getElementById('saveScanBtn');
    button.disabled = true;
    button.textContent = '已存入歷史';
    Utils.toast('已存入歷史', 'success');
  }

  function continueScan() {
    if (!running || !stream?.active) {
      start();
      return;
    }
    document.getElementById('scanResultCard').hidden = true;
    document.getElementById('detectedBox').hidden = true;
    resetCandidate();
    lastResult = null;
    scanning = true;
    setCameraStatus('請對準下一個條碼');
    document.getElementById('cameraCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetCandidate() { candidate = { value: '', format: '', hits: 0, at: 0 }; }

  function currentStreamTracksStop() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    videoTrack = null;
    if (video) video.srcObject = null;
  }

  async function stop({ keepResult = false, preserveToken = false } = {}) {
    if (!preserveToken) lifecycleToken += 1;
    running = false;
    scanning = false;
    processing = false;
    cancelScheduledLoop();
    currentStreamTracksStop();
    torchOn = false;
    const torchBtn = document.getElementById('torchBtn');
    if (torchBtn) torchBtn.classList.remove('active');
    if (video) video.srcObject = null;
    document.getElementById('zoomPanel')?.setAttribute('hidden', '');
    document.getElementById('detectedBox')?.setAttribute('hidden', '');
    if (!keepResult) document.getElementById('scanResultCard')?.setAttribute('hidden', '');
    releaseWakeLock();
  }

  function pause() {
    scanning = false;
    setCameraStatus('掃描已暫停');
  }

  function resume() {
    if (running && stream?.active) {
      resetCandidate();
      scanning = true;
      setCameraStatus('相機已啟動，請對準條碼');
    } else {
      start();
    }
  }

  async function flipCamera() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (devices.length > 1) {
        const currentIndex = devices.findIndex(device => device.deviceId === currentDeviceId);
        const next = devices[(currentIndex + 1 + devices.length) % devices.length];
        await start({ deviceId: next.deviceId });
      } else {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        await start({ facingMode });
      }
    } catch {
      Utils.toast('無法切換鏡頭', 'error');
    }
  }

  async function toggleTorch() {
    if (!videoTrack?.getCapabilities || !videoTrack.applyConstraints) {
      Utils.toast('此裝置不支援網頁補光燈', 'error');
      return;
    }
    const capabilities = videoTrack.getCapabilities();
    if (!capabilities.torch) {
      Utils.toast('目前鏡頭不支援補光燈', 'error');
      return;
    }
    try {
      torchOn = !torchOn;
      await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      document.getElementById('torchBtn').classList.toggle('active', torchOn);
    } catch {
      torchOn = false;
      Utils.toast('無法切換補光燈', 'error');
    }
  }

  async function refocus() {
    if (!videoTrack) return;
    await tuneTrack(videoTrack);
    const frame = document.getElementById('scanFrame');
    frame.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 220 });
    setCameraStatus('重新對焦中…');
    setTimeout(() => scanning && setCameraStatus('請對準條碼'), 500);
  }

  function showDetectedBox(box) {
    if (!box || !video.videoWidth || !video.videoHeight) return;
    const rect = video.getBoundingClientRect();
    const videoAspect = video.videoWidth / video.videoHeight;
    const elementAspect = rect.width / rect.height;
    let scale;
    let offsetX = 0;
    let offsetY = 0;
    if (videoAspect > elementAspect) {
      scale = rect.height / video.videoHeight;
      offsetX = (rect.width - video.videoWidth * scale) / 2;
    } else {
      scale = rect.width / video.videoWidth;
      offsetY = (rect.height - video.videoHeight * scale) / 2;
    }
    const el = document.getElementById('detectedBox');
    el.style.left = `${box.x * scale + offsetX}px`;
    el.style.top = `${box.y * scale + offsetY}px`;
    el.style.width = `${Math.max(24, box.width * scale)}px`;
    el.style.height = `${Math.max(24, box.height * scale)}px`;
    el.hidden = false;
    el.dataset.seenAt = String(performance.now());
  }

  function fadeDetectedBox() {
    const el = document.getElementById('detectedBox');
    const seenAt = Number(el.dataset.seenAt || 0);
    if (!seenAt || performance.now() - seenAt > 260) el.hidden = true;
  }

  function pulseDetectedBox() {
    const el = document.getElementById('detectedBox');
    if (el.hidden) return;
    el.animate([
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.04)', opacity: 1 },
      { transform: 'scale(1)', opacity: .9 }
    ], { duration: 330 });
  }

  function provideFeedback() {
    const settings = Storage.getSettings();
    if (settings.vibration && navigator.vibrate) navigator.vibrate([45, 35, 90]);
    if (settings.sound) playBeep();
  }

  function playBeep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1320, audioContext.currentTime + .09);
      gain.gain.setValueAtTime(.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.18, audioContext.currentTime + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .13);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + .14);
      oscillator.addEventListener('ended', () => audioContext.close());
    } catch { /* autoplay policies may block audio */ }
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); }
    catch { wakeLock = null; }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  function handleVisibility() {
    if (document.visibilityState === 'hidden') {
      pause();
      releaseWakeLock();
    } else if (window.App?.currentPage?.() === 'scan') {
      requestWakeLock();
      resume();
    }
  }

  function setCameraStatus(text) {
    const el = document.getElementById('cameraStatus');
    if (el) el.textContent = text;
  }

  function setEnginePill(text, className = '') {
    const el = document.getElementById('scanEnginePill');
    if (!el) return;
    el.textContent = text;
    el.className = `status-pill ${className}`.trim();
  }

  function showPermissionError(message) {
    document.getElementById('permissionMessage').textContent = message;
    document.getElementById('permissionNote').hidden = false;
    setCameraStatus('相機未啟動');
  }

  function hidePermissionError() {
    document.getElementById('permissionNote').hidden = true;
  }

  function cameraErrorMessage(error) {
    switch (error?.name) {
      case 'NotAllowedError': return '相機權限被拒絕。請到瀏覽器網站設定允許相機，再按「重新啟動」。';
      case 'NotFoundError': return '找不到可用相機，請確認裝置鏡頭正常。';
      case 'NotReadableError': return '相機可能正被其他 App 使用。請關閉其他相機 App 後重試。';
      case 'OverconstrainedError': return '目前鏡頭不支援要求的模式，請按「重新啟動」改用預設設定。';
      case 'SecurityError': return '瀏覽器基於安全性禁止相機。請使用 HTTPS 或 GitHub Pages 網址。';
      default: return `無法啟動相機${error?.message ? `：${error.message}` : ''}`;
    }
  }

  function getEngine() { return engine; }
  function isRunning() { return running; }

  return { init, start, stop, pause, resume, getEngine, isRunning, decodeCanvasWithZxing };
})();
