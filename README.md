# BarcodePro V2_0

適合部署到 GitHub Pages 的行動版 PWA 條碼工具。

## V2_0 主要改善

- 開啟程式預設進入「即時掃描」，相機權限已允許時會直接啟動。
- 原生 `BarcodeDetector` 優先，無法使用時自動切換 ZXing。
- 使用後鏡頭、高解析度、連續對焦／曝光／白平衡（裝置支援時）。
- 支援補光燈、鏡頭切換、鏡頭縮放及點擊重新對焦。
- 讀到條碼後以連續畫面確認，降低一維條碼誤讀。
- 結果明確分為「條碼讀值」與「網址」，網址可直接開啟。
- 圖片解碼支援原圖、增強對比及旋轉方向備援；原生引擎可列出多個條碼。
- 保留條碼產生、歷史紀錄、JSON 匯出與深淺色設定。
- 設定頁顯示當前／最新版本，啟動時自動檢查及套用更新。

## 部署方式

1. 將此資料夾內所有檔案上傳到 GitHub repository 根目錄。
2. GitHub repository → **Settings** → **Pages**。
3. Source 選擇 **Deploy from a branch**，Branch 選擇 `main` 與 `/ (root)`。
4. 使用 GitHub Pages 的 HTTPS 網址開啟，允許相機權限。
5. iPhone Safari 可使用「分享」→「加入主畫面」安裝成 PWA。

## 注意事項

- 相機 API 必須在 HTTPS 或 localhost 環境使用，直接雙擊 `index.html` 無法開啟相機。
- 第一次載入需要網路下載 ZXing 與 bwip-js；Service Worker 會在成功載入後快取供後續使用。
- 不同手機瀏覽器支援的條碼格式、補光燈、縮放與對焦能力可能不同，程式會自動隱藏或降級不支援功能。

## 版本更新

修改版本時，請同步更新：

- `version.js` 的 `APP_VERSION`
- `version.json` 的 `version` 與說明
- `service-worker.js` 的 `CACHE_NAME` 與 `RUNTIME_CACHE`

部署新版本後，已安裝的 PWA 會自動偵測 Service Worker 更新並重新載入。
