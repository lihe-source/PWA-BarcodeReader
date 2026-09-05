const Decoder=(()=>{
  let worker=null,active=null,nextId=0,workerFailed=false;
  function startWorker(){
    if(worker||workerFailed||!window.Worker)return;
    try{
      worker=new Worker('./decoder-worker.js');
      worker.onmessage=e=>{if(active?.id!==e.data.id)return;const job=active;active=null;clearTimeout(job.timer);e.data.error?job.reject(new Error(e.data.error)):job.resolve(e.data.result);};
      worker.onerror=()=>failWorker(new Error('背景解碼不可用，切換備援'));
    }catch(e){workerFailed=true;Utils.report(e,'解碼執行緒');}
  }
  function cancel(){if(active){clearTimeout(active.timer);active.reject(new DOMException('已取消辨識','AbortError'));active=null;}worker?.terminate();worker=null;}
  function failWorker(error){workerFailed=true;const job=active;active=null;worker?.terminate();worker=null;if(job){clearTimeout(job.timer);job.reject(error);}}
  async function decode(canvas,options={}){
    if(active)throw new Error('辨識引擎忙碌中');startWorker();
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    if(worker){return new Promise((resolve,reject)=>{const id=++nextId;active={id,resolve,reject,timer:setTimeout(()=>failWorker(new Error('背景解碼逾時')),12000)};worker.postMessage({id,buffer:data.data.buffer,width:canvas.width,height:canvas.height,options},[data.data.buffer]);}).catch(e=>{if(workerFailed&&e.name!=='AbortError')return decode(canvas,options);throw e;});}
    await new Promise(r=>setTimeout(r,0));return DecoderCore.decode(data.data,canvas.width,canvas.height,options);
  }
  return {decode,cancel,mode:()=>workerFailed?'主執行緒備援':'背景解碼'};
})();
