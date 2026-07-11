const Utils = (() => {
  const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/i;

  function toast(message, type = '') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`.trim();
    el.textContent = String(message);
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 180);
    }, 2400);
  }

  function normalizeOpenableUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return '';

    if (/^(https?:\/\/)/i.test(value)) {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch { return ''; }
    }

    if (/^www\./i.test(value)) {
      try { return new URL(`https://${value}`).href; } catch { return ''; }
    }

    const match = value.match(URL_PATTERN);
    if (match) {
      const candidate = /^www\./i.test(match[0]) ? `https://${match[0]}` : match[0];
      try {
        const url = new URL(candidate);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch { return ''; }
    }
    return '';
  }

  function classifyContent(value, format = '') {
    const text = String(value ?? '').trim();
    if (normalizeOpenableUrl(text)) return '網址';
    if (/^mailto:/i.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return '電子郵件';
    if (/^tel:/i.test(text)) return '電話號碼';
    if (/^WIFI:/i.test(text)) return 'Wi-Fi 設定';
    if (/^(geo:|BEGIN:VCARD|BEGIN:VEVENT)/i.test(text)) return '結構化資料';
    if (/^(EAN|UPC|CODE|ITF|CODABAR)/i.test(String(format)) || /^\d{8,14}$/.test(text)) return '產品／識別碼';
    return '文字內容';
  }

  async function copyText(text) {
    const value = String(text ?? '');
    try {
      await navigator.clipboard.writeText(value);
      toast('已複製讀值', 'success');
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      toast(ok ? '已複製讀值' : '無法複製，請長按文字複製', ok ? 'success' : 'error');
      return ok;
    }
  }

  async function shareText(title, text, url = '') {
    const payload = { title, text };
    if (url) payload.url = url;
    if (navigator.share) {
      try { await navigator.share(payload); return true; }
      catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    await copyText(url || text);
    return false;
  }

  function openUrl(url) {
    const normalized = normalizeOpenableUrl(url);
    if (!normalized) {
      toast('內容不是可開啟的 HTTP／HTTPS 網址', 'error');
      return false;
    }
    window.open(normalized, '_blank', 'noopener,noreferrer');
    return true;
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
  }

  function formatLabel(format = '') {
    return String(format || 'UNKNOWN').replaceAll('_', '-').toUpperCase();
  }

  function sourceLabel(source) {
    return ({ scan: '即時掃描', import: '圖片解碼', generate: '產生條碼' })[source] || '未知來源';
  }

  function debounce(fn, delay = 250) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function canvasToBlob(canvas, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('無法建立圖片')), type, quality);
    });
  }

  function uniqueId(prefix = 'item') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  return {
    toast, normalizeOpenableUrl, classifyContent, copyText, shareText, openUrl,
    formatDateTime, formatLabel, sourceLabel, debounce, downloadBlob, canvasToBlob,
    uniqueId, safeJsonParse, escapeCsv
  };
})();
