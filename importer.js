const Importer=(()=>{
  const $=id=>document.getElementById(id);let epoch=0,busy=false,source=null,objectUrl='',results=[],selected=0;
  function init(){
    $('chooseImageBtn').onclick=()=>$('imageInput').click();$('takePhotoBtn').onclick=()=>$('photoInput').click();
    for(const id of ['imageInput','photoInput'])$(id).onchange=e=>{const file=e.target.files?.[0];e.target.value='';if(file)load(file);};
    $('cancelImageBtn').onclick=cancel;$('decodeImageBtn').onclick=decode;
    for(const id of ['cropX','cropY','cropW','cropH'])$(id).oninput=drawCrop;
    $('copyImageBtn').onclick=()=>current()&&Utils.copyText(current().value);
    $('shareImageBtn').onclick=()=>current()&&Utils.shareText('條碼讀值',current().value);
    $('openImageUrlBtn').onclick=()=>current()&&Utils.openUrl(current().url);
    $('saveImageBtn').onclick=()=>save([current()]);$('saveAllImageBtn').onclick=()=>save(results);
  }
  function cancel(){++epoch;busy=false;Decoder.cancel();$('imageProgress').hidden=true;$('cancelImageBtn').hidden=true;$('decodeImageBtn').disabled=!source;}
  async function load(file){
    cancel();const mine=epoch;
    if(file.size>30*1024*1024){Utils.toast('圖片上限 30 MB','error');return;}
    if(file.type&&!file.type.startsWith('image/')){Utils.toast('請選擇圖片','error');return;}
    source=null;results=[];$('imageResultCard').hidden=true;$('imageResultTabs').hidden=true;$('cropTools').hidden=true;
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('此裝置無法讀取圖片，請改用 JPG 或 PNG'));i.src=objectUrl;});
      if(mine!==epoch)return;
      if(img.naturalWidth*img.naturalHeight>64000000)throw new Error('圖片超過 6,400 萬像素，請先縮小');
      const scale=Math.min(1,2600/Math.max(img.naturalWidth,img.naturalHeight));source=document.createElement('canvas');source.width=Math.round(img.naturalWidth*scale);source.height=Math.round(img.naturalHeight*scale);source.getContext('2d').drawImage(img,0,0,source.width,source.height);
      $('imagePreview').src=objectUrl;$('imagePreviewCard').hidden=false;$('cropTools').hidden=false;
      $('cropX').value=0;$('cropY').value=0;$('cropW').value=100;$('cropH').value=100;drawCrop();await decode();
    }catch(e){if(mine===epoch)Utils.busyError(e,'圖片讀取失敗');}
  }
  function drawCrop(){
    const region=$('cropRegion');const x=Number($('cropX').value),y=Number($('cropY').value);
    const w=Math.min(100-x,Number($('cropW').value)),h=Math.min(100-y,Number($('cropH').value));
    Object.assign(region.style,{left:`${x}%`,top:`${y}%`,width:`${w}%`,height:`${h}%`});
    for(const id of ['cropX','cropY','cropW','cropH'])$(`${id}Text`).textContent=`${$(id).value}%`;
  }
  function cropped(){const x=Number($('cropX').value)/100,y=Number($('cropY').value)/100,w=Math.min(1-x,Number($('cropW').value)/100),h=Math.min(1-y,Number($('cropH').value)/100);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(source.width*w));c.height=Math.max(1,Math.round(source.height*h));c.getContext('2d').drawImage(source,source.width*x,source.height*y,source.width*w,source.height*h,0,0,c.width,c.height);return c;}
  function pass(base,rotation=0,enhance=false,region=null){
    const r=region||{x:0,y:0,w:base.width,h:base.height},c=document.createElement('canvas');const scale=Math.min(1,1800/Math.max(r.w,r.h));const w=Math.max(1,Math.round(r.w*scale)),h=Math.max(1,Math.round(r.h*scale));c.width=rotation?h:w;c.height=rotation?w:h;
    const ctx=c.getContext('2d',{willReadFrequently:true});if(enhance)ctx.filter='grayscale(1) contrast(1.4)';ctx.translate(c.width/2,c.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(base,r.x,r.y,r.w,r.h,-w/2,-h/2,w,h);return c;
  }
  async function decode(){
    if(!source)return;cancel();const mine=epoch;busy=true;results=[];$('imageResultCard').hidden=true;$('imageResultTabs').hidden=true;$('imageProgress').hidden=false;$('cancelImageBtn').hidden=false;$('decodeImageBtn').disabled=true;
    const base=cropped(),found=new Map();
    const add=(value,format)=>{if(!value.length)return;const f=Utils.formatLabel(format==='pdf417'?'PDF_417':format);const r=Storage.normalize({value,format:f,source:'import'});found.set(JSON.stringify([r.value,r.format]),r);};
    try{
      if(window.BarcodeDetector){try{const formats=await BarcodeDetector.getSupportedFormats();if(mine!==epoch)return;if(formats.length){const d=new BarcodeDetector({formats});for(const c of await d.detect(base))add(c.rawValue,c.format);}}catch{}}
      const attempts=[{},{enhance:true},{rotation:90},{rotation:-90}];
      for(let row=0;row<2;row++)for(let col=0;col<2;col++)attempts.push({region:{x:Math.floor(base.width*col*.4),y:Math.floor(base.height*row*.4),w:Math.floor(base.width*.6),h:Math.floor(base.height*.6)}});
      for(let i=0;i<attempts.length;i++){
        if(mine!==epoch)return;$('imageProgressText').textContent=`辨識中 ${i+1}/${attempts.length} · 已找到 ${found.size} 個`;
        const a=attempts[i],c=pass(base,a.rotation||0,a.enhance||false,a.region);let r;
        try{r=await Decoder.decode(c,{hard:true});}finally{c.width=c.height=1;}
        if(mine!==epoch)return;if(r)add(r.value,r.format);
      }
      results=[...found.values()];selected=0;render();
      if(results.length)Utils.toast(`找到 ${results.length} 個不同條碼；重疊或極小條碼可裁切後重試`,'success');else Utils.toast('未找到條碼，請裁切放大或換更清晰的圖片','error');
    }catch(e){if(mine===epoch&&e.name!=='AbortError')Utils.busyError(e,'圖片辨識失敗');}
    finally{base.width=base.height=1;if(mine===epoch){busy=false;$('imageProgress').hidden=true;$('cancelImageBtn').hidden=true;$('decodeImageBtn').disabled=false;}}
  }
  function current(){return results[selected];}
  function render(){
    const r=current();$('imageEmptyState').hidden=Boolean(r);$('imageResultCard').hidden=!r;const tabs=$('imageResultTabs');tabs.replaceChildren();tabs.hidden=results.length<2;
    results.forEach((item,i)=>{const b=document.createElement('button');b.className='result-tab'+(i===selected?' active':'');b.textContent=`${i+1} · ${item.format}`;b.onclick=()=>{selected=i;render();};tabs.append(b);});
    if(!r)return;$('imageResultValue').textContent=r.value;$('imageResultFormat').textContent=r.format;$('imageResultType').textContent=r.type;$('imageResultMeta').textContent=`${r.value.length} 字元 · ${results.length} 個不同結果`;$('openImageUrlBtn').disabled=!r.url;$('saveImageBtn').disabled=false;
    const reason=Storage.validate(r.value,r.format);$('imageValidation').textContent=reason?`不符合掃描檢核：${reason}。仍可複製，不能存入有效紀錄。`:'';
  }
  async function save(items){
    const rows=items.filter(Boolean);if(!rows.length)return;
    const invalid=rows.find(r=>Storage.validate(r.value,r.format));if(invalid){Utils.toast('含不符合設定檢核的條碼，請調整設定或選取有效結果','error');return;}
    try{const report=await Storage.restore({app:'BarcodePro',history:rows});Utils.toast(`已新增 ${report.added} 筆，略過 ${report.duplicates} 筆重複紀錄`,'success');$('saveImageBtn').disabled=true;}catch(e){Utils.busyError(e,'未能保存圖片結果');}
  }
  function session(){return {results,selected};}
  function restoreSession(s){if(!s?.results)return;try{results=s.results.map(e=>Storage.normalize(e));selected=Math.min(s.selected||0,Math.max(0,results.length-1));render();}catch{}}
  return {init,cancel,isBusy:()=>busy,session,restoreSession};
})();
