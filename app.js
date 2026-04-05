// app.js — V1_5
// Default tab: generate. Scanner uses pause/resume to avoid re-requesting camera permission.

const App = (() => {
  let currentTab = 'generate'; // default = generate
  let scanStarted = false;

  function switchTab(tab) {
    if (currentTab === tab) return;
    const prev = currentTab;
    currentTab = tab;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === tab));
    document.getElementById('page-' + tab).classList.add('active');

    // Camera lifecycle: pause (not stop) to keep stream alive between switches
    if (prev === 'scan') Scanner.pause();

    if (tab === 'scan') {
      if (!scanStarted) {
        Scanner.start();   // First time: start camera (triggers permission once)
        scanStarted = true;
      } else {
        Scanner.resume();  // Subsequent: reuse existing stream, no permission prompt
      }
    }

    if (tab === 'history') History.load();
  }

  function initScanToolbar() {
    document.getElementById('btnFlipCamera').addEventListener('click', () => Scanner.flipCamera());
    document.getElementById('btnTorch').addEventListener('click', () => Scanner.toggleTorch());
  }

  function initGenerateActions() {
    document.getElementById('btnDownload').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      try { await Export.downloadPNG(Generator.getCanvas(), gen.format); UI.toast('下載成功'); }
      catch (e) { UI.toast('下載失敗：' + e.message); }
    });
    document.getElementById('btnShare').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      try { await Export.shareImage(Generator.getCanvas(), gen.format); }
      catch { UI.toast('分享失敗'); }
    });
    document.getElementById('btnSaveGen').addEventListener('click', async () => {
      const gen = Generator.getLastGenerated();
      if (!gen) { UI.toast('請先生成條碼'); return; }
      await DB.add({ content: gen.content, format: gen.format, category: gen.category, source: 'generate' });
      UI.toast('已儲存到歷史');
    });
  }

  async function init() {
    document.getElementById('versionDisplay').textContent = APP_VERSION;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.page)));

    initScanToolbar();
    Generator.init();
    History.init();
    initGenerateActions();
    Importer.init();
    Updater.init();

    // Camera: only start when user switches to scan tab
    // When app goes to background, fully stop camera (battery + privacy)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && currentTab === 'scan') {
        Scanner.stop();
        scanStarted = false;
      } else if (!document.hidden && currentTab === 'scan') {
        Scanner.start();
        scanStarted = true;
      }
    });
  }

  return { init, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
