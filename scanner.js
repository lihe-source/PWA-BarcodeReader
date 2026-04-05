// scanner.js — camera scanning via ZXing

const Scanner = (() => {
  let reader = null;
  let currentDeviceId = null;
  let devices = [];
  let torchOn = false;
  let currentStream = null;
  let scanning = false;

  const FORMATS = () => {
    const ZF = ZXing.BarcodeFormat;
    return [ZF.EAN_13, ZF.EAN_8, ZF.UPC_A, ZF.UPC_E,
            ZF.CODE_128, ZF.CODE_39, ZF.ITF, ZF.QR_CODE,
            ZF.DATA_MATRIX, ZF.PDF_417];
  };

  function formatCategory(fmt) {
    const d2 = ['QR_CODE', 'DATA_MATRIX', 'PDF_417', 'AZTEC'];
    return d2.includes(fmt) ? '2D' : '1D';
  }

  function detectExtra(content, fmt) {
    if (fmt === 'EAN_13') {
      if (/^97[89]/.test(content)) return 'ISBN';
      if (/^977/.test(content)) return 'ISSN';
    }
    return null;
  }

  function isURL(str) {
    try { return /^https?:\/\//i.test(str); } catch { return false; }
  }

  function relTime() {
    return new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  }

  function showResult(result) {
    const content = result.getText();
    const fmt = result.getBarcodeFormat ? ZXing.BarcodeFormat[result.getBarcodeFormat()] : (result.format || 'UNKNOWN');
    const fmtStr = typeof fmt === 'string' ? fmt : Object.keys(ZXing.BarcodeFormat).find(k => ZXing.BarcodeFormat[k] === fmt) || 'UNKNOWN';
    const cat = formatCategory(fmtStr);
    const extra = detectExtra(content, fmtStr);
    const url = isURL(content);

    document.getElementById('resultContent').textContent = content;

    const meta = document.getElementById('resultMeta');
    meta.innerHTML = '';
    const addTag = (cls, txt) => {
      const s = document.createElement('span');
      s.className = 'result-tag ' + cls;
      s.textContent = txt;
      meta.appendChild(s);
    };
    addTag(cat === '2D' ? 'tag-2d' : 'tag-1d', fmtStr.replace('_', '-'));
    addTag('tag-time', relTime());
    if (extra) addTag('tag-extra', extra);

    const btnUrl = document.getElementById('btnOpenUrl');
    btnUrl.style.display = url ? '' : 'none';
    if (url) btnUrl.onclick = () => window.open(content, '_blank');

    document.getElementById('btnCopy').onclick = () => {
      navigator.clipboard.writeText(content).catch(() => {});
      UI.toast('已複製');
    };

    document.getElementById('btnSaveScan').onclick = async () => {
      await DB.add({ content, format: extra || fmtStr, category: cat, source: 'scan' });
      UI.toast('已儲存');
      document.getElementById('btnSaveScan').disabled = true;
    };

    document.getElementById('btnContinueScan').onclick = () => {
      document.getElementById('scanResultWrap').style.display = 'none';
      resume();
    };

    document.getElementById('scanResultWrap').style.display = '';
  }

  async function getDevices() {
    devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
    return devices;
  }

  async function start(deviceId) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS());
    reader = new ZXing.BrowserMultiFormatReader(hints);

    try {
      await reader.decodeFromVideoDevice(deviceId || undefined, 'scan-video', (result, err) => {
        if (!scanning) return;
        if (result) {
          scanning = false;
          if (navigator.vibrate) navigator.vibrate(200);
          showResult(result);
        }
      });
      scanning = true;
      currentDeviceId = deviceId || null;

      // Cache stream for torch
      const video = document.getElementById('scan-video');
      currentStream = video.srcObject;

      document.getElementById('scanError').style.display = 'none';
      document.getElementById('scanOverlay').style.display = '';
    } catch (err) {
      console.error('Camera error:', err);
      document.getElementById('scanError').style.display = '';
      document.getElementById('scanOverlay').style.display = 'none';
    }
  }

  function stop() {
    if (reader) { try { reader.reset(); } catch (_) {} reader = null; }
    scanning = false;
    torchOn = false;
  }

  function resume() {
    if (reader) {
      scanning = true;
    } else {
      start(currentDeviceId);
    }
  }

  async function flipCamera() {
    stop();
    const devs = await getDevices();
    if (devs.length < 2) { UI.toast('只有一個鏡頭'); return; }
    const idx = devs.findIndex(d => d.deviceId === currentDeviceId);
    const next = devs[(idx + 1) % devs.length];
    await start(next.deviceId);
  }

  async function toggleTorch() {
    if (!currentStream) return;
    const [track] = currentStream.getVideoTracks();
    if (!track) return;
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      document.getElementById('btnTorch').classList.toggle('active', torchOn);
    } catch {
      UI.toast('此裝置不支援閃光燈');
      torchOn = false;
    }
  }

  return { start, stop, flipCamera, toggleTorch };
})();
