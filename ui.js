// ui.js — shared UI utilities

const UI = {
  toast(msg, duration = 2000) {
    const wrap = document.getElementById('toastWrap');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), duration + 300);
  },

  confirm(title, body, onConfirm, danger = true) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">' + title + '</div>' +
        '<div class="modal-body">' + body + '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-secondary" id="_mc">取消</button>' +
          '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="_mo">' + (danger ? '確定刪除' : '確定') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    bd.querySelector('#_mc').onclick = () => bd.remove();
    bd.querySelector('#_mo').onclick = () => { bd.remove(); onConfirm(); };
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
  },

  showDetail(record, onDelete, onRegenerate) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const time = new Date(record.timestamp).toLocaleString('zh-TW');
    const srcIcon = record.source === 'scan' ? '📷' : '✏️';
    bd.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-title">詳細資訊</div>' +
        '<div class="detail-label">條碼內容</div>' +
        '<div class="detail-value">' + record.content + '</div>' +
        '<div class="detail-label">格式</div>' +
        '<div class="detail-value">' + record.format + '（' + record.category + '）</div>' +
        '<div class="detail-label">來源</div>' +
        '<div class="detail-value">' + srcIcon + ' ' + (record.source === 'scan' ? '掃描' : '生成') + '</div>' +
        '<div class="detail-label">時間</div>' +
        '<div class="detail-value">' + time + '</div>' +
        '<div class="detail-actions">' +
          '<button class="btn btn-secondary" id="_dCopy">複製</button>' +
          (onRegenerate ? '<button class="btn btn-primary" id="_dRegen">重新生成</button>' : '') +
          '<button class="btn btn-danger" id="_dDel">刪除</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    bd.querySelector('#_dCopy').onclick = () => {
      navigator.clipboard.writeText(record.content).catch(() => {});
      UI.toast('已複製');
    };
    if (onRegenerate) {
      bd.querySelector('#_dRegen').onclick = () => { bd.remove(); onRegenerate(record); };
    }
    bd.querySelector('#_dDel').onclick = () => {
      bd.remove();
      UI.confirm('確認刪除', '確定要刪除這筆記錄嗎？', () => onDelete(record.id));
    };
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
  }
};
