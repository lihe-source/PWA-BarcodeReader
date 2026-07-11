const App = (() => {
  let activePage = 'scan';
  let initialized = false;
  let mediaQuery = null;

  async function init() {
    if (initialized) return;
    initialized = true;

    Scanner.init();
    Importer.init();
    Generator.init();
    HistoryView.init();
    Updater.init();
    bindNavigation();
    bindSettings();
    applyStoredSettings();

    const requestedPage = new URLSearchParams(location.search).get('page');
    if (['scan', 'import', 'generate', 'history', 'settings'].includes(requestedPage) && requestedPage !== 'scan') {
      await navigate(requestedPage);
    }

    // The scan page is the default screen. Camera startup is intentionally
    // scheduled before update checks so the viewfinder appears immediately.
    if (activePage === 'scan') setTimeout(() => Scanner.start(), 30);

    Updater.registerServiceWorker().then(() => {
      if (Updater.shouldAutoCheck()) Updater.checkForUpdates();
      else {
        const latest = document.getElementById('latestVersionText');
        if (latest) latest.textContent = APP_VERSION;
      }
    });
  }

  function bindNavigation() {
    document.querySelectorAll('[data-page-target]').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.pageTarget));
    });
  }

  async function navigate(pageName) {
    const page = document.querySelector(`.page[data-page="${pageName}"]`);
    if (!page || pageName === activePage && page.classList.contains('active')) return;

    document.querySelectorAll('.page').forEach(element => element.classList.toggle('active', element === page));
    document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.pageTarget === pageName));

    const previousPage = activePage;
    activePage = pageName;
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (previousPage === 'scan' && pageName !== 'scan') await Scanner.stop({ keepResult: true });
    if (pageName === 'scan') Scanner.start();
    if (pageName === 'history') HistoryView.render();
    if (pageName === 'generate') Generator.render();
  }

  function bindSettings() {
    const bindings = [
      ['autoSaveToggle', 'autoSave'],
      ['soundToggle', 'sound'],
      ['vibrationToggle', 'vibration']
    ];
    bindings.forEach(([id, key]) => {
      document.getElementById(id).addEventListener('change', event => {
        Storage.saveSettings({ [key]: event.target.checked });
      });
    });

    document.getElementById('themeSelect').addEventListener('change', event => {
      const settings = Storage.saveSettings({ theme: event.target.value });
      applyTheme(settings.theme);
    });

    document.getElementById('exportHistoryBtn').addEventListener('click', () => {
      Storage.exportHistory();
      Utils.toast('歷史紀錄已匯出', 'success');
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      if (!Storage.getHistory().length) {
        Utils.toast('目前沒有可清除的紀錄');
        return;
      }
      if (!window.confirm('確定要清除全部歷史紀錄嗎？此動作無法復原。')) return;
      Storage.clearHistory();
      Utils.toast('歷史紀錄已清除');
    });

    window.addEventListener('barcode-settings-changed', event => syncSettingsControls(event.detail));
  }

  function applyStoredSettings() {
    const settings = Storage.getSettings();
    syncSettingsControls(settings);
    applyTheme(settings.theme);
  }

  function syncSettingsControls(settings) {
    document.getElementById('autoSaveToggle').checked = Boolean(settings.autoSave);
    document.getElementById('soundToggle').checked = Boolean(settings.sound);
    document.getElementById('vibrationToggle').checked = Boolean(settings.vibration);
    document.getElementById('themeSelect').value = settings.theme || 'system';
  }

  function applyTheme(theme) {
    if (!mediaQuery) {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
      mediaQuery.addEventListener?.('change', () => {
        if (Storage.getSettings().theme === 'system') applyTheme('system');
      });
    }
    const resolved = theme === 'system' ? (mediaQuery.matches ? 'light' : 'dark') : theme;
    document.documentElement.dataset.theme = resolved;
    const themeColor = resolved === 'light' ? '#f3f6fb' : '#070b14';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }

  function currentPage() { return activePage; }

  return { init, navigate, currentPage };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', App.init);
