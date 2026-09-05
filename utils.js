'use strict';
const Utils = (() => {
  const $ = id => document.getElementById(id);
  const errors = [];
  function report(error, scope = '系統') {
    console.warn(scope, error);
    // Never retain scanned contents, file contents or raw server responses in diagnostics.
    errors.unshift({ at: new Date().toISOString(), scope, name: error?.name || 'Error' });
    errors.splice(12);
  }
  function toast(message, type = '', action) {
    const el = document.createElement('div'); el.className = `toast ${type}`;
    const text = document.createElement('span'); text.textContent = message; el.append(text);
    if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.run(); el.remove(); }; el.append(b); }
    $('toastStack')?.append(el); setTimeout(() => el.remove(), action ? 9000 : 4000);
  }
  function normalizeOpenableUrl(raw) {
    const text = String(raw ?? '').trim();
    // Only treat a complete URL as a link. No links extracted from arbitrary payloads.
    if (!/^(https?:\/\/|www\.)\S+$/i.test(text)) return '';
    try { const u = new URL(/^www\./i.test(text) ? `https://${text}` : text); return /^(http:|https:)$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
  }
  function classifyContent(value, format = '') {
    const t = String(value ?? '');
    if (/^WIFI:/i.test(t)) return 'Wi-Fi 設定';
    if (/^(BEGIN:VCARD|BEGIN:VEVENT|geo:)/i.test(t)) return '結構化資料';
    if (/^mailto:/i.test(t)) return '電子郵件';
    if (/^tel:/i.test(t)) return '電話號碼';
    if (normalizeOpenableUrl(t)) return '網址';
    return /^(EAN|UPC|CODE|ITF|CODABAR)/i.test(format) ? '產品／識別碼' : '文字內容';
  }
  function formatLabel(f = '') { return String(f || 'UNKNOWN').replaceAll('_', '-').toUpperCase(); }
  function sourceLabel(s) { return ({scan:'即時掃描',import:'圖片解碼',generate:'產生條碼'})[s] || '其他'; }
  function formatDateTime(t) { const d = new Date(t); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-TW',{hour12:false}); }
  function uniqueId() { return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function safeJsonParse(v,f) { try { return JSON.parse(v) ?? f; } catch { return f; } }
  function debounce(fn,ms=200) { let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(String(text)); toast('已複製原始內容','success'); return true; }
    catch { const el=document.createElement('textarea'); el.value=String(text); document.body.append(el); el.select(); let ok=false; try{ok=document.execCommand('copy');}catch{} el.remove(); toast(ok?'已複製原始內容':'請長按讀值手動複製',ok?'success':'error'); return ok; }
  }
  async function shareText(title,text) { try { if(navigator.share){await navigator.share({title,text});return;} } catch(e){if(e.name==='AbortError')return;} await copyText(text); }
  function openUrl(value) {
    const url=normalizeOpenableUrl(value); if(!url)return;
    const host=new URL(url).hostname;
    if(window.confirm(`即將開啟外部網站：\n${host}\n\n${url}\n\n請確認網址可信，勿輸入不明網站要求的帳密。`))window.open(url,'_blank','noopener,noreferrer');
  }
  function downloadBlob(blob,name) { const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000); }
  function canvasToBlob(c) { return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('圖片轉換失敗')),'image/png')); }
  function escapeCsv(value) {
    let t=String(value??'');
    // CSV has no column types: apostrophe protects formulas AND long numeric IDs in Excel.
    if (/^[\s]*[=+@-]/.test(t) || /^[\s]*\d/.test(t) || /^[\t\r\n]/.test(t)) t="'"+t;
    return '"'+t.replaceAll('"','""')+'"';
  }
  function busyError(e,label='操作失敗') { report(e,label); toast(`${label}：${e?.message || '請重試'}`,'error'); }
  return {$,report,errors,toast,normalizeOpenableUrl,classifyContent,formatLabel,sourceLabel,formatDateTime,uniqueId,safeJsonParse,debounce,copyText,shareText,openUrl,downloadBlob,canvasToBlob,escapeCsv,busyError};
})();
