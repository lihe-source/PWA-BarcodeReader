// importer.js — V1_6
// Multi-barcode detection: iteratively mask detected regions and re-scan.
// Draws colored numbered boxes on preview canvas.
// Saves ALL detected barcodes to history with source='import'.

const Importer = (() => {
  const COLORS = ['#E74C3C','#E67E22','#2ECC71','#3498DB','#9B59B6','#1ABC9C','#F39C12','#E91E63'];

  const FORMATS = () => {
    const F = ZXing.BarcodeFormat;
    return [F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.ITF,F.QR_CODE,F.DATA_MATRIX,F.PDF_417];
  };

  function fmtStr(num) { return Object.keys(ZXing.BarcodeFormat).find(k=>ZXing.BarcodeFormat[k]===num)||'UNKNOWN'; }
  function fmtCat(s)   { return ['QR_CODE','DATA_MATRIX','PDF_417','AZTEC'].includes(s)?'2D':'1D'; }
  function detectExtra(c,f) { if(f==='EAN_13'){if(/^97[89]/.test(c))return 'ISBN';if(/^977/.test(c))return 'ISSN';}return null; }

  function getPoints(result) {
    const pts = result.getResultPoints ? result.getResultPoints() : [];
    return pts.map(p => ({
      x: typeof p.getX==='function' ? p.getX() : p.x,
      y: typeof p.getY==='function' ? p.getY() : p.y
    }));
  }

  function pointsBBox(pts, pad) {
    if (!pts.length) return null;
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
    return {
      x: Math.min(...xs)-pad, y: Math.min(...ys)-pad,
      w: Math.max(...xs)-Math.min(...xs)+pad*2,
      h: Math.max(...ys)-Math.min(...ys)+pad*2
    };
  }

  async function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = rej;
      img.src = url;
    });
  }

  async function decodeOneFromCanvas(canvas) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS());
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.BrowserMultiFormatReader(hints);
    const url = canvas.toDataURL('image/png');
    return reader.decodeFromImageUrl(url); // throws NotFoundException if none found
  }

  async function decodeAll(img) {
    // Create work canvas (gets modified by masking)
    const wc = document.createElement('canvas');
    wc.width = img.naturalWidth; wc.height = img.naturalHeight;
    const ctx = wc.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const found = []; // { result, pts, bbox }

    for (let i = 0; i < 20; i++) {
      let result;
      try { result = await decodeOneFromCanvas(wc); } catch { break; }

      const pts  = getPoints(result);
      const bbox = pointsBBox(pts, 20);

      found.push({ result, pts, bbox });

      if (bbox) {
        // White-out detected region so next pass finds a different barcode
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);
      } else {
        break; // Can't determine position — stop to avoid infinite loop
      }
    }

    return found;
  }

  function renderOverlay(img, found) {
    const wrap = document.getElementById('importPreviewWrap');
    // Replace preview with canvas
    let oc = document.getElementById('importOverlayCanvas');
    if (!oc) {
      oc = document.createElement('canvas');
      oc.id = 'importOverlayCanvas';
      oc.style.cssText = 'width:100%;display:block;background:#f0f0f0;border-radius:14px;';
      wrap.innerHTML = '';
      wrap.appendChild(oc);
    }
    oc.width  = img.naturalWidth;
    oc.height = img.naturalHeight;
    const ctx = oc.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const lw = Math.max(3, img.naturalWidth / 150);
    const fs = Math.max(16, img.naturalWidth / 40);

    found.forEach(({ pts, bbox }, i) => {
      if (!bbox) return;
      const color = COLORS[i % COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);

      // Numbered label
      const labelW = fs * 1.8, labelH = fs * 1.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bbox.x, bbox.y - labelH, labelW, labelH, 4)
                    : ctx.rect(bbox.x, bbox.y - labelH, labelW, labelH);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = `bold ${fs}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i+1), bbox.x + labelW/2, bbox.y - labelH/2);
    });
  }

  function buildResultList(found) {
    const box = document.getElementById('importResultBox');
    box.style.display = '';
    box.innerHTML = '';

    if (found.length === 0) {
      box.innerHTML = '<div class="import-no-result">⚠️ 未能辨識圖片中的條碼</div>';
      return;
    }

    const header = document.createElement('div');
    header.className = 'import-result-header';
    header.textContent = '辨識到 ' + found.length + ' 個條碼';
    box.appendChild(header);

    found.forEach(({ result }, i) => {
      const content = result.getText();
      const fmt = fmtStr(result.getBarcodeFormat());
      const cat = fmtCat(fmt);
      const extra = detectExtra(content, fmt);
      const color = COLORS[i % COLORS.length];
      const isURL = /^https?:\/\//i.test(content);

      const item = document.createElement('div');
      item.className = 'import-result-item';
      item.innerHTML =
        '<div class="import-item-head">' +
          '<span class="import-item-num" style="background:' + color + '">' + (i+1) + '</span>' +
          '<span class="result-tag ' + (cat==='2D'?'tag-2d':'tag-1d') + '">' + fmt.replace(/_/g,'-') + '</span>' +
          (extra ? '<span class="result-tag tag-extra">' + extra + '</span>' : '') +
        '</div>' +
        '<div class="import-item-content">' + content + '</div>' +
        '<div class="import-item-actions"></div>';
      box.appendChild(item);

      const actions = item.querySelector('.import-item-actions');

      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn btn-secondary'; btnCopy.textContent = '複製';
      btnCopy.onclick = () => { navigator.clipboard.writeText(content).catch(()=>{}); UI.toast('已複製'); };
      actions.appendChild(btnCopy);

      if (isURL) {
        const btnOpen = document.createElement('button');
        btnOpen.className = 'btn btn-primary'; btnOpen.textContent = '開啟';
        btnOpen.onclick = () => window.open(content,'_blank');
        actions.appendChild(btnOpen);
      }

      const btnSave = document.createElement('button');
      btnSave.className = 'btn btn-success'; btnSave.textContent = '儲存';
      btnSave.onclick = async () => {
        await DB.add({ content, format: extra||fmt, category: cat, source: 'import' });
        UI.toast('已儲存'); btnSave.disabled = true;
      };
      actions.appendChild(btnSave);
    });

    // Save all button
    if (found.length > 1) {
      const btnAll = document.createElement('button');
      btnAll.className = 'btn btn-success import-save-all';
      btnAll.textContent = '全部儲存 (' + found.length + ')';
      btnAll.onclick = async () => {
        for (const { result } of found) {
          const content = result.getText();
          const fmt = fmtStr(result.getBarcodeFormat());
          const cat = fmtCat(fmt);
          const extra = detectExtra(content, fmt);
          await DB.add({ content, format: extra||fmt, category: cat, source: 'import' });
        }
        UI.toast('已儲存 ' + found.length + ' 筆記錄');
        btnAll.disabled = true;
      };
      box.appendChild(btnAll);
    }
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { UI.toast('請選擇圖片檔案'); return; }

    document.getElementById('importPreviewWrap').style.display = '';
    document.getElementById('importPlaceholder').style.display = 'none';
    document.getElementById('importResultBox').style.display = 'none';
    document.getElementById('importSpinner').style.display = '';

    let img;
    try { img = await loadImage(file); } catch { UI.toast('圖片載入失敗'); document.getElementById('importSpinner').style.display='none'; return; }

    // Show original image first
    const wrap = document.getElementById('importPreviewWrap');
    wrap.innerHTML = '';
    const preview = document.createElement('img');
    preview.className = 'import-preview-img'; preview.src = img.src;
    // Actually img src might already be revoked; re-create object URL
    const url2 = URL.createObjectURL(file);
    const img2 = new Image();
    img2.onload = () => URL.revokeObjectURL(url2);
    img2.src = url2;
    img2.className = 'import-preview-img';
    wrap.appendChild(img2);

    try {
      const found = await decodeAll(img);
      document.getElementById('importSpinner').style.display = 'none';

      if (found.length > 0) {
        renderOverlay(img, found);
      }
      buildResultList(found);
    } catch (e) {
      document.getElementById('importSpinner').style.display = 'none';
      buildResultList([]);
    }
  }

  function init() {
    document.getElementById('importFileInput').addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('importCameraInput').addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('importBtnGallery').addEventListener('click', () =>
      document.getElementById('importFileInput').click());
    document.getElementById('importBtnCamera').addEventListener('click', () =>
      document.getElementById('importCameraInput').click());
  }

  return { init };
})();
