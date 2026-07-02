// =========================================================
// おくりっこノート - app.js
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, where,
  onSnapshot, query, serverTimestamp, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ----- Firebase 初期化 -----
const firebaseConfig = {
  apiKey: "AIzaSyB46-_asSRloE4o0sOSMRptfSPH_IsqSVw",
  authDomain: "okuri-note.firebaseapp.com",
  projectId: "okuri-note",
  storageBucket: "okuri-note.firebasestorage.app",
  messagingSenderId: "355615947388",
  appId: "1:355615947388:web:82646ed37f525d41a1e7f9"
};
const EMAIL_DOMAIN = "@okuri-note.app";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
try { enableIndexedDbPersistence(db); } catch (e) { /* 複数タブ等は無視 */ }

// ----- 定数 -----
const CATEGORIES = ["誕生日","クリスマス","入学・卒業祝い","出産祝い","結婚祝い","お中元","お歳暮","帰省土産","お見舞い","その他"];
const PRICE_RANGES = ["〜1,000円","1,000〜3,000円","3,000〜5,000円","5,000〜10,000円","10,000円〜"];
const PERSON_GROUPS = ["家族","親族","友人・知人","ご近所","仕事関係","その他"];

// ----- ピンチ/ダブルタップズーム抑制(iOS対策) -----
document.addEventListener('gesturestart', (e)=> e.preventDefault());
document.addEventListener('gesturechange', (e)=> e.preventDefault());
document.addEventListener('gestureend', (e)=> e.preventDefault());
document.addEventListener('touchmove', (e)=>{ if(e.touches.length > 1) e.preventDefault(); }, {passive:false});
let lastTouchEnd = 0;
document.addEventListener('touchend', (e)=>{
  const now = Date.now();
  if(now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, {passive:false});

// ----- 状態 -----
let allPeople = [];
let allRecords = [];
let allStock = [];
let unsubs = [];
const HOME_FILTER_KEY = 'okurikko_home_filter';
function loadHomeFilterState(){
  try{
    const raw = localStorage.getItem(HOME_FILTER_KEY);
    if(!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  }catch(e){ return {}; }
}
function saveHomeFilterState(){
  try{
    localStorage.setItem(HOME_FILTER_KEY, JSON.stringify({
      homeMode, homeTypeFilter, returnFirst, selectedYear
    }));
  }catch(e){ /* ストレージ不可な環境は無視 */ }
}
const savedHomeFilter = loadHomeFilterState();
let homeMode = savedHomeFilter.homeMode === 'list' ? 'list' : 'year';
let homeTypeFilter = ['all','received','given'].includes(savedHomeFilter.homeTypeFilter) ? savedHomeFilter.homeTypeFilter : 'all';
let selectedYear = savedHomeFilter.selectedYear || null;
let returnFirst = !!savedHomeFilter.returnFirst;
let currentPersonDetailId = null;
let editingRecordId = null;
let recordType = 'received';
let counterpartSelections = [];
let familySelections = [];
let editingPersonId = null;
let editingStockId = null;
let returnConfirmRecordId = null;
let formReturnGivenItems = [];
let linkingStockId = null;
let pendingStockId = null;
let selectedStockId = null;
let currentStockHistoryId = null;

// ----- ユーティリティ -----
function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function normalizeUrl(input){
  const v = (input||'').trim();
  if(!v) return '';
  if(/^https?:\/\//i.test(v)) return v;
  return 'https://' + v;
}
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDate(d){
  if(!d) return '日付未設定';
  const [y,m,day] = d.split('-');
  return `${y}/${Number(m)}/${Number(day)}`;
}
function getPersonName(id){
  const p = allPeople.find(x=>x.id===id);
  return p ? p.name : '(不明)';
}
function namesOf(ids){
  return (ids||[]).map(getPersonName).join('・');
}
function recordInvolves(r, personId){
  return (r.counterpartIds||[]).includes(personId) || (r.familyMemberIds||[]).includes(personId);
}
function emptyStateHTML(title, desc){
  return `<div class="empty-state">
    <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 8 12 3l9 5-9 5-9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>
    </svg>
    <h3 style="margin:0 0 6px;font-size:15px;color:var(--ink);">${esc(title)}</h3>
    <p>${esc(desc)}</p>
  </div>`;
}

// ----- シート開閉 -----
function openSheet(id){
  document.getElementById('backdrop').classList.add('show');
  document.getElementById(id).classList.add('show');
  document.getElementById('app').classList.add('sheet-open');
}
function closeSheet(id){
  document.getElementById(id).classList.remove('show');
  const anyOpen = !!document.querySelector('.sheet.show');
  document.getElementById('backdrop').classList.toggle('show', anyOpen);
  document.getElementById('app').classList.toggle('sheet-open', anyOpen);
}
function syncSheetOpenState(){
  const anyOpen = !!document.querySelector('.sheet.show');
  document.getElementById('backdrop').classList.toggle('show', anyOpen);
  document.getElementById('app').classList.toggle('sheet-open', anyOpen);
}
document.getElementById('backdrop').addEventListener('click', () => {
  ['record-sheet','person-sheet','stock-sheet','return-confirm-sheet','stock-link-sheet','stock-use-confirm-sheet','stock-unuse-confirm-sheet'].forEach(id => document.getElementById(id).classList.remove('show'));
  document.getElementById('backdrop').classList.remove('show');
  syncSheetOpenState();
});

// シートをハンドルの下スワイプで閉じる
document.querySelectorAll('.sheet').forEach(sheet=>{
  const handle = sheet.querySelector('.sheet-handle');
  if(!handle) return;
  let startY = 0, currentY = 0, dragging = false;
  const onStart = (y)=>{ startY = y; currentY = y; dragging = true; sheet.style.transition = 'none'; };
  const onMove = (y)=>{
    if(!dragging) return;
    currentY = y;
    const dy = Math.max(0, currentY - startY);
    sheet.style.transform = `translateX(-50%) translateY(${dy}px)`;
  };
  const onEnd = ()=>{
    if(!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    const dy = currentY - startY;
    if(dy > 90){
      sheet.classList.remove('show');
      document.getElementById('backdrop').classList.remove('show');
      syncSheetOpenState();
    }
  };
  handle.addEventListener('touchstart', (e)=>{ onStart(e.touches[0].clientY); }, {passive:true});
  handle.addEventListener('touchmove', (e)=>{ onMove(e.touches[0].clientY); }, {passive:true});
  handle.addEventListener('touchend', onEnd);
  handle.addEventListener('mousedown', (e)=>{ onStart(e.clientY);
    const mm = (ev)=>onMove(ev.clientY);
    const mu = ()=>{ onEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });
});

// ----- ナビゲーション -----
const VIEW_IDS = ['home','people','person-detail','search','stock','stock-history'];
function switchView(name){
  VIEW_IDS.forEach(v => document.getElementById('view-'+v).classList.toggle('active', v===name));
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view===name || (name==='person-detail' && btn.dataset.view==='people') || (name==='stock-history' && btn.dataset.view==='stock'));
  });
  if(name==='home') renderHome();
  if(name==='people') renderPeople();
  if(name==='search') renderSearchResults();
  if(name==='stock') renderStock();
  updateFab(name);
}
function updateFab(viewName){
  const fab = document.getElementById('fab-add');
  fab.classList.toggle('hidden', !(viewName==='home' || viewName==='stock'));
}
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.backTo));
});
document.getElementById('fab-add').addEventListener('click', () => {
  const active = document.querySelector('#main .view.active');
  const viewName = active ? active.id.replace('view-','') : '';
  if(viewName==='stock') openStockSheet();
  else openRecordSheet();
});

// ----- ホーム(記録一覧) -----
function getYears(records){
  const years = new Set(records.map(r => (r.date||'').slice(0,4)).filter(Boolean));
  return Array.from(years).sort((a,b)=> b.localeCompare(a));
}
function renderHome(){
  saveHomeFilterState();
  document.querySelectorAll('#type-filter-tabs .chip-toggle').forEach(b=>{
    if(b.id === 'sort-return-btn'){
      b.classList.toggle('active', returnFirst);
    } else {
      b.classList.toggle('active', b.dataset.type===homeTypeFilter);
    }
  });
  document.getElementById('filter-toggle-btn').classList.toggle('active', homeTypeFilter!=='all' || returnFirst);

  const list = document.getElementById('home-list');
  const yearTabs = document.getElementById('year-tabs');
  const typeLabel = homeTypeFilter==='received' ? 'もらった' : homeTypeFilter==='given' ? 'あげた' : '';

  let filtered = allRecords;
  if(homeTypeFilter==='received') filtered = filtered.filter(r=>r.type==='received');
  else if(homeTypeFilter==='given') filtered = filtered.filter(r=>r.type==='given');

  const years = getYears(filtered);
  if(homeMode==='year' && (!selectedYear || !years.includes(selectedYear))){
    selectedYear = years[0] || String(new Date().getFullYear());
  }
  const yearsForTabs = years.length ? years : [String(new Date().getFullYear())];
  let tabsHtml = `<button class="year-tab ${homeMode==='list'?'active':''}" data-year="__all__">すべて表示</button>`;
  yearsForTabs.forEach(y=>{
    tabsHtml += `<button class="year-tab ${(homeMode==='year' && y===selectedYear)?'active':''}" data-year="${y}">${y}年</button>`;
  });
  yearTabs.innerHTML = tabsHtml;

  function sortRecords(arr){
    return [...arr].sort((a,b)=>{
      if(returnFirst){
        const aNeeds = (a.type==='received' && a.returnPlanned && !a.returnDone) ? 0 : 1;
        const bNeeds = (b.type==='received' && b.returnPlanned && !b.returnDone) ? 0 : 1;
        if(aNeeds !== bNeeds) return aNeeds - bNeeds;
      }
      return (b.date||'').localeCompare(a.date||'');
    });
  }

  if(homeMode==='list'){
    const records = sortRecords(filtered);
    if(!records.length){
      list.innerHTML = emptyStateHTML(`まだ${typeLabel}記録がありません`,'右下の＋ボタンから記録を追加しましょう。');
      return;
    }
    let html=''; let lastYear=null;
    records.forEach(r=>{
      const y=(r.date||'').slice(0,4)||'未設定';
      if(!returnFirst && y!==lastYear){ html += `<div class="section-label">${esc(y)}年</div>`; lastYear=y; }
      html += renderRecordCard(r);
    });
    list.innerHTML = html;
  } else {
    const records = sortRecords(filtered.filter(r=> (r.date||'').slice(0,4)===selectedYear));
    list.innerHTML = records.length ? records.map(renderRecordCard).join('')
      : emptyStateHTML(`この年の${typeLabel}記録はありません`,'右下の＋ボタンから記録を追加しましょう。');
  }
}
document.querySelectorAll('#type-filter-tabs .chip-toggle').forEach(b=>{
  b.addEventListener('click', () => {
    if(b.id === 'sort-return-btn'){
      returnFirst = !returnFirst;
    } else {
      homeTypeFilter = b.dataset.type;
    }
    renderHome();
  });
});
document.getElementById('filter-toggle-btn').addEventListener('click', () => {
  document.getElementById('type-filter-tabs').classList.toggle('hidden');
});
document.getElementById('year-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.year-tab');
  if(!btn) return;
  if(btn.dataset.year === '__all__'){ homeMode = 'list'; }
  else { homeMode = 'year'; selectedYear = btn.dataset.year; }
  renderHome();
});

function renderRecordCard(r){
  const isReceived = r.type==='received';
  const counterpart = namesOf(r.counterpartIds);
  const family = namesOf(r.familyMemberIds);
  const dirLabel = isReceived ? '↓ もらった' : '↑ あげた';
  const peopleLine = isReceived
    ? `<b>${esc(counterpart)}</b> → ${esc(family)}`
    : `${esc(family)} → <b>${esc(counterpart)}</b>`;
  let returnBadge = '';
  let needsReturn = false;
  if(isReceived && r.returnPlanned){
    if(r.returnDone){
      returnBadge = `<span class="return-badge done">お返し済み</span>`;
    } else {
      returnBadge = `<button type="button" class="return-badge pending" data-action="mark-returned" data-id="${r.id}">お返しした ✓</button>`;
      needsReturn = true;
    }
  }
  const priceHtml = (r.price!=null && r.price!=='') ? `<span class="price">¥${Number(r.price).toLocaleString()}</span>` : '<span></span>';
  let titleHtml = esc(r.itemName || '(品名未設定)');
  if(isReceived && r.returnDone && (r.returnGivenItems||[]).length){
    titleHtml += ` → ${esc(r.returnGivenItems.join('・'))}`;
  }
  let candidatesHtml = '';
  let candToggleBtn = '';
  if(needsReturn){
    const cands = (r.returnCandidates||[]).filter(c=>c && c.name);
    if(cands.length){
      candToggleBtn = `<button type="button" class="cand-toggle-btn" data-action="toggle-candidates" data-id="${r.id}">お返し候補を表示 ▾</button>`;
      candidatesHtml = `<div class="return-candidates-preview hidden" id="cand-preview-${r.id}">` + cands.map(c=>{
        let line = `<span class="rcp-name">${esc(c.name)}</span>`;
        if(c.price!=null && c.price!=='') line += `<span class="rcp-price">¥${Number(c.price).toLocaleString()}</span>`;
        if(c.url) line += `<a class="rcp-link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗</a>`;
        return `<div class="rcp-row">${line}</div>`;
      }).join('') + `</div>`;
    }
  }
  return `
  <div class="tag-card ${isReceived?'':'given'} ${needsReturn?'needs-return':''}" data-id="${r.id}" data-kind="record">
    <div class="tag-card-row">
      <span class="direction-badge">${dirLabel}</span>
      <span class="cat-tag">${esc(r.category||'その他')}</span>
      <span class="tag-date">${formatDate(r.date)}</span>
    </div>
    <div class="tag-card-title">${titleHtml}</div>
    <div class="tag-card-people">${peopleLine}</div>
    <div class="tag-card-bottom">${priceHtml}${candToggleBtn}${returnBadge}</div>
    ${candidatesHtml}
  </div>`;
}

// ----- 人物 -----
function renderPeople(){
  const container = document.getElementById('people-list');
  if(!allPeople.length){
    container.innerHTML = emptyStateHTML('まだ登録がありません','右上の＋ボタンから人物を登録しましょう。');
    return;
  }
  let html = '';
  const groupOrder = [...PERSON_GROUPS];
  groupOrder.forEach(g=>{
    const members = allPeople.filter(p=>(p.group||'その他')===g)
      .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja'));
    if(!members.length) return;
    html += `<div class="section-label">${esc(g)}</div>`;
    html += members.map(renderPersonCard).join('');
  });
  // 既知グループに当てはまらないものを末尾に
  const others = allPeople.filter(p=>!groupOrder.includes(p.group||'その他'))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja'));
  if(others.length){
    html += `<div class="section-label">その他</div>`;
    html += others.map(renderPersonCard).join('');
  }
  container.innerHTML = html;
}
function renderPersonCard(p){
  const initial = (p.name||'?').slice(0,1);
  const count = allRecords.filter(r=>recordInvolves(r, p.id)).length;
  const metaParts = [];
  if(p.note) metaParts.push(esc(p.note));
  metaParts.push(`記録 ${count}件`);
  return `
  <div class="person-card">
    <button class="person-card-main" data-action="open-detail" data-id="${p.id}">
      <span class="avatar">${esc(initial)}</span>
      <div>
        <div class="person-name">${esc(p.name)}</div>
        <div class="person-meta">${metaParts.join(' ・ ')}</div>
      </div>
    </button>
    <button class="btn-small" data-action="edit-person" data-id="${p.id}">編集</button>
  </div>`;
}
function showPersonDetail(id){
  const p = allPeople.find(x=>x.id===id);
  if(!p) return;
  currentPersonDetailId = id;
  document.getElementById('person-detail-name').textContent = p.name;
  switchView('person-detail');
  renderPersonDetailList(id);
}
function renderPersonDetailList(id){
  const records = allRecords.filter(r=>recordInvolves(r, id))
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('person-detail-list').innerHTML = records.length
    ? records.map(renderRecordCard).join('')
    : emptyStateHTML('まだ記録がありません','この人とのやり取りを追加してみましょう。');
}

// ----- 検索 -----
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', () => renderSearchResults());
function renderSearchResults(){
  const q = (searchInput.value||'').trim().toLowerCase();
  const results = document.getElementById('search-results');
  if(!q){ results.innerHTML = `<p class="muted">人の名前・品物名・カテゴリ・メモ・日付(例: 2025-12)で検索できます。</p>`; return; }
  const matched = allRecords.filter(r=>{
    const counterpart = namesOf(r.counterpartIds).toLowerCase();
    const family = namesOf(r.familyMemberIds).toLowerCase();
    const item = (r.itemName||'').toLowerCase();
    const cat = (r.category||'').toLowerCase();
    const memo = (r.memo||'').toLowerCase();
    const date = (r.date||'');
    return counterpart.includes(q) || family.includes(q) || item.includes(q) || cat.includes(q) || memo.includes(q) || date.includes(q);
  }).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  results.innerHTML = matched.length ? matched.map(renderRecordCard).join('')
    : emptyStateHTML('見つかりませんでした','別のキーワードで試してみてください。');
}

// ----- ストック -----
function renderStock(){
  const active = allStock.filter(s=>!s.used);
  const used = allStock.filter(s=>s.used);

  const list = document.getElementById('stock-list');
  if(!active.length){
    list.innerHTML = emptyStateHTML('ストックはまだありません','お返し用の品物を価格帯別に登録しておきましょう。');
  } else {
    let html='';
    PRICE_RANGES.forEach(range=>{
      const items = active.filter(s=>s.priceRange===range);
      if(!items.length) return;
      html += `<div class="section-label">${esc(range)}</div>`;
      items.forEach(s=> html += renderStockCard(s));
    });
    const others = active.filter(s=>!PRICE_RANGES.includes(s.priceRange));
    if(others.length){
      html += `<div class="section-label">その他</div>`;
      others.forEach(s=> html += renderStockCard(s));
    }
    list.innerHTML = html;
  }

  const usedLabel = document.getElementById('stock-used-label');
  const usedList = document.getElementById('stock-used-list');
  if(used.length){
    usedLabel.classList.remove('hidden');
    usedList.innerHTML = used.map(renderUsedStockCard).join('');
  } else {
    usedLabel.classList.add('hidden');
    usedList.innerHTML = '';
  }
}
function renderStockCard(s){
  const histBtn = (s.linkedRecordIds||[]).length
    ? `<div class="stock-used-actions"><button type="button" class="btn-small" data-action="view-stock-history" data-id="${s.id}">あげた実績を見る (${s.linkedRecordIds.length}件)</button></div>`
    : '';
  const urlLink = s.url ? `<a class="stock-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 商品ページを見る</a>` : '';
  return `
  <div class="stock-card">
    <button class="checkbox-circle" data-action="use-stock" data-id="${s.id}">✓</button>
    <div style="flex:1">
      <button class="person-card-main" data-action="edit-stock" data-id="${s.id}" style="padding:0">
        <div>
          <div class="stock-name">${esc(s.itemName)}</div>
          <div class="stock-meta">${esc(s.category||'')}${s.memo ? ' ・ '+esc(s.memo) : ''}</div>
        </div>
      </button>
      ${urlLink}
      ${histBtn}
    </div>
  </div>`;
}
function renderUsedStockCard(s){
  const count = (s.linkedRecordIds||[]).length;
  const histBtn = count
    ? `<button type="button" class="btn-small" data-action="view-stock-history" data-id="${s.id}">あげた実績を見る (${count}件)</button>`
    : '';
  const urlLink = s.url ? `<a class="stock-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">🔗 商品ページを見る</a>` : '';
  return `
  <div class="stock-card stock-used">
    <span class="checkbox-circle checked">✓</span>
    <div style="flex:1">
      <button class="person-card-main" data-action="edit-stock" data-id="${s.id}" style="padding:0">
        <div>
          <div class="stock-name">${esc(s.itemName)}</div>
          <div class="stock-meta">${esc(s.category||'')}${s.memo ? ' ・ '+esc(s.memo) : ''}</div>
        </div>
      </button>
      ${urlLink}
      <div class="stock-used-actions">
        ${histBtn}
        <button type="button" class="btn-small" data-action="link-stock" data-id="${s.id}">あげた記録を選ぶ</button>
        <button type="button" class="btn-small" data-action="unuse-stock" data-id="${s.id}">ストックに戻す</button>
      </div>
    </div>
  </div>`;
}

function openReturnConfirmSheet(recordId){
  let candidates, preChecked = [];
  if(recordId === '__form__'){
    returnConfirmRecordId = '__form__';
    candidates = [1,2,3].map(i=>({
      name: document.getElementById(`record-cand${i}-name`).value.trim(),
      price: document.getElementById(`record-cand${i}-price`).value,
      shop: document.getElementById(`record-cand${i}-shop`).value.trim(),
      url: document.getElementById(`record-cand${i}-url`).value.trim()
    })).filter(c=>c.name);
    preChecked = formReturnGivenItems;
  } else {
    const r = allRecords.find(x=>x.id===recordId);
    if(!r) return;
    returnConfirmRecordId = recordId;
    candidates = (r.returnCandidates||[]).filter(c=>c && c.name);
    preChecked = r.returnGivenItems || [];
  }
  const container = document.getElementById('return-confirm-candidates');
  if(candidates.length){
    container.innerHTML = candidates.map(c=>{
      let detail = '';
      if(c.price!=null && c.price!=='') detail += ` ・ ¥${Number(c.price).toLocaleString()}`;
      if(c.shop) detail += ` ・ ${esc(c.shop)}`;
      const checked = preChecked.includes(c.name) ? 'checked' : '';
      return `<label class="checkbox-row"><input type="checkbox" class="return-confirm-cand" value="${esc(c.name)}" ${checked}> ${esc(c.name)}${detail}</label>`;
    }).join('');
  } else {
    container.innerHTML = `<p class="muted">候補は登録されていません。下の欄に贈ったものを入力してください。</p>`;
  }
  // 候補にない既存の品目をその他欄に表示
  const extra = preChecked.filter(it=>!candidates.some(c=>c.name===it));
  document.getElementById('return-confirm-other').value = extra.join('、');
  document.getElementById('return-confirm-error').textContent = '';
  openSheet('return-confirm-sheet');
}
document.getElementById('return-confirm-save').addEventListener('click', async () => {
  const errEl = document.getElementById('return-confirm-error');
  const items = [...document.querySelectorAll('.return-confirm-cand:checked')].map(el=>el.value);
  const other = document.getElementById('return-confirm-other').value.trim();
  if(other) other.split(/[、,]/).map(s=>s.trim()).filter(Boolean).forEach(s=>items.push(s));
  if(items.length===0){ errEl.textContent = '贈ったものを選択または入力してください。'; return; }
  if(returnConfirmRecordId === '__form__'){
    formReturnGivenItems = items;
    document.getElementById('record-return-done').checked = true;
    closeSheet('return-confirm-sheet');
    return;
  }
  try{
    await updateDoc(doc(db,'records',returnConfirmRecordId), { returnDone: true, returnGivenItems: items });
    closeSheet('return-confirm-sheet');
  }catch(err){ errEl.textContent = '更新に失敗しました: '+err.message; }
});
document.getElementById('return-confirm-cancel').addEventListener('click', () => {
  if(returnConfirmRecordId === '__form__'){
    // フォームの「お返し済み」チェックを元に戻す(品目未確定なら外す)
    document.getElementById('record-return-done').checked = formReturnGivenItems.length > 0;
  }
  closeSheet('return-confirm-sheet');
});

// ----- クリック委譲 -----
document.addEventListener('click', (e) => {
  const markReturned = e.target.closest('[data-action="mark-returned"]');
  if(markReturned){ openReturnConfirmSheet(markReturned.dataset.id); return; }

  const toggleCand = e.target.closest('[data-action="toggle-candidates"]');
  if(toggleCand){
    const preview = document.getElementById(`cand-preview-${toggleCand.dataset.id}`);
    if(preview){
      const willShow = preview.classList.contains('hidden');
      preview.classList.toggle('hidden');
      toggleCand.textContent = willShow ? 'お返し候補を隠す ▴' : 'お返し候補を表示 ▾';
    }
    return;
  }

  const selectLink = e.target.closest('[data-action="select-link-record"]');
  if(selectLink){ linkStockToRecord(selectLink.dataset.id); return; }
  const selectStockItem = e.target.closest('[data-action="select-stock-item"]');
  if(selectStockItem){
    const s = allStock.find(x=>x.id===selectStockItem.dataset.id);
    if(s){
      document.getElementById('record-item').value = s.itemName || '';
      const catSelect = document.getElementById('record-category');
      const customWrap = document.getElementById('record-category-custom-wrap');
      const customInput = document.getElementById('record-category-custom');
      if(s.category && !CATEGORIES.includes(s.category)){
        catSelect.value = 'その他';
        customWrap.classList.remove('hidden');
        customInput.value = s.category;
      } else if(s.category){
        catSelect.value = s.category;
        customWrap.classList.add('hidden');
        customInput.value = '';
      }
      selectedStockId = s.id;
    }
    document.getElementById('record-stock-list').classList.add('hidden');
    return;
  }
  const viewHistory = e.target.closest('[data-action="view-stock-history"]');
  if(viewHistory){ openStockHistory(viewHistory.dataset.id); return; }
  const ppi = e.target.closest('.person-picker-item');
  if(ppi){
    const listEl = ppi.closest('.person-picker-list');
    const isFamily = listEl.id === 'record-family-list';
    const selections = isFamily ? familySelections : counterpartSelections;
    const chipsId = isFamily ? 'record-family-chips' : 'record-counterpart-chips';
    const newRowId = isFamily ? 'record-family-new-row' : 'record-counterpart-new-row';
    if(ppi.dataset.id === '__new__'){
      document.getElementById(newRowId).classList.remove('hidden');
      document.getElementById(newRowId.replace('-row','')).focus();
    } else {
      selections.push({ id: ppi.dataset.id });
      renderChips(chipsId, selections, isFamily);
    }
    listEl.classList.add('hidden');
    populateRecordPersonSelects();
    return;
  }

  const chipRemove = e.target.closest('.chip-remove');
  if(chipRemove){
    const idx = Number(chipRemove.dataset.idx);
    if(chipRemove.dataset.list === 'record-counterpart-chips'){
      counterpartSelections.splice(idx,1);
      renderChips('record-counterpart-chips', counterpartSelections, false);
    } else {
      familySelections.splice(idx,1);
      renderChips('record-family-chips', familySelections, true);
    }
    populateRecordPersonSelects();
    return;
  }
  const openDetail = e.target.closest('[data-action="open-detail"]');
  if(openDetail){ showPersonDetail(openDetail.dataset.id); return; }
  const editPerson = e.target.closest('[data-action="edit-person"]');
  if(editPerson){ openPersonSheet(allPeople.find(p=>p.id===editPerson.dataset.id)); return; }
  const useStock = e.target.closest('[data-action="use-stock"]');
  if(useStock){ handleUseStock(useStock.dataset.id); return; }
  const unuseStock = e.target.closest('[data-action="unuse-stock"]');
  if(unuseStock){ handleUnuseStock(unuseStock.dataset.id); return; }
  const linkStock = e.target.closest('[data-action="link-stock"]');
  if(linkStock){ openStockLinkSheet(linkStock.dataset.id); return; }
  const editStock = e.target.closest('[data-action="edit-stock"]');
  if(editStock){ openStockSheet(allStock.find(s=>s.id===editStock.dataset.id)); return; }
  const recordCard = e.target.closest('.tag-card[data-kind="record"]');
  if(recordCard){ openRecordSheet(allRecords.find(r=>r.id===recordCard.dataset.id)); return; }
});

// ----- 記録フォーム -----
function setRecordType(type){
  recordType = type;
  document.querySelectorAll('#record-type-toggle button').forEach(b=> b.classList.toggle('active', b.dataset.type===type));
  const isReceived = type==='received';
  document.getElementById('record-counterpart-label').textContent = isReceived ? 'だれから' : 'だれに';
  document.getElementById('record-family-label').textContent = isReceived ? 'だれに' : 'だれから';
  document.getElementById('record-return-section').classList.toggle('hidden', !isReceived);
  document.getElementById('record-stock-picker-wrap').classList.toggle('hidden', isReceived);
  document.getElementById('record-stock-list').classList.add('hidden');
  if(typeof populateRecordPersonSelects === 'function') populateRecordPersonSelects();
}
document.querySelectorAll('#record-type-toggle button').forEach(b=>{
  b.addEventListener('click', () => setRecordType(b.dataset.type));
});
function renderChips(containerId, selections, isFamily){
  document.getElementById(containerId).innerHTML = selections.map((s, idx) => {
    const name = s.id ? getPersonName(s.id) : `${s.newName}(新規)`;
    return `<span class="chip ${isFamily?'family':''}">${esc(name)}<button type="button" class="chip-remove" data-list="${containerId}" data-idx="${idx}">×</button></span>`;
  }).join('');
}
function personPickerItemsHtml(excludeIds, familyOnly){
  const groupRank = (p)=>{ const i = PERSON_GROUPS.indexOf(p.group||'その他'); return i<0 ? PERSON_GROUPS.length : i; };
  let pool = allPeople.filter(p=>!excludeIds.includes(p.id));
  if(familyOnly) pool = pool.filter(p=>(p.group||'')==='家族');
  const sorted = pool.sort((a,b)=>{
    const gr = groupRank(a) - groupRank(b);
    if(gr !== 0) return gr;
    return (a.name||'').localeCompare(b.name||'','ja');
  });
  let html = sorted.map(p=>{
    const note = [p.group, p.note].filter(Boolean).join(' ・ ');
    return `<button type="button" class="person-picker-item" data-id="${p.id}"><span class="ppi-name">${esc(p.name)}</span>${note?`<span class="ppi-note">${esc(note)}</span>`:''}</button>`;
  }).join('');
  if(familyOnly && !sorted.length){
    html = `<p class="muted" style="padding:11px 14px">「家族」グループに登録された人がいません。人物タブで家族を登録してください。</p>`;
  }
  html += `<button type="button" class="person-picker-item ppi-new" data-id="__new__"><span class="ppi-name">＋ 新しい人を追加</span></button>`;
  return html;
}
function populateRecordPersonSelects(){
  const counterpartIds = counterpartSelections.filter(s=>s.id).map(s=>s.id);
  const familyIds = familySelections.filter(s=>s.id).map(s=>s.id);
  // 「もらった」のとき家族リスト(だれに)は家族グループのみ。「あげた」のときは制限なし。
  const familyOnly = recordType === 'received';
  document.getElementById('record-counterpart-list').innerHTML = personPickerItemsHtml(counterpartIds, false);
  document.getElementById('record-family-list').innerHTML = personPickerItemsHtml(familyIds, familyOnly);
}
document.getElementById('record-counterpart-picker').addEventListener('click', ()=>{
  document.getElementById('record-family-list').classList.add('hidden');
  document.getElementById('record-counterpart-list').classList.toggle('hidden');
});
document.getElementById('record-family-picker').addEventListener('click', ()=>{
  document.getElementById('record-counterpart-list').classList.add('hidden');
  document.getElementById('record-family-list').classList.toggle('hidden');
});
function populateStockPicker(){
  const active = allStock.filter(s=>!s.used).sort((a,b)=>(a.itemName||'').localeCompare(b.itemName||'','ja'));
  const container = document.getElementById('record-stock-list');
  container.innerHTML = active.length
    ? active.map(s=>{
        const note = [s.category, s.priceRange].filter(Boolean).join(' ・ ');
        return `<button type="button" class="person-picker-item" data-action="select-stock-item" data-id="${s.id}"><span class="ppi-name">${esc(s.itemName)}</span>${note?`<span class="ppi-note">${esc(note)}</span>`:''}</button>`;
      }).join('')
    : `<p class="muted">ストックがありません。</p>`;
}
document.getElementById('record-stock-picker').addEventListener('click', ()=>{
  populateStockPicker();
  document.getElementById('record-stock-list').classList.toggle('hidden');
});
function addNewPersonChip(selections, chipsId, newRowId, inputId, isFamily){
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if(!name) return;
  selections.push({ newName: name });
  input.value = '';
  document.getElementById(newRowId).classList.add('hidden');
  renderChips(chipsId, selections, isFamily);
}
document.getElementById('record-counterpart-new-add').addEventListener('click', () => {
  addNewPersonChip(counterpartSelections, 'record-counterpart-chips', 'record-counterpart-new-row', 'record-counterpart-new', false);
});
document.getElementById('record-family-new-add').addEventListener('click', () => {
  addNewPersonChip(familySelections, 'record-family-chips', 'record-family-new-row', 'record-family-new', true);
});
function openRecordSheet(record=null){
  editingRecordId = record ? record.id : null;
  selectedStockId = null;
  setRecordType(record ? record.type : 'received');
  document.getElementById('record-sheet-title').textContent = record ? '記録を編集' : '記録を追加';
  document.getElementById('record-date').value = record ? record.date : todayStr();
  counterpartSelections = (record && record.counterpartIds) ? record.counterpartIds.map(id=>({id})) : [];
  familySelections = (record && record.familyMemberIds) ? record.familyMemberIds.map(id=>({id})) : [];
  populateRecordPersonSelects();
  renderChips('record-counterpart-chips', counterpartSelections, false);
  renderChips('record-family-chips', familySelections, true);
  document.getElementById('record-counterpart-list').classList.add('hidden');
  document.getElementById('record-family-list').classList.add('hidden');
  document.getElementById('record-counterpart-new').value = '';
  document.getElementById('record-counterpart-new-row').classList.add('hidden');
  document.getElementById('record-family-new').value = '';
  document.getElementById('record-family-new-row').classList.add('hidden');
  document.getElementById('record-item').value = record ? (record.itemName||'') : '';

  const catSelect = document.getElementById('record-category');
  const customWrap = document.getElementById('record-category-custom-wrap');
  const customInput = document.getElementById('record-category-custom');
  if(record && record.category && !CATEGORIES.includes(record.category)){
    catSelect.value = 'その他';
    customWrap.classList.remove('hidden');
    customInput.value = record.category;
  } else {
    catSelect.value = record ? record.category : CATEGORIES[0];
    customWrap.classList.add('hidden');
    customInput.value = '';
  }

  document.getElementById('record-price').value = (record && record.price!=null) ? record.price : '';
  document.getElementById('record-memo').value = record ? (record.memo||'') : '';
  for(let i=1;i<=3;i++){
    const c = (record && record.returnCandidates && record.returnCandidates[i-1]) || {};
    document.getElementById(`record-cand${i}-name`).value = c.name || '';
    document.getElementById(`record-cand${i}-price`).value = (c.price!=null) ? c.price : '';
    document.getElementById(`record-cand${i}-shop`).value = c.shop || '';
    document.getElementById(`record-cand${i}-url`).value = c.url || '';
  }
  document.getElementById('record-return-date').value = record ? (record.returnDate||'') : '';
  document.getElementById('record-return-done').checked = record ? !!record.returnDone : false;
  formReturnGivenItems = (record && record.returnGivenItems) ? [...record.returnGivenItems] : [];
  const returnPlanned = record ? !!record.returnPlanned : false;
  document.getElementById('record-return-planned').checked = returnPlanned;
  document.getElementById('record-return-details').classList.toggle('hidden', !returnPlanned);

  document.getElementById('record-delete').classList.toggle('hidden', !record);
  document.getElementById('record-error').textContent = '';
  openSheet('record-sheet');
}
document.getElementById('record-category').addEventListener('change', (e)=>{
  document.getElementById('record-category-custom-wrap').classList.toggle('hidden', e.target.value!=='その他');
});
document.getElementById('record-return-planned').addEventListener('change', (e)=>{
  document.getElementById('record-return-details').classList.toggle('hidden', !e.target.checked);
});
document.getElementById('record-return-done').addEventListener('change', (e)=>{
  if(e.target.checked){
    openReturnConfirmSheet('__form__');
  } else {
    formReturnGivenItems = [];
  }
});
async function resolveSelections(selections){
  const ids = [];
  for(const s of selections){
    if(s.id){ ids.push(s.id); }
    else {
      const ref = await addDoc(collection(db,'people'), { name: s.newName, group: 'その他', note: '', userId: auth.currentUser.uid, createdAt: serverTimestamp() });
      ids.push(ref.id);
    }
  }
  return ids;
}
document.getElementById('record-save').addEventListener('click', async () => {
  const errEl = document.getElementById('record-error');
  const date = document.getElementById('record-date').value;
  const itemName = document.getElementById('record-item').value.trim();
  let category = document.getElementById('record-category').value;
  if(category==='その他'){
    const custom = document.getElementById('record-category-custom').value.trim();
    if(custom) category = custom;
  }
  const priceRaw = document.getElementById('record-price').value;
  const price = priceRaw==='' ? null : Number(priceRaw);

  if(!date || !itemName){
    errEl.textContent = '日付・品物は必須です。';
    return;
  }
  if(counterpartSelections.length===0){
    errEl.textContent = '相手を1人以上追加してください。';
    return;
  }
  if(familySelections.length===0){
    errEl.textContent = '家族を1人以上追加してください。';
    return;
  }

  let counterpartIds, familyMemberIds;
  try{
    counterpartIds = await resolveSelections(counterpartSelections);
    familyMemberIds = await resolveSelections(familySelections);
  }catch(err){ errEl.textContent = '人物の登録に失敗しました: '+err.message; return; }

  const data = { type: recordType, date, counterpartIds, familyMemberIds, itemName, category, price,
    memo: document.getElementById('record-memo').value.trim() };

  const existingRecord = editingRecordId ? allRecords.find(r=>r.id===editingRecordId) : null;

  if(recordType==='received' && document.getElementById('record-return-planned').checked){
    data.returnPlanned = true;
    data.returnCandidates = [1,2,3].map(i=>{
      const name = document.getElementById(`record-cand${i}-name`).value.trim();
      const pRaw = document.getElementById(`record-cand${i}-price`).value;
      const shop = document.getElementById(`record-cand${i}-shop`).value.trim();
      const url = normalizeUrl(document.getElementById(`record-cand${i}-url`).value);
      return { name, price: pRaw==='' ? null : Number(pRaw), shop, url };
    });
    data.returnDate = document.getElementById('record-return-date').value || null;
    data.returnDone = document.getElementById('record-return-done').checked;
    data.returnGivenItems = data.returnDone ? formReturnGivenItems : [];
  } else {
    data.returnPlanned = false;
    data.returnCandidates = [];
    data.returnDate = null;
    data.returnDone = false;
    data.returnGivenItems = [];
  }

  try{
    let recordId;
    if(editingRecordId){
      await updateDoc(doc(db,'records',editingRecordId), data);
      recordId = editingRecordId;
    } else {
      data.createdAt = serverTimestamp();
      data.userId = auth.currentUser.uid;
      const ref = await addDoc(collection(db,'records'), data);
      recordId = ref.id;
    }
    if(selectedStockId){
      const s = allStock.find(x=>x.id===selectedStockId);
      if(s){
        const ids = new Set(s.linkedRecordIds||[]);
        ids.add(recordId);
        await updateDoc(doc(db,'stock',selectedStockId), { used: true, linkedRecordIds: [...ids] });
      }
    }
    closeSheet('record-sheet');
  }catch(err){ errEl.textContent = '保存に失敗しました: '+err.message; }
});
document.getElementById('record-delete').addEventListener('click', async () => {
  if(!editingRecordId) return;
  if(!confirm('この記録を削除しますか?')) return;
  await deleteDoc(doc(db,'records',editingRecordId));
  closeSheet('record-sheet');
});
document.getElementById('record-cancel').addEventListener('click', () => closeSheet('record-sheet'));

// ----- 人物フォーム -----
function openPersonSheet(person=null){
  editingPersonId = person ? person.id : null;
  document.getElementById('person-sheet-title').textContent = person ? '人物を編集' : '人物を追加';
  document.getElementById('person-name').value = person ? person.name : '';
  document.getElementById('person-group').value = (person && person.group && PERSON_GROUPS.includes(person.group)) ? person.group : PERSON_GROUPS[0];
  document.getElementById('person-note').value = person ? (person.note||'') : '';
  document.getElementById('person-error').textContent = '';
  document.getElementById('person-delete').classList.toggle('hidden', !person);
  openSheet('person-sheet');
}
document.getElementById('add-person-btn').addEventListener('click', () => openPersonSheet());
document.getElementById('person-save').addEventListener('click', async () => {
  const name = document.getElementById('person-name').value.trim();
  const errEl = document.getElementById('person-error');
  if(!name){ errEl.textContent = '名前を入力してください。'; return; }
  const data = {
    name,
    group: document.getElementById('person-group').value,
    note: document.getElementById('person-note').value.trim()
  };
  try{
    if(editingPersonId){
      await updateDoc(doc(db,'people',editingPersonId), data);
    } else {
      data.createdAt = serverTimestamp();
      data.userId = auth.currentUser.uid;
      await addDoc(collection(db,'people'), data);
    }
    closeSheet('person-sheet');
  }catch(err){ errEl.textContent = '保存に失敗しました: '+err.message; }
});
document.getElementById('person-delete').addEventListener('click', async () => {
  if(!editingPersonId) return;
  const used = allRecords.some(r=>recordInvolves(r, editingPersonId));
  const msg = used ? 'この人物は記録に使われています。削除すると記録側の表示が「(不明)」になります。削除しますか?' : 'この人物を削除しますか?';
  if(!confirm(msg)) return;
  await deleteDoc(doc(db,'people',editingPersonId));
  closeSheet('person-sheet');
});
document.getElementById('person-cancel').addEventListener('click', () => closeSheet('person-sheet'));

// ----- ストックフォーム -----
function openStockSheet(stock=null){
  editingStockId = stock ? stock.id : null;
  document.getElementById('stock-sheet-title').textContent = stock ? 'ストックを編集' : 'ストックを追加';
  document.getElementById('stock-item').value = stock ? stock.itemName : '';
  document.getElementById('stock-price-range').value = stock ? stock.priceRange : PRICE_RANGES[0];

  const catSelect = document.getElementById('stock-category');
  const customWrap = document.getElementById('stock-category-custom-wrap');
  const customInput = document.getElementById('stock-category-custom');
  const cat = stock ? (stock.category||'') : '';
  if(cat && !CATEGORIES.includes(cat)){
    catSelect.value = 'その他';
    customWrap.classList.remove('hidden');
    customInput.value = cat;
  } else {
    catSelect.value = cat;
    customWrap.classList.add('hidden');
    customInput.value = '';
  }

  document.getElementById('stock-memo').value = stock ? (stock.memo||'') : '';
  document.getElementById('stock-url').value = stock ? (stock.url||'') : '';
  document.getElementById('stock-used').checked = stock ? !!stock.used : false;
  document.getElementById('stock-error').textContent = '';
  document.getElementById('stock-delete').classList.toggle('hidden', !stock);
  openSheet('stock-sheet');
}
document.getElementById('stock-category').addEventListener('change', (e)=>{
  document.getElementById('stock-category-custom-wrap').classList.toggle('hidden', e.target.value!=='その他');
});
document.getElementById('stock-url').addEventListener('blur', (e)=>{
  e.target.value = normalizeUrl(e.target.value);
});
[1,2,3].forEach(i=>{
  document.getElementById(`record-cand${i}-url`).addEventListener('blur', (e)=>{
    e.target.value = normalizeUrl(e.target.value);
  });
});
document.getElementById('stock-save').addEventListener('click', async () => {
  const itemName = document.getElementById('stock-item').value.trim();
  const errEl = document.getElementById('stock-error');
  if(!itemName){ errEl.textContent = '品物名を入力してください。'; return; }
  let category = document.getElementById('stock-category').value;
  if(category==='その他'){
    const custom = document.getElementById('stock-category-custom').value.trim();
    if(custom) category = custom;
  }
  const data = {
    itemName,
    priceRange: document.getElementById('stock-price-range').value,
    category,
    memo: document.getElementById('stock-memo').value.trim(),
    url: normalizeUrl(document.getElementById('stock-url').value),
    used: document.getElementById('stock-used').checked,
  };
  try{
    if(editingStockId){
      await updateDoc(doc(db,'stock',editingStockId), data);
    } else {
      data.linkedRecordIds = [];
      data.createdAt = serverTimestamp();
      data.userId = auth.currentUser.uid;
      await addDoc(collection(db,'stock'), data);
    }
    closeSheet('stock-sheet');
  }catch(err){ errEl.textContent = '保存に失敗しました: '+err.message; }
});
document.getElementById('stock-delete').addEventListener('click', async () => {
  if(!editingStockId) return;
  if(!confirm('このストックを削除しますか?')) return;
  await deleteDoc(doc(db,'stock',editingStockId));
  closeSheet('stock-sheet');
});
document.getElementById('stock-cancel').addEventListener('click', () => closeSheet('stock-sheet'));
function handleUseStock(id){
  const s = allStock.find(x=>x.id===id);
  if(!s) return;
  pendingStockId = id;
  document.getElementById('stock-use-confirm-title').textContent = `「${s.itemName}」を使用済みにしますか?`;
  openSheet('stock-use-confirm-sheet');
}
document.getElementById('stock-use-confirm-move').addEventListener('click', async () => {
  try{ await updateDoc(doc(db,'stock',pendingStockId), { used: true }); }catch(e){ /* noop */ }
  closeSheet('stock-use-confirm-sheet');
});
document.getElementById('stock-use-confirm-keep').addEventListener('click', async () => {
  const s = allStock.find(x=>x.id===pendingStockId);
  if(s){
    const { id: _oldId, ...rest } = s;
    try{ await addDoc(collection(db,'stock'), { ...rest, used: true, linkedRecordIds: [], createdAt: serverTimestamp() }); }catch(e){ /* noop */ }
  }
  closeSheet('stock-use-confirm-sheet');
});
document.getElementById('stock-use-confirm-cancel').addEventListener('click', () => closeSheet('stock-use-confirm-sheet'));
function handleUnuseStock(id){
  pendingStockId = id;
  openSheet('stock-unuse-confirm-sheet');
}
document.getElementById('stock-unuse-confirm-yes').addEventListener('click', async () => {
  try{ await updateDoc(doc(db,'stock',pendingStockId), { used: false }); }catch(e){ /* noop */ }
  closeSheet('stock-unuse-confirm-sheet');
});
document.getElementById('stock-unuse-confirm-no').addEventListener('click', () => closeSheet('stock-unuse-confirm-sheet'));
function openStockLinkSheet(stockId){
  linkingStockId = stockId;
  const s = allStock.find(x=>x.id===stockId);
  const linked = new Set((s && s.linkedRecordIds) || []);
  const given = allRecords.filter(r=>r.type==='given' && !linked.has(r.id)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const container = document.getElementById('stock-link-list');
  container.innerHTML = given.length ? given.map(r=>`
    <button type="button" class="person-picker-item" data-action="select-link-record" data-id="${r.id}">
      <span class="ppi-name">${esc(r.itemName||'(品名未設定)')}</span>
      <span class="ppi-note">${formatDate(r.date)} ・ ${esc(namesOf(r.counterpartIds))}</span>
    </button>`).join('') : `<p class="muted">追加できるあげた記録がありません。</p>`;
  openSheet('stock-link-sheet');
}
async function linkStockToRecord(recordId){
  const s = allStock.find(x=>x.id===linkingStockId);
  if(s){
    const ids = new Set(s.linkedRecordIds||[]);
    ids.add(recordId);
    try{ await updateDoc(doc(db,'stock',linkingStockId), { linkedRecordIds: [...ids] }); }catch(e){ /* noop */ }
  }
  closeSheet('stock-link-sheet');
}
document.getElementById('stock-link-cancel').addEventListener('click', () => closeSheet('stock-link-sheet'));
function openStockHistory(stockId){
  const s = allStock.find(x=>x.id===stockId);
  if(!s) return;
  currentStockHistoryId = stockId;
  document.getElementById('stock-history-title').textContent = `${s.itemName||'(品名未設定)'} のあげた実績`;
  const ids = s.linkedRecordIds || [];
  const records = ids.map(id=>allRecords.find(r=>r.id===id)).filter(Boolean)
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const list = document.getElementById('stock-history-list');
  list.innerHTML = records.length ? records.map(renderRecordCard).join('')
    : emptyStateHTML('まだ実績がありません','「あげた記録を選ぶ」から記録を紐づけられます。');
  switchView('stock-history');
}

// ----- セレクト初期化 -----
(function initSelects(){
  document.getElementById('record-category').innerHTML = CATEGORIES.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.getElementById('stock-category').innerHTML = `<option value="">(なし)</option>` + CATEGORIES.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.getElementById('stock-price-range').innerHTML = PRICE_RANGES.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  document.getElementById('person-group').innerHTML = PERSON_GROUPS.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');
})();

// ----- データ購読 -----
function attachListeners(){
  const uid = auth.currentUser.uid;
  unsubs.push(onSnapshot(query(collection(db,'people'), where('userId','==',uid)), (snap)=>{
    allPeople = snap.docs.map(d=>({id:d.id, ...d.data()}));
    refreshCurrentView();
  }));
  unsubs.push(onSnapshot(query(collection(db,'records'), where('userId','==',uid)), (snap)=>{
    allRecords = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    refreshCurrentView();
  }));
  unsubs.push(onSnapshot(query(collection(db,'stock'), where('userId','==',uid)), (snap)=>{
    allStock = snap.docs.map(d=>({id:d.id, ...d.data()}));
    refreshCurrentView();
  }));
}
function detachListeners(){
  unsubs.forEach(u=>u());
  unsubs = [];
  allPeople = []; allRecords = []; allStock = [];
}
function refreshCurrentView(){
  const active = document.querySelector('#main .view.active');
  if(!active) return;
  const id = active.id.replace('view-','');
  if(id==='home') renderHome();
  else if(id==='people') renderPeople();
  else if(id==='person-detail' && currentPersonDetailId){
    const p = allPeople.find(x=>x.id===currentPersonDetailId);
    if(p) document.getElementById('person-detail-name').textContent = p.name;
    renderPersonDetailList(currentPersonDetailId);
  }
  else if(id==='search') renderSearchResults();
  else if(id==='stock') renderStock();
}

// ----- 認証 -----
let loginMode = 'signin';
document.getElementById('login-mode-toggle').addEventListener('click', () => {
  loginMode = loginMode === 'signin' ? 'signup' : 'signin';
  document.getElementById('login-submit').textContent = loginMode === 'signin' ? 'ログイン' : '新規登録';
  document.getElementById('login-mode-toggle').textContent = loginMode === 'signin' ? '新規登録はこちら' : 'ログインはこちら';
  document.getElementById('login-pass').autocomplete = loginMode === 'signin' ? 'current-password' : 'new-password';
  document.getElementById('signup-disclaimer').classList.toggle('hidden', loginMode !== 'signup');
  document.getElementById('signup-agree').checked = false;
  document.getElementById('login-error').textContent = '';
});
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('login-id').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if(!/^[a-zA-Z0-9._-]+$/.test(id)){
    errEl.textContent = 'IDは半角英数字(._-)で入力してください。';
    return;
  }
  if(loginMode === 'signup'){
    if(pass.length < 6){
      errEl.textContent = 'パスワードは6文字以上で入力してください。';
      return;
    }
    if(!document.getElementById('signup-agree').checked){
      errEl.textContent = '免責事項への同意が必要です。';
      return;
    }
  }
  try{
    if(loginMode === 'signin'){
      await signInWithEmailAndPassword(auth, id + EMAIL_DOMAIN, pass);
    } else {
      await createUserWithEmailAndPassword(auth, id + EMAIL_DOMAIN, pass);
    }
  }catch(err){
    if(loginMode === 'signin'){
      errEl.textContent = 'IDまたはパスワードが正しくありません。';
    } else if(err.code === 'auth/email-already-in-use'){
      errEl.textContent = 'そのIDはすでに使われています。別のIDをお試しください。';
    } else if(err.code === 'auth/weak-password'){
      errEl.textContent = 'パスワードは6文字以上で入力してください。';
    } else {
      errEl.textContent = '登録に失敗しました: ' + err.message;
    }
  }
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  if(!confirm('ログアウトしますか?')) return;
  await signOut(auth);
});

// ----- CSV書き出し -----
function csvEscape(val){
  const s = (val===null || val===undefined) ? '' : String(val);
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function downloadCsv(filename, rows){
  const csv = rows.map(row=>row.map(csvEscape).join(',')).join('\r\n');
  const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF'+csv);
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  try{ a.click(); }catch(e){ /* ダウンロードがブロックされる環境では何もしない */ }
  document.body.removeChild(a);
}
function candStr(c){
  if(!c || !c.name) return '';
  let s = c.name;
  if(c.price!=null && c.price!=='') s += `(¥${Number(c.price).toLocaleString()})`;
  if(c.shop) s += ` @${c.shop}`;
  if(c.url) s += ` [${c.url}]`;
  return s;
}
function exportAllCsv(){
  const recordRows = [['種類','日付','相手','家族','品物','カテゴリ','価格','メモ','お返し予定','お返し候補1','お返し候補2','お返し候補3','お返し予定日','お返し済み','お返ししたもの']];
  allRecords.forEach(r=>{
    const cands = r.returnCandidates||[];
    recordRows.push([
      r.type==='received' ? 'もらった' : 'あげた',
      r.date||'',
      namesOf(r.counterpartIds),
      namesOf(r.familyMemberIds),
      r.itemName||'',
      r.category||'',
      (r.price!=null && r.price!=='') ? r.price : '',
      r.memo||'',
      r.returnPlanned ? 'はい' : 'いいえ',
      candStr(cands[0]), candStr(cands[1]), candStr(cands[2]),
      r.returnDate||'',
      r.returnDone ? 'はい' : 'いいえ',
      (r.returnGivenItems||[]).join('・')
    ]);
  });

  const peopleRows = [['名前','グループ','備考']];
  allPeople.forEach(p=> peopleRows.push([p.name||'', p.group||'', p.note||'']));

  const stockRows = [['品物名','価格帯','カテゴリ','メモ','URL','使用済み','あげた実績件数','あげた実績']];
  allStock.forEach(s=>{
    const histories = (s.linkedRecordIds||[]).map(id=>{
      const r = allRecords.find(x=>x.id===id);
      return r ? `${r.date||''} ${namesOf(r.counterpartIds)}` : '';
    }).filter(Boolean);
    stockRows.push([
      s.itemName||'', s.priceRange||'', s.category||'', s.memo||'', s.url||'',
      s.used ? 'はい' : 'いいえ', histories.length, histories.join(' / ')
    ]);
  });

  downloadCsv('okurikko_records.csv', recordRows);
  setTimeout(()=>downloadCsv('okurikko_people.csv', peopleRows), 400);
  setTimeout(()=>downloadCsv('okurikko_stock.csv', stockRows), 800);
}
document.getElementById('export-csv-btn').addEventListener('click', exportAllCsv);

// ----- スプラッシュ -----
let splashDone = false;
let firstAuthHandled = false;
setTimeout(() => { splashDone = true; tryReveal(); }, 1600);

function hideSplash(){
  const el = document.getElementById('view-splash');
  el.classList.add('splash-hide');
  setTimeout(()=> el.classList.remove('active'), 420);
}
function tryReveal(){
  if(!splashDone || !firstAuthHandled) return;
  hideSplash();
}

onAuthStateChanged(auth, (user) => {
  if(user){
    document.getElementById('app').classList.add('logged-in');
    document.getElementById('view-login').classList.remove('active');
    document.getElementById('main').classList.add('active');
    attachListeners();
    switchView('home');
  } else {
    detachListeners();
    document.getElementById('app').classList.remove('logged-in');
    document.getElementById('main').classList.remove('active');
    document.getElementById('login-pass').value = '';
    document.getElementById('view-login').classList.add('active');
  }
  if(!firstAuthHandled){
    firstAuthHandled = true;
    tryReveal();
  }
});

// ----- サービスワーカー登録 -----
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}
