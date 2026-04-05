// importer.js — V1_2: decode barcode from imported image

const Importer = (() => {
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

  async function decodeFile(file) {
    const url = URL.createObjectURL(file);
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS());
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.BrowserMultiFormatReader(hints);
    try {
      const result = await reader.decodeFromImageUrl(url);
      return result;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function showResult(result) {
    const content = result.getText();
    const fmt = fmtStr(result.getBarcodeFormat());
    const cat = fmtCat(fmt);
    const extra = detectExtra(content, fmt);

    document.getElementById('importResultBox').style.display = '';
    document.getElementById('importResultContent').textContent = content;

    const meta = document.getElementById('importResultMeta');
    meta.innerHTML = '';
    const addTag = (cls, txt) => {
      const s = document.createElement('span');
      s.className = 'result-tag ' + cls; s.textContent = txt;
      meta.appendChild(s);
    };
    addTag(cat === '2D' ? 'tag-2d' : 'tag-1d', fmt.replace(/_/g,'-'));
    if (extra) addTag('tag-extra', extra);

    const isURL = /^https?:\/\//i.test(content);
    const btnUrl = document.getElementById('importBtnOpenUrl');
    btnUrl.style.display = isURL ? '' : 'none';
    if (isURL) btnUrl.onclick = () => window.open(content, '_blank');

    document.getElementById('importBtnCopy').onclick = () => {
      navigator.clipboard.writeText(content).catch(()=>{});
      UI.toast('已複製');
    };
    const btnSave = document.getElementById('importBtnSave');
    btnSave.disabled = false;
    btnSave.onclick = async () => {
      await DB.add({ content, format: extra||fmt, category: cat, source: 'scan' });
      UI.toast('已儲存到歷史'); btnSave.disabled = true;
    };
  }

  function showError() {
    document.getElementById('importResultBox').style.display = '';
    document.getElementById('importResultContent').textContent = '⚠️ 未能辨識圖片中的條碼';
    document.getElementById('importResultMeta').innerHTML = '';
    document.getElementById('importBtnOpenUrl').style.display = 'none';
    document.getElementById('importBtnCopy').onclick = null;
    document.getElementById('importBtnSave').disabled = true;
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { UI.toast('請選擇圖片檔案'); return; }

    // Show preview
    const previewWrap = document.getElementById('importPreviewWrap');
    const previewImg = document.getElementById('importPreview');
    const placeholder = document.getElementById('importPlaceholder');
    const spinner = document.getElementById('importSpinner');
    const resultBox = document.getElementById('importResultBox');

    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.onload = () => URL.revokeObjectURL(url);
    previewWrap.style.display = '';
    placeholder.style.display = 'none';
    resultBox.style.display = 'none';
    spinner.style.display = '';

    try {
      const result = await decodeFile(file);
      spinner.style.display = 'none';
      showResult(result);
    } catch (e) {
      spinner.style.display = 'none';
      showError();
    }
  }

  function init() {
    // File input (gallery)
    document.getElementById('importFileInput').addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });
    // Camera capture input
    document.getElementById('importCameraInput').addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('importBtnGallery').addEventListener('click', () => {
      document.getElementById('importFileInput').click();
    });
    document.getElementById('importBtnCamera').addEventListener('click', () => {
      document.getElementById('importCameraInput').click();
    });
  }

  return { init };
})();
