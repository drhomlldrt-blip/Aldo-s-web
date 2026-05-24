import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, Timestamp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

// ===== CONFIGURACIÓN FIREBASE =====
const firebaseConfig = {
  apiKey: "AIzaSyAXDYH2Fxc3-3k1zU-YVvFFqPpdvL4wlOY",
  authDomain: "gym-control-40a40.firebaseapp.com",
  projectId: "gym-control-40a40",
  storageBucket: "gym-control-40a40.firebasestorage.app",
  messagingSenderId: "715804426202",
  appId: "1:715804426202:web:e73704036043427062cae3"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ===== USUARIOS FIJOS (supervisor no cambia) =====
const USERS_FIJOS = {
  'admin': { pass:'gym2024', name:'Supervisor General', role:'supervisor', suc:'ALL' },
};

// ===== ÁREAS DEL CHECKLIST =====
const AREAS = [
  { id:'espejos', name:'Espejos y vidrios', items:[
    'Espejos sala principal sin manchas',
    'Espejos vestuarios limpios',
    'Vidrios de entrada sin huellas',
    'Espejos baños sin salpicaduras',
  ]},
  { id:'pisos', name:'Pisos', items:[
    'Piso de goma (área de pesas) limpio',
    'Piso flotante sala de aeróbicos',
    'Piso de recepción barrido y lustrado',
    'Pasillos sin residuos',
  ]},
  { id:'vestidores', name:'Vestidores', items:[
    'Bancas limpias y secas',
    'Casilleros sin residuos externos',
    'Suelo del vestidor limpio',
    'Espejos de vestidor sin manchas',
  ]},
  { id:'banos', name:'Baños y duchas', items:[
    'Inodoros desinfectados',
    'Lavabos limpios sin sarro',
    'Duchas sin hongos ni sarro',
    'Suelo de baños seco y limpio',
    'Papel higiénico y jabón abastecidos',
    'Desagüe de duchas sin obstrucción',
  ]},
  { id:'maquinas', name:'Máquinas y equipos', items:[
    'Trotadoras limpias (pantalla, banda, manillas)',
    'Spinning: asientos y manubrios desinfectados',
    'Máquinas de pesas sin sudor',
    'Mancuernas ordenadas y limpias',
    'Colchonetas enrolladas y limpias',
  ]},
  { id:'aerobicos', name:'Sala de aeróbicos', items:[
    'Espejo frontal de sala limpio',
    'Piso de sala barrido',
    'Ventiladores y aires sin polvo',
    'Equipo de sonido externo limpio',
  ]},
  { id:'recepcion', name:'Área de recepción', items:[
    'Mostrador limpio y ordenado',
    'Sillas de espera limpias',
    'Entrada y alfombra de bienvenida limpia',
    'Papeleras vaciadas',
  ]},
];

// ===== ESTADO =====
let currentSuc  = '';
let currentUser = null;
let reportPrio  = 'normal';
let reportItem  = '';
let checkState  = {};
let reportes    = [];
let usuarios    = [];

// ===== HELPERS =====
function showLoading(){ document.getElementById('loading').classList.add('show'); }
function hideLoading(){ document.getElementById('loading').classList.remove('show'); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
window.closeModal = closeModal;

function fechaHoy(){ return new Date().toISOString().split('T')[0]; }
function mesActual(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

// ===== NAVEGACIÓN =====
window.selectSuc = function(suc){
  currentSuc = suc;
  document.getElementById('login-suc-name').textContent = 'Sucursal ' + suc;
  document.getElementById('inp-user').value = '';
  document.getElementById('inp-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  show('screen-login');
  setTimeout(()=>document.getElementById('inp-user').focus(), 300);
};

window.goHome = function(){ show('screen-home'); };

// ===== LOGIN =====
window.doLogin = async function(){
  const u   = document.getElementById('inp-user').value.trim().toLowerCase();
  const p   = document.getElementById('inp-pass').value;
  const err = document.getElementById('login-err');

  showLoading();

  // Verificar usuario fijo (admin)
  if(USERS_FIJOS[u]){
    const user = USERS_FIJOS[u];
    if(user.pass !== p){ hideLoading(); err.textContent='Usuario o contraseña incorrectos'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    await loadDash();
    return;
  }

  // Verificar usuario en Firebase
  try {
    const docRef = doc(db, 'usuarios', u);
    const docSnap = await getDoc(docRef);
    if(!docSnap.exists()){ hideLoading(); err.textContent='Usuario o contraseña incorrectos'; err.style.display='block'; return; }
    const user = docSnap.data();
    if(user.pass !== p){ hideLoading(); err.textContent='Usuario o contraseña incorrectos'; err.style.display='block'; return; }
    if(user.suc !== currentSuc){ hideLoading(); err.textContent='No tienes acceso a esta sucursal'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    await loadDash();
  } catch(e){
    hideLoading(); err.textContent='Error de conexión. Intenta de nuevo.'; err.style.display='block';
  }
};

window.doLogout = function(){ currentUser=null; checkState={}; reportes=[]; usuarios=[]; goHome(); };

// ===== DASHBOARD =====
async function loadDash(){
  document.getElementById('dash-suc').textContent  = 'Sucursal ' + currentSuc;
  document.getElementById('dash-user').textContent = currentUser.name;
  const roleLabels = { supervisor:'Supervisor', recepcionista:'Recepcionista', limpieza:'Limpieza' };
  document.getElementById('dash-role').textContent = roleLabels[currentUser.role];

  let tabs = [];
  if(currentUser.role === 'supervisor'){
    tabs = [
      {id:'panel-limpieza', label:'Checklist'},
      {id:'panel-reportes', label:'Reportes'},
      {id:'panel-historial', label:'Historial'},
      {id:'panel-admin', label:'Usuarios'},
    ];
  } else if(currentUser.role === 'recepcionista'){
    tabs = [
      {id:'panel-limpieza', label:'Checklist'},
      {id:'panel-reportes', label:'Reportes'},
    ];
  } else if(currentUser.role === 'limpieza'){
    tabs = [
      {id:'panel-reportes', label:'Mis tareas'},
    ];
  }

  ['panel-limpieza','panel-reportes','panel-historial','panel-admin'].forEach(p=>document.getElementById(p).classList.remove('active'));

  const tabsEl = document.getElementById('tabs-container');
  tabsEl.innerHTML = '';
  tabs.forEach((t,i)=>{
    const el = document.createElement('div');
    el.className = 'tab'+(i===0?' active':'');
    el.textContent = t.label;
    el.onclick = ()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
      ['panel-limpieza','panel-reportes','panel-historial','panel-admin'].forEach(p=>document.getElementById(p).classList.remove('active'));
      document.getElementById(t.id).classList.add('active');
    };
    tabsEl.appendChild(el);
  });

  if(tabs.length) document.getElementById(tabs[0].id).classList.add('active');

  await Promise.all([
    cargarChecklist(),
    cargarReportes(),
    cargarUsuarios(),
  ]);

  hideLoading();
  show('screen-dash');
}

// ===== CHECKLIST (persiste por sucursal + día) =====
async function cargarChecklist(){
  const docId = `${currentSuc}_${fechaHoy()}`;
  try {
    const docSnap = await getDoc(doc(db, 'checklists', docId));
    checkState = docSnap.exists() ? docSnap.data().estado || {} : {};
  } catch(e){ checkState = {}; }
  renderChecklist();
}

async function guardarChecklist(){
  const docId = `${currentSuc}_${fechaHoy()}`;
  await setDoc(doc(db, 'checklists', docId), {
    sucursal: currentSuc,
    fecha: fechaHoy(),
    mes: mesActual(),
    estado: checkState,
    ultimaActualizacion: new Date().toISOString(),
    actualizadoPor: currentUser.name,
  });
}

function renderChecklist(){
  const cont = document.getElementById('checklist-container');
  cont.innerHTML = '';
  AREAS.forEach(area=>{
    const estado = checkState[area.id] || [];
    const done = estado.filter(Boolean).length;
    const total = area.items.length;
    const badgeCls = done===total?'badge-ok':done>0?'badge-pend':'badge-crit';
    const badgeTxt = done===total?'Completo':`${done}/${total}`;
    const block = document.createElement('div');
    block.className = 'area-block';
    block.innerHTML = `
      <div class="area-header" onclick="toggleArea('${area.id}')">
        <span class="area-name">${area.name}</span>
        <span class="area-badge ${badgeCls}">${badgeTxt}</span>
        <span class="chevron" id="chev-${area.id}">▼</span>
      </div>
      <div class="area-items" id="items-${area.id}">
        ${area.items.map((item,i)=>`
          <div class="check-item">
            <input type="checkbox" ${estado[i]?'checked':''} onchange="toggleCheck('${area.id}',${i},this.checked)">
            <div>
              <div class="check-label ${estado[i]?'done':''}">${item}</div>
              ${currentUser.role!=='limpieza'?`<button class="btn-report" onclick="openReport('${item}','${area.name}')">Reportar problema</button>`:''}
            </div>
          </div>`).join('')}
      </div>`;
    cont.appendChild(block);
  });
}

window.toggleArea = function(id){
  const el=document.getElementById('items-'+id); const chev=document.getElementById('chev-'+id);
  el.classList.toggle('open'); chev.textContent=el.classList.contains('open')?'▲':'▼';
};

window.toggleCheck = async function(areaId, i, val){
  if(!checkState[areaId]) checkState[areaId]=[];
  checkState[areaId][i] = val;
  renderChecklist();
  const el=document.getElementById('items-'+areaId);
  if(el){ el.classList.add('open'); document.getElementById('chev-'+areaId).textContent='▲'; }
  await guardarChecklist();
  showToast(val ? 'Ítem completado ✓' : 'Ítem desmarcado');
};

// ===== REPORTES (persisten en Firebase) =====
async function cargarReportes(){
  try {
    const q = query(collection(db,'reportes'), where('sucursal','==',currentSuc), where('mes','==',mesActual()), orderBy('timestamp','desc'));
    const snap = await getDocs(q);
    reportes = snap.docs.map(d=>({id:d.id, ...d.data()}));
  } catch(e){ reportes=[]; }
  renderReportes();
}

window.openReport = function(item, area){
  reportItem = `${area} — ${item}`;
  reportPrio = 'normal';
  document.getElementById('modal-item-name').textContent = reportItem;
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-report').classList.add('open');
};

window.setPrio = function(p){
  reportPrio = p;
  ['normal','media','alta'].forEach(x=>{ document.getElementById('prio-'+x).style.opacity = x===p?'1':'0.5'; });
};

window.sendReport = async function(){
  const desc = document.getElementById('modal-desc').value.trim();
  const now  = new Date();
  showLoading();
  try {
    const newReport = {
      item: reportItem,
      desc: desc || 'Sin descripción adicional',
      prio: reportPrio,
      estado: reportPrio==='alta'?'prioridad':'pendiente',
      hora: now.toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'}),
      fecha: fechaHoy(),
      mes: mesActual(),
      sucursal: currentSuc,
      creadoPor: currentUser.name,
      timestamp: Timestamp.fromDate(now),
    };
    const ref = doc(collection(db,'reportes'));
    await setDoc(ref, newReport);
    closeModal('modal-report');
    await cargarReportes();
    showToast('Reporte enviado correctamente');
  } catch(e){ showToast('Error al enviar reporte'); }
  hideLoading();
};

function renderReportes(){
  const cont = document.getElementById('reportes-container');
  if(!reportes.length){ cont.innerHTML='<div class="empty">Sin reportes activos este mes</div>'; return; }
  const estadoMap   = {pendiente:'s-pend',atendido:'s-done',prioridad:'s-prio',diferido:'s-def'};
  const estadoLabel = {pendiente:'Pendiente',atendido:'Atendido ✓',prioridad:'Prioritario',diferido:'Diferido'};
  const canAct = currentUser.role==='limpieza'||currentUser.role==='supervisor';
  cont.innerHTML = reportes.map(r=>`
    <div class="report-card">
      <div class="report-top">
        <div class="report-area">${r.item}</div>
        <span class="status-pill ${estadoMap[r.estado]}">${estadoLabel[r.estado]}</span>
      </div>
      <div class="report-desc">${r.desc} <span style="font-size:10px"> · ${r.hora} · ${r.fecha} · por ${r.creadoPor}</span></div>
      ${canAct&&r.estado!=='atendido'?`<div class="report-actions">
        <button class="btn-sm btn-atend" onclick="actReport('${r.id}','atendido')">✓ Atendido</button>
        ${currentUser.role==='supervisor'?`
        <button class="btn-sm btn-prio" onclick="actReport('${r.id}','prioridad')">Prioridad</button>
        <button class="btn-sm btn-defer" onclick="actReport('${r.id}','diferido')">Diferir</button>`:''}
      </div>`:''}
    </div>`).join('');
}

window.actReport = async function(id, estado){
  showLoading();
  try {
    await updateDoc(doc(db,'reportes',id),{ estado, actualizadoPor: currentUser.name, actualizadoEn: new Date().toISOString() });
    await cargarReportes();
    const msgs={atendido:'Marcado como atendido',prioridad:'Marcado como prioritario',diferido:'Diferido al siguiente turno'};
    showToast(msgs[estado]);
  } catch(e){ showToast('Error al actualizar'); }
  hideLoading();
};

// ===== HISTORIAL =====
async function cargarHistorial(){
  try {
    const q = query(collection(db,'reportes'), where('sucursal','==',currentSuc), where('mes','==',mesActual()), orderBy('timestamp','desc'));
    const snap = await getDocs(q);
    const todos = snap.docs.map(d=>d.data());
    const cont = document.getElementById('historial-container');
    if(!todos.length){ cont.innerHTML='<div class="empty">Sin historial este mes</div>'; return; }
    cont.innerHTML = todos.map(r=>`
      <div class="hist-card">
        <div class="hist-date">${r.fecha} · ${r.hora} · ${r.sucursal}</div>
        <div class="hist-item">${r.item}</div>
        <div class="hist-detail">Estado: ${r.estado} · Por: ${r.creadoPor}</div>
      </div>`).join('');
  } catch(e){ document.getElementById('historial-container').innerHTML='<div class="empty">Error al cargar historial</div>'; }
}

// ===== USUARIOS (Firebase) =====
async function cargarUsuarios(){
  try {
    const q = query(collection(db,'usuarios'), where('suc','==',currentSuc));
    const snap = await getDocs(q);
    usuarios = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ usuarios=[]; }
  renderAdmin();
}

function renderAdmin(){
  const cont = document.getElementById('admin-users');
  document.getElementById('add-user-suc').textContent = currentSuc;
  const roleColor={supervisor:'color:#e8c14a',recepcionista:'color:#4ae8a0',limpieza:'color:#e8904a'};

  // Usuario fijo admin
  let html = `<div class="user-row">
    <div class="user-info"><div class="user-name">Supervisor General</div><div class="user-detail">@admin · <span style="color:#e8c14a">supervisor</span></div></div>
  </div>`;

  html += usuarios.map(u=>`
    <div class="user-row">
      <div class="user-info">
        <div class="user-name">${u.name}</div>
        <div class="user-detail">@${u.id} · <span style="${roleColor[u.role]}">${u.role}</span></div>
      </div>
      <button class="btn-del" onclick="eliminarUsuario('${u.id}')">Dar de baja</button>
    </div>`).join('');

  cont.innerHTML = html;
}

window.showAddUserModal = function(){
  document.getElementById('new-name').value='';
  document.getElementById('new-user').value='';
  document.getElementById('new-pass').value='';
  document.getElementById('modal-add-user').classList.add('open');
};

window.saveNewUser = async function(){
  const name = document.getElementById('new-name').value.trim();
  const user = document.getElementById('new-user').value.trim().toLowerCase();
  const pass = document.getElementById('new-pass').value;
  const role = document.getElementById('new-role').value;
  if(!name||!user||!pass){ showToast('Completa todos los campos'); return; }
  showLoading();
  try {
    await setDoc(doc(db,'usuarios',user),{ name, pass, role, suc:currentSuc, creadoEn: new Date().toISOString() });
    closeModal('modal-add-user');
    await cargarUsuarios();
    showToast('Usuario agregado correctamente');
  } catch(e){ showToast('Error al guardar usuario'); }
  hideLoading();
};

window.eliminarUsuario = async function(id){
  if(!confirm(`¿Dar de baja al usuario @${id}?`)) return;
  showLoading();
  try {
    await deleteDoc(doc(db,'usuarios',id));
    await cargarUsuarios();
    showToast('Usuario dado de baja');
  } catch(e){ showToast('Error al eliminar usuario'); }
  hideLoading();
};

// Enter en login
document.getElementById('inp-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

// Cargar historial al cambiar de tab
document.addEventListener('click', e=>{
  if(e.target.classList.contains('tab') && e.target.textContent==='Historial') cargarHistorial();
});
