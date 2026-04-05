// history.js — V1_5: added 'import' source support

const History = (() => {
  let allRecords = [];
  let filterVal = 'all';
  let searchVal = '';

  const SOURCE_ICON  = { scan:'📷', generate:'✏️', import:'🖼️' };
  const SOURCE_LABEL = { scan:'掃描',  generate:'生成',  import:'圖片匯入' };

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff/60000);
    if (m<1) return '剛剛';
    if (m<60) return m+'分鐘前';
    const h=Math.floor(m/60);
    if (h<24) return h+'小時前';
    const d=new Date(ts), now=new Date();
    if (d.toDateString()===new Date(now-86400000).toDateString())
      return '昨天 '+d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'})+' '+
           d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  }

  function filtered() {
    return allRecords.filter(r => {
      if (searchVal && !r.content.toLowerCase().includes(searchVal)) return false;
      if (filterVal==='all') return true;
      if (filterVal==='1D') return r.category==='1D';
      if (filterVal==='2D') return r.category==='2D';
      if (filterVal==='scan') return r.source==='scan';
      if (filterVal==='generate') return r.source==='generate';
      if (filterVal==='import') return r.source==='import';
      return true;
    });
  }

  function render() {
    const list = document.getElementById('historyList');
    const records = filtered();
    if (!records.length) {
      list.innerHTML =
        '<div class="history-empty"><div class="empty-icon">📋</div><p>'+
        (allRecords.length===0?'還沒有記錄<br>掃描或生成條碼後會顯示在這裡':'沒有符合條件的記錄')+
        '</p></div>';
      return;
    }
    list.innerHTML = '';
    records.forEach(r => {
      const icon = SOURCE_ICON[r.source] || '📄';
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML =
        '<div class="history-item-icon">' + icon + '</div>' +
        '<div class="history-item-body">' +
          '<div class="history-item-content">' + r.content + '</div>' +
          '<div class="history-item-meta">' +
            '<span class="hi-tag '+(r.category==='2D'?'hi-tag-2d':'hi-tag-1d')+'">' + r.format + '</span>' +
            '<span class="hi-tag hi-tag-src-'+r.source+'">'+(SOURCE_LABEL[r.source]||r.source)+'</span>' +
            '<span class="hi-time">' + relativeTime(r.timestamp) + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="history-item-del" data-id="'+r.id+'">🗑️</button>';
      item.querySelector('.history-item-del').addEventListener('click', e => {
        e.stopPropagation();
        UI.confirm('確認刪除','確定要刪除這筆記錄嗎？', async () => { await DB.delete(r.id); await load(); });
      });
      item.addEventListener('click', () => {
        UI.showDetail(r,
          async id => { await DB.delete(id); await load(); },
          rec => { App.switchTab('generate'); document.getElementById('genInput').value=rec.content; Generator.generate(); }
        );
      });
      list.appendChild(item);
    });
  }

  async function load() { allRecords = await DB.getAll(); render(); }

  function init() {
    document.getElementById('historySearch').addEventListener('input', e => {
      searchVal = e.target.value.toLowerCase(); render();
    });
    document.getElementById('historyFilters').addEventListener('click', e => {
      const chip = e.target.closest('.filter-chip'); if(!chip) return;
      filterVal = chip.dataset.filter;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c===chip));
      render();
    });
    document.getElementById('historyClearBtn').addEventListener('click', () => {
      UI.confirm('清除全部','確定要刪除所有記錄嗎？此操作無法復原。', async () => { await DB.clearAll(); await load(); });
    });
  }

  return { init, load };
})();
