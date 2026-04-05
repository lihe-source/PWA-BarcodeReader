// updater.js — remote version check + SW update

const Updater = (() => {
  let timer = null;

  function parseVersion(text) {
    const m = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  async function check() {
    if (!UPDATE_CONFIG.versionFileURL.includes('{owner}')) {
      try {
        const res = await fetch(UPDATE_CONFIG.versionFileURL + '?t=' + Date.now());
        if (!res.ok) return;
        const text = await res.text();
        const remote = parseVersion(text);
        if (remote && remote !== APP_VERSION) {
          document.getElementById('updateBanner').style.display = '';
        }
      } catch (_) {}
    }
  }

  function init() {
    document.getElementById('updateBtn').addEventListener('click', async e => {
      e.preventDefault();
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        }
      } catch (_) {}
      location.reload();
    });

    navigator.serviceWorker && navigator.serviceWorker.addEventListener('controllerchange', () => {
      location.reload();
    });

    check();
    timer = setInterval(check, UPDATE_CONFIG.checkInterval);
  }

  return { init };
})();
