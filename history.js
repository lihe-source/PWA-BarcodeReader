'use strict';
const HistoryView=(()=>{
  const $=id=>document.getElementById(id);let rows=[],page=1,epoch=0,editRecord=null,summary={matched:0,total:0,quantity:0,categories:[]};const selected=new Set(),size=30;
  const filters=()=>({q:$('historySearch').value,source:$('historyFilter').value,category:$('historyCategory').value,from:$('historyFrom').value,to:$('historyTo').value});
  function init(){
    $('historySearch').oninput=Utils.debounce(()=>{page=1;refresh();},180);
    for(const id of ['historyFilter','historyCategory','historyFrom','historyTo'])$(id).onchange=()=>{page=1;refresh();};
    $('historyPrev').onclick=()=>{page--;refresh();};$('historyNext').onclick=()=>{page++;refresh();};
    $('historySelectPage').onclick=()=>{rows.forEach(r=>selected.add(r.id));render();};
    $('historyDeselect').onclick=()=>{selected.clear();render();};$('historyDeleteSelected').onclick=()=>remove([...selected]);
    $('exportCsvBtn').onclick=async()=>{try{const all=await Storage.getHistory();await Storage.exportCSV(all.filter(r=>selected.size?selected.has(r.id):Storage.matches(r,filters())));}catch(e){Utils.busyError(e,'CSV 匯出失敗');}};
    $('editCancel').onclick=()=>$('editDialog').close();$('editForm').onsubmit=async e=>{e.preventDefault();if(!editRecord)return;try{await Storage.addHistory({...editRecord,note:$('editNote').value,category:$('editCategory').value,quantity:Number($('editQuantity').value)});$('editDialog').close();}catch(error){Utils.busyError(error,'編輯未儲存');}};
    window.addEventListener('barcode-history-changed',()=>{selected.clear();if(App.currentPage()==='history')refresh();});
    window.addEventListener('barcode-settings-changed',()=>{if(App.currentPage()==='history')refresh();});categories();
  }
  function categories(){
    for(const id of ['historyCategory','editCategory']){
      const el=$(id),value=el.value;el.replaceChildren();const names=[...new Set([...Storage.getSettings().categories,...summary.categories,...(editRecord?[editRecord.category]:[])])];
      if(id==='historyCategory')names.unshift('全部分類');names.forEach(n=>{const o=document.createElement('option');o.value=n==='全部分類'?'':n;o.textContent=n;el.append(o);});
      if([...el.options].some(o=>o.value===value))el.value=value;
    }
  }
  async function refresh(){
    const mine=++epoch;
    try{const result=await Storage.queryHistory(filters(),page,size);if(mine!==epoch)return;
      summary=result;const pages=Math.max(1,Math.ceil(result.matched/size));if(page>pages){page=pages;return refresh();}
      rows=result.rows;categories();render();
    }catch(e){Utils.busyError(e,'歷史讀取失敗');}
  }
  function render(){
    const pages=Math.max(1,Math.ceil(summary.matched/size));
    $('historyCount').textContent=summary.total+' 筆';$('historySummary').textContent=`符合 ${summary.matched} 筆 · 已選 ${selected.size} 筆 · 數量合計 ${summary.quantity}`;
    $('historyList').replaceChildren(...rows.map(item));$('historyEmptyState').hidden=summary.matched>0;
    $('historyPage').textContent=page+' / '+pages;$('historyPrev').disabled=page===1;$('historyNext').disabled=page===pages;$('historyDeleteSelected').disabled=!selected.size;
  }
  function button(label,fn){const b=document.createElement('button');b.className='mini-btn';b.textContent=label;b.onclick=fn;return b;}
  function item(r){
    const a=document.createElement('article');a.className='history-item';
    const head=document.createElement('div');head.className='history-item-head';const label=document.createElement('label');label.className='checkline';
    const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(r.id);check.setAttribute('aria-label','選取此筆紀錄');check.onchange=()=>{check.checked?selected.add(r.id):selected.delete(r.id);render();};
    const title=document.createElement('span');title.textContent=r.format+' · '+Utils.sourceLabel(r.source);label.append(check,title);head.append(label);
    const value=document.createElement('pre');value.className='history-value selectable';value.textContent=r.value;
    const sub=document.createElement('p');sub.className='history-sub';sub.textContent=Utils.formatDateTime(r.createdAt)+' · '+r.category+' · 數量 '+r.quantity;
    const details=document.createElement('details'),toggle=document.createElement('summary');toggle.textContent='詳細資料與操作';
    const full=document.createElement('pre');full.className='result-value selectable';full.textContent=r.value;
    const note=document.createElement('p');note.textContent=r.note||'無備註';note.className='note';
    const actions=document.createElement('div');actions.className='history-actions';actions.append(button('再次產生',()=>{App.navigate('generate');Generator.focusValue(r.value,r.format);}),button('編輯備註／數量',()=>edit(r)),button('刪除',()=>remove([r.id])));
    if(r.url)actions.append(button('確認並開啟網址',()=>Utils.openUrl(r.url)));
    details.append(toggle,full,note,actions);head.append(button('複製',()=>Utils.copyText(r.value)));a.append(head,value,sub,details);return a;
  }
  function edit(r){editRecord=r;$('editNote').value=r.note;$('editQuantity').value=r.quantity;categories();$('editCategory').value=r.category;$('editDialog').showModal();}
  async function remove(ids){
    if(!ids.length)return;if(ids.length>1&&!confirm('刪除選取的 '+ids.length+' 筆紀錄？'))return;
    try{const removed=await Storage.removeHistory(ids);Utils.toast('已刪除 '+removed.length+' 筆','',{label:'復原',run:()=>Storage.restoreDeleted(removed).catch(e=>Utils.busyError(e,'復原失敗'))});}catch(e){Utils.busyError(e,'刪除失敗');}
  }
  return {init,refresh,render};
})();
