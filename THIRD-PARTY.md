# 隨包函式庫

本版沿用使用者附件中的函式庫位元組，沒有連網更新至其他版本。它們是執行依賴，不需要另外安裝。

- `bwip-js.min.js`：bwip-js，檔案內自述版本 4.9.0（2026-03-31），保留原檔開頭完整版權及授權。官方原始專案：https://github.com/metafloor/bwip-js 。
- `zxing.min.js`：ZXing JavaScript library，沿用附件內 UMD bundle。舊版頁面的 CDN 版本宣告不等於此本機 bundle 的版本；因此不將它標成 0.21.3。官方原始專案：https://github.com/zxing-js/library 。授權為 Apache License 2.0；上游版本與完整授權資訊請以原始專案為準。

版本識別不完整的 ZXing bundle 以隨包 `checksums.sha256` 鎖定並由條碼回讀測試驗證；沒有宣稱為上游最新版。Apache License 2.0 全文見 `LICENSE-APACHE-2.0.txt`，上游附加聲明見 `NOTICE-ZXING.txt`。重新分發或另行更新函式庫時，應一併保留上游 LICENSE／NOTICE 與適用版權聲明。
