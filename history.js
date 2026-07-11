const HistoryView = (() => {
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById('historySearch').addEventListener('input', render);
    document.getElementById('historyFilter').addEventListener('change', render);
    window.addEventListener('barcode-history-changed', render);
    render();
  }

  function render() {
    const all = Storage.getHistory();
    const query = document.getElementById('historySearch')?.value.trim().toLowerCase() || '';
    const filter = document.getElementById('historyFilter')?.value || 'all';
    const items = all.filter(item => {
      const sourceMatch = filter === 'all' || item.source === filter;
      const queryMatch = !query || [item.value, item.url, item.format, item.type]
        .some(value => String(value || '').toLowerCase().includes(query));
      return sourceMatch && queryMatch;
    });

    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmptyState');
    const count = document.getElementById('historyCount');
    if (!list || !empty || !count) return;
    count.textContent = String(all.length);
    list.replaceChildren();
    empty.hidden = items.length > 0;

    if (!items.length) {
      const title = empty.querySelector('strong');
      const detail = empty.querySelector('span');
      if (all.length && (query || filter !== 'all')) {
        title.textContent = '沒有符合條件的紀錄';
        detail.textContent = '請調整搜尋文字或來源篩選。';
      } else {
        title.textContent = '目前沒有紀錄';
        detail.textContent = '掃描或產生條碼後，紀錄會顯示在這裡。';
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(item => fragment.appendChild(createItem(item)));
    list.appendChild(fragment);
  }

  function createItem(item) {
    const article = document.createElement('article');
    article.className = 'history-item';

    const head = document.createElement('div');
    head.className = 'history-item-head';
    const titleWrap = document.createElement('div');
    const source = document.createElement('div');
    source.className = 'history-source';
    source.textContent = Utils.sourceLabel(item.source);
    const value = document.createElement('div');
    value.className = 'history-value selectable';
    value.textContent = item.value;
    titleWrap.append(source, value);
    const format = document.createElement('span');
    format.className = 'format-tag';
    format.textContent = item.format;
    head.append(titleWrap, format);
    article.appendChild(head);

    if (item.url) {
      const url = document.createElement('div');
      url.className = 'history-url selectable';
      url.textContent = item.url;
      article.appendChild(url);
    }

    const sub = document.createElement('div');
    sub.className = 'history-sub';
    [item.type, Utils.formatDateTime(item.createdAt)].forEach(text => {
      const span = document.createElement('span');
      span.textContent = text;
      sub.appendChild(span);
    });
    article.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.appendChild(actionButton('複製', () => Utils.copyText(item.value)));
    if (item.url) actions.appendChild(actionButton('開啟網址', () => Utils.openUrl(item.url)));
    actions.appendChild(actionButton('再次產生', () => {
      window.App?.navigate('generate');
      setTimeout(() => Generator.focusValue(item.value), 80);
    }));
    actions.appendChild(actionButton('刪除', () => {
      Storage.removeHistory(item.id);
      Utils.toast('紀錄已刪除');
    }, 'delete'));
    article.appendChild(actions);
    return article;
  }

  function actionButton(label, handler, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mini-btn ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  return { init, render };
})();
