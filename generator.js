const Generator = (() => {
  const FORMAT_OPTIONS = {
    qrcode: { label: 'QR_CODE', bcid: 'qrcode', scale: 5, padding: 8 },
    code128: { label: 'CODE_128', bcid: 'code128', scale: 3, height: 16, includetext: true },
    code39: { label: 'CODE_39', bcid: 'code39', scale: 3, height: 16, includetext: true },
    ean13: { label: 'EAN_13', bcid: 'ean13', scale: 3, height: 16, includetext: true },
    ean8: { label: 'EAN_8', bcid: 'ean8', scale: 4, height: 16, includetext: true },
    upca: { label: 'UPC_A', bcid: 'upca', scale: 3, height: 16, includetext: true },
    datamatrix: { label: 'DATA_MATRIX', bcid: 'datamatrix', scale: 6, padding: 7 },
    pdf417: { label: 'PDF_417', bcid: 'pdf417', scale: 3, height: 5, padding: 5 }
  };

  let initialized = false;
  let lastGenerated = null;

  function init() {
    if (initialized) return;
    initialized = true;
    const valueInput = document.getElementById('generateValue');
    const formatInput = document.getElementById('generateFormat');
    const updatePreview = Utils.debounce(render, 180);
    valueInput.addEventListener('input', updatePreview);
    formatInput.addEventListener('change', render);
    document.getElementById('downloadBarcodeBtn').addEventListener('click', download);
    document.getElementById('shareBarcodeBtn').addEventListener('click', share);
    document.getElementById('saveBarcodeBtn').addEventListener('click', save);
    updateButtons(false);
    window.addEventListener('load', () => {
      if (document.getElementById('generateValue').value.trim()) render();
    }, { once: true });
  }

  function render() {
    const value = document.getElementById('generateValue').value.trim();
    const formatKey = document.getElementById('generateFormat').value;
    const config = FORMAT_OPTIONS[formatKey];
    const canvas = document.getElementById('barcodeCanvas');
    const placeholder = document.getElementById('barcodePlaceholder');
    const errorBox = document.getElementById('generateError');

    lastGenerated = null;
    errorBox.hidden = true;
    errorBox.textContent = '';
    if (!value) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.hidden = true;
      placeholder.hidden = false;
      updateButtons(false);
      return;
    }

    if (!window.bwipjs?.toCanvas) {
      showError('條碼產生元件尚未載入，請確認網路後重新整理。');
      updateButtons(false);
      return;
    }

    try {
      const options = {
        bcid: config.bcid,
        text: value,
        scale: config.scale,
        height: config.height,
        includetext: Boolean(config.includetext),
        textxalign: 'center',
        textsize: 10,
        paddingwidth: config.padding ?? 4,
        paddingheight: config.padding ?? 4,
        backgroundcolor: 'FFFFFF'
      };
      if (formatKey === 'qrcode') options.eclevel = 'M';
      if (formatKey === 'datamatrix') options.parsefnc = true;
      bwipjs.toCanvas(canvas, options);
      canvas.hidden = false;
      placeholder.hidden = true;
      lastGenerated = {
        value,
        url: Utils.normalizeOpenableUrl(value),
        format: config.label,
        type: Utils.classifyContent(value, config.label),
        source: 'generate',
        createdAt: new Date().toISOString()
      };
      updateButtons(true);
    } catch (error) {
      canvas.hidden = true;
      placeholder.hidden = false;
      showError(humanizeGenerationError(error, formatKey));
      updateButtons(false);
    }
  }

  function humanizeGenerationError(error, formatKey) {
    const message = String(error?.message || error || '無法產生條碼');
    const hints = {
      ean13: 'EAN-13 通常需要 12 或 13 位數字，檢查碼必須正確。',
      ean8: 'EAN-8 通常需要 7 或 8 位數字，檢查碼必須正確。',
      upca: 'UPC-A 通常需要 11 或 12 位數字，檢查碼必須正確。'
    };
    return hints[formatKey] ? `${hints[formatKey]}（${message}）` : message;
  }

  function showError(message) {
    const errorBox = document.getElementById('generateError');
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function updateButtons(enabled) {
    ['downloadBarcodeBtn', 'shareBarcodeBtn', 'saveBarcodeBtn'].forEach(id => {
      document.getElementById(id).disabled = !enabled;
    });
  }

  async function download() {
    if (!lastGenerated) return;
    try {
      const blob = await Utils.canvasToBlob(document.getElementById('barcodeCanvas'));
      Utils.downloadBlob(blob, `BarcodePro-${lastGenerated.format}-${Date.now()}.png`);
      Utils.toast('PNG 已下載', 'success');
    } catch {
      Utils.toast('無法下載圖片', 'error');
    }
  }

  async function share() {
    if (!lastGenerated) return;
    try {
      const blob = await Utils.canvasToBlob(document.getElementById('barcodeCanvas'));
      const file = new File([blob], `BarcodePro-${lastGenerated.format}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'BarcodePro 條碼', text: lastGenerated.value });
      } else {
        await download();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') Utils.toast('此裝置無法分享圖片，已保留下載功能', 'error');
    }
  }

  function save() {
    if (!lastGenerated) return;
    Storage.addHistory(lastGenerated);
    document.getElementById('saveBarcodeBtn').disabled = true;
    Utils.toast('已存入歷史', 'success');
  }

  function focusValue(value = '') {
    const input = document.getElementById('generateValue');
    if (value) input.value = value;
    render();
    input.focus();
  }

  return { init, render, focusValue };
})();
