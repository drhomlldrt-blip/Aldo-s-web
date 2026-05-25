// ============================================================
// GYM CONTROL — LÓGICA PRINCIPAL v3
// ============================================================
import { db } from './firebase.js';
import { USERS_FIJOS } from './usuarios.js';
import { TAREAS_MANANA, TAREAS_TARDE, TAREAS_NOCHE, AREAS_REVISION } from './data/satelite.js';
import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

// ============================================================
// TAREAS POR SUCURSAL
// Solo SATELITE tiene tareas por ahora.
// Para agregar otra sucursal: importa su archivo y agrégala aquí.
// ============================================================
const TAREAS_POR_SUCURSAL = {
  'SATELITE': { manana: TAREAS_MANANA, tarde: TAREAS_TARDE, noche: TAREAS_NOCHE },
};
const AREAS_POR_SUCURSAL = {
  'SATELITE': AREAS_REVISION,
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let currentSuc      = '';
let currentUser     = null;
let reportes        = [];
let usuarios        = [];
let turnoVista      = 'manana'; // turno que está viendo el supervisor

// ============================================================
// HELPERS
// ============================================================
const fechaHoy  = () => new Date().toISOString().split('T')[0];
const mesActual = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
const horaActual= () => new Date().toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});
const tsAhora   = () => Date.now();
const turnoLabel= t => ({manana:'Turno mañana',tarde:'Turno tarde',noche:'Turno noche',apoyo:'Turno apoyo'}[t]||t);

function detectarTurno(){
  const h = new Date().getHours();
  if(h>=7  && h<14) return 'manana';
  if(h>=14 && h<19) return 'tarde';
  return 'noche';
}

function showLoading(){ document.getElementById('loading').classList.add('show'); }
function hideLoading(){ document.getElementById('loading').classList.remove('show'); }
function showToast(msg,tipo='ok'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+tipo;
  setTimeout(()=>t.classList.remove('show'),3000);
}
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
window.closeModal = id => document.getElementById(id).classList.remove('open');

// ============================================================
// HOME — SELECCIÓN DE SUCURSAL
// Si el supervisor ya está logueado, cambia directo sin login
// ============================================================
window.selectSuc = function(suc){
  currentSuc = suc;
  // Supervisor: cambiar sucursal sin re-login
  if(currentUser && currentUser.role === 'supervisor'){
    document.getElementById('dash-suc').textContent = currentSuc;
    showLoading();
    Promise.all([renderChecklist(), cargarReportes()]).then(()=>{
      if(currentUser.role==='supervisor') cargarAlertas();
      hideLoading();
      show('screen-dash');
      showToast('Sucursal cambiada: ' + suc);
    });
    return;
  }
  // Resto del personal: ir a login
  document.getElementById('login-suc-name').textContent = suc;
  document.getElementById('inp-user').value = '';
  document.getElementById('inp-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  show('screen-login');
  setTimeout(()=>document.getElementById('inp-user').focus(), 200);
};

window.goHome = () => show('screen-home');

// Botón para cambiar sucursal desde el dashboard (supervisor)
window.cambiarSucursal = () => show('screen-home');

// ============================================================
// LOGIN
// ============================================================
window.doLogin = async function(){
  const u   = document.getElementById('inp-user').value.trim().toLowerCase();
  const p   = document.getElementById('inp-pass').value;
  const err = document.getElementById('login-err');
  err.style.display = 'none';
  showLoading();

  if(USERS_FIJOS[u]){
    const user = USERS_FIJOS[u];
    if(user.pass !== p){ hideLoading(); err.textContent='Contraseña incorrecta'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    await loadDash(); return;
  }

  try {
    const snap = await getDoc(doc(db,'usuarios',u));
    if(!snap.exists()){ hideLoading(); err.textContent='Usuario no encontrado'; err.style.display='block'; return; }
    const user = snap.data();
    if(user.pass !== p){ hideLoading(); err.textContent='Contraseña incorrecta'; err.style.display='block'; return; }
    if(user.suc !== currentSuc){ hideLoading(); err.textContent='No tienes acceso a esta sucursal'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    await loadDash();
  } catch(e){ hideLoading(); err.textContent='Error de conexión'; err.style.display='block'; }
};

window.doLogout = function(){ currentUser=null; reportes=[]; usuarios=[]; goHome(); };
document.getElementById('inp-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

// ============================================================
// DASHBOARD
// ============================================================
async function loadDash(){
  document.getElementById('dash-suc').textContent  = currentSuc;
  document.getElementById('dash-user').textContent = currentUser.name;
  document.getElementById('dash-role').textContent = {supervisor:'Supervisor',recepcionista:'Recepcionista',limpieza:'Limpieza'}[currentUser.role]||currentUser.role;

  // Botón cambiar sucursal solo para supervisor
  const btnCambiar = document.getElementById('btn-cambiar-suc');
  if(btnCambiar) btnCambiar.style.display = currentUser.role==='supervisor' ? 'inline-block' : 'none';

  // Botón tarea especial
  const btnSup = document.getElementById('btn-sup-reporte');
  if(btnSup) btnSup.style.display = currentUser.role==='supervisor' ? 'block' : 'none';

  let tabs = [];
  if(currentUser.role==='supervisor'){
    tabs=[
      {id:'panel-checklist', label:'Checklist'},
      {id:'panel-reportes',  label:'Reportes'},
      {id:'panel-historial', label:'Historial'},
      {id:'panel-alertas',   label:'Alertas'},
      {id:'panel-admin',     label:'Usuarios'},
    ];
  } else if(currentUser.role==='recepcionista'){
    tabs=[
      {id:'panel-revision',  label:'Revisión áreas'},
      {id:'panel-reportes',  label:'Mis reportes'},
    ];
  } else if(currentUser.role==='limpieza'){
    tabs=[
      {id:'panel-checklist', label:'Mis tareas'},
      {id:'panel-reportes',  label:'Reportes a atender'},
    ];
  }

  const allPanels=['panel-checklist','panel-reportes','panel-revision','panel-historial','panel-alertas','panel-admin'];
  allPanels.forEach(p=>document.getElementById(p).classList.remove('active'));

  const tabsEl=document.getElementById('tabs-container');
  tabsEl.innerHTML='';
  tabs.forEach((t,i)=>{
    const el=document.createElement('div');
    el.className='tab'+(i===0?' active':'');
    el.textContent=t.label;
    el.dataset.panel=t.id;
    el.onclick=()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
      allPanels.forEach(p=>document.getElementById(p).classList.remove('active'));
      document.getElementById(t.id).classList.add('active');
      if(t.id==='panel-historial') cargarHistorial();
      if(t.id==='panel-alertas')   cargarAlertas();
      if(t.id==='panel-admin')     cargarUsuarios();
    };
    tabsEl.appendChild(el);
  });

  if(tabs.length) document.getElementById(tabs[0].id).classList.add('active');

  turnoVista = currentUser.turno || detectarTurno();

  await Promise.all([renderChecklist(), cargarReportes()]);
  if(currentUser.role==='recepcionista') renderRevision();
  if(currentUser.role==='supervisor')    cargarAlertas();
  hideLoading();
  show('screen-dash');
}

// ============================================================
// CHECKLIST — con selector de turno para supervisor
// ============================================================
function getTareasTurno(turno){
  const tareas = TAREAS_POR_SUCURSAL[currentSuc];
  if(!tareas) return [];
  return tareas[turno] || [];
}

async function renderChecklist(){
  const cont = document.getElementById('checklist-container');
  if(!cont) return;

  const esSupervisor = currentUser.role === 'supervisor';
  const tieneTareas  = !!TAREAS_POR_SUCURSAL[currentSuc];

  // Sucursal sin tareas configuradas
  if(!tieneTareas){
    cont.innerHTML=`<div class="empty">
      <div style="font-size:32px;margin-bottom:12px">🚧</div>
      <div>Las tareas de esta sucursal aún no están configuradas.</div>
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">Próximamente se agregarán.</div>
    </div>`;
    return;
  }

  // Selector de turno (supervisor ve los 3 turnos, limpieza ve el suyo)
  let selectorHTML = '';
  if(esSupervisor){
    selectorHTML = `
    <div class="turno-selector">
      <button class="btn-turno ${turnoVista==='manana'?'active':''}" onclick="cambiarTurnoVista('manana')">Turno mañana</button>
      <button class="btn-turno ${turnoVista==='tarde'?'active':''}"  onclick="cambiarTurnoVista('tarde')">Turno tarde</button>
      <button class="btn-turno ${turnoVista==='noche'?'active':''}"  onclick="cambiarTurnoVista('noche')">Turno noche</button>
    </div>`;
  }

  const turno = esSupervisor ? turnoVista : (currentUser.turno || detectarTurno());
  const lista = getTareasTurno(turno);
  const docId = `${currentSuc}_${turno}_${fechaHoy()}`;

  let estado = {};
  try {
    const snap = await getDoc(doc(db,'checklists',docId));
    if(snap.exists()) estado = snap.data().tareas || {};
  } catch(e){}

  const turnoInfo = {manana:'Turno mañana — 07:00 a 11:00',tarde:'Turno tarde — 14:30 a 18:30',noche:'Turno noche — 18:30 a 22:30'};

  let html = selectorHTML + `<div class="section-title">${turnoInfo[turno]||''} <span></span></div>`;

  lista.forEach(bloque=>{
    const hechas = bloque.tareas.filter((_,i)=>estado[`${bloque.id}_${i}`]?.hecho).length;
    const total  = bloque.tareas.length;
    const pct    = Math.round(hechas/total*100);
    const badgeCls = hechas===total?'badge-ok':hechas>0?'badge-pend':'badge-crit';

    html += `
    <div class="area-block">
      <div class="area-header" onclick="toggleBloque('${bloque.id}')">
        <div style="flex:1">
          <div class="area-name">${bloque.area}</div>
          <div class="area-hora">${bloque.hora}</div>
        </div>
        <span class="area-badge ${badgeCls}">${hechas}/${total}</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="chevron" id="chev-${bloque.id}">▼</span>
      </div>
      <div class="area-items" id="items-${bloque.id}">
        ${bloque.tareas.map((tarea,i)=>{
          const key  = `${bloque.id}_${i}`;
          const dat  = estado[key]||{};
          const hecho= dat.hecho||false;
          const canCheck = currentUser.role==='limpieza' || currentUser.role==='supervisor';
          return `
          <div class="check-item ${hecho?'item-done':''}">
            <input type="checkbox" ${hecho?'checked':''} ${!canCheck?'disabled':''}
              onchange="marcarTarea('${bloque.id}',${i},this.checked,'${docId}','${turno}')">
            <div class="check-content">
              <div class="check-label ${hecho?'done':''}">${tarea}</div>
              ${hecho?`<div class="check-meta">✓ ${dat.hora} — ${dat.quien}</div>`:''}
              ${hecho&&dat.obs?`<div class="check-obs">${dat.obs}</div>`:''}
              ${canCheck&&!hecho?`
                <div class="obs-row">
                  <input type="text" class="obs-input" id="obs-${key}" placeholder="Observación (opcional)">
                </div>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  cont.innerHTML = html;
}

window.cambiarTurnoVista = async function(turno){
  turnoVista = turno;
  showLoading();
  await renderChecklist();
  hideLoading();
};

window.toggleBloque = function(id){
  const el=document.getElementById('items-'+id);
  const chev=document.getElementById('chev-'+id);
  if(!el) return;
  el.classList.toggle('open');
  chev.textContent=el.classList.contains('open')?'▲':'▼';
};

window.marcarTarea = async function(bloqueId,i,hecho,docId,turno){
  const key = `${bloqueId}_${i}`;
  const obs = document.getElementById('obs-'+key)?.value.trim() || '';
  showLoading();
  try {
    const snap = await getDoc(doc(db,'checklists',docId));
    const data = snap.exists()?snap.data():{};
    const tareas = data.tareas||{};

    if(hecho){
      tareas[key]={ hecho:true, hora:horaActual(), quien:currentUser.name, obs, timestamp:tsAhora() };
    } else {
      delete tareas[key];
    }

    await setDoc(doc(db,'checklists',docId),{
      sucursal:currentSuc, turno, fecha:fechaHoy(), mes:mesActual(),
      tareas, actualizadoPor:currentUser.name, actualizadoEn:new Date().toISOString(),
    });

    await renderChecklist();
    const el=document.getElementById('items-'+bloqueId);
    if(el){ el.classList.add('open'); document.getElementById('chev-'+bloqueId).textContent='▲'; }
    showToast(hecho?'Tarea marcada como hecha ✓':'Tarea desmarcada');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ============================================================
// REVISIÓN DE ÁREAS — RECEPCIONISTA
// ============================================================
function renderRevision(){
  const cont=document.getElementById('revision-container');
  if(!cont) return;
  const areas = AREAS_POR_SUCURSAL[currentSuc] || [];
  if(!areas.length){ cont.innerHTML='<div class="empty">Sin áreas configuradas para esta sucursal</div>'; return; }
  cont.innerHTML = areas.map(area=>`
    <div class="area-block">
      <div class="area-header-rev">
        <div class="area-name">${area.nombre}</div>
        <div class="rev-btns">
          <button class="btn-rev btn-bien" onclick="reportarAreaBien('${area.id}','${area.nombre}')">✓ Bien</button>
          <button class="btn-rev btn-falta" onclick="abrirReporteArea('${area.id}','${area.nombre}')">⚠ Falta atención</button>
        </div>
      </div>
    </div>`).join('');
}

let reporteAreaActual=null;

window.abrirReporteArea=function(areaId,areaNombre){
  reporteAreaActual={id:areaId,nombre:areaNombre};
  document.getElementById('modal-area-nombre').textContent=areaNombre;
  document.getElementById('modal-desc-rev').value='';
  document.getElementById('modal-prio-rev').value='normal';
  document.getElementById('modal-revision').classList.add('open');
};

window.reportarAreaBien=async function(areaId,areaNombre){
  showLoading();
  try {
    await setDoc(doc(collection(db,'reportes')),{
      areaId, area:areaNombre, estado:'bien', nivelRevision:'bien',
      desc:'Área en buen estado', sucursal:currentSuc,
      fecha:fechaHoy(), mes:mesActual(), creadoPor:currentUser.name,
      rol:'recepcionista', timestamp:tsAhora(),
    });
    showToast(`${areaNombre} — marcada como bien ✓`);
    await cargarReportes();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

window.enviarReporteArea=async function(){
  if(!reporteAreaActual) return;
  const desc=document.getElementById('modal-desc-rev').value.trim();
  const prio=document.getElementById('modal-prio-rev').value;
  showLoading();
  try {
    await setDoc(doc(collection(db,'reportes')),{
      areaId:reporteAreaActual.id, area:reporteAreaActual.nombre,
      estado:'pendiente', nivelRevision:'falta', prio,
      desc:desc||'Requiere atención', sucursal:currentSuc,
      fecha:fechaHoy(), mes:mesActual(), creadoPor:currentUser.name,
      rol:'recepcionista', timestamp:tsAhora(),
      alertaEn: tsAhora()+(24*60*60*1000),
    });
    closeModal('modal-revision');
    showToast('Reporte enviado al personal de limpieza');
    await cargarReportes();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// Supervisor asigna tarea especial
window.abrirReporteSupervisor=function(){
  document.getElementById('modal-task-desc').value='';
  document.getElementById('modal-task-area').value='';
  document.getElementById('modal-task-prio').value='normal';
  document.getElementById('modal-tarea-sup').classList.add('open');
};

window.enviarTareaSupervisor=async function(){
  const desc=document.getElementById('modal-task-desc').value.trim();
  const area=document.getElementById('modal-task-area').value.trim();
  const prio=document.getElementById('modal-task-prio').value;
  if(!desc){ showToast('Escribe la descripción','err'); return; }
  showLoading();
  try {
    await setDoc(doc(collection(db,'reportes')),{
      area:area||'General', estado:'pendiente', nivelRevision:'supervisor', prio,
      desc, sucursal:currentSuc, fecha:fechaHoy(), mes:mesActual(),
      creadoPor:currentUser.name, rol:'supervisor', timestamp:tsAhora(),
      alertaEn:tsAhora()+(24*60*60*1000),
    });
    closeModal('modal-tarea-sup');
    showToast('Tarea asignada al personal de limpieza');
    await cargarReportes();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ============================================================
// REPORTES
// ============================================================
async function cargarReportes(){
  try {
    const q=query(collection(db,'reportes'),where('sucursal','==',currentSuc));
    const snap=await getDocs(q);
    const ahora=tsAhora();
    reportes=snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(r=>{
        if(r.nivelRevision==='bien') return false;
        if(r.estado==='atendido'&&r.expiraEn&&ahora>r.expiraEn) return false;
        return true;
      })
      .sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  } catch(e){ reportes=[]; }
  renderReportes();
}

function renderReportes(){
  const cont=document.getElementById('reportes-container');
  if(!cont) return;
  let lista=reportes;
  if(currentUser.role==='limpieza') lista=reportes.filter(r=>r.estado!=='atendido');

  if(!lista.length){ cont.innerHTML='<div class="empty">Sin reportes activos</div>'; return; }

  const ahora=tsAhora();
  const estadoMap={pendiente:'s-pend',atendido:'s-done',alerta:'s-alerta'};
  const estadoLabel={pendiente:'Pendiente',atendido:'Atendido ✓',alerta:'⚠ Sin atender'};
  const prioMap={alta:'prio-alta',media:'prio-media'};

  cont.innerHTML=lista.map(r=>{
    const enAlerta=r.estado==='pendiente'&&r.alertaEn&&ahora>r.alertaEn;
    const estadoReal=enAlerta?'alerta':r.estado;
    const canAtender=currentUser.role==='limpieza'||currentUser.role==='supervisor';
    const canPrio=currentUser.role==='supervisor';
    return `
    <div class="report-card ${prioMap[r.prio]||''} ${enAlerta?'en-alerta':''}">
      <div class="report-top">
        <div style="flex:1">
          <div class="report-area">${r.area}</div>
          <div class="report-fecha">${r.fecha} · por ${r.creadoPor}</div>
        </div>
        <span class="status-pill ${estadoMap[estadoReal]}">${estadoLabel[estadoReal]}</span>
      </div>
      ${r.desc?`<div class="report-desc">${r.desc}</div>`:''}
      ${enAlerta?`<div class="alerta-msg">⚠ No fue atendido en 24 horas</div>`:''}
      ${r.estado==='atendido'?`<div class="check-meta">Atendido por ${r.atendidoPor} a las ${r.atendidoEn}</div>`:''}
      <div class="report-actions">
        ${canAtender&&r.estado!=='atendido'?`<button class="btn-sm btn-atend" onclick="atenderReporte('${r.id}')">✓ Marcar atendido</button>`:''}
        ${canPrio&&r.estado!=='atendido'?`
          <button class="btn-sm btn-prio" onclick="cambiarPrio('${r.id}','alta')">🔴 Urgente</button>
          <button class="btn-sm btn-defer" onclick="cambiarPrio('${r.id}','diferido')">Diferir</button>`:''}
        ${currentUser.role==='recepcionista'&&r.estado!=='atendido'&&!enAlerta?`
          <button class="btn-sm btn-noatend" onclick="reportarNoAtendido('${r.id}')">No fue atendido</button>`:''}
      </div>
    </div>`;
  }).join('');
}

window.atenderReporte=async function(id){
  showLoading();
  try {
    await updateDoc(doc(db,'reportes',id),{
      estado:'atendido', atendidoPor:currentUser.name,
      atendidoEn:horaActual(), atendidoFecha:fechaHoy(),
      expiraEn:tsAhora()+(48*60*60*1000),
    });
    await cargarReportes();
    showToast('Marcado como atendido ✓');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

window.cambiarPrio=async function(id,val){
  showLoading();
  try {
    await updateDoc(doc(db,'reportes',id),{prio:val,editadoPor:currentUser.name});
    await cargarReportes();
    showToast('Prioridad actualizada');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

window.reportarNoAtendido=async function(id){
  showLoading();
  try {
    await updateDoc(doc(db,'reportes',id),{
      estado:'alerta', noAtendidoPor:currentUser.name, noAtendidoEn:horaActual(),
    });
    await cargarReportes();
    showToast('Reportado como no atendido — supervisor notificado');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ============================================================
// HISTORIAL
// ============================================================
async function cargarHistorial(){
  const cont=document.getElementById('historial-container');
  if(!cont) return;
  showLoading();
  try {
    const q=query(collection(db,'checklists'),where('sucursal','==',currentSuc),where('mes','==',mesActual()));
    const snap=await getDocs(q);
    const docs=snap.docs.map(d=>d.data()).sort((a,b)=>b.fecha.localeCompare(a.fecha));
    if(!docs.length){ cont.innerHTML='<div class="empty">Sin historial este mes</div>'; hideLoading(); return; }
    let html='';
    docs.forEach(d=>{
      const tareas=d.tareas||{};
      const hechas=Object.entries(tareas).filter(([,t])=>t.hecho);
      if(!hechas.length) return;
      html+=`<div class="hist-card">
        <div class="hist-fecha">${d.fecha} · ${turnoLabel(d.turno)}</div>
        ${hechas.map(([,t])=>`
          <div class="hist-tarea">✓ ${t.hora} — ${t.quien}
            ${t.obs?`<span class="hist-obs"> · Obs: ${t.obs}</span>`:''}
          </div>`).join('')}
      </div>`;
    });
    cont.innerHTML=html||'<div class="empty">Sin actividad registrada</div>';
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; }
  hideLoading();
}

// ============================================================
// ALERTAS
// ============================================================
async function cargarAlertas(){
  const cont=document.getElementById('alertas-container');
  if(!cont) return;
  const ahora=tsAhora();
  const alertas=reportes.filter(r=>
    r.estado==='alerta'||(r.estado==='pendiente'&&r.alertaEn&&ahora>r.alertaEn)
  );
  const tabAlertas=document.querySelector('[data-panel="panel-alertas"]');
  if(tabAlertas){
    tabAlertas.textContent=alertas.length>0?`Alertas (${alertas.length})`:'Alertas';
    tabAlertas.style.background=alertas.length>0?'#e84a4a':'';
    tabAlertas.style.color=alertas.length>0?'#fff':'';
  }
  if(!alertas.length){ cont.innerHTML='<div class="empty">Sin alertas ✓</div>'; return; }
  cont.innerHTML=`
    <div class="alerta-banner">⚠ ${alertas.length} tarea${alertas.length>1?'s':''} sin atender en más de 24 horas</div>
    ${alertas.map(r=>`
    <div class="report-card en-alerta">
      <div class="report-top">
        <div><div class="report-area">${r.area}</div><div class="report-fecha">${r.fecha} · ${r.creadoPor}</div></div>
        <span class="status-pill s-alerta">Sin atender</span>
      </div>
      ${r.desc?`<div class="report-desc">${r.desc}</div>`:''}
      <div class="report-actions">
        <button class="btn-sm btn-prio" onclick="cambiarPrio('${r.id}','alta')">🔴 Urgente</button>
        <button class="btn-sm btn-atend" onclick="atenderReporte('${r.id}')">✓ Atendido</button>
      </div>
    </div>`).join('')}`;
}

// ============================================================
// ADMIN — USUARIOS
// ============================================================
async function cargarUsuarios(){
  const cont=document.getElementById('admin-users');
  if(!cont) return;
  try {
    const q=query(collection(db,'usuarios'),where('suc','==',currentSuc));
    const snap=await getDocs(q);
    usuarios=snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ usuarios=[]; }
  const roleColor={supervisor:'color:#e8c14a',recepcionista:'color:#4ae8a0',limpieza:'color:#e8904a'};
  let html=`<div class="user-row">
    <div class="user-info"><div class="user-name">Supervisor General</div>
    <div class="user-detail">@admin · <span style="color:#e8c14a">supervisor</span></div></div>
  </div>`;
  html+=usuarios.map(u=>`
    <div class="user-row">
      <div class="user-info">
        <div class="user-name">${u.name}</div>
        <div class="user-detail">@${u.id} · <span style="${roleColor[u.role]||''}">${u.role}</span> · ${turnoLabel(u.turno)}</div>
      </div>
      <button class="btn-del" onclick="eliminarUsuario('${u.id}')">Dar de baja</button>
    </div>`).join('');
  cont.innerHTML=html;
}

window.showAddUserModal=function(){
  ['new-name','new-user','new-pass'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('modal-add-user').classList.add('open');
};

window.saveNewUser=async function(){
  const name=document.getElementById('new-name').value.trim();
  const user=document.getElementById('new-user').value.trim().toLowerCase();
  const pass=document.getElementById('new-pass').value;
  const role=document.getElementById('new-role').value;
  const turno=document.getElementById('new-turno').value;
  if(!name||!user||!pass){ showToast('Completa todos los campos','err'); return; }
  showLoading();
  try {
    await setDoc(doc(db,'usuarios',user),{name,pass,role,turno,suc:currentSuc,creadoEn:new Date().toISOString()});
    closeModal('modal-add-user');
    await cargarUsuarios();
    showToast('Usuario agregado correctamente');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

window.eliminarUsuario=async function(id){
  if(!confirm(`¿Dar de baja al usuario @${id}?`)) return;
  showLoading();
  try {
    await deleteDoc(doc(db,'usuarios',id));
    await cargarUsuarios();
    showToast('Usuario dado de baja');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};
