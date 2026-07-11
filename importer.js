const Importer = (() => {
  let initialized = false;
  let results = [];
  let selectedIndex = 0;
  let previewUrl = '';

  function init() {
    if (initialized) return;
    initialized = true;
    const imageInput = document.getElementById('imageInput');
    const photoInput = document.getElementById('photoInput');
    document.getElementById('chooseImageBtn').addEventListener('click', () => imageInput.click());
    document.getElementById('takePhotoBtn').addEventListener('click', () => photoInput.click());
    imageInput.addEventListener('change', event => handleFile(event.target.files?.[0]));
    photoInput.addEventListener('change', event => handleFile(event.target.files?.[0]));
    document.getElementById('copyImageBtn').addEventListener('click', () => current() && Utils.copyText(current().value));
    document.getElementById('shareImageBtn').addEventListener('click', () => {
      const item = current();
      if (item) Utils.shareText('條碼讀值', item.value, item.url);
    });
    document.getElementById('openImageUrlBtn').addEventListener('click', () => current() && Utils.openUrl(current().url));
    document.getElementById('saveImageBtn').addEventListener('click', saveCurrent);
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Utils.toast('請選擇圖片檔案', 'error');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      Utils.toast('圖片超過 30 MB，請先縮小後再試', 'error');
      return;
    }

    results = [];
    selectedIndex = 0;
    document.getElementById('imageResultCard').hidden = true;
    document.getElementById('imageResultTabs').hidden = true;
    document.getElementById('imageEmptyState').hidden = true;
    document.getElementById('imagePreviewCard').hidden = false;
    document.getElementById('imageProgress').hidden = false;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    const preview = document.getElementById('imagePreview');
    preview.src = previewUrl;

    try {
      const image = await loadImage(previewUrl);
      const canvas = imageToCanvas(image);
      results = await decodeCanvas(canvas);
      if (!results.length) {
        document.getElementById('imageEmptyState').hidden = false;
        document.getElementById('imageEmptyState').querySelector('strong').textContent = '找不到可辨識條碼';
        document.getElementById('imageEmptyState').querySelector('span').textContent = '請換一張較清楚、光線均勻且條碼占比更大的圖片。';
        Utils.toast('圖片中未找到條碼', 'error');
        return;
      }
      renderTabs();
      renderSelected(0);
      Utils.toast(`找到 ${results.length} 個條碼`, 'success');
    } catch (error) {
      console.error('Image decode error:', error);
      document.getElementById('imageEmptyState').hidden = false;
      document.getElementById('imageEmptyState').querySelector('strong').textContent = '圖片無法辨識';
      document.getElementById('imageEmptyState').querySelector('span').textContent = error?.message || '請改用 JPG 或 PNG 圖片後重試。';
      Utils.toast('圖片解碼失敗', 'error');
    } finally {
      document.getElementById('imageProgress').hidden = true;
      document.getElementById('imageInput').value = '';
      document.getElementById('photoInput').value = '';
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('瀏覽器無法讀取此圖片格式'));
      image.src = url;
    });
  }

  function imageToCanvas(image) {
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function decodeCanvas(canvas) {
    const nativeResults = await decodeNative(canvas);
    if (nativeResults.length) return deduplicate(nativeResults);

    if (!window.ZXing?.MultiFormatReader) await waitForZxing(5000);
    if (window.ZXing?.MultiFormatReader) {
      const passes = [canvas, createEnhancedCanvas(canvas), createRotatedCanvas(canvas, 90), createRotatedCanvas(canvas, -90)];
      for (const pass of passes) {
        const decoded = Scanner.decodeCanvasWithZxing(pass);
        if (decoded) return [normalizeResult(decoded.value, decoded.format)];
      }
    }
    return [];
  }


  function waitForZxing(timeoutMs) {
    if (window.ZXing?.MultiFormatReader) return Promise.resolve(true);
    return new Promise(resolve => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.ZXing?.MultiFormatReader) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 80);
    });
  }

  async function decodeNative(canvas) {
    if (!('BarcodeDetector' in window)) return [];
    try {
      const requested = [
        'aztec', 'codabar', 'code_39', 'code_93', 'code_128', 'data_matrix',
        'ean_8', 'ean_13', 'itf', 'pdf417', 'qr_code', 'upc_a', 'upc_e'
      ];
      const supported = typeof BarcodeDetector.getSupportedFormats === 'function'
        ? await BarcodeDetector.getSupportedFormats()
        : requested;
      const formats = requested.filter(format => supported.includes(format));
      if (!formats.length) return [];
      const detector = new BarcodeDetector({ formats });
      let codes = await detector.detect(canvas);
      if (!codes.length) codes = await detector.detect(createEnhancedCanvas(canvas));
      return codes.map(code => normalizeResult(code.rawValue, code.format));
    } catch { return []; }
  }

  function createEnhancedCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.filter = 'grayscale(1) contrast(1.55) brightness(1.08)';
    context.drawImage(source, 0, 0);
    context.filter = 'none';
    return canvas;
  }

  function createRotatedCanvas(source, degrees) {
    const canvas = document.createElement('canvas');
    const swap = Math.abs(degrees) % 180 === 90;
    canvas.width = swap ? source.height : source.width;
    canvas.height = swap ? source.width : source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return canvas;
  }

  function normalizeResult(value, format) {
    const nativeMap = {
      qr_code: 'QR_CODE', data_matrix: 'DATA_MATRIX', pdf417: 'PDF_417',
      code_128: 'CODE_128', code_39: 'CODE_39', code_93: 'CODE_93',
      ean_13: 'EAN_13', ean_8: 'EAN_8', upc_a: 'UPC_A', upc_e: 'UPC_E',
      aztec: 'AZTEC', codabar: 'CODABAR', itf: 'ITF'
    };
    const normalizedFormat = Utils.formatLabel(nativeMap[format] || format);
    return {
      value: String(value ?? '').trim(),
      url: Utils.normalizeOpenableUrl(value),
      format: normalizedFormat,
      type: Utils.classifyContent(value, normalizedFormat),
      source: 'import',
      createdAt: new Date().toISOString()
    };
  }

  function deduplicate(items) {
    const map = new Map();
    items.forEach(item => {
      if (item.value && !map.has(`${item.format}:${item.value}`)) map.set(`${item.format}:${item.value}`, item);
    });
    return [...map.values()];
  }

  function renderTabs() {
    const tabs = document.getElementById('imageResultTabs');
    tabs.replaceChildren();
    if (results.length <= 1) {
      tabs.hidden = true;
      return;
    }
    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `result-tab${index === selectedIndex ? ' active' : ''}`;
      button.textContent = `${index + 1}. ${item.format}`;
      button.addEventListener('click', () => renderSelected(index));
      tabs.appendChild(button);
    });
    tabs.hidden = false;
  }

  function renderSelected(index) {
    selectedIndex = index;
    const item = current();
    if (!item) return;
    document.querySelectorAll('#imageResultTabs .result-tab').forEach((tab, tabIndex) => tab.classList.toggle('active', tabIndex === index));
    document.getElementById('imageResultType').textContent = item.type;
    document.getElementById('imageResultFormat').textContent = item.format;
    document.getElementById('imageResultValue').textContent = item.value;

    const urlEl = document.getElementById('imageResultUrl');
    const noUrl = document.getElementById('imageNoUrl');
    const openButton = document.getElementById('openImageUrlBtn');
    if (item.url) {
      urlEl.textContent = item.url;
      urlEl.href = item.url;
      urlEl.hidden = false;
      noUrl.hidden = true;
      openButton.disabled = false;
    } else {
      urlEl.textContent = '';
      urlEl.removeAttribute('href');
      urlEl.hidden = true;
      noUrl.hidden = false;
      openButton.disabled = true;
    }

    const meta = document.getElementById('imageResultMeta');
    meta.replaceChildren(metaChip(Utils.sourceLabel(item.source)), metaChip(Utils.formatDateTime(item.createdAt)), metaChip(`${results.length} 個結果`));
    document.getElementById('saveImageBtn').disabled = false;
    document.getElementById('imageResultCard').hidden = false;
  }

  function metaChip(text) {
    const el = document.createElement('span');
    el.className = 'meta-chip';
    el.textContent = text;
    return el;
  }

  function saveCurrent() {
    const item = current();
    if (!item) return;
    Storage.addHistory(item);
    document.getElementById('saveImageBtn').disabled = true;
    Utils.toast('已存入歷史', 'success');
  }

  function current() { return results[selectedIndex] || null; }

  return { init };
})();
