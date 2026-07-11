const Updater = (() => {
  let registration = null;
  let refreshing = false;
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById('currentVersionText').textContent = APP_VERSION;
    document.getElementById('headerVersion').textContent = APP_VERSION;
    document.getElementById('checkUpdateBtn').addEventListener('click', () => checkForUpdates({ manual: true }));
    document.getElementById('updateNowBtn').addEventListener('click', applyUpdate);
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      setVersionNote('此瀏覽器不支援 Service Worker，無法使用自動更新與離線快取。');
      return null;
    }
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      observeRegistration(registration);
      return registration;
    } catch (error) {
      console.error('Service worker registration failed:', error);
      setVersionNote('Service Worker 註冊失敗，請確認使用 HTTPS 或 GitHub Pages。');
      return null;
    }
  }

  function observeRegistration(reg) {
    if (reg.waiting) showUpdateAvailable();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateAvailable();
          // Requirement: when a new version is ready, activate it automatically.
          setTimeout(() => applyUpdate(), 550);
        }
      });
    });
  }

  async function checkForUpdates({ manual = false } = {}) {
    const button = document.getElementById('checkUpdateBtn');
    const latestText = document.getElementById('latestVersionText');
    if (button) button.disabled = true;
    latestText.textContent = '檢查中';
    try {
      const response = await fetch(`${UPDATE_CONFIG.versionUrl}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const latest = String(data.version || APP_VERSION);
      latestText.textContent = latest;
      localStorage.setItem('barcodepro.lastUpdateCheck', String(Date.now()));

      if (compareVersions(latest, APP_VERSION) > 0) {
        setVersionNote(`發現新版本 ${latest}，正在下載並準備自動更新。`);
        showUpdateAvailable(latest);
        if (registration) await registration.update();
        if (registration?.waiting) setTimeout(() => applyUpdate(), 450);
      } else {
        setVersionNote(`目前已是最新版本（最後檢查：${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}）。`);
        if (manual) Utils.toast('目前已是最新版本', 'success');
      }
      return data;
    } catch (error) {
      console.warn('Update check failed:', error);
      latestText.textContent = '無法確認';
      setVersionNote('目前無法連線檢查版本；恢復網路後可再次檢查。');
      if (manual) Utils.toast('檢查更新失敗，請確認網路連線', 'error');
      return null;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function shouldAutoCheck() {
    if (!UPDATE_CONFIG.autoCheckOnLaunch) return false;
    const last = Number(localStorage.getItem('barcodepro.lastUpdateCheck') || 0);
    return !last || Date.now() - last >= UPDATE_CONFIG.checkIntervalMs;
  }

  async function applyUpdate() {
    document.getElementById('updateNowBtn').disabled = true;
    try {
      if (!registration) registration = await navigator.serviceWorker?.getRegistration('./');
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }
      if (registration) {
        await registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          return;
        }
      }
      // If the new worker is already active or SW is unavailable, bypass caches once.
      window.location.reload();
    } catch (error) {
      console.error('Apply update failed:', error);
      document.getElementById('updateNowBtn').disabled = false;
      Utils.toast('更新失敗，請重新開啟程式', 'error');
    }
  }

  function showUpdateAvailable(version = '') {
    const banner = document.getElementById('updateBanner');
    document.getElementById('updateBannerText').textContent = version ? `新版本 ${version} 已可用` : '新版本已下載完成';
    banner.hidden = false;
  }

  function setVersionNote(text) {
    const element = document.getElementById('versionNote');
    if (element) element.textContent = text;
  }

  function compareVersions(a, b) {
    const parts = value => String(value).replace(/^V/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
    const left = parts(a);
    const right = parts(b);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left[index] || 0) - (right[index] || 0);
      if (difference !== 0) return Math.sign(difference);
    }
    return 0;
  }

  return { init, registerServiceWorker, checkForUpdates, shouldAutoCheck, applyUpdate };
})();
