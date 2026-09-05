/* Maintenance helper. Example: node release.cjs V3_0_1 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const version=process.argv[2];
if(!/^V\d+(?:_\d+)+$/.test(version||'')){console.error('Usage: node release.cjs V3_0_1');process.exit(1);}
const dir=__dirname,date=new Date().toISOString().slice(0,10),json=JSON.parse(fs.readFileSync(path.join(dir,'version.json'),'utf8'));
json.version=version;json.buildDate=date;
fs.writeFileSync(path.join(dir,'version.js'),`/* Generated release identity shared by page and service worker. */\nconst APP_VERSION = '${version}';\nconst BUILD_DATE = '${date}';\n`);
fs.writeFileSync(path.join(dir,'version.json'),JSON.stringify(json,null,2)+'\n');
const result=cp.spawnSync(process.execPath,[path.join(dir,'verify.cjs')],{stdio:'inherit'});
if(result.status!==0){console.error('Release validation failed. Do not deploy.');process.exit(1);}
console.log('Release files updated. Upload the complete application, not just version.json.');
