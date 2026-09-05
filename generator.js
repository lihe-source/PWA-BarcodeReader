const Generator=(()=>{
  const $=id=>document.getElementById(id);
  const formats={'QR-CODE':'qrcode','CODE-128':'code128','CODE-39':'code39','EAN-13':'ean13','EAN-8':'ean8','UPC-A':'upca','DATA-MATRIX':'datamatrix','PDF-417':'pdf417'};
  let record=null,epoch=0,busy=false,renderTimer,exporting=0;
  function init(){
    for(const id of ['generateValue','generateFormat'])$(id).addEventListener(id==='generateValue'?'input':'change',()=>{invalidate();clearTimeout(renderTimer);renderTimer=setTimeout(render,180);App.persistDraft();});
    $('downloadBarcodeBtn').onclick=download;$('shareBarcodeBtn').onclick=share;$('saveBarcodeBtn').onclick=save;$('verifyBarcodeBtn').onclick=verify;$('printBarcodeBtn').onclick=print;
    const draft=App.getDraft();if(draft){$('generateValue').value=draft.value||'';if(formats[draft.format])$('generateFormat').value=draft.format;}
    if($('generateValue').value)render();else buttons(false);
  }
  function buttons(on){for(const id of ['downloadBarcodeBtn','shareBarcodeBtn','saveBarcodeBtn','verifyBarcodeBtn','printBarcodeBtn'])$(id).disabled=!on;}
  function invalidate(){++epoch;if(busy){Decoder.cancel();busy=false;}record=null;buttons(false);$('verifyStatus').textContent='';}
  function normalizeEAN(value,format){
    const sizes={'EAN-13':13,'EAN-8':8,'UPC-A':12},size=sizes[format];if(!size)return value;
    if(!/^\d+$/.test(value)||![size-1,size].includes(value.length))throw new Error(`${format} 請輸入 ${size-1} 或 ${size} 位數字。`);
    const body=value.slice(0,size-1);let sum=0;for(let i=body.length-1,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=Number(body[i])*weight;
    const check=String((10-sum%10)%10);if(value.length===size&&value.at(-1)!==check)throw new Error(`檢查碼不正確，最後一碼應為 ${check}。`);return body+check;
  }
  function optionsFor(format,text){
    const options={bcid:formats[format],text,scale:4,paddingwidth:12,paddingheight:12,includetext:!['QR-CODE','DATA-MATRIX','PDF-417'].includes(format),textxalign:'center',backgroundcolor:'FFFFFF'};
    if(!['QR-CODE','DATA-MATRIX'].includes(format))options.height=18;
    if(format==='QR-CODE')options.eclevel='M';
    return options;
  }
  function render(){
    invalidate();const value=$('generateValue').value,format=$('generateFormat').value,c=$('barcodeCanvas');$('generateError').hidden=true;c.hidden=true;$('barcodePlaceholder').hidden=false;
    if(!value.length)return;
    try{
      if(value.length>4000)throw new Error('內容上限 4,000 字元；實際可編碼容量依格式而異。');
      const actual=normalizeEAN(value,format);
      bwipjs.toCanvas(c,optionsFor(format,actual));
      record=Storage.normalize({value:actual,format,source:'generate'});c.hidden=false;$('barcodePlaceholder').hidden=true;buttons(true);
      $('generateNote').textContent=actual!==value?`已自動補上檢查碼，實際內容：${actual}`:'原始空白與換行會保留；尺寸不足時請縮短內容。';
    }catch(e){$('generateError').textContent=e.message||String(e);$('generateError').hidden=false;}
  }
  async function download(){if(!record)return;const r=record;exporting++;try{const blob=await Utils.canvasToBlob($('barcodeCanvas'));Utils.downloadBlob(blob,`BarcodePro-${r.format}-${Date.now()}.png`);Utils.toast('已交由瀏覽器儲存 PNG','success');}catch(e){Utils.busyError(e,'PNG 匯出失敗');}finally{exporting--;}}
  async function share(){if(!record)return;const r=record;exporting++;try{const blob=await Utils.canvasToBlob($('barcodeCanvas'));const file=new File([blob],'BarcodePro.png',{type:'image/png'});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:r.format,text:r.value});else Utils.downloadBlob(blob,'BarcodePro.png');}catch(e){if(e.name!=='AbortError')Utils.busyError(e,'分享失敗');}finally{exporting--;}}
  async function save(){if(!record)return;const r=record;try{await Storage.addHistory(r);if(record===r)$('saveBarcodeBtn').disabled=true;Utils.toast('已存入歷史','success');}catch(e){Utils.busyError(e,'儲存失敗');}}
  async function verify(){
    if(!record)return;const r=record,mine=epoch;busy=true;$('verifyStatus').textContent='正在回讀驗證…';$('verifyBarcodeBtn').disabled=true;
    try{const read=await Decoder.decode($('barcodeCanvas'),{hard:true,format:r.format});if(mine!==epoch)return;$('verifyStatus').textContent=read?.value===r.value?'✓ 回讀內容完全一致':'未通過回讀；請調整內容或尺寸並用實機驗證，勿直接用於正式標籤。';}
    catch(e){if(mine===epoch)$('verifyStatus').textContent='此次無法驗證，請重試。';}
    finally{if(mine===epoch){busy=false;$('verifyBarcodeBtn').disabled=false;}}
  }
  async function print(){
    if(!record)return;
    const width=Number($('printWidth').value),height=Number($('printHeight').value),c=$('barcodeCanvas');
    if(width<20||width>210||height<15||height>297){Utils.toast('寬度須為 20–210 mm，高度須為 15–297 mm','error');return;}
    const area=$('printArea');area.replaceChildren();const img=document.createElement('img');img.src=c.toDataURL('image/png');img.style.maxWidth=`${width-4}mm`;img.style.maxHeight=`${height-4}mm`;area.style.width=`${width}mm`;area.style.height=`${height}mm`;area.append(img);
    await img.decode();window.print();
  }
  function focusValue(value='',format='QR-CODE'){
    if(!formats[Utils.formatLabel(format)]){Utils.toast('此格式不支援重新產生，已保留原紀錄','error');return false;}
    $('generateValue').value=value;$('generateFormat').value=Utils.formatLabel(format);render();App.persistDraft();return true;
  }
  function cancel(){clearTimeout(renderTimer);++epoch;busy=false;Decoder.cancel();if(record)$('verifyBarcodeBtn').disabled=false;}
  return {init,render,focusValue,cancel,normalizeEAN,optionsFor,isBusy:()=>busy||exporting>0};
})();
