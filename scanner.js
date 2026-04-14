// scanner.js — V1_7
// V1_7 optimizations:
//  1. Native detect() directly on video element (skip canvas → faster)
//  2. Multi-barcode: detect ALL codes, show floating labels, tap to select
//  3. Multi-ROI strip scanning for ZXing (top/mid/bot strips to find multiple codes)
//  4. Enhanced contrast fallback pass for hard-to-read barcodes
//  5. ~30fps native / ~16fps ZXing scan loop
//  6. Larger scan frame (CSS), wider ROI crop

const Scanner = (() => {
  let nativeDetector = null;
  let useNative = false;
  let currentStream = null;
  let currentDeviceId = null;
  let scanning = false;
  let torchOn = false;
  let streamAlive = false;
  let rafId = 0;
  let lastSingleText = null;
  let lastSingleTime = 0;
  let workCanvas = null;
  let workCtx = null;
  let enhCanvas = null;
  let enhCtx = null;

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

  function ensureCanvas(tag, w, h) {
    if (tag === 'work') {
      if (!workCanvas) { workCanvas = document.createElement('canvas'); workCtx = workCanvas.getContext('2d', { willReadFrequently: true }); }
      if (workCanvas.width !== w) workCanvas.width = w;
      if (workCanvas.height !== h) workCanvas.height = h;
      return { c: workCanvas, x: workCtx };
    }
    if (!enhCanvas) { enhCanvas = document.createElement('canvas'); enhCtx = enhCanvas.getContext('2d', { willReadFrequently: true }); }
    if (enhCanvas.width !== w) enhCanvas.width = w;
    if (enhCanvas.height !== h) enhCanvas.height = h;
    return { c: enhCanvas, x: enhCtx };
  }

  function enhanceContrast(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const { c, x } = ensureCanvas('enh', w, h);
    x.filter = 'contrast(1.6) brightness(1.1)';
    x.drawImage(srcCanvas, 0, 0);
    x.filter = 'none';
    return c;
  }

  function flashSuccess() {
    const ov = document.getElementById('scanOverlay');
    if (!ov) return;
    ov.style.background = 'rgba(39,174,96,0.35)';
    setTimeout(() => { ov.style.background = 'rgba(0,0,0,0.4)'; }, 350);
  }

  // ── Video→screen coordinate mapping (object-fit:cover) ──

  function v2s(video, bbox) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const r = video.getBoundingClientRect();
    const va = vw / vh, ea = r.width / r.height;
    let sc, ox = 0, oy = 0;
    if (va > ea) { sc = r.height / vh; ox = (r.width - vw * sc) / 2; }
    else { sc = r.width / vw; oy = (r.height - vh * sc) / 2; }
    return { x: bbox.x * sc + ox, y: bbox.y * sc + oy, w: bbox.width * sc, h: bbox.height * sc };
  }

  function bbFromPts(pts) {
    if (!pts || pts.length < 2) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      const px = p.x !== undefined ? p.x : p.getX();
      const py = p.y !== undefined ? p.y : p.getY();
      if (px < x0) x0 = px; if (py < y0) y0 = py;
      if (px > x1) x1 = px; if (py > y1) y1 = py;
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  // ── Multi-barcode overlay ──

  function renderLabels(codes, video) {
    const el = document.getElementById('multiCodeOverlay');
    if (!el) return;
    el.innerHTML = '';
    if (!codes || !codes.length) return;
    codes.forEach(code => {
      const pos = code.sp;
      if (!pos) return;
      const lbl = document.createElement('div');
      lbl.className = 'multi-code-label';
      lbl.style.left = (pos.x + pos.w / 2) + 'px';
      lbl.style.top = pos.y + 'px';
      lbl.style.maxWidth = Math.max(pos.w, 140) + 'px';
      const short = code.text.length > 22 ? code.text.slice(0, 20) + '…' : code.text;
      lbl.innerHTML = '<span class="mcl-fmt">' + code.fmt.replace(/_/g, '-') + '</span><span class="mcl-text">' + short + '</span>';
      lbl.addEventListener('click', e => { e.stopPropagation(); scanning = false; showResult(code.text, code.fmt); });
      el.appendChild(lbl);
    });
  }
  function clearLabels() { const el = document.getElementById('multiCodeOverlay'); if (el) el.innerHTML = ''; }

  // ── Result display ──

  function showResult(content, fmt) {
    const cat = fmtCat(fmt), extra = detectExtra(content, fmt);
    const isURL = /^https?:\/\//i.test(content);
    flashSuccess();
    if (navigator.vibrate) navigator.vibrate(100);
    clearLabels();

    document.getElementById('resultContent').textContent = content;
    const meta = document.getElementById('resultMeta');
    meta.innerHTML = '';
    const tag = (cls, txt) => { const s = document.createElement('span'); s.className = 'result-tag ' + cls; s.textContent = txt; meta.appendChild(s); };
    tag(cat === '2D' ? 'tag-2d' : 'tag-1d', fmt.replace(/_/g, '-'));
    tag('tag-time', new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }));
    if (extra) tag('tag-extra', extra);

    const btnUrl = document.getElementById('btnOpenUrl');
    btnUrl.style.display = isURL ? '' : 'none';
    if (isURL) btnUrl.onclick = () => window.open(content, '_blank');

    document.getElementById('btnCopy').onclick = () => { navigator.clipboard.writeText(content).catch(() => {}); UI.toast('已複製'); };
    const btnSave = document.getElementById('btnSaveScan');
    btnSave.disabled = false;
    btnSave.onclick = async () => {
      await DB.add({ content, format: extra || fmt, category: cat, source: 'scan' });
      UI.toast('已儲存'); btnSave.disabled = true;
    };
    document.getElementById('btnContinueScan').onclick = () => {
      document.getElementById('scanResultWrap').style.display = 'none';
      lastSingleText = null; scanning = true;
    };
    document.getElementById('scanResultWrap').style.display = '';
  }

  function singleHit(text, fmt) {
    const now = Date.now();
    if (text === lastSingleText && now - lastSingleTime < 1500) return;
    lastSingleText = text; lastSingleTime = now;
    scanning = false;
    if (navigator.vibrate) navigator.vibrate(200);
    showResult(text, fmt);
  }

  // ── Native BarcodeDetector loop ──

  function nativeLoop(video) {
    let last = 0;
    const INTV = 33;
    const tick = async () => {
      if (!streamAlive) return;
      if (scanning && video.readyState >= 2 && nativeDetector) {
        const now = performance.now();
        if (now - last >= INTV) {
          last = now;
          try {
            let codes = await nativeDetector.detect(video);
            if (!codes || codes.length === 0) codes = await nativeEnhancedCrop(video);
            if (codes && codes.length > 0) processNativeCodes(codes, video);
            else clearLabels();
          } catch (_) { }
        }
      }
      if (streamAlive) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function nativeEnhancedCrop(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const cw = Math.floor(vw * 0.85), ch = Math.floor(vh * 0.65);
    const cx = Math.floor((vw - cw) / 2), cy = Math.floor((vh - ch) / 2);
    const { c, x } = ensureCanvas('work', cw, ch);
    x.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
    const enh = enhanceContrast(c);
    try {
      const codes = await nativeDetector.detect(enh);
      if (codes && codes.length) {
        return codes.map(cd => {
          const bb = cd.boundingBox;
          if (bb) {
            const remapped = { x: bb.x + cx, y: bb.y + cy, width: bb.width, height: bb.height };
            return Object.assign({}, cd, { _remappedBB: remapped });
          }
          return cd;
        });
      }
    } catch (_) { }
    return null;
  }

  function processNativeCodes(codes, video) {
    if (codes.length === 1) {
      singleHit(codes[0].rawValue, NATIVE_TO_ZX[codes[0].format] || codes[0].format.toUpperCase());
    } else {
      const mapped = codes.map(c => {
        const bb = c._remappedBB || c.boundingBox || (c.cornerPoints ? bbFromPts(c.cornerPoints) : null);
        return { text: c.rawValue, fmt: NATIVE_TO_ZX[c.format] || c.format.toUpperCase(), sp: bb ? v2s(video, bb) : null };
      });
      renderLabels(mapped, video);
    }
  }

  // ── ZXing fallback loop ──

  function zxLoop(video) {
    const hints = new Map();
    const F = ZXing.BarcodeFormat;
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
      F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE,
      F.DATA_MATRIX, F.PDF_417, F.CODABAR
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    try { hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true); } catch (_) { }

    let last = 0;
    const INTV = 60;

    const tick = async () => {
      if (!streamAlive) return;
      if (scanning && video.readyState >= 2) {
        const now = performance.now();
        if (now - last >= INTV) {
          last = now;
          const vw = video.videoWidth, vh = video.videoHeight;
          if (vw && vh) {
            const strips = [
              { sx: vw * 0.10, sy: vh * 0.20, sw: vw * 0.80, sh: vh * 0.60 },
              { sx: vw * 0.05, sy: vh * 0.08, sw: vw * 0.90, sh: vh * 0.32 },
              { sx: vw * 0.05, sy: vh * 0.55, sw: vw * 0.90, sh: vh * 0.32 },
              { sx: 0, sy: 0, sw: vw, sh: vh }
            ];
            const found = new Map();

            for (let i = 0; i < strips.length; i++) {
              const s = strips[i];
              const sx = Math.floor(s.sx), sy = Math.floor(s.sy), sw = Math.floor(s.sw), sh = Math.floor(s.sh);
              const res = zxDecode(video, sx, sy, sw, sh, hints);
              if (res) {
                if (!found.has(res.text)) {
                  const pts = res.result.getResultPoints();
                  let bb = null;
                  if (pts && pts.length >= 2) {
                    const raw = bbFromPts(pts);
                    bb = { x: raw.x + sx, y: raw.y + sy, width: raw.width, height: raw.height };
                  }
                  found.set(res.text, { text: res.text, fmt: res.fmt, bb });
                }
              }
              if (found.size === 1 && i === 0) break;
              if (found.size >= 2) break;
            }

            if (found.size === 0) {
              const cx = Math.floor(vw * 0.10), cy = Math.floor(vh * 0.20);
              const cw = Math.floor(vw * 0.80), ch = Math.floor(vh * 0.60);
              const { c: wc, x: wx } = ensureCanvas('work', cw, ch);
              wx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);
              const enh = enhanceContrast(wc);
              const res = zxDecodeCanvas(enh, hints);
              if (res) found.set(res.text, { text: res.text, fmt: res.fmt, bb: null });
            }

            if (found.size === 1) {
              singleHit(found.values().next().value.text, found.values().next().value.fmt);
            } else if (found.size > 1) {
              const mapped = [...found.values()].map(c => ({
                text: c.text, fmt: c.fmt,
                sp: c.bb ? v2s(video, c.bb) : null
              }));
              renderLabels(mapped, video);
            } else {
              clearLabels();
            }
          }
        }
      }
      if (streamAlive) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function zxDecode(video, sx, sy, sw, sh, hints) {
    const { c, x } = ensureCanvas('work', sw, sh);
    x.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return zxDecodeCanvas(c, hints);
  }

  function zxDecodeCanvas(canvas, hints) {
    try {
      const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const bin = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
      const reader = new ZXing.MultiFormatReader();
      const result = reader.decode(bin, hints);
      if (result) return { text: result.getText(), fmt: fmtStr(result.getBarcodeFormat()), result };
    } catch (_) { }
    return null;
  }

  // ── Camera management ──

  function clearStream() {
    scanning = false; streamAlive = false; torchOn = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    const v = document.getElementById('scan-video');
    if (v) v.srcObject = null;
    clearLabels();
  }

  async function tuneCamera(track) {
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const adv = [];
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.push({ focusMode: 'continuous' });
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.push({ exposureMode: 'continuous' });
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.push({ whiteBalanceMode: 'continuous' });
    if (adv.length) try { await track.applyConstraints({ advanced: adv }); } catch (_) { }
  }

  async function startCamera(deviceId) {
    clearStream();
    await new Promise(r => setTimeout(r, 80));
    const video = document.getElementById('scan-video');

    if (!nativeDetector && 'BarcodeDetector' in window) {
      try {
        const sup = await BarcodeDetector.getSupportedFormats();
        const ok = NATIVE_FORMATS.filter(f => sup.includes(f));
        if (ok.length >= 5) {
          nativeDetector = new BarcodeDetector({ formats: ok });
          useNative = true;
        }
      } catch (_) { }
    }

    try {
      const vc = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
      try { currentStream = await navigator.mediaDevices.getUserMedia({ video: vc }); }
      catch (_) {
        const fb = deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
        currentStream = await navigator.mediaDevices.getUserMedia({ video: fb });
      }

      const track = currentStream.getVideoTracks()[0];
      currentDeviceId = (track.getSettings ? track.getSettings().deviceId : null) || deviceId || null;
      video.srcObject = currentStream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      tuneCamera(track);

      streamAlive = true; scanning = true;
      lastSingleText = null; lastSingleTime = 0;
      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';
      document.getElementById('scanResultWrap').style.display = 'none';

      if (useNative) nativeLoop(video);
      else zxLoop(video);
    } catch (err) {
      console.error('Camera:', err);
      document.getElementById('scanError').style.display = 'flex';
      document.getElementById('scanOverlay').style.display = 'none';
    }
  }

  function pause() { scanning = false; clearLabels(); }
  function resume() {
    if (streamAlive && currentStream) {
      document.getElementById('scanResultWrap').style.display = 'none';
      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';
      lastSingleText = null; scanning = true;
    } else { return startCamera(currentDeviceId); }
  }
  function stop() { clearStream(); }

  async function flipCamera() {
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (_) { }
    if (devs.length < 2) { UI.toast('此裝置只有一個鏡頭'); return; }
    const i = devs.findIndex(d => d.deviceId === currentDeviceId);
    await startCamera(devs[(i + 1) % devs.length].deviceId);
  }

  async function toggleTorch() {
    if (!currentStream) return;
    const track = currentStream.getVideoTracks()[0];
    try { torchOn = !torchOn; await track.applyConstraints({ advanced: [{ torch: torchOn }] }); document.getElementById('btnTorch').classList.toggle('active', torchOn); }
    catch { UI.toast('此裝置不支援閃光燈'); torchOn = false; }
  }

  return { start: startCamera, pause, resume, stop, flipCamera, toggleTorch };
})();
