// app.js — main app controller

const App = (() => {
  let currentTab = 'scan';
  let scanStarted = false;

  function switchTab(tab) {
    if (currentTab === tab) return;
    const prev = currentTab;
    currentTab = tab;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === tab));
    document.getElementById('page-' + tab).classList.add('active');

    // Stop scan when leaving scan tab
    if (prev === 'scan') {
      Scanner.stop();
      scanStarted = false;
    }

    // Start scan when entering scan tab
    if (tab === 'scan' && !scanStarted) {
      document.getElementById('scanResultWrap').style.display = 'none';
      Scanner.start();
      scanStarted = true;
    }

    // Load history when entering history tab
    if (tab === 'history') {
      History.load();
    }
  }

  function initScanToolbar() {
    document.getElementById('btnFlipCamera').addEventListener('click', () => Scanner.flipCamera());
    document.getElementById('btnTorch').addEventListener('click', () => Scanner.toggleTorch());
  }

  function initGenerateActions() {
    document.getElementById('btnDownload').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      try {
        await Export.downloadPNG(Generator.getCanvas(), gen.format);
        UI.toast('下載成功');
      } catch (e) { UI.toast('下載失敗：' + e.message); }
    });

    document.getElementById('btnShare').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      try {
        await Export.shareImage(Generator.getCanvas(), gen.format);
      } catch (e) { UI.toast('分享失敗'); }
    });

    document.getElementById('btnSaveGen').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      await DB.add({ content: gen.content, format: gen.format, category: gen.category, source: 'generate' });
      UI.toast('已儲存到歷史');
    });
  }

  async function init() {
    // Version display
    document.getElementById('versionDisplay').textContent = APP_VERSION;

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }

    // Tab bar
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.page));
    });

    // Init modules
    initScanToolbar();
    Generator.init();
    History.init();
    initGenerateActions();
    Updater.init();

    // Auto-start scanner on launch
    Scanner.start();
    scanStarted = true;
  }

  return { init, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
