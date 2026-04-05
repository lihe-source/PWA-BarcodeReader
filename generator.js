// generator.js — barcode generation via JsBarcode + bwip-js

const Generator = (() => {
  let selectedFormat = 'CODE128';

  const FORMAT_META = {
    CODE128:    { lib: 'jsbarcode', bcid: 'CODE128',     cat: '1D', label: 'Code 128' },
    EAN13:      { lib: 'jsbarcode', bcid: 'EAN13',       cat: '1D', label: 'EAN-13' },
    EAN8:       { lib: 'jsbarcode', bcid: 'EAN8',        cat: '1D', label: 'EAN-8' },
    UPCA:       { lib: 'jsbarcode', bcid: 'UPC',         cat: '1D', label: 'UPC-A' },
    UPCE:       { lib: 'jsbarcode', bcid: 'UPC',         cat: '1D', label: 'UPC-E' },
    CODE39:     { lib: 'jsbarcode', bcid: 'CODE39',      cat: '1D', label: 'Code 39' },
    ITF14:      { lib: 'jsbarcode', bcid: 'ITF14',       cat: '1D', label: 'ITF-14' },
    ISBN:       { lib: 'jsbarcode', bcid: 'EAN13',       cat: '1D', label: 'ISBN' },
    ISSN:       { lib: 'jsbarcode', bcid: 'EAN13',       cat: '1D', label: 'ISSN' },
    QRCODE:     { lib: 'bwip',     bcid: 'qrcode',       cat: '2D', label: 'QR Code' },
    DATAMATRIX: { lib: 'bwip',     bcid: 'datamatrix',   cat: '2D', label: 'Data Matrix' },
    PDF417:     { lib: 'bwip',     bcid: 'pdf417',       cat: '2D', label: 'PDF417' },
    GS1DATABAR: { lib: 'bwip',     bcid: 'databaromni',  cat: '2D', label: 'GS1 DataBar' },
  };

  function calcCheckDigit(digits) {
    let sum = 0;
    digits.forEach((d, i) => { sum += d * (i % 2 === 0 ? 1 : 3); });
    return (10 - (sum % 10)) % 10;
  }

  function validate(fmt, val) {
    const v = val.trim();
    if (!v) return { ok: false, msg: '請輸入內容' };
    switch (fmt) {
      case 'EAN13': {
        if (!/^\d{12,13}$/.test(v)) return { ok: false, msg: '需輸入 12 或 13 位純數字' };
        return { ok: true, val: v.length === 12 ? v + calcCheckDigit(v.split('').map(Number)) : v };
      }
      case 'EAN8': {
        if (!/^\d{7,8}$/.test(v)) return { ok: false, msg: '需輸入 7 或 8 位純數字' };
        return { ok: true, val: v.length === 7 ? v + calcCheckDigit(v.split('').map(Number)) : v };
      }
      case 'UPCA': {
        if (!/^\d{11,12}$/.test(v)) return { ok: false, msg: '需輸入 11 或 12 位純數字' };
        return { ok: true, val: v.length === 11 ? v + calcCheckDigit(v.split('').map(Number)) : v };
      }
      case 'UPCE': {
        if (!/^\d{6,8}$/.test(v)) return { ok: false, msg: '需輸入 6、7 或 8 位純數字' };
        return { ok: true, val: v };
      }
      case 'CODE128': {
        if (v.length < 1 || v.length > 80) return { ok: false, msg: '長度需 1~80 個字元' };
        return { ok: true, val: v };
      }
      case 'CODE39': {
        if (!/^[A-Z0-9\-. $/+%*]+$/.test(v)) return { ok: false, msg: '僅支援大寫英文、數字及符號 - . $ / + % * 空格' };
        return { ok: true, val: v };
      }
      case 'ITF14': {
        if (!/^\d{14}$/.test(v)) return { ok: false, msg: '需輸入 14 位純數字' };
        return { ok: true, val: v };
      }
      case 'ISBN': {
        const d = v.replace(/[-\s]/g, '');
        if (!/^\d{10}$/.test(d) && !/^97[89]\d{10}$/.test(d)) return { ok: false, msg: '需輸入 10 位或 13 位（978/979開頭）ISBN' };
        const ean = d.length === 13 ? d : '978' + d.substring(0, 9);
        return { ok: true, val: ean + calcCheckDigit(ean.split('').map(Number)) };
      }
      case 'ISSN': {
        const d = v.replace(/[-\s]/g, '').toUpperCase();
        if (!/^\d{7}[\dX]$/.test(d)) return { ok: false, msg: '需輸入 8 位 ISSN（最後1位可為X）' };
        const ean = '977' + d.substring(0, 7) + '00';
        return { ok: true, val: ean + calcCheckDigit(ean.split('').map(Number)) };
      }
      case 'QRCODE': {
        if (v.length > 4296) return { ok: false, msg: '內容過長（最大 4296 字元）' };
        return { ok: true, val: v };
      }
      case 'DATAMATRIX': {
        if (v.length > 2335) return { ok: false, msg: '內容過長（最大 2335 字元）' };
        return { ok: true, val: v };
      }
      case 'PDF417': {
        if (v.length > 1850) return { ok: false, msg: '內容過長（最大 1850 字元）' };
        return { ok: true, val: v };
      }
      case 'GS1DATABAR': {
        if (!v.startsWith('(01)') && !v.startsWith('(00)') && !/^\d+$/.test(v))
          return { ok: false, msg: '請輸入 GS1 AI 格式，如 (01)04912345123459' };
        return { ok: true, val: v };
      }
      default:
        return { ok: true, val: v };
    }
  }

  let lastGenerated = null;

  function generate() {
    const raw = document.getElementById('genInput').value;
    const errEl = document.getElementById('genError');
    const canvas = document.getElementById('gen-canvas');
    const placeholder = document.getElementById('genPlaceholder');

    const { ok, msg, val } = validate(selectedFormat, raw);
    if (!ok) {
      errEl.textContent = msg;
      errEl.classList.add('visible');
      canvas.style.display = 'none';
      placeholder.style.display = '';
      lastGenerated = null;
      return;
    }
    errEl.classList.remove('visible');

    const meta = FORMAT_META[selectedFormat];
    try {
      if (meta.lib === 'jsbarcode') {
        JsBarcode(canvas, val, {
          format: meta.bcid,
          displayValue: true,
          fontSize: 16,
          margin: 10,
          width: 2,
          height: 100,
          valid: v => {
            if (!v) { errEl.textContent = '條碼值不合法'; errEl.classList.add('visible'); }
          }
        });
      } else {
        // bwip-js
        bwipjs.toCanvas(canvas, {
          bcid: meta.bcid,
          text: val,
          scale: 3,
          includetext: false,
          padding: 10
        });
      }
      canvas.style.display = '';
      placeholder.style.display = 'none';
      lastGenerated = { format: meta.label, category: meta.cat, content: val };
    } catch (e) {
      errEl.textContent = '生成失敗：' + e.message;
      errEl.classList.add('visible');
      canvas.style.display = 'none';
      placeholder.style.display = '';
      lastGenerated = null;
    }
  }

  function selectFormat(fmt) {
    selectedFormat = fmt;
    document.querySelectorAll('.format-chip').forEach(c => {
      c.classList.toggle('selected', c.dataset.format === fmt);
    });
    generate();
  }

  function getCanvas() { return document.getElementById('gen-canvas'); }
  function getLastGenerated() { return lastGenerated; }

  function init() {
    document.querySelectorAll('.format-chip').forEach(c => {
      c.addEventListener('click', () => selectFormat(c.dataset.format));
    });
    const input = document.getElementById('genInput');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(generate, 300);
    });
  }

  return { init, generate, selectFormat, getCanvas, getLastGenerated };
})();
