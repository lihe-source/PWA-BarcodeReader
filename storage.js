const Storage = (() => {
  const HISTORY_KEY = 'barcodepro.history.v2';
  const SETTINGS_KEY = 'barcodepro.settings.v2';
  const DEFAULT_SETTINGS = Object.freeze({
    autoSave: true,
    sound: true,
    vibration: true,
    theme: 'system'
  });

  function getHistory() {
    const items = Utils.safeJsonParse(localStorage.getItem(HISTORY_KEY), []);
    return Array.isArray(items) ? items : [];
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 500)));
    window.dispatchEvent(new CustomEvent('barcode-history-changed'));
  }

  function addHistory(entry) {
    const item = {
      id: entry.id || Utils.uniqueId('barcode'),
      value: String(entry.value ?? ''),
      url: Utils.normalizeOpenableUrl(entry.url || entry.value || ''),
      format: Utils.formatLabel(entry.format),
      type: entry.type || Utils.classifyContent(entry.value, entry.format),
      source: entry.source || 'scan',
      createdAt: entry.createdAt || new Date().toISOString()
    };
    const list = getHistory();
    const duplicateIndex = list.findIndex(existing =>
      existing.value === item.value && existing.source === item.source &&
      Math.abs(new Date(existing.createdAt).getTime() - Date.now()) < 5000
    );
    if (duplicateIndex >= 0) list.splice(duplicateIndex, 1);
    list.unshift(item);
    saveHistory(list);
    return item;
  }

  function removeHistory(id) {
    saveHistory(getHistory().filter(item => item.id !== id));
  }

  function clearHistory() { saveHistory([]); }

  function getSettings() {
    const raw = Utils.safeJsonParse(localStorage.getItem(SETTINGS_KEY), {});
    return { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  function saveSettings(partial) {
    const next = { ...getSettings(), ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('barcode-settings-changed', { detail: next }));
    return next;
  }

  function exportHistory() {
    const payload = {
      app: 'BarcodePro',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      history: getHistory()
    };
    Utils.downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
      `BarcodePro-History-${new Date().toISOString().slice(0, 10)}.json`
    );
  }

  return {
    getHistory, addHistory, removeHistory, clearHistory,
    getSettings, saveSettings, exportHistory
  };
})();
