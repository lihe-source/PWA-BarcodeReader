importScripts('./zxing.min.js','./decoder-core.js');
self.onmessage=event=>{
  const {id,buffer,width,height,options}=event.data;
  try{self.postMessage({id,result:DecoderCore.decode(new Uint8ClampedArray(buffer),width,height,options)});}
  catch(error){self.postMessage({id,error:error.name||'DecodeError'});}
};
