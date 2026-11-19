/* node release.cjs V3_1 -- release identity, asset hashes and validation. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const version=process.argv[2];
if(!/^V\d+(?:_\d+)+$/.test(version||'')){console.error('Usage: node release.cjs V3_1');process.exit(1);}
const dir=__dirname,date=new Date().toISOString().slice(0,10);
fs.writeFileSync(path.join(dir,'version.js'),`/* Generated shared release identity. */\nconst APP_VERSION = '${version}';\nconst BUILD_DATE = '${date}';\n`);
const info={version,buildDate:date,notes:['掃描成功彈出結果視窗、完整文字複製與直接開啟網址','結果視窗期間暫停辨識，手動繼續下一筆','安全更新、設定草稿及跨視窗同步','備份衝突比對與還原前快照','資料庫游標分頁與精簡歷史列表','連續掃描離框判斷與數量累加','原圖裁切、拖曳框與快速辨識','按需載入產碼套件與離線資源完整性驗證']};
fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify(info,null,2)+'\n');
const html=path.join(dir,'index.html');fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace(/(id="(?:headerVersion|currentVersionText)"[^>]*>)V[\d_\.]+/g,'$1'+version));
const files=fs.readdirSync(dir).filter(f=>/\.(?:js|css|html|png|json)$/.test(f)&&!['service-worker.js','release-manifest.js','version.json'].includes(f)).sort();
const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex')]));
fs.writeFileSync(path.join(dir,'release-manifest.js'),`/* Generated: do not edit manually. */\nconst RELEASE_VERSION = '${version}';\nconst RELEASE_HASHES = ${JSON.stringify(hashes,null,2)};\n`);
const result=cp.spawnSync(process.execPath,[path.join(dir,'verify.cjs')],{stdio:'inherit'});
if(result.status!==0){console.error('Validation failed. Do not deploy.');process.exit(1);}
const all=fs.readdirSync(dir).filter(f=>f!=='checksums.sha256'&&fs.statSync(path.join(dir,f)).isFile()).sort();
fs.writeFileSync(path.join(dir,'checksums.sha256'),all.map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex')+'  '+f).join('\n')+'\n');
console.log('Release validated. Upload all assets together; do not upload version.json alone.');
