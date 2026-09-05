/* Shared by the worker and CPU fallback; vendor library is bundled locally. */
const DecoderCore=(()=>{
  let reader,signature='';
  function decode(pixels,width,height,{hard=false,format='all'}={}){
    const key=`${hard}:${format}`;
    if(!reader||key!==signature){
      signature=key;reader=new ZXing.MultiFormatReader();const hints=new Map();
      const names=format==='all'?['QR_CODE','DATA_MATRIX','PDF_417','AZTEC','CODE_128','CODE_39','CODE_93','CODABAR','EAN_13','EAN_8','UPC_A','UPC_E','ITF']:[format.replaceAll('-','_')];
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,names.map(n=>ZXing.BarcodeFormat[n]).filter(n=>n!==undefined));
      hints.set(ZXing.DecodeHintType.TRY_HARDER,hard);reader.setHints(hints);
    }
    const gray=new Uint8ClampedArray(width*height);
    for(let i=0,j=0;i<gray.length;i++,j+=4)gray[i]=(pixels[j]+2*pixels[j+1]+pixels[j+2])>>2;
    try{
      const bitmap=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(gray,width,height)));
      const r=reader.decodeWithState(bitmap);return {value:r.getText(),format:ZXing.BarcodeFormat[r.getBarcodeFormat()]};
    }catch{return null;}finally{reader.reset();}
  }
  return {decode};
})();
