/**
 * BarcodePro 自動更新設定
 * 部署到 GitHub Pages 後，只需將下方 versionFileURL 改為：
 * 'https://raw.githubusercontent.com/你的帳號/你的Repo名稱/main/version.js'
 *
 * 或保留 './version.js'（相對路徑），Service Worker 會自動繞過快取取得最新版本
 */
const UPDATE_CONFIG = {
  versionFileURL: './version.js',
  checkInterval: 3600000  // 每小時自動檢查一次（毫秒）
};
