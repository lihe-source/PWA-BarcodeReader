const HistoryView=(()=>{
  const $=id=>document.getElementById(id);let all=[],filtered=[],page=1,epoch=0,editId=null;const selected=new Set(),size=30;
  function init(){
    $('historySearch').oninput=Utils.debounce(()=>{page=1;render();},180);
    for(const id of ['historyFilter','historyCategory','historyFrom','historyTo'])$(id).onchange=()=>{page=1;render();};
    $('historyPrev').onclick=()=>{page--;render();};$('historyNext').onclick=()=>{page++;render();};
    $('historySelectPage').onclick=()=>{filtered.slice((page-1)*size,page*size).forEach(r=>selected.add(r.id));render();};
    $('historyDeselect').onclick=()=>{selected.clear();render();};$('historyDeleteSelected').onclick=()=>remove([...selected]);
    $('exportCsvBtn').onclick=()=>Storage.exportCSV(selected.size?all.filter(r=>selected.has(r.id)):filtered).catch(e=>Utils.busyError(e,'CSV 匯出失敗'));
    $('editCancel').onclick=()=>$('editDialog').close();$('editForm').onsubmit=async e=>{e.preventDefault();const r=all.find(r=>r.id===editId);if(!r)return;try{await Storage.addHistory({...r,note:$('editNote').value,category:$('editCategory').value,quantity:Number($('editQuantity').value)});$('editDialog').close();}catch(error){Utils.busyError(error,'編輯未儲存');}};
    window.addEventListener('barcode-history-changed',refresh);window.addEventListener('barcode-settings-changed',()=>{categories();render();});categories();refresh();
  }
  function categories(){for(const id of ['historyCategory','editCategory']){const el=$(id),value=el.value;el.replaceChildren();const names=[...new Set([...Storage.getSettings().categories,...all.map(r=>r.category)])];if(id==='historyCategory')names.unshift('全部分類');names.forEach(n=>{const o=document.createElement('option');o.value=n==='全部分類'?'':n;o.textContent=n;el.append(o);});if([...el.options].some(o=>o.value===value))el.value=value;}}
  async function refresh(){const mine=++epoch;try{const rows=await Storage.getHistory();if(mine!==epoch)return;all=rows;const ids=new Set(all.map(r=>r.id));for(const id of selected)if(!ids.has(id))selected.delete(id);categories();render();}catch(e){Utils.busyError(e,'歷史讀取失敗');}}
  function render(){
    const q=$('historySearch').value.toLowerCase(),source=$('historyFilter').value,cat=$('historyCategory').value,from=$('historyFrom').value,to=$('historyTo').value;
    filtered=all.filter(r=>{const d=new Date(r.createdAt);const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return (!q||[r.value,r.format,r.note,r.category].some(v=>v.toLowerCase().includes(q)))&&(source==='all'||r.source===source)&&(!cat||r.category===cat)&&(!from||date>=from)&&(!to||date<=to);});
    const pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.max(1,Math.min(page,pages));
    $('historyCount').textContent=`${all.length} 筆`;$('historySummary').textContent=`符合 ${filtered.length} 筆 · 已選 ${selected.size} 筆 · 數量合計 ${filtered.reduce((n,r)=>n+r.quantity,0)}`;
    const list=$('historyList');list.replaceChildren();filtered.slice((page-1)*size,page*size).forEach(r=>list.append(item(r)));
    $('historyEmptyState').hidden=filtered.length>0;$('historyPage').textContent=`${page} / ${pages}`;$('historyPrev').disabled=page===1;$('historyNext').disabled=page===pages;$('historyDeleteSelected').disabled=!selected.size;
  }
  function button(label,fn){const b=document.createElement('button');b.className='mini-btn';b.textContent=label;b.onclick=fn;return b;}
  function item(r){
    const a=document.createElement('article');a.className='history-item';
    const head=document.createElement('div');head.className='history-item-head';const label=document.createElement('label');label.className='checkline';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(r.id);check.setAttribute('aria-label','選取此筆紀錄');check.onchange=()=>{check.checked?selected.add(r.id):selected.delete(r.id);render();};const title=document.createElement('span');title.textContent=`${r.format} · ${Utils.sourceLabel(r.source)}`;label.append(check,title);head.append(label);
    const value=document.createElement('pre');value.className='history-value selectable';value.textContent=r.value;
    const sub=document.createElement('p');sub.className='history-sub';sub.textContent=`${Utils.formatDateTime(r.createdAt)} · ${r.category} · 數量 ${r.quantity}`;
    const note=document.createElement('p');note.textContent=r.note;note.className='note';
    const actions=document.createElement('div');actions.className='history-actions';actions.append(button('複製',()=>Utils.copyText(r.value)),button('再次產生',()=>{App.navigate('generate');Generator.focusValue(r.value,r.format);}),button('備註／數量',()=>edit(r)),button('刪除',()=>remove([r.id])));if(r.url)actions.append(button('開啟網址',()=>Utils.openUrl(r.url)));a.append(head,value,sub,note,actions);return a;
  }
  function edit(r){editId=r.id;$('editNote').value=r.note;$('editQuantity').value=r.quantity;categories();$('editCategory').value=r.category;$('editDialog').showModal();}
  async function remove(ids){if(!ids.length)return;if(ids.length>1&&!confirm(`刪除選取的 ${ids.length} 筆紀錄？`))return;try{const removed=await Storage.removeHistory(ids);Utils.toast(`已刪除 ${removed.length} 筆`,'',{label:'復原',run:()=>Storage.restoreDeleted(removed).catch(e=>Utils.busyError(e,'復原失敗'))});}catch(e){Utils.busyError(e,'刪除失敗');}}
  return {init,refresh,render};
})();
