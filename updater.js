// updater.js — V1_4: robust version check + SW auto-update

const Updater = (() => {
  function parseVersion(text) {
    const m = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  function versionNum(v) {
    const m = v ? v.match(/V(\d+)_(\d)/) : null;
    return m ? parseInt(m[1]) * 10 + parseInt(m[2]) : 0;
  }

  async function checkRemote() {
    try {
      // Add ?nocache= so SW bypasses its own cache (see service-worker.js fetch handler)
      const url = UPDATE_CONFIG.versionFileURL + '?nocache=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return parseVersion(await res.text());
    } catch (_) { return null; }
  }

  function showBanner(remoteVer) {
    const banner = document.getElementById('updateBanner');
    banner.innerHTML = '發現新版本 ' + remoteVer + '，<a href="#" id="updateBtn">立即更新</a>';
    banner.style.display = '';

    document.getElementById('updateBtn').addEventListener('click', async e => {
      e.preventDefault();
      banner.innerHTML = '更新中，請稍候...';
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            if (reg.waiting) {
              // New SW installed and waiting — tell it to take over
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
              return; // reload triggered by controllerchange listener below
            }
          }
        }
        // No waiting SW — hard reload to fetch fresh files
        location.reload(true);
      } catch (_) {
        location.reload(true);
      }
    });
  }

  async function check() {
    const remote = await checkRemote();
    if (remote && versionNum(remote) > versionNum(APP_VERSION)) {
      showBanner(remote);
    }
  }

  function init() {
    // When a new SW takes control, reload to apply updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        location.reload();
      });
    }
    // Check on startup
    check();
    // Check periodically
    setInterval(check, UPDATE_CONFIG.checkInterval);
  }

  return { init };
})();
