// ============================================================
// GYM CONTROL — LÓGICA PRINCIPAL v3
// ============================================================
import { db } from './firebase.js';
import { USERS_FIJOS } from './usuarios.js';
import * as SATELITE   from './data/satelite.js';
import * as UPEA       from './data/upea.js';
import * as JUL16      from './data/jul16.js';
import * as CEJA       from './data/ceja.js';
import * as CRUCE      from './data/cruce.js';
import * as MIRAFLORES from './data/miraflores.js';
import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

// ============================================================
// TAREAS Y ÁREAS POR SUCURSAL
// Cada archivo de datos exporta SUCURSAL_ID, que debe coincidir
// EXACTO con el valor que manda selectSuc() en index.html.
// Para agregar otra sucursal: importa su archivo arriba y
// agrégalo a este arreglo.
//
// SATELITE, CEJA y CRUCE quedaron INACTIVAS (2026-09): ya no
// aparecen como tarjeta seleccionable en la pantalla de inicio
// (ver index.html), pero se mantienen aquí a propósito para no
// perder su checklist ni su historial — reportes, checklists y
// usuarios viejos de esas sucursales se pueden seguir revisando.
// Si alguna vuelve a operar, solo hay que reactivar su tarjeta
// en index.html.
// ============================================================
const SUCURSALES_DATA = [SATELITE, UPEA, JUL16, CEJA, CRUCE, MIRAFLORES];

const TAREAS_POR_SUCURSAL = {};
const AREAS_POR_SUCURSAL  = {};
SUCURSALES_DATA.forEach(mod=>{
  TAREAS_POR_SUCURSAL[mod.SUCURSAL_ID] = { manana: mod.TAREAS_MANANA, tarde: mod.TAREAS_TARDE, noche: mod.TAREAS_NOCHE };
  AREAS_POR_SUCURSAL[mod.SUCURSAL_ID]  = mod.AREAS_REVISION;
});

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
// OJO: toISOString() siempre da la fecha en UTC, no en horario de
// Bolivia (UTC-4). Eso hacía que el turno noche (18:30-22:30, que
// cae justo después de que el reloj UTC ya cambió de día) guardara
// sus tareas con la fecha de "mañana", y por eso se veían tildadas
// todo el día siguiente. fechaLocal() arma la fecha con los
// componentes locales del navegador para evitar ese desfase.
function fechaLocal(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
const fechaHoy  = () => fechaLocal(new Date());
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
    guardarSesion();
    showLoading();
    loadDash().then(()=>{
      hideLoading();
      show('screen-dash');
      showToast('Sucursal cambiada: ' + suc);
    }).catch(()=>{ /* loadDash ya mostró su propio aviso de error */ });
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
    guardarSesion();
    try{ await loadDash(); } catch(e){ /* loadDash ya mostró su propio aviso de error */ }
    return;
  }

  try {
    // Primero busca con el formato nuevo (documento por sucursal, a
    // prueba de choques de nombre entre sucursales). Si no existe,
    // cae al formato antiguo (ID = solo el username) para que las
    // cuentas creadas antes de esta corrección sigan funcionando.
    let snap = await getDoc(doc(db,'usuarios',`${currentSuc}__${u}`));
    if(!snap.exists()) snap = await getDoc(doc(db,'usuarios',u));
    if(!snap.exists()){ hideLoading(); err.textContent='Usuario no encontrado'; err.style.display='block'; return; }
    const user = snap.data();
    if(user.pass !== p){ hideLoading(); err.textContent='Contraseña incorrecta'; err.style.display='block'; return; }
    if(user.suc !== currentSuc){ hideLoading(); err.textContent='No tienes acceso a esta sucursal'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    guardarSesion();
    await loadDash();
  } catch(e){ hideLoading(); err.textContent='Error de conexión'; err.style.display='block'; }
};

window.doLogout = function(){
  try{ updateDoc(doc(db,'sesiones_activas', idDispositivoActual()), {activa:false}); }catch(e){}
  currentUser=null; reportes=[]; usuarios=[]; borrarSesion(); goHome();
};
document.getElementById('inp-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

// ============================================================
// DASHBOARD
// ============================================================
// ============================================================
// NAVEGACIÓN EN 2 NIVELES (supervisor): categoría → sub-pestañas.
// Recepción y limpieza siguen con la barra simple de siempre,
// ya que tienen pocas pestañas y no lo necesitan.
// ============================================================
window.seleccionarCategoria = function(catId, silencioso){
  const categorias = window._categoriasDash || [];
  const cat = categorias.find(c=>c.id===catId);
  if(!cat) return;
  document.querySelectorAll('.categoria-btn').forEach(b=>b.classList.toggle('active', b.dataset.cat===catId));
  renderTabsEnBarra(cat.tabs, true);
};

function renderTabsEnBarra(tabs, activarPrimera){
  const tabsEl = document.getElementById('tabs-container');
  tabsEl.innerHTML='';
  tabs.forEach((t,i)=>{
    const el=document.createElement('div');
    el.className='tab'+(activarPrimera && i===0?' active':'');
    el.dataset.panel=t.id;
    if(t.id==='panel-reportes' && currentUser.role==='limpieza'){
      el.innerHTML = `${t.label} <span class="tab-badge" id="tab-badge-reportes" style="display:none">0</span>`;
    } else {
      el.textContent=t.label;
    }
    el.onclick=()=>activarPanelTab(t.id);
    tabsEl.appendChild(el);
  });
  if(activarPrimera && tabs.length) activarPanelTab(tabs[0].id, true);
}

// Centraliza qué hay que cargar/refrescar según la pestaña elegida,
// para no repetir esta lista en cada lugar que activa una pestaña.
function activarPanelTab(panelId, siloso){
  const allPanels = window._allPanelsDash || [];
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active', x.dataset.panel===panelId));
  allPanels.forEach(p=>{ const el=document.getElementById(p); if(el) el.classList.remove('active'); });
  const panelEl = document.getElementById(panelId);
  if(panelEl) panelEl.classList.add('active');
  guardarPanelActivo(panelId);
  if(panelId==='panel-historial')  cargarHistorial();
  if(panelId==='panel-revision')   renderRevision();
  if(panelId==='panel-alertas')    cargarAlertas();
  if(panelId==='panel-pt')         initPTPanel();
  if(panelId==='panel-agenda')     initAgendaPanel();
  if(panelId==='panel-ops')        initOpsPanel();
  if(panelId==='panel-admin')      cargarUsuarios();
  if(panelId==='panel-accesorios') cargarAccesorios();
  if(panelId==='panel-inventario') initInventarioPanel();
  if(panelId==='panel-seguimiento') cargarSeguimiento();
  if(panelId==='panel-aerobicos')  initClasesPanel('aerobicos');
  if(panelId==='panel-spinning')   initClasesPanel('spinning');
}

async function loadDash(){
 try{
  document.getElementById('dash-suc').textContent  = currentSuc;
  document.getElementById('dash-user').textContent = currentUser.name;
  document.getElementById('dash-role').textContent = {supervisor:'Supervisor',recepcionista:'Recepcionista',limpieza:'Limpieza',instructor:'Instructor'}[currentUser.role]||currentUser.role;

  // Botón cambiar sucursal solo para supervisor
  const btnCambiar = document.getElementById('btn-cambiar-suc');
  if(btnCambiar) btnCambiar.style.display = currentUser.role==='supervisor' ? 'inline-block' : 'none';

  // Botón tarea especial
  const btnSup = document.getElementById('btn-sup-reporte');
  if(btnSup) btnSup.style.display = currentUser.role==='supervisor' ? 'block' : 'none';

  let tabs = [];
  let categorias = null;

  if(currentUser.role==='supervisor'){
    categorias = [
      {id:'limpieza', label:'🧹 Control de Limpieza', tabs:[
        {id:'panel-checklist', label:'Checklist'},
        {id:'panel-reportes',  label:'Reportes'},
        {id:'panel-revision',  label:'Revisión áreas'},
        {id:'panel-historial', label:'Historial'},
      ]},
      {id:'clases', label:'🏋 Aeróbicos y Spinning', tabs:[
        {id:'panel-aerobicos', label:'Aeróbicos'},
        {id:'panel-spinning',  label:'Spinning'},
      ]},
      {id:'pt', label:'👤 Entrenadores PT', tabs:[
        {id:'panel-pt',         label:'Entrenadores PT'},
        {id:'panel-inventario', label:'Conteo accesorios'},
      ]},
      {id:'admin', label:'⚙ Administración', tabs:[
        {id:'panel-admin',      label:'Usuarios'},
        {id:'panel-accesorios', label:'Accesorios'},
        {id:'panel-inventario', label:'Conteo accesorios'},
        {id:'panel-seguimiento', label:'Seguimiento'},
        // Agenda, Operaciones y Alertas se sacaron del menú a pedido
        // (no se usaban). El código y los datos siguen intactos, solo
        // no hay pestaña que lleve a ellos; para reactivarlas basta
        // con devolver estas 3 líneas:
        // {id:'panel-agenda',  label:'Agenda'},
        // {id:'panel-ops',     label:'Operaciones'},
        // {id:'panel-alertas', label:'Alertas'},
      ]},
    ];
  } else if(currentUser.role==='recepcionista'){
    tabs=[
      {id:'panel-revision',   label:'Revisión áreas'},
      {id:'panel-reportes',   label:'Mis reportes'},
      {id:'panel-aerobicos',  label:'Aeróbicos'},
      {id:'panel-spinning',   label:'Spinning'},
      {id:'panel-pt',         label:'Entrenadores PT'},
      {id:'panel-inventario', label:'Conteo accesorios'},
    ];
  } else if(currentUser.role==='limpieza'){
    tabs=[
      {id:'panel-checklist', label:'Mis tareas'},
      {id:'panel-reportes',  label:'Reportes a atender'},
    ];
  } else if(currentUser.role==='instructor'){
    tabs=[
      {id:'panel-inventario', label:'Conteo de accesorios'},
    ];
  }

  const allPanels=['panel-checklist','panel-reportes','panel-revision','panel-historial','panel-alertas','panel-admin','panel-accesorios','panel-inventario','panel-seguimiento','panel-aerobicos','panel-spinning','panel-pt','panel-agenda','panel-ops'];
  allPanels.forEach(p=>{ const el=document.getElementById(p); if(el) el.classList.remove('active'); else console.warn('Panel no encontrado en el HTML:', p); });
  window._allPanelsDash = allPanels;

  const catCont = document.getElementById('categorias-container');

  if(categorias){
    window._categoriasDash = categorias;
    catCont.style.display='flex';
    catCont.innerHTML = categorias.map((c,i)=>
      `<div class="categoria-btn${i===0?' active':''}" id="cat-btn-${c.id}" data-cat="${c.id}" onclick="seleccionarCategoria('${c.id}')">${c.label}${c.id==='admin'?' <span class="cat-badge" id="cat-badge-admin" style="display:none"></span>':''}</div>`
    ).join('');
    seleccionarCategoria(categorias[0].id, true);
  } else {
    catCont.style.display='none';
    catCont.innerHTML='';
    renderTabsEnBarra(tabs, true);
  }

  turnoVista = currentUser.turno || detectarTurno();

  // El checklist de limpieza y los reportes no le sirven de nada a un
  // instructor (ese rol solo usa "Conteo de accesorios"), así que no
  // tiene sentido cargarlos para ese rol — y de paso, si algo de eso
  // llegara a fallar, ya no se lleva puesto el resto del panel.
  if(currentUser.role!=='instructor'){
    // Promise.allSettled en vez de Promise.all: si UNA de las dos
    // falla (ej. sin permisos en Firestore para algo puntual), la
    // otra igual carga y el panel se termina de mostrar — antes, un
    // solo error acá tiraba abajo TODO el ingreso al panel y la
    // persona se quedaba pegada en la pantalla de inicio con el
    // aviso de error, sin poder ver nada de lo que sí se guardó.
    const resultados = await Promise.allSettled([renderChecklist(), cargarReportes()]);
    resultados.forEach(r=>{ if(r.status==='rejected') console.error('Error cargando panel:', r.reason); });
    if(currentUser.role==='recepcionista'){
      try{ renderRevision(); } catch(e){ console.error('Error en renderRevision:', e); }
    }
  }
  // Alertas se sacó del menú de Administración (no se usaba), así que
  // ya no se llama acá para que no quede un numerito pegado al botón
  // de "Administración" sin ningún lado donde verlo.
  hideLoading();
  show('screen-dash');
 } catch(e){
  console.error('Error en loadDash:', e);
  hideLoading();
  showToast('Ocurrió un error al cargar. Actualizá la página (Ctrl+Shift+R) e intentá de nuevo.','err');
  throw e;
 }
}

// ============================================================
// CHECKLIST — con selector de turno para supervisor
// ============================================================
function getTareasTurno(turno){
  const tareas = TAREAS_POR_SUCURSAL[currentSuc];
  if(!tareas) return [];
  return tareas[turno] || [];
}

// Calcula cuántos minutos hay entre dos horas "HH:MM"
function calcularDuracionMin(ini,fin){
  if(!ini||!fin) return null;
  const [h1,m1]=ini.split(':').map(Number);
  const [h2,m2]=fin.split(':').map(Number);
  if(isNaN(h1)||isNaN(m1)||isNaN(h2)||isNaN(m2)) return null;
  let mins=(h2*60+m2)-(h1*60+m1);
  if(mins<0) mins+=24*60;
  return mins;
}

// El personal de limpieza tomaba el rango de hora muy literal (dejaban de
// revisar baños fuera de "su horario"). Por eso ahora se muestran los
// MINUTOS que debería tomar la tarea como dato principal, y el rango de
// hora queda solo como guía aproximada de en qué momento del turno va.
// Los bloques de "Tiempo de imprevistos" no tienen una hora fija real
// (el horario exacto varía), así que ahí se muestran solo los minutos.
function formatoBloqueTiempo(bloque){
  if(bloque.area==='Tiempo de imprevistos'){
    const m=(bloque.tareas[0]||'').match(/\((\d+)\s*min\)/i);
    return `<div class="area-dur">~${m?m[1]:'?'} min</div>`;
  }
  const [ini,fin]=bloque.hora.split('–');
  const mins=calcularDuracionMin(ini,fin);
  if(mins==null) return `<div class="area-hora">${bloque.hora}</div>`;
  return `<div class="area-dur">~${mins} min</div><div class="area-hora-sec">${bloque.hora} aprox.</div>`;
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

  const bannerPrioridad = `
    <div class="prioridad-banner">
      Los horarios de cada tarea son una <strong>guía aproximada</strong> de realizar.
      <strong>Los baños son prioridad</strong>: hay que revisarlos y limpiar con frecuencia durante todo el turno,
      no solo dentro de su bloque de horario.
    </div>`;

  let totalHechas=0, totalTareas=0, bloquesCompletos=0, totalBloquesReales=0;
  const bloquesHtml = lista.map(bloque=>{
    const esImprevisto = bloque.area==='Tiempo de imprevistos';
    const hechas = bloque.tareas.filter((_,i)=>estado[`${bloque.id}_${i}`]?.hecho).length;
    const total  = bloque.tareas.length;
    const pct    = Math.round(hechas/total*100);
    const badgeCls = esImprevisto ? 'badge-imprevisto' : (hechas===total?'badge-ok':hechas>0?'badge-pend':'badge-crit');
    // El tiempo de imprevistos no es un área real para inspeccionar, así
    // que no cuenta en las estadísticas de avance del turno.
    if(!esImprevisto){
      totalHechas+=hechas; totalTareas+=total; if(hechas===total) bloquesCompletos++;
      totalBloquesReales++;
    }

    return `
    <div class="area-block${esImprevisto?' area-block-imprevisto':''}">
      <div class="area-header" onclick="toggleBloque('${bloque.id}')">
        <div style="flex:1">
          <div class="area-name">${esImprevisto?'⏱ ':''}${bloque.area}</div>
          ${formatoBloqueTiempo(bloque)}
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
  }).join('');

  const pctGlobal = totalTareas ? Math.round(totalHechas/totalTareas*100) : 0;
  const pendientes = totalTareas-totalHechas;
  const statsHtml = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-top"><span class="stat-label">Avance del turno</span><span class="stat-icon ok">✓</span></div>
        <div class="stat-num">${pctGlobal}%</div>
        <div class="stat-sub">${totalHechas} de ${totalTareas} tareas</div>
      </div>
      <div class="stat-card">
        <div class="stat-top"><span class="stat-label">Pendientes</span><span class="stat-icon warn">!</span></div>
        <div class="stat-num">${pendientes}</div>
        <div class="stat-sub">tareas sin marcar</div>
      </div>
      <div class="stat-card">
        <div class="stat-top"><span class="stat-label">Bloques completos</span><span class="stat-icon info">◔</span></div>
        <div class="stat-num">${bloquesCompletos}/${totalBloquesReales}</div>
        <div class="stat-sub">áreas al 100%</div>
      </div>
    </div>`;

  let html = selectorHTML + bannerPrioridad + statsHtml + `<div class="section-title">${turnoInfo[turno]||''} <span></span></div>` + bloquesHtml;

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
// Antes la lista de áreas a revisar salía de TODAS las áreas del
// checklist de limpieza (quedaba distinta por sucursal y con demasiados
// ítems). Ahora es una lista simple y fija, igual en las 5 sucursales,
// para que sea rápida de usar desde recepción.
const AREAS_REVISION_GENERAL = [
  'Baños', 'Duchas', 'Vestidores', 'Casilleros', 'Máquinas',
  'Equipos de cardio', 'Sala de aeróbicos', 'Sala de spinning',
  'Sala de pesas', 'Otros',
];

function slugArea(nombre){
  return nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

function getAreasParaRevision(){
  return AREAS_REVISION_GENERAL;
}

async function renderRevision(){
  const cont=document.getElementById('revision-container');
  if(!cont) return;
  const areas = getAreasParaRevision();
  if(!areas.length){ cont.innerHTML='<div class="empty">Sin áreas configuradas para esta sucursal</div>'; return; }
  const esSup = currentUser.role==='supervisor';

  const hoy = fechaHoy();
  const hoyMap = {};
  try{
    const q=query(collection(db,'revisiones'),where('sucursal','==',currentSuc),where('fecha','==',hoy));
    const snap=await getDocs(q);
    snap.docs.forEach(d=>{ hoyMap[d.data().areaId]=d.data(); });
  }catch(e){}

  const nivelLabel={bien:'✓ Bien',falta:'⚠ Falta atención'};
  const nivelCls  ={bien:'niv-bien',falta:'niv-falta'};

  const resumenSup = esSup
    ? `<div class="rev-resumen-sup">Hoy se revisaron <strong>${Object.keys(hoyMap).length}</strong> de <strong>${areas.length}</strong> áreas</div>`
    : '';

  cont.innerHTML = resumenSup + areas.map(nombre=>{
    const areaId=slugArea(nombre);
    const nombreEsc=nombre.replace(/'/g,"\\'");
    const marca=hoyMap[areaId];
    return `
    <div class="area-block">
      <div class="area-header-rev">
        <div style="flex:1;min-width:180px">
          <div class="area-name">${nombre}</div>
          ${marca
            ? `<div class="rev-marca ${nivelCls[marca.nivel]}">${nivelLabel[marca.nivel]} · ${marca.hora} — ${marca.registradoPor}</div>`
            : `<div class="rev-marca rev-pendiente">Sin revisar hoy</div>`}
        </div>
        <div class="rev-btns">
          <button class="btn-rev btn-bien" onclick="marcarRevision('${areaId}','${nombreEsc}','bien')">✓ Bien</button>
          <button class="btn-rev btn-falta" onclick="abrirReporteArea('${areaId}','${nombreEsc}','falta')">⚠ Falta atención</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

let reporteAreaActual=null;

window.marcarRevision=async function(areaId,areaNombre,nivel){
  showLoading();
  try{
    const hoy=fechaHoy();
    await setDoc(doc(db,'revisiones',`${currentSuc}_${areaId}_${hoy}`),{
      sucursal:currentSuc, areaId, area:areaNombre, fecha:hoy, nivel,
      registradoPor:currentUser.name, hora:horaActual(), registradoEn:new Date().toISOString(),
    });
    showToast(`${areaNombre} — marcada como bien ✓`);
    await renderRevision();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

let fotoRevActual=null; // dataURL ya comprimida, lista para guardar

window.abrirReporteArea=function(areaId,areaNombre,nivel){
  reporteAreaActual={id:areaId,nombre:areaNombre,nivel:nivel||'falta'};
  document.getElementById('modal-area-nombre').textContent=areaNombre;
  document.getElementById('modal-desc-rev').value='';
  document.getElementById('modal-prio-rev').value= reporteAreaActual.nivel==='falta' ? 'alta' : 'normal';
  quitarFotoRev();
  document.getElementById('modal-revision').classList.add('open');
};

// Comprime la foto en el navegador antes de guardarla (los reportes se
// guardan en Firestore, que no acepta archivos grandes)
function comprimirImagen(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const maxW=800;
        const scale=Math.min(1, maxW/img.width);
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*scale);
        canvas.height=Math.round(img.height*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',0.6));
      };
      img.onerror=reject;
      img.src=e.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

// Se dispara al elegir una foto, sea con el botón "Tomar foto" (cámara)
// o "Galería" — ambos botones usan esta misma función.
window.previewFotoRev=async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoRevActual = await comprimirImagen(input.files[0]);
    document.getElementById('foto-preview-img').src=fotoRevActual;
    document.getElementById('foto-preview-rev').style.display='block';
  }catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.quitarFotoRev=function(){
  fotoRevActual=null;
  const prev=document.getElementById('foto-preview-rev');
  if(prev) prev.style.display='none';
  const cam=document.getElementById('modal-foto-camara'); if(cam) cam.value='';
  const gal=document.getElementById('modal-foto-galeria'); if(gal) gal.value='';
};

window.enviarReporteArea=async function(){
  if(!reporteAreaActual) return;
  const desc=document.getElementById('modal-desc-rev').value.trim();
  const prio=document.getElementById('modal-prio-rev').value;
  showLoading();
  try {
    const foto=fotoRevActual||null;
    const hoy=fechaHoy();
    await setDoc(doc(db,'revisiones',`${currentSuc}_${reporteAreaActual.id}_${hoy}`),{
      sucursal:currentSuc, areaId:reporteAreaActual.id, area:reporteAreaActual.nombre,
      fecha:hoy, nivel:reporteAreaActual.nivel, registradoPor:currentUser.name,
      hora:horaActual(), registradoEn:new Date().toISOString(),
    });
    await setDoc(doc(collection(db,'reportes')),{
      areaId:reporteAreaActual.id, area:reporteAreaActual.nombre,
      estado:'pendiente', nivelRevision:reporteAreaActual.nivel, prio,
      desc:desc||'Requiere atención',
      sucursal:currentSuc, fecha:hoy, mes:mesActual(), creadoPor:currentUser.name,
      rol:'recepcionista', timestamp:tsAhora(),
      alertaEn: tsAhora()+(24*60*60*1000),
      foto,
    });
    closeModal('modal-revision');
    showToast('Reporte enviado al personal de limpieza');
    await renderRevision();
    await cargarReportes();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// Supervisor asigna tarea especial
let fotoSupActual=null;

window.abrirReporteSupervisor=function(){
  document.getElementById('modal-task-desc').value='';
  document.getElementById('modal-task-area').value='';
  document.getElementById('modal-task-prio').value='normal';
  quitarFotoSup();
  document.getElementById('modal-tarea-sup').classList.add('open');
};

window.previewFotoSup=async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoSupActual = await comprimirImagen(input.files[0]);
    document.getElementById('foto-preview-img-sup').src=fotoSupActual;
    document.getElementById('foto-preview-sup').style.display='block';
  }catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.quitarFotoSup=function(){
  fotoSupActual=null;
  const prev=document.getElementById('foto-preview-sup'); if(prev) prev.style.display='none';
  const cam=document.getElementById('modal-foto-camara-sup'); if(cam) cam.value='';
  const gal=document.getElementById('modal-foto-galeria-sup'); if(gal) gal.value='';
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
      foto: fotoSupActual||null,
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
  actualizarBadgeReportes();
}

// Notificación visible para el personal de limpieza: un número en la
// pestaña "Reportes a atender" cuando tienen reportes pendientes, para
// que no dependan de entrar a mirar si hay algo nuevo.
function actualizarBadgeReportes(){
  if(currentUser.role!=='limpieza') return;
  const badge=document.getElementById('tab-badge-reportes');
  if(!badge) return;
  const pendientes=reportes.filter(r=>r.estado!=='atendido').length;
  if(pendientes>0){ badge.textContent=pendientes; badge.style.display='inline-flex'; }
  else badge.style.display='none';
}

function renderReportes(){
  const cont=document.getElementById('reportes-container');
  if(!cont) return;
  let lista=reportes;
  if(currentUser.role==='limpieza') lista=reportes.filter(r=>r.estado!=='atendido');

  if(!lista.length){ cont.innerHTML='<div class="empty">Sin reportes activos</div>'; return; }

  const ahora=tsAhora();
  const estadoMap={pendiente:'s-pend',atendido:'s-done',alerta:'s-alerta',diferido:'s-diferido'};
  const estadoLabel={pendiente:'Pendiente',atendido:'Atendido ✓',alerta:'⚠ Sin atender',diferido:'Diferido 24h'};
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
        <span class="status-pill ${estadoMap[estadoReal]||'s-pend'}">${estadoLabel[estadoReal]||estadoReal}</span>
      </div>
      ${r.desc?`<div class="report-desc">${r.desc}</div>`:''}
      ${r.foto?`<img src="${r.foto}" class="report-foto" onclick="verFotoGrande('${r.id}')">`:''}
      ${enAlerta?`<div class="alerta-msg">⚠ No fue atendido en 24 horas</div>`:''}
      ${r.estado==='atendido'?`<div class="check-meta">Atendido por ${r.atendidoPor} a las ${r.atendidoEn}</div>`:''}
      <div class="report-actions">
        ${canAtender&&r.estado!=='atendido'?`<button class="btn-sm btn-atend" onclick="atenderReporte('${r.id}')">✓ Marcar atendido</button>`:''}
        ${canPrio&&r.estado!=='atendido'?`
          <button class="btn-sm btn-prio" onclick="cambiarPrio('${r.id}','alta')">🔴 Urgente</button>
          <button class="btn-sm btn-defer" onclick="diferirReporte('${r.id}')" title="Pospone la alerta de 24 horas, sin borrar el reporte">Diferir 24h</button>`:''}
        ${currentUser.role==='recepcionista'&&r.estado!=='atendido'&&!enAlerta?`
          <button class="btn-sm btn-noatend" onclick="reportarNoAtendido('${r.id}')">No fue atendido</button>`:''}
      </div>
    </div>`;
  }).join('');
}

// Antes se abría con window.open(dataURL) — muchos navegadores bloquean
// o dejan en negro una pestaña nueva con una imagen en base64, y no
// quedaba claro cómo volver. Ahora se abre en un visor propio, dentro
// del mismo sistema, con una X bien visible para salir.
window.verFotoGrande=function(id){
  const r=reportes.find(x=>x.id===id);
  if(!r || !r.foto) return;
  document.getElementById('foto-viewer-img').src=r.foto;
  document.getElementById('modal-foto-viewer').classList.add('open');
};
window.cerrarFotoGrande=function(){
  document.getElementById('modal-foto-viewer').classList.remove('open');
  document.getElementById('foto-viewer-img').src='';
};

// Antes "Diferir" solo cambiaba un campo interno (prio) que no se usaba
// en ningún lado — no tenía ningún efecto visible ni real. Ahora sí:
// pospone la alerta de "no atendido" 24 horas más y lo marca con un
// estado visible ("Diferido 24h"), sin perder el reporte de vista.
window.diferirReporte=async function(id){
  showLoading();
  try {
    await updateDoc(doc(db,'reportes',id),{
      estado:'diferido', prio:'diferido',
      alertaEn: tsAhora()+(24*60*60*1000),
      diferidoPor:currentUser.name, diferidoEn:horaActual(),
    });
    await cargarReportes();
    showToast('Reporte diferido — se pospuso 24 horas');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

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
// El día de hoy se muestra abierto tal como se va haciendo.
// A partir del día siguiente, cada fecha pasa a ser una carpeta
// plegable (colapsada por defecto, pero se puede abrir para ver
// el detalle completo). Las fechas de más de 7 días de antigüedad
// dejan de mostrarse.
// ============================================================
function mesDe(fechaStr){
  return fechaStr.slice(0,7); // 'YYYY-MM' a partir de 'YYYY-MM-DD'
}

// Reconstruye los bloques de área (mismo formato que el checklist en vivo)
// para una fecha/turno del historial, a partir del estado guardado ese día.
function renderBloquesHistorial(fecha,turno,estado){
  const lista = getTareasTurno(turno);
  if(!lista.length) return '<div class="empty" style="padding:6px 0">Sin tareas configuradas</div>';

  return lista.map(bloque=>{
    const esImprevisto = bloque.area==='Tiempo de imprevistos';
    const hechas = bloque.tareas.filter((_,i)=>estado[`${bloque.id}_${i}`]?.hecho).length;
    const total  = bloque.tareas.length;
    const pct    = total ? Math.round(hechas/total*100) : 0;
    const badgeCls = esImprevisto ? 'badge-imprevisto' : (hechas===total?'badge-ok':hechas>0?'badge-pend':'badge-crit');
    const uid = `${fecha}_${turno}_${bloque.id}`; // id único por fecha+turno+bloque

    return `
    <div class="area-block${esImprevisto?' area-block-imprevisto':''}">
      <div class="area-header" onclick="toggleBloque('${uid}')">
        <div style="flex:1">
          <div class="area-name">${esImprevisto?'⏱ ':''}${bloque.area}</div>
          ${formatoBloqueTiempo(bloque)}
        </div>
        <span class="area-badge ${badgeCls}">${hechas}/${total}</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="chevron" id="chev-${uid}">▼</span>
      </div>
      <div class="area-items" id="items-${uid}">
        ${bloque.tareas.map((tarea,i)=>{
          const key   = `${bloque.id}_${i}`;
          const dat   = estado[key]||{};
          const hecho = dat.hecho||false;
          return `
          <div class="check-item ${hecho?'item-done':''}">
            <span class="hist-mark ${hecho?'hist-mark-ok':''}">${hecho?'✓':'—'}</span>
            <div class="check-content">
              <div class="check-label ${hecho?'done':''}">${tarea}</div>
              ${hecho?`<div class="check-meta">✓ ${dat.hora} — ${dat.quien}</div>`:''}
              ${hecho&&dat.obs?`<div class="check-obs">${dat.obs}</div>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

async function cargarHistorial(){
  const cont=document.getElementById('historial-container');
  if(!cont) return;
  showLoading();
  try {
    const hoy = fechaHoy();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate()-6); // ventana de 7 días (hoy + 6 anteriores)
    const cutoffStr = fechaLocal(cutoff);

    // Puede que la ventana de 7 días cruce de un mes a otro
    const meses = new Set([mesActual(), mesDe(cutoffStr)]);
    let docs = [];
    for(const mes of meses){
      const q=query(collection(db,'checklists'),where('sucursal','==',currentSuc),where('mes','==',mes));
      const snap=await getDocs(q);
      docs.push(...snap.docs.map(d=>d.data()));
    }

    // Agrupamos por fecha (puede haber varios turnos el mismo día)
    // Guardamos el estado completo (tareas: {bloqueId_i: {...}}) para poder
    // reconstruir la vista por área/bloque, igual que el checklist en vivo.
    const porFecha = {};
    docs.forEach(d=>{
      if(!d.fecha || d.fecha < cutoffStr || d.fecha > hoy) return;
      const tareas = d.tareas||{};
      const hayHechas = Object.values(tareas).some(t=>t.hecho);
      if(!hayHechas) return;
      if(!porFecha[d.fecha]) porFecha[d.fecha] = {};
      porFecha[d.fecha][d.turno] = tareas;
    });

    const fechas = Object.keys(porFecha).sort((a,b)=>b.localeCompare(a));
    if(!fechas.length){ cont.innerHTML='<div class="empty">Sin actividad registrada en los últimos 7 días</div>'; hideLoading(); return; }

    const renderTurnos = (fecha,turnos) => Object.entries(turnos).map(([turno,estado])=>`
      <div class="hist-turno-label">${turnoLabel(turno)}</div>
      ${renderBloquesHistorial(fecha,turno,estado)}
    `).join('');

    let html='';
    fechas.forEach(fecha=>{
      if(fecha===hoy){
        html += `<div class="hist-card hist-hoy">
          <div class="hist-fecha">${fecha} · Hoy</div>
          ${renderTurnos(fecha,porFecha[fecha])}
        </div>`;
      } else {
        html += `<div class="hist-folder">
          <div class="hist-folder-header" onclick="toggleHistDia('${fecha}')">
            <span class="hist-folder-icon">📁</span>
            <span class="hist-fecha" style="margin:0">${fecha}</span>
            <span class="chevron" id="hist-chev-${fecha}">▼</span>
          </div>
          <div class="hist-folder-body" id="hist-body-${fecha}">
            ${renderTurnos(fecha,porFecha[fecha])}
          </div>
        </div>`;
      }
    });
    cont.innerHTML=html;
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; }
  hideLoading();
}

window.toggleHistDia = function(fecha){
  const body=document.getElementById('hist-body-'+fecha);
  const chev=document.getElementById('hist-chev-'+fecha);
  if(!body) return;
  body.classList.toggle('open');
  chev.textContent = body.classList.contains('open') ? '▲' : '▼';
};

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
  const catBadge=document.getElementById('cat-badge-admin');
  if(catBadge){
    if(alertas.length>0){ catBadge.textContent=alertas.length; catBadge.style.display='inline-flex'; }
    else catBadge.style.display='none';
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
  const roleColor={supervisor:'color:#e8c14a',recepcionista:'color:#4ae8a0',limpieza:'color:#e8904a',instructor:'color:#c084fc'};
  let html=`<div class="user-row">
    <div class="user-info"><div class="user-name">Supervisor General</div>
    <div class="user-detail">@admin · <span style="color:#e8c14a">supervisor</span></div></div>
  </div>`;
  html+=usuarios.map(u=>{
    const uname = u.username || u.id; // docs viejos no tienen 'username': el ID ES el username
    return `
    <div class="user-row">
      <div class="user-info">
        <div class="user-name">${u.name}</div>
        <div class="user-detail">@${uname} · <span style="${roleColor[u.role]||''}">${u.role}</span> · ${turnoLabel(u.turno)}</div>
      </div>
      <button class="btn-sesion" onclick="cerrarSesionDeUsuario('${uname}')">Cerrar sesión</button>
      <button class="btn-del" onclick="eliminarUsuario('${u.id}','${uname}')">Dar de baja</button>
    </div>`;
  }).join('');
  cont.innerHTML=html;
}

// Cierra (a distancia) todas las sesiones activas de un usuario, sin
// eliminar su cuenta. Útil para personal momentáneo: aunque siga
// existiendo el usuario, no puede seguir usando la app hasta que
// vuelva a iniciar sesión. El dispositivo afectado sale solo en
// menos de un minuto (el mismo chequeo periódico que usa "Sesiones
// activas" en el menú del propio usuario).
window.cerrarSesionDeUsuario=async function(username){
  if(!confirm(`¿Cerrar la sesión activa de @${username}? Si tiene la app abierta en algún dispositivo, va a volver sola al inicio.`)) return;
  showLoading();
  try {
    // Se filtra también por sucursal: si alguien en otra sucursal
    // tiene el mismo nombre de usuario, esto evita cerrarle la sesión
    // a esa otra persona por error.
    const q=query(collection(db,'sesiones_activas'),where('username','==',username),where('sucursal','==',currentSuc),where('activa','==',true));
    const snap=await getDocs(q);
    if(snap.empty){ showToast('Ese usuario no tiene sesiones activas'); }
    else {
      await Promise.all(snap.docs.map(d=>updateDoc(doc(db,'sesiones_activas',d.id),{activa:false})));
      showToast('Sesión cerrada');
    }
  } catch(e){ showToast('Error al cerrar la sesión','err'); }
  hideLoading();
};

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
    // IMPORTANTE: antes el ID del documento era solo el nombre de
    // usuario (ej. "luis"), compartido entre TODAS las sucursales.
    // Si ese nombre ya existía en otra sucursal (activa o inactiva),
    // crearlo acá lo sobrescribía por completo y se lo "robaba" a la
    // otra sucursal sin avisar — eso causaba que cuentas desaparecieran
    // solas. Ahora el documento queda por sucursal ("UPEA__luis"), así
    // que dos sucursales nunca pueden pisarse la misma cuenta.
    const idNuevo = `${currentSuc}__${user}`;
    const existeNuevo = await getDoc(doc(db,'usuarios',idNuevo));
    if(existeNuevo.exists()){
      hideLoading();
      showToast('Ya existe un usuario con ese nombre en esta sucursal','err');
      return;
    }
    // Revisa también el formato viejo (ID = solo el username), por si
    // ese nombre ya está tomado por una cuenta de ESTA U OTRA sucursal
    // creada antes de esta corrección.
    const legado = await getDoc(doc(db,'usuarios',user));
    if(legado.exists()){
      hideLoading();
      const otraSuc = legado.data().suc;
      showToast(otraSuc===currentSuc
        ? 'Ya existe un usuario con ese nombre en esta sucursal (cuenta antigua)'
        : `Ese nombre de usuario ya lo usa alguien de "${otraSuc}" — usa uno distinto (ej. ${user}2)`, 'err');
      return;
    }
    await setDoc(doc(db,'usuarios',idNuevo),{name,pass,role,turno,suc:currentSuc,username:user,creadoEn:new Date().toISOString()});
    closeModal('modal-add-user');
    await cargarUsuarios();
    showToast('Usuario agregado correctamente');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

window.eliminarUsuario=async function(docId, username){
  const uname = username || docId;
  if(!confirm(`¿Dar de baja al usuario @${uname}? Si tiene la app abierta en algún dispositivo, se le va a cerrar la sesión automáticamente.`)) return;
  showLoading();
  try {
    // Antes, dar de baja solo borraba el usuario de Firestore: si la
    // persona ya había iniciado sesión en un dispositivo, se quedaba
    // con acceso hasta que ella misma cerrara sesión. Ahora, al dar
    // de baja, también se cierran todas sus sesiones activas para
    // que quede sin acceso de inmediato (en menos de un minuto).
    try {
      const q=query(collection(db,'sesiones_activas'),where('username','==',uname),where('sucursal','==',currentSuc),where('activa','==',true));
      const snap=await getDocs(q);
      await Promise.all(snap.docs.map(d=>updateDoc(doc(db,'sesiones_activas',d.id),{activa:false})));
    } catch(e){ /* si esto falla igual seguimos con la baja del usuario */ }
    await deleteDoc(doc(db,'usuarios',docId));
    await cargarUsuarios();
    showToast('Usuario dado de baja y sesión cerrada');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ============================================================
// AERÓBICOS / SPINNING
// Datos por sucursal, guardados en Firestore:
//   'clases'            -> horario recurrente semanal (día fijo)
//   'historial_clases'  -> asistencia/incidencias por fecha (doc id: claseId_fecha)
//   'especiales'        -> clases sueltas (feriados, fines de semana)
//   'solicitudes_borrado' -> pedidos de recepción para borrar una clase,
//                            que el supervisor debe aprobar o rechazar
// ============================================================
const DIAS = [
  {id:'lunes',label:'Lunes'},{id:'martes',label:'Martes'},{id:'miercoles',label:'Miércoles'},
  {id:'jueves',label:'Jueves'},{id:'viernes',label:'Viernes'},{id:'sabado',label:'Sábado'},{id:'domingo',label:'Domingo'},
];
function diaLabel(id){ const d=DIAS.find(x=>x.id===id); return d?d.label:id; }
function diaHoyId(){ return ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][new Date().getDay()]; }

let clasesData      = {aerobicos:[], spinning:[]};
let especialesData  = {aerobicos:[], spinning:[]};
let solicitudesData = {aerobicos:[], spinning:[]};
let histClaseCache  = {}; // claseId -> registros ordenados desc por fecha

function calcularAntiguedad(fechaInicio){
  if(!fechaInicio) return '—';
  const ini=new Date(fechaInicio+'T00:00:00'), hoy=new Date();
  let meses=(hoy.getFullYear()-ini.getFullYear())*12+(hoy.getMonth()-ini.getMonth());
  if(hoy.getDate()<ini.getDate()) meses--;
  if(meses<0) return '—';
  const anios=Math.floor(meses/12), rest=meses%12;
  return anios>0 ? `${anios}a ${rest}m` : `${rest}m`;
}
function estadoHistLabel(e){ return {realizada:'Realizada',retraso:'Con retraso',reemplazo:'Con reemplazo',cancelada:'Cancelada'}[e]||e; }
function motivoCancelLabel(m){ return {ausencia_sin_aviso:'Ausencia sin aviso',aviso_previo:'Aviso previo',retraso_mayor:'Retraso mayor a 15 min',alumnos_insuficientes:'Alumnos insuficientes',infraestructura:'Infraestructura',otro:'Otro'}[m]||m; }
function gestionadoLabel(g){ return {instructor:'Instructor',gimnasio:'Gimnasio'}[g]||g; }
function estadoEspecialLabel(e){ return {reservado:'Reservado',confirmado:'Confirmado',realizado:'Realizado',cancelado:'Cancelado'}[e]||e; }
function formatoFechaCorta(fecha){ if(!fecha) return '—'; const [y,m,d]=fecha.split('-'); return `${d}/${m}`; }

// ------------------------------------------------------------
// Entrada del panel (se llama al abrir la pestaña)
// ------------------------------------------------------------
window.initClasesPanel = async function(tipo){
  showLoading();
  try{
    const qc=query(collection(db,'clases'),where('sucursal','==',currentSuc),where('tipo','==',tipo));
    const sc=await getDocs(qc);
    clasesData[tipo]=sc.docs.map(d=>({id:d.id,...d.data()}));

    const qe=query(collection(db,'especiales'),where('sucursal','==',currentSuc),where('tipo','==',tipo));
    const se=await getDocs(qe);
    especialesData[tipo]=se.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.fecha.localeCompare(a.fecha));

    if(currentUser.role==='supervisor'){
      const qs=query(collection(db,'solicitudes_borrado'),where('sucursal','==',currentSuc),where('tipoClase','==',tipo),where('estado','==','pendiente'));
      const ss=await getDocs(qs);
      solicitudesData[tipo]=ss.docs.map(d=>({id:d.id,...d.data()}));
    } else {
      solicitudesData[tipo]=[];
    }
  } catch(e){ showToast('Error al cargar horario','err'); }
  hideLoading();
  renderHorarioTipo(tipo);
  renderEspecialesTipo(tipo);
  cambiarVistaClases(tipo,'horario');
};

window.cambiarVistaClases = function(tipo,vista){
  document.querySelectorAll(`#switch-${tipo} .clases-switch-btn`).forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`#switch-${tipo} [data-vista="${vista}"]`);
  if(btn) btn.classList.add('active');
  document.getElementById(`${tipo}-horario-container`).style.display    = vista==='horario'?'block':'none';
  document.getElementById(`${tipo}-especiales-container`).style.display = vista==='especiales'?'block':'none';
  document.getElementById(`btn-nueva-clase-${tipo}`).style.display    = (vista==='horario' && currentUser.role==='supervisor')?'inline-block':'none';
  document.getElementById(`btn-nueva-especial-${tipo}`).style.display = vista==='especiales'?'inline-block':'none';
};

// ------------------------------------------------------------
// HORARIO SEMANAL
// ------------------------------------------------------------
function renderHorarioTipo(tipo){
  const cont=document.getElementById(`${tipo}-horario-container`);
  if(!cont) return;
  const esSup=currentUser.role==='supervisor';
  let html='';

  if(esSup && solicitudesData[tipo].length){
    html+=`<div class="solicitudes-box">
      <div class="solicitudes-title">⚠ Solicitudes de eliminación pendientes</div>
      ${solicitudesData[tipo].map(s=>`
        <div class="solicitud-row">
          <div class="solicitud-info">
            <div class="solicitud-resumen">${s.resumen}</div>
            <div class="solicitud-meta">Pedido por ${s.solicitadoPor}</div>
          </div>
          <div class="solicitud-btns">
            <button class="btn-mini btn-mini-ok" onclick="resolverSolicitud('${s.id}','${tipo}',true)">Aprobar</button>
            <button class="btn-mini btn-mini-no" onclick="resolverSolicitud('${s.id}','${tipo}',false)">Rechazar</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  const lista=clasesData[tipo];
  const esSup2=currentUser.role==='supervisor';
  if(esSup2 && lista.length){
    html+=`<button class="btn-link-report" onclick="abrirReporteInstructor('${tipo}')">📊 Reporte por instructor</button>`;
  }
  if(!lista.length){
    cont.innerHTML=html+'<div class="empty">Sin clases programadas todavía</div>';
    return;
  }

  const hoyId=diaHoyId();
  DIAS.forEach(dia=>{
    const claseDia=lista.filter(c=>c.dia===dia.id).sort((a,b)=>a.horaIni.localeCompare(b.horaIni));
    if(!claseDia.length) return;
    const uidDia=`${tipo}-${dia.id}`;
    const abierto=dia.id===hoyId;
    html+=`
    <div class="dia-acordeon">
      <div class="dia-header" onclick="toggleDiaAcordeon('${uidDia}')">
        <span class="dia-nombre">${dia.label}${abierto?' · Hoy':''}</span>
        <span class="dia-count">${claseDia.length} clase${claseDia.length>1?'s':''} <span class="chevron" id="chev-dia-${uidDia}">${abierto?'▲':'▼'}</span></span>
      </div>
      <div class="dia-body${abierto?' open':''}" id="body-dia-${uidDia}">
        ${claseDia.map(c=>renderSlotCard(tipo,c)).join('')}
      </div>
    </div>`;
  });

  cont.innerHTML=html;
}

window.toggleDiaAcordeon=function(uid){
  const body=document.getElementById('body-dia-'+uid), chev=document.getElementById('chev-dia-'+uid);
  if(!body) return;
  body.classList.toggle('open');
  chev.textContent=body.classList.contains('open')?'▲':'▼';
};

function renderSlotCard(tipo,c){
  const esSup=currentUser.role==='supervisor';
  const uid=`${tipo}-${c.id}`;
  const antig=calcularAntiguedad(c.fechaInicio);
  const disciplinaTxt=tipo==='aerobicos'?(c.disciplina||''):'Spinning';
  const yaSolicitada=solicitudesData[tipo].some(s=>s.claseId===c.id);

  return `
  <div class="slot-card">
    <div class="slot-header" onclick="toggleSlotCard('${tipo}','${c.id}')">
      <div class="slot-hora">${c.horaIni}–${c.horaFin}</div>
      <div class="slot-info">
        <div class="slot-instructor">${c.instructor}</div>
        <div class="slot-disciplina">${disciplinaTxt}${c.costo?` · Bs ${c.costo}`:''}</div>
      </div>
      <div class="slot-actions">
        ${esSup?`
          <button class="slot-icon-btn" onclick="event.stopPropagation();abrirModalClase('${tipo}','${c.id}')" title="Editar">✎</button>
        `:`
          <button class="slot-icon-btn" onclick="event.stopPropagation();solicitarBorradoClase('${tipo}','${c.id}')" title="Solicitar eliminación" ${yaSolicitada?'disabled style="opacity:.4"':''}>🗑</button>
        `}
        <span class="chevron" id="chev-slot-${uid}">▼</span>
      </div>
    </div>
    <div class="slot-body" id="body-slot-${uid}">
      <div class="slot-detail-row">
        <div>Costo por clase: <strong>Bs ${c.costo||0}</strong></div>
        <div>Celular: <strong>${c.celular||'—'}</strong></div>
        <div>Antigüedad: <strong>${antig}</strong></div>
      </div>
      <button class="slot-btn-registrar" onclick="abrirModalHistClase('${tipo}','${c.id}')">+ Registrar clase de hoy</button>
      <div class="hist-mini-title">Historial reciente</div>
      <div id="hist-mini-${uid}"><div class="empty" style="padding:12px 0">Toca para ver</div></div>
    </div>
  </div>`;
}

window.toggleSlotCard=async function(tipo,claseId){
  const uid=`${tipo}-${claseId}`;
  const body=document.getElementById('body-slot-'+uid), chev=document.getElementById('chev-slot-'+uid);
  if(!body) return;
  const abriendo=!body.classList.contains('open');
  body.classList.toggle('open');
  chev.textContent=body.classList.contains('open')?'▲':'▼';
  if(abriendo && !histClaseCache[claseId]) await cargarHistMiniClase(tipo,claseId);
};

async function cargarHistMiniClase(tipo,claseId){
  try{
    const q=query(collection(db,'historial_clases'),where('claseId','==',claseId));
    const snap=await getDocs(q);
    histClaseCache[claseId]=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  }catch(e){ histClaseCache[claseId]=[]; }
  renderHistMini(tipo,claseId);
}

function renderHistMini(tipo,claseId){
  const cont=document.getElementById(`hist-mini-${tipo}-${claseId}`);
  if(!cont) return;
  const regs=(histClaseCache[claseId]||[]).slice(0,8);
  if(!regs.length){ cont.innerHTML='<div class="empty" style="padding:12px 0">Sin registros todavía</div>'; return; }
  cont.innerHTML=regs.map(r=>`
    <div class="hist-mini-row">
      <span class="hist-mini-fecha">${r.fecha}</span>
      <span class="estado-badge estado-${r.estado}">${estadoHistLabel(r.estado)}</span>
      ${r.alumnosInicio!=null||r.alumnosFin!=null?`<span>${r.alumnosInicio??'?'}→${r.alumnosFin??'?'} alumnos</span>`:''}
      ${r.estado==='retraso'&&r.atrasoMin?`<span>${r.atrasoMin} min</span>`:''}
      ${r.estado==='reemplazo'&&r.reemplazoNombre?`<span>Reemplazo: ${r.reemplazoNombre}${r.reemplazoGestionadoPor?' ('+gestionadoLabel(r.reemplazoGestionadoPor)+')':''}</span>`:''}
      ${r.estado==='cancelada'&&r.motivoCancelacion?`<span>${motivoCancelLabel(r.motivoCancelacion)}</span>`:''}
    </div>`).join('');
}

// ------------------------------------------------------------
// MODAL: crear/editar clase (SOLO SUPERVISOR)
// ------------------------------------------------------------
window.abrirModalClase=function(tipo,claseId=null){
  document.getElementById('clase-tipo').value=tipo;
  document.getElementById('clase-id-edit').value=claseId||'';
  document.getElementById('modal-clase-titulo').textContent=claseId?'Editar clase':'Nueva clase';
  document.getElementById('campo-disciplina').style.display=tipo==='aerobicos'?'block':'none';
  document.getElementById('btn-borrar-clase').style.display=claseId?'inline-block':'none';

  const c=claseId?clasesData[tipo].find(x=>x.id===claseId):null;
  document.getElementById('clase-dia').value=c?c.dia:'lunes';
  document.getElementById('clase-hora-ini').value=c?c.horaIni:'';
  document.getElementById('clase-hora-fin').value=c?c.horaFin:'';
  document.getElementById('clase-instructor').value=c?c.instructor:'';
  document.getElementById('clase-disciplina').value=c?(c.disciplina||''):'';
  document.getElementById('clase-costo').value=c?(c.costo||''):'';
  document.getElementById('clase-celular').value=c?(c.celular||''):'';
  document.getElementById('clase-fecha-inicio').value=c?(c.fechaInicio||''):fechaHoy();
  document.getElementById('modal-clase').classList.add('open');
};

window.guardarClase=async function(){
  const tipo=document.getElementById('clase-tipo').value;
  const claseId=document.getElementById('clase-id-edit').value;
  const dia=document.getElementById('clase-dia').value;
  const horaIni=document.getElementById('clase-hora-ini').value;
  const horaFin=document.getElementById('clase-hora-fin').value;
  const instructor=document.getElementById('clase-instructor').value.trim();
  const disciplina=tipo==='aerobicos'?document.getElementById('clase-disciplina').value.trim():'Spinning';
  const costo=Number(document.getElementById('clase-costo').value)||0;
  const celular=document.getElementById('clase-celular').value.trim();
  const fechaInicio=document.getElementById('clase-fecha-inicio').value||fechaHoy();

  if(!horaIni||!horaFin||!instructor||(tipo==='aerobicos'&&!disciplina)){ showToast('Completa los campos obligatorios','err'); return; }
  showLoading();
  try{
    const data={sucursal:currentSuc,tipo,dia,horaIni,horaFin,instructor,disciplina,costo,celular,fechaInicio,
      actualizadoPor:currentUser.name,actualizadoEn:new Date().toISOString()};
    if(claseId){
      await updateDoc(doc(db,'clases',claseId),data);
    } else {
      data.creadoPor=currentUser.name; data.creadoEn=new Date().toISOString();
      await setDoc(doc(collection(db,'clases')),data);
    }
    closeModal('modal-clase');
    showToast('Clase guardada');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// Solo llamable desde dentro del modal de edición → siempre supervisor
window.borrarClase=async function(){
  const tipo=document.getElementById('clase-tipo').value;
  const claseId=document.getElementById('clase-id-edit').value;
  if(!claseId) return;
  if(!confirm('¿Eliminar esta clase del horario? También se borrará su historial.')) return;
  showLoading();
  try{
    const qh=query(collection(db,'historial_clases'),where('claseId','==',claseId));
    const sh=await getDocs(qh);
    await Promise.all(sh.docs.map(d=>deleteDoc(doc(db,'historial_clases',d.id))));

    const qs=query(collection(db,'solicitudes_borrado'),where('claseId','==',claseId),where('estado','==','pendiente'));
    const ss=await getDocs(qs);
    await Promise.all(ss.docs.map(d=>updateDoc(doc(db,'solicitudes_borrado',d.id),{estado:'aprobado',resueltoPor:currentUser.name,resueltoEn:new Date().toISOString()})));

    await deleteDoc(doc(db,'clases',claseId));
    delete histClaseCache[claseId];
    closeModal('modal-clase');
    showToast('Clase eliminada');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error al eliminar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// SOLICITUD DE BORRADO (recepción) + aprobación (supervisor)
// ------------------------------------------------------------
window.solicitarBorradoClase=async function(tipo,claseId){
  const c=clasesData[tipo].find(x=>x.id===claseId);
  if(!c) return;
  if(solicitudesData[tipo].some(s=>s.claseId===claseId)){ showToast('Ya hay una solicitud pendiente para esta clase','err'); return; }
  if(!confirm(`¿Enviar solicitud para eliminar la clase de ${diaLabel(c.dia)} ${c.horaIni} con ${c.instructor}? El supervisor debe aprobarla.`)) return;
  showLoading();
  try{
    await setDoc(doc(collection(db,'solicitudes_borrado')),{
      tipo:'clase', claseId, sucursal:currentSuc, tipoClase:tipo,
      resumen:`${diaLabel(c.dia)} ${c.horaIni}–${c.horaFin} · ${c.instructor}${tipo==='aerobicos'&&c.disciplina?' ('+c.disciplina+')':''}`,
      solicitadoPor:currentUser.name, solicitadoEn:new Date().toISOString(), estado:'pendiente',
    });
    showToast('Solicitud enviada. El supervisor debe aprobarla.');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error al enviar la solicitud','err'); }
  hideLoading();
};

window.resolverSolicitud=async function(id,tipo,aprobar){
  const s=solicitudesData[tipo].find(x=>x.id===id);
  if(!s) return;
  showLoading();
  try{
    if(aprobar){
      const qh=query(collection(db,'historial_clases'),where('claseId','==',s.claseId));
      const sh=await getDocs(qh);
      await Promise.all(sh.docs.map(d=>deleteDoc(doc(db,'historial_clases',d.id))));
      await deleteDoc(doc(db,'clases',s.claseId));
      delete histClaseCache[s.claseId];
    }
    await updateDoc(doc(db,'solicitudes_borrado',id),{estado:aprobar?'aprobado':'rechazado',resueltoPor:currentUser.name,resueltoEn:new Date().toISOString()});
    showToast(aprobar?'Clase eliminada':'Solicitud rechazada');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// MODAL: registrar historial del día (recepción + supervisor)
// ------------------------------------------------------------
window.abrirModalHistClase=function(tipo,claseId){
  const c=clasesData[tipo].find(x=>x.id===claseId);
  if(!c) return;
  document.getElementById('hist-clase-tipo').value=tipo;
  document.getElementById('hist-clase-id').value=claseId;
  document.getElementById('modal-hist-clase-sub').textContent=`${diaLabel(c.dia)} ${c.horaIni}–${c.horaFin} · ${c.instructor}`;
  document.getElementById('hist-clase-fecha').value=fechaHoy();
  document.getElementById('hist-clase-estado').value='realizada';
  document.getElementById('hist-clase-atraso').value='';
  document.getElementById('hist-clase-reemplazo').value='';
  document.getElementById('hist-clase-gestionado').value='instructor';
  document.getElementById('hist-clase-motivo').value='ausencia_sin_aviso';
  document.getElementById('hist-clase-alum-ini').value='';
  document.getElementById('hist-clase-alum-fin').value='';
  document.getElementById('hist-clase-obs').value='';
  onCambioEstadoHist();
  document.getElementById('modal-hist-clase').classList.add('open');
};

// El formulario es dinámico: solo se ven los campos que corresponden
// al estado elegido, para que recepción lo llene rápido y sin ruido.
window.onCambioEstadoHist=function(){
  const est=document.getElementById('hist-clase-estado').value;
  document.getElementById('campo-hist-retraso').style.display    = est==='retraso'   ?'block':'none';
  document.getElementById('campo-hist-reemplazo').style.display  = est==='reemplazo' ?'block':'none';
  document.getElementById('campo-hist-gestionado').style.display = est==='reemplazo' ?'block':'none';
  document.getElementById('campo-hist-motivo').style.display     = est==='cancelada' ?'block':'none';
};

window.guardarHistClase=async function(){
  const tipo=document.getElementById('hist-clase-tipo').value;
  const claseId=document.getElementById('hist-clase-id').value;
  const fecha=document.getElementById('hist-clase-fecha').value||fechaHoy();
  const estado=document.getElementById('hist-clase-estado').value;
  const atrasoMin=Number(document.getElementById('hist-clase-atraso').value)||0;
  const reemplazoNombre=document.getElementById('hist-clase-reemplazo').value.trim();
  const reemplazoGestionadoPor=document.getElementById('hist-clase-gestionado').value;
  const motivoCancelacion=document.getElementById('hist-clase-motivo').value;
  const alumIniVal=document.getElementById('hist-clase-alum-ini').value;
  const alumFinVal=document.getElementById('hist-clase-alum-fin').value;
  const alumnosInicio = alumIniVal!==''?Number(alumIniVal):null;
  const alumnosFin    = alumFinVal!==''?Number(alumFinVal):null;
  const obs=document.getElementById('hist-clase-obs').value.trim();
  if(!claseId) return;

  if(estado==='reemplazo' && !reemplazoNombre){ showToast('Indica el instructor reemplazante','err'); return; }

  showLoading();
  try{
    const c=clasesData[tipo].find(x=>x.id===claseId);
    await setDoc(doc(db,'historial_clases',`${claseId}_${fecha}`),{
      claseId, sucursal:currentSuc, tipo, fecha, estado,
      instructor: c?c.instructor:null, // se guarda plano para poder agrupar por instructor sin hacer join
      dia: c?c.dia:null, horaIni: c?c.horaIni:null, horaFin: c?c.horaFin:null,
      atrasoMin: estado==='retraso'?atrasoMin:null,
      reemplazoNombre: estado==='reemplazo'?reemplazoNombre:null,
      reemplazoGestionadoPor: estado==='reemplazo'?reemplazoGestionadoPor:null,
      motivoCancelacion: estado==='cancelada'?motivoCancelacion:null,
      alumnosInicio, alumnosFin,
      obs, registradoPor:currentUser.name, registradoEn:new Date().toISOString(),
    });
    closeModal('modal-hist-clase');
    showToast('Registro guardado');
    delete histClaseCache[claseId];
    await cargarHistMiniClase(tipo,claseId);
  }catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// REPORTE POR INSTRUCTOR
// Junta todos los registros de historial_clases de un instructor
// (sin importar en cuántos horarios distintos dé clase) para sacar
// estadísticas generales: puntualidad, cancelaciones, reemplazos y
// asistencia promedio, en vez de tener que revisar clase por clase.
// ------------------------------------------------------------
window.abrirReporteInstructor=function(tipo){
  document.getElementById('rep-tipo').value=tipo;
  const instructores=[...new Set(clasesData[tipo].map(c=>c.instructor))].sort();
  document.getElementById('rep-instructor').innerHTML=instructores.map(i=>`<option value="${i}">${i}</option>`).join('');
  document.getElementById('rep-instructor-resultado').innerHTML='';
  document.getElementById('modal-reporte-instructor').classList.add('open');
};

function fechaDesdePeriodo(periodo){
  if(periodo==='todo') return null;
  const meses = periodo==='mes' ? 1 : 3;
  const d=new Date();
  d.setMonth(d.getMonth()-meses);
  return fechaLocal(d);
}

window.generarReporteInstructor=async function(){
  const tipo=document.getElementById('rep-tipo').value;
  const instructor=document.getElementById('rep-instructor').value;
  const periodo=document.getElementById('rep-periodo').value;
  const cont=document.getElementById('rep-instructor-resultado');
  if(!instructor) return;
  cont.innerHTML='<div class="empty" style="padding:12px 0">Cargando...</div>';
  try{
    const q=query(collection(db,'historial_clases'),where('sucursal','==',currentSuc),where('tipo','==',tipo),where('instructor','==',instructor));
    const snap=await getDocs(q);
    const desde=fechaDesdePeriodo(periodo);
    let regs=snap.docs.map(d=>d.data());
    if(desde) regs=regs.filter(r=>r.fecha>=desde);

    if(!regs.length){ cont.innerHTML='<div class="empty" style="padding:12px 0">Sin registros en este período</div>'; return; }

    const total=regs.length;
    const porEstado={realizada:0,retraso:0,reemplazo:0,cancelada:0};
    regs.forEach(r=>{ if(porEstado[r.estado]!=null) porEstado[r.estado]++; });
    const dictadas = porEstado.realizada+porEstado.retraso+porEstado.reemplazo;
    const puntualidad = dictadas ? Math.round(porEstado.realizada/dictadas*100) : 0;
    const pctCancel = Math.round(porEstado.cancelada/total*100);

    const asistencias=regs.filter(r=>r.alumnosFin!=null).map(r=>r.alumnosFin);
    const promAsist = asistencias.length ? (asistencias.reduce((a,b)=>a+b,0)/asistencias.length).toFixed(1) : '—';

    const motivos={};
    regs.filter(r=>r.estado==='cancelada').forEach(r=>{
      const m=r.motivoCancelacion||'otro';
      motivos[m]=(motivos[m]||0)+1;
    });

    // Desglose por horario (día + hora), porque el mismo instructor
    // puede tener varios bloques distintos en la semana
    const porHorario={};
    regs.forEach(r=>{
      const key=`${diaLabel(r.dia)} ${r.horaIni||''}–${r.horaFin||''}`;
      porHorario[key]=(porHorario[key]||0)+1;
    });

    cont.innerHTML=`
      <div class="rep-stats-grid">
        <div class="rep-stat-card"><div class="rep-stat-num">${total}</div><div class="rep-stat-label">Clases registradas</div></div>
        <div class="rep-stat-card"><div class="rep-stat-num">${puntualidad}%</div><div class="rep-stat-label">Puntualidad</div></div>
        <div class="rep-stat-card"><div class="rep-stat-num">${pctCancel}%</div><div class="rep-stat-label">Canceladas</div></div>
        <div class="rep-stat-card"><div class="rep-stat-num">${promAsist}</div><div class="rep-stat-label">Asistencia promedio</div></div>
      </div>
      <div class="rep-section-title">Detalle</div>
      <div class="rep-motivo-row"><span>Realizadas normalmente</span><strong>${porEstado.realizada}</strong></div>
      <div class="rep-motivo-row"><span>Realizadas con retraso</span><strong>${porEstado.retraso}</strong></div>
      <div class="rep-motivo-row"><span>Realizadas con reemplazo</span><strong>${porEstado.reemplazo}</strong></div>
      <div class="rep-motivo-row"><span>Canceladas</span><strong>${porEstado.cancelada}</strong></div>
      ${Object.keys(motivos).length?`
        <div class="rep-section-title">Motivos de cancelación</div>
        ${Object.entries(motivos).map(([m,n])=>`<div class="rep-motivo-row"><span>${motivoCancelLabel(m)}</span><strong>${n}</strong></div>`).join('')}
      `:''}
      <div class="rep-section-title">Por horario</div>
      ${Object.entries(porHorario).map(([h,n])=>`<div class="rep-horario-row"><span>${h}</span><strong>${n} registro${n>1?'s':''}</strong></div>`).join('')}
    `;
  }catch(e){ cont.innerHTML='<div class="empty" style="padding:12px 0">Error al cargar el reporte</div>'; }
};

// ------------------------------------------------------------
// CLASES ESPECIALES (feriados / fines de semana)
// Tanto supervisor como recepción pueden crear, editar y borrar.
// ------------------------------------------------------------
function renderEspecialesTipo(tipo){
  const cont=document.getElementById(`${tipo}-especiales-container`);
  if(!cont) return;
  const lista=especialesData[tipo];
  if(!lista.length){ cont.innerHTML='<div class="empty">Sin clases especiales programadas</div>'; return; }
  cont.innerHTML=lista.map(e=>`
    <div class="especial-card" onclick="abrirModalEspecial('${tipo}','${e.id}')">
      <div class="especial-fecha">${formatoFechaCorta(e.fecha)}</div>
      <div class="especial-info">
        <div class="especial-nombre">${e.instructor}${tipo==='aerobicos'&&e.disciplina?' · '+e.disciplina:''}</div>
        <div class="especial-meta">${e.horaIni}–${e.horaFin} · Bs ${e.monto||0}/cliente${e.estado==='realizado'&&e.asistieron!=null?' · '+e.asistieron+' asistieron':''}</div>
      </div>
      <span class="estado-badge estado-${e.estado}">${estadoEspecialLabel(e.estado)}</span>
    </div>`).join('');
}

window.abrirModalEspecial=function(tipo,id=null){
  document.getElementById('especial-tipo').value=tipo;
  document.getElementById('especial-id-edit').value=id||'';
  document.getElementById('campo-especial-disciplina').style.display=tipo==='aerobicos'?'block':'none';
  document.getElementById('btn-borrar-especial').style.display=id?'inline-block':'none';

  const e=id?especialesData[tipo].find(x=>x.id===id):null;
  document.getElementById('especial-fecha').value=e?e.fecha:fechaHoy();
  document.getElementById('especial-hora-ini').value=e?e.horaIni:'';
  document.getElementById('especial-hora-fin').value=e?e.horaFin:'';
  document.getElementById('especial-disciplina').value=e?(e.disciplina||''):'';
  document.getElementById('especial-instructor').value=e?(e.instructor||''):'';
  document.getElementById('especial-monto').value=e?(e.monto||''):'';
  document.getElementById('especial-estado').value=e?(e.estado||'reservado'):'reservado';
  document.getElementById('especial-asistieron').value=(e&&e.asistieron!=null)?e.asistieron:'';
  toggleCampoAsistieron();
  document.getElementById('modal-especial').classList.add('open');
};

function toggleCampoAsistieron(){
  const est=document.getElementById('especial-estado').value;
  document.getElementById('campo-especial-asistieron').style.display=est==='realizado'?'block':'none';
}
document.getElementById('especial-estado')?.addEventListener('change',toggleCampoAsistieron);

window.guardarEspecial=async function(){
  const tipo=document.getElementById('especial-tipo').value;
  const id=document.getElementById('especial-id-edit').value;
  const fecha=document.getElementById('especial-fecha').value;
  const horaIni=document.getElementById('especial-hora-ini').value;
  const horaFin=document.getElementById('especial-hora-fin').value;
  const disciplina=tipo==='aerobicos'?document.getElementById('especial-disciplina').value.trim():'Spinning';
  const instructor=document.getElementById('especial-instructor').value.trim();
  const monto=Number(document.getElementById('especial-monto').value)||0;
  const estado=document.getElementById('especial-estado').value;
  const asistieronVal=document.getElementById('especial-asistieron').value;
  const asistieron=asistieronVal!==''?Number(asistieronVal):null;

  if(!fecha||!horaIni||!horaFin||!instructor){ showToast('Completa los campos obligatorios','err'); return; }
  showLoading();
  try{
    const data={sucursal:currentSuc,tipo,fecha,horaIni,horaFin,disciplina,instructor,monto,estado,asistieron,
      actualizadoPor:currentUser.name,actualizadoEn:new Date().toISOString()};
    if(id){
      await updateDoc(doc(db,'especiales',id),data);
    } else {
      data.creadoPor=currentUser.name; data.creadoEn=new Date().toISOString();
      await setDoc(doc(collection(db,'especiales')),data);
    }
    closeModal('modal-especial');
    showToast('Clase especial guardada');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

window.borrarEspecial=async function(){
  const tipo=document.getElementById('especial-tipo').value;
  const id=document.getElementById('especial-id-edit').value;
  if(!id) return;
  if(!confirm('¿Eliminar esta clase especial?')) return;
  showLoading();
  try{
    await deleteDoc(doc(db,'especiales',id));
    closeModal('modal-especial');
    showToast('Clase especial eliminada');
    await initClasesPanel(tipo);
  }catch(e){ showToast('Error al eliminar','err'); }
  hideLoading();
};

// ============================================================
// ACCESORIOS — catálogo, conteo por turno y seguimiento de casos
//
// Colecciones (Firestore):
//  accesorios              catálogo por sucursal: en uso / reserva / activo
//  conteo_accesorios       1 doc por sucursal+día+turno+momento. items:
//                            {accId: {ok:true, esperado}
//                                  | {ok:false, tipo, esperado, encontrados, faltante, nota}}
//  incidencias_accesorios  "casos" de seguimiento (faltante / defectuoso).
//                          estado: abierta | cerrada | anulada. NUNCA se borran.
//  movimientos_accesorios  bitácora de TODO lo que se hace (quién, qué, cuándo).
//                          Solo se agregan registros; no se editan ni se borran.
//
// Regla clave: el número oficial ("en uso") solo lo cambia el supervisor con
// una acción registrada (baja, reposición, ajuste). Un caso abierto NO lo
// toca: únicamente baja lo que se espera encontrar en sala, para que el mismo
// faltante no se reporte de nuevo en cada turno.
//
// Los pares se manejan en "medios pares": 1 lado = 0.5 par.
// ============================================================
let accesoriosData = [];
let casosAcc = [];
let fotoAccesorioActual = null;
let inventarioChecklistActual = {turno:'manana', momento:'inicio', zona:'recepcion'};
let invUltimoSala = null;   // último conteo de sala de máquinas (para avisar cuánto hace)
let invEstado = {};          // decisión del instructor por accesorio (borrador o guardado)
let invAbierto = null;       // accesorio con el formulario "Falta algo" abierto
let invGuardadoInfo = null;  // {contadoPor, hora} si este conteo ya se guardó
let incidenciaActualId = null;
let movimientosCache = [];

const UBIC_LABEL  = {maquinas:'Sala de máquinas', recepcion:'Recepción'};
const TURNO_LABEL = {manana:'Mañana', tarde:'Tarde'};
const TIPO_CASO_LABEL = {faltante:'Faltante', defectuoso:'Defectuoso'};
const RES_LABEL = {aparecio:'Apareció / reparado', pagado:'Pagado por cliente', baja:'Dado de baja', anulada:'Anulado'};

// Zonas de conteo: Recepción es el conteo frecuente (por turno, inicio y fin);
// Sala de máquinas es aparte y ocasional (no hace falta en cada turno).
const ZONAS = {
  recepcion: {label:'Recepción',        ubicacion:'recepcion'},
  sala:      {label:'Sala de máquinas', ubicacion:'maquinas'},
};
function byId(id){ return document.getElementById(id); }
function escAcc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function turnoDeAhora(){ return new Date().getHours() < 14 ? 'manana' : 'tarde'; }
function conteoDocId(turno, momento){ return `${currentSuc}_${fechaHoy()}_${turno}_${momento}`; }
function redondearCant(v, unidad){ v = Number(v)||0; return unidad==='par' ? Math.round(v*2)/2 : Math.round(v); }

// Texto de cantidad. Para pares, medio par se lee "1 lado".
function cantTexto(n, unidad){
  n = Number(n)||0;
  if(unidad==='par'){
    const ent = Math.floor(n);
    const lado = (n-ent) >= 0.5;
    const partes = [];
    if(ent>0 || !lado) partes.push(`${ent} ${ent===1?'par':'pares'}`);
    if(lado) partes.push('1 lado');
    return partes.join(' y ');
  }
  return `${n} ${n===1?'unidad':'unidades'}`;
}
function haceTiempo(iso){
  if(!iso) return '';
  const dias = Math.floor((Date.now()-new Date(iso).getTime())/86400000);
  if(dias<=0) return 'hoy';
  return dias===1 ? 'hace 1 día' : `hace ${dias} días`;
}
function diasDesde(iso){ return iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : 0; }
function diasEntreFechas(f1, f2){   // días de f1 a f2 (YYYY-MM-DD)
  const [a,b,c] = f1.split('-').map(Number), [d,e,g] = f2.split('-').map(Number);
  return Math.round((Date.UTC(d,e-1,g)-Date.UTC(a,b-1,c))/86400000);
}
function haceFecha(f){ const n = diasEntreFechas(f, fechaHoy()); return n<=0 ? 'hoy' : (n===1 ? 'ayer' : `hace ${n} días`); }
function fechaCorta(f){ if(!f) return ''; const [,m,d]=f.split('-'); return `${d}/${m}`; }

// ---------- datos ----------
async function cargarAccesoriosDatos(){
  const snap = await getDocs(query(collection(db,'accesorios'), where('sucursal','==',currentSuc)));
  accesoriosData = snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function cargarIncidenciasDatos(){
  const snap = await getDocs(query(collection(db,'incidencias_accesorios'), where('sucursal','==',currentSuc)));
  casosAcc = snap.docs.map(d=>({id:d.id,...d.data()}));
}
// Orden: el que tú definas con ▲▼; los que aún no tienen orden quedan según se crearon.
function ordenarAcc(list){
  return [...list].sort((x,y)=>{
    const ox = Number.isFinite(x.orden) ? x.orden : 1e9, oy = Number.isFinite(y.orden) ? y.orden : 1e9;
    if(ox!==oy) return ox-oy;
    const cx = x.creadoEn||'', cy = y.creadoEn||'';
    if(cx!==cy) return cx.localeCompare(cy);
    return (x.nombre||'').localeCompare(y.nombre||'','es');
  });
}
function accesoriosDeZona(ubicacion){ return ordenarAcc(accesoriosData.filter(a=>a.activo!==false && a.ubicacion===ubicacion)); }
// Renumera una zona 1..n respetando el orden actual (el nuevo o movido de zona va al final)
async function normalizarOrden(ubicacion){
  const tareas = [];
  accesoriosDeZona(ubicacion).forEach((g,k)=>{
    if(g.orden!==k+1){ g.orden = k+1; tareas.push(updateDoc(doc(db,'accesorios',g.id),{orden:k+1})); }
  });
  await Promise.all(tareas);
}
function accesoriosActivos(){ return accesoriosData.filter(a=>a.activo!==false); }
// Un caso "defectuoso" nuevo ya MOVIÓ las unidades de "en uso" a "defectuosos" al reportarse
// (transferido:true). Los defectuosos de antes de este cambio no movieron nada.
function casoTransferido(i){ return i.tipo==='defectuoso' && i.transferido===true; }
function enSeguimiento(accId, tipo){
  return casosAcc
    .filter(i=>i.estado==='abierta' && i.accesorioId===accId && (!tipo || i.tipo===tipo) && !casoTransferido(i))
    .reduce((s,i)=>s+(Number(i.cantidad)||0), 0);
}
// Defectuosos apartados = lo guardado + casos viejos que aún no habían movido nada
function defectuososDe(a){ return (Number(a.cantidadDefectuosa)||0) + enSeguimiento(a.id,'defectuoso'); }

// Pasa unidades entre "en uso" y "defectuosos" (delta>0: se apartan; delta<0: vuelven a uso).
// Devuelve el texto para la bitácora ('' si no hubo cambio). Lee el accesorio fresco.
async function moverDefectuoso(accId, delta){
  const ref = doc(db,'accesorios',accId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return '';
  const a = snap.data(); const u = a.unidad;
  const uso = Number(a.cantidadRef)||0, def = Number(a.cantidadDefectuosa)||0;
  const mover = delta>0 ? Math.min(delta, uso) : -Math.min(-delta, def);
  if(!mover) return '';
  await updateDoc(ref,{cantidadRef: uso-mover, cantidadDefectuosa: def+mover});
  return `En uso: ${cantTexto(uso,u)} → ${cantTexto(uso-mover,u)} · Defectuosos: ${cantTexto(def,u)} → ${cantTexto(def+mover,u)}`;
}
// Lo que el instructor debe encontrar hoy en sala = en uso − lo que ya está en seguimiento
function esperadoHoy(a){ return Math.max(0, (Number(a.cantidadRef)||0) - enSeguimiento(a.id)); }

// Bitácora: cada acción deja huella (quién, qué, cuándo). Si falla, no frena la acción.
async function registrarMovimiento({accesorioId, accesorioNombre, incidenciaId=null, tipo, detalle}){
  try{
    await setDoc(doc(collection(db,'movimientos_accesorios')),{
      sucursal: currentSuc, accesorioId, accesorioNombre, incidenciaId, tipo, detalle,
      por: currentUser.name, rol: currentUser.role,
      fecha: fechaHoy(), hora: horaActual(), ts: new Date().toISOString(),
    });
  }catch(e){ console.error('No se pudo registrar el movimiento:', e); }
}

function chipsAccesorio(a){
  const res = Number(a.cantidadReserva)||0;
  const def = defectuososDe(a);
  const fal = enSeguimiento(a.id,'faltante');
  let h = '';
  if(res>0) h += `<span class="chip chip-reserva">Reserva · ${cantTexto(res,a.unidad)}</span>`;
  if(def>0) h += `<span class="chip chip-def">Defectuoso · ${cantTexto(def,a.unidad)}</span>`;
  if(fal>0) h += `<span class="chip chip-falta">En búsqueda · ${cantTexto(fal,a.unidad)}</span>`;
  return h;
}
function fotoMini(a){
  return a.foto
    ? `<img src="${a.foto}" class="accesorio-foto-mini zoomable-img" alt="${escAcc(a.nombre)}">`
    : `<div class="accesorio-foto-mini-vacia">🏋</div>`;
}

// ------------------------------------------------------------
// Catálogo (Administración → Accesorios)
// ------------------------------------------------------------
window.cargarAccesorios = async function(){
  const cont = byId('accesorios-container');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{ await Promise.all([cargarAccesoriosDatos(), cargarIncidenciasDatos()]); }
  catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; return; }
  renderAccesorios();
};

function accCardHTML(a, i, n){
  return `
    <div class="accesorio-card">
      ${fotoMini(a)}
      <div class="accesorio-info">
        <div class="accesorio-nombre">${escAcc(a.nombre)}</div>
        <div class="accesorio-meta">En uso: <b>${cantTexto(a.cantidadRef, a.unidad)}</b></div>
        <div class="inv-chips">${chipsAccesorio(a)}</div>
      </div>
      <div class="acc-orden">
        <button class="orden-btn" aria-label="Subir" ${i===0?'disabled':''} onclick="moverAccesorio('${a.id}',-1)">▲</button>
        <button class="orden-btn" aria-label="Bajar" ${i===n-1?'disabled':''} onclick="moverAccesorio('${a.id}',1)">▼</button>
      </div>
      <button class="btn-cancel" onclick="abrirModalAccesorio('${a.id}')">Editar</button>
    </div>`;
}
function renderAccesorios(){
  const cont = byId('accesorios-container');
  const archivados = accesoriosData.filter(a=>a.activo===false);
  if(!accesoriosData.length){ cont.innerHTML='<div class="empty">Todavía no hay accesorios cargados</div>'; return; }
  let html = '';
  ['recepcion','maquinas'].forEach(u=>{
    const grupo = accesoriosDeZona(u);
    html += `<div class="inv-grupo">${UBIC_LABEL[u]}<span>${grupo.length}</span></div>`;
    html += grupo.length ? grupo.map((a,i)=>accCardHTML(a,i,grupo.length)).join('')
                         : `<div class="empty">Sin accesorios en ${UBIC_LABEL[u].toLowerCase()}</div>`;
  });
  if(archivados.length){
    html += `<details class="acc-archivados"><summary>Archivados (${archivados.length})</summary>` +
      archivados.map(a=>`
      <div class="accesorio-card acc-arch">
        ${fotoMini(a)}
        <div class="accesorio-info"><div class="accesorio-nombre">${escAcc(a.nombre)}</div>
          <div class="accesorio-meta">${UBIC_LABEL[a.ubicacion]||a.ubicacion}</div></div>
        <button class="btn-cancel" onclick="reactivarAccesorio('${a.id}')">Reactivar</button>
      </div>`).join('') + `</details>`;
  }
  cont.innerHTML = html;
}

// ▲▼: intercambia con el vecino dentro de la misma zona y renumera la zona
window.moverAccesorio = async function(id, dir){
  const a = accesoriosData.find(x=>x.id===id); if(!a) return;
  const grupo = accesoriosDeZona(a.ubicacion);
  const i = grupo.findIndex(x=>x.id===id), j = i+dir;
  if(i<0 || j<0 || j>=grupo.length) return;
  [grupo[i], grupo[j]] = [grupo[j], grupo[i]];
  const tareas = [];
  grupo.forEach((g,k)=>{ if(g.orden!==k+1){ g.orden = k+1; tareas.push(updateDoc(doc(db,'accesorios',g.id),{orden:k+1})); } });
  renderAccesorios();   // se ve al instante; se guarda en segundo plano
  try{ await Promise.all(tareas); }
  catch(e){ showToast('No se pudo guardar el orden','err'); await cargarAccesorios(); }
};

window.previewFotoAccesorio = async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoAccesorioActual = await comprimirImagen(input.files[0]);
    const img = byId('accesorio-foto-preview');
    img.src = fotoAccesorioActual; img.style.display='block';
    byId('accesorio-foto-placeholder').style.display='none';
  }catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.abrirModalAccesorio = function(id){
  const a = id ? accesoriosData.find(x=>x.id===id) : null;
  byId('modal-accesorio-titulo').textContent = a?'Editar accesorio':'Nuevo accesorio';
  byId('accesorio-id-edit').value = id||'';
  byId('accesorio-nombre').value = a?a.nombre:'';
  byId('accesorio-ubicacion').value = a?a.ubicacion:'maquinas';
  byId('accesorio-cantidad-ref').value = a?a.cantidadRef:'';
  byId('accesorio-cantidad-reserva').value = a?(a.cantidadReserva||0):0;
  byId('accesorio-cantidad-defectuosa').value = a?(a.cantidadDefectuosa||0):0;
  byId('accesorio-unidad').value = a?(a.unidad||'unidad'):'unidad';
  fotoAccesorioActual = a?(a.foto||null):null;
  const preview = byId('accesorio-foto-preview');
  const placeholder = byId('accesorio-foto-placeholder');
  if(fotoAccesorioActual){ preview.src=fotoAccesorioActual; preview.style.display='block'; placeholder.style.display='none'; }
  else { preview.style.display='none'; placeholder.style.display='flex'; }
  byId('accesorio-foto-cam').value='';
  byId('accesorio-foto-gal').value='';
  byId('btn-accesorio-borrar').style.display = a?'inline-block':'none';
  byId('modal-accesorio').classList.add('open');
};

window.guardarAccesorio = async function(){
  const id = byId('accesorio-id-edit').value;
  const nombre = byId('accesorio-nombre').value.trim();
  const ubicacion = byId('accesorio-ubicacion').value;
  const unidad = byId('accesorio-unidad').value;
  const cantidadRef = redondearCant(byId('accesorio-cantidad-ref').value, unidad);
  const cantidadReserva = redondearCant(byId('accesorio-cantidad-reserva').value, unidad);
  const cantidadDefectuosa = redondearCant(byId('accesorio-cantidad-defectuosa').value, unidad);
  if(!nombre){ showToast('Escribe el nombre','err'); return; }
  showLoading();
  try{
    const prev = id ? accesoriosData.find(x=>x.id===id) : null;
    const data = {nombre, ubicacion, cantidadRef, cantidadReserva, cantidadDefectuosa, unidad, foto:fotoAccesorioActual||null, sucursal:currentSuc};
    const cambiaZona = !prev || prev.ubicacion!==ubicacion;
    if(cambiaZona) data.orden = 2e9;   // provisional: queda al final y se renumera abajo
    let accId = id;
    if(id){ await updateDoc(doc(db,'accesorios',id), data); }
    else {
      data.creadoEn = new Date().toISOString(); data.activo = true;
      const ref = doc(collection(db,'accesorios'));
      await setDoc(ref, data); accId = ref.id;
    }
    // Respaldo: todo cambio manual de números queda en la bitácora
    if(!prev){
      await registrarMovimiento({accesorioId:accId, accesorioNombre:nombre, tipo:'alta',
        detalle:`Alta del accesorio. En uso: ${cantTexto(cantidadRef,unidad)} · Reserva: ${cantTexto(cantidadReserva,unidad)} · Defectuosos: ${cantTexto(cantidadDefectuosa,unidad)}`});
    } else {
      const cambios = [];
      if(prev.nombre!==nombre) cambios.push(`Nombre: "${prev.nombre}" → "${nombre}"`);
      if((Number(prev.cantidadRef)||0)!==cantidadRef) cambios.push(`En uso: ${cantTexto(prev.cantidadRef,prev.unidad)} → ${cantTexto(cantidadRef,unidad)}`);
      if((Number(prev.cantidadReserva)||0)!==cantidadReserva) cambios.push(`Reserva: ${cantTexto(prev.cantidadReserva||0,prev.unidad)} → ${cantTexto(cantidadReserva,unidad)}`);
      if((Number(prev.cantidadDefectuosa)||0)!==cantidadDefectuosa) cambios.push(`Defectuosos: ${cantTexto(prev.cantidadDefectuosa||0,prev.unidad)} → ${cantTexto(cantidadDefectuosa,unidad)}`);
      if(cambios.length) await registrarMovimiento({accesorioId:accId, accesorioNombre:nombre, tipo:'ajuste', detalle:'Ajuste manual — '+cambios.join(' · ')});
    }
    closeModal('modal-accesorio');
    await cargarAccesorios();
    if(cambiaZona){ await normalizarOrden(ubicacion); renderAccesorios(); }
    showToast('Guardado');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// No se elimina: se archiva (deja de aparecerle a los instructores pero el historial queda)
window.archivarAccesorio = async function(){
  const id = byId('accesorio-id-edit').value;
  const a = accesoriosData.find(x=>x.id===id);
  if(!a) return;
  if(casosAcc.some(i=>i.accesorioId===id && i.estado==='abierta')){ showToast('Tiene casos abiertos: ciérralos en Seguimiento antes de archivar','err'); return; }
  if(!confirm(`¿Archivar "${a.nombre}"? Deja de aparecerle a los instructores, pero su historial se conserva y puedes reactivarlo.`)) return;
  showLoading();
  try{
    await updateDoc(doc(db,'accesorios',id), {activo:false});
    await registrarMovimiento({accesorioId:id, accesorioNombre:a.nombre, tipo:'archivo', detalle:'Accesorio archivado'});
    closeModal('modal-accesorio');
    await cargarAccesorios();
    showToast('Accesorio archivado');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};
window.reactivarAccesorio = async function(id){
  const a = accesoriosData.find(x=>x.id===id);
  if(!a) return;
  showLoading();
  try{
    await updateDoc(doc(db,'accesorios',id), {activo:true});
    await registrarMovimiento({accesorioId:id, accesorioNombre:a.nombre, tipo:'archivo', detalle:'Accesorio reactivado'});
    await cargarAccesorios();
    showToast('Accesorio reactivado');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// Conteo — pestaña "Conteo" (el instructor marca; recepción y
// supervisor ven el resultado)
// ------------------------------------------------------------
window.initInventarioPanel = async function(){
  const cont = byId('inventario-container');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{ await Promise.all([cargarAccesoriosDatos(), cargarIncidenciasDatos()]); }
  catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; return; }

  if(currentUser.role==='instructor'){
    inventarioChecklistActual = {turno: turnoDeAhora(), momento:'inicio', zona:'recepcion'};
    invAbierto = null;
    invUltimoSala = await ultimoConteoSala();
    await cargarConteoActual();
    renderInventarioInstructor();
  } else {
    await renderInventarioLectura();
  }
};

async function ultimoConteoSala(){
  try{
    const snap = await getDocs(query(collection(db,'conteo_accesorios'), where('sucursal','==',currentSuc), where('momento','==','sala')));
    const l = snap.docs.map(d=>d.data()).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'') || (b.guardadoEn||'').localeCompare(a.guardadoEn||''));
    return l[0] || null;
  }catch(e){ return null; }
}

function invDraftKey(){ return 'inv_draft_'+conteoDocId(inventarioChecklistActual.turno, inventarioChecklistActual.momento); }
function invGuardarDraft(){ try{ localStorage.setItem(invDraftKey(), JSON.stringify(invEstado)); }catch(e){} }

async function cargarConteoActual(){
  const { turno, momento } = inventarioChecklistActual;
  invEstado = {}; invGuardadoInfo = null;
  try{
    const snap = await getDoc(doc(db,'conteo_accesorios', conteoDocId(turno, momento)));
    if(snap.exists()){
      const d = snap.data();
      invGuardadoInfo = {contadoPor:d.contadoPor, hora:d.hora};
      Object.entries(d.items||{}).forEach(([accId,v])=>{
        if(typeof v==='number'){ // formato anterior: solo el número contado
          const a = accesoriosData.find(x=>x.id===accId); if(!a) return;
          const ref = Number(a.cantidadRef)||0;
          invEstado[accId] = v===ref ? {ok:true, esperado:ref}
            : {ok:false, tipo:'faltante', esperado:ref, encontrados:v, faltante:Math.max(0,ref-v), nota:'(registro anterior)'};
        } else invEstado[accId] = v;
      });
    } else {
      // Borrador local: si la página se recarga a mitad del conteo, no se pierde lo marcado
      try{ const raw = localStorage.getItem(invDraftKey()); if(raw) invEstado = JSON.parse(raw)||{}; }catch(e){}
    }
  } catch(e){ invEstado = {}; }
}

window.cambiarChecklistInventario = async function(turno, momento, zona){
  const c = inventarioChecklistActual;
  if(zona && zona!==c.zona){ c.zona = zona; c.momento = zona==='sala' ? 'sala' : 'inicio'; }
  if(turno) c.turno = turno;
  if(momento && c.zona==='recepcion') c.momento = momento;
  invAbierto = null;
  await cargarConteoActual();
  renderInventarioInstructor();
};

function invEsperado(a){
  const st = invEstado[a.id];
  return (st && st.esperado!==undefined) ? st.esperado : esperadoHoy(a);
}

function invCardHTML(a){
  const st = invEstado[a.id];
  const esperado = invEsperado(a);
  const abierto = invAbierto===a.id;
  const clase = 'inv-card' + (st ? (st.ok?' inv-ok':' inv-prob') : '');
  const esPar = a.unidad==='par';
  let html = `
  <div class="${clase}">
    <div class="inv-fila">
      ${fotoMini(a)}
      <div class="inv-info">
        <div class="inv-nombre">${escAcc(a.nombre)}</div>
        <div class="inv-debe">DEBE HABER</div>
        <div class="inv-esperado">${cantTexto(esperado, a.unidad)}</div>
        <div class="inv-chips">${chipsAccesorio(a)}</div>
      </div>
    </div>
    <div class="inv-acciones">
      <button class="inv-btn-ok ${st&&st.ok?'on':''}" onclick="invMarcarOk('${a.id}')">✓ Completo</button>
      <button class="inv-btn-falta ${st&&!st.ok?'on':''}" onclick="invAbrirReporte('${a.id}')">Falta algo</button>
    </div>`;
  if(st && !st.ok && !abierto){
    html += `<div class="inv-reporte"><b>${TIPO_CASO_LABEL[st.tipo]||'Reporte'}:</b> faltan ${cantTexto(st.faltante, a.unidad)}
      <span class="inv-reporte-sub">(encontraste ${cantTexto(st.encontrados, a.unidad)})</span>${st.nota?`<div class="inv-reporte-nota">“${escAcc(st.nota)}”</div>`:''}</div>`;
  }
  if(abierto){
    const pre = (st && !st.ok) ? st : {};
    html += `
    <div class="inv-form">
      <div class="inv-form-tipo">
        <label class="inv-radio"><input type="radio" name="inv-tipo-${a.id}" value="faltante" ${(pre.tipo||'faltante')==='faltante'?'checked':''}> Falta / se perdió</label>
        <label class="inv-radio"><input type="radio" name="inv-tipo-${a.id}" value="defectuoso" ${pre.tipo==='defectuoso'?'checked':''}> Defectuoso (se aparta)</label>
      </div>
      <div class="inv-form-campos">
        <label>${esPar?'Pares completos que encontraste':'¿Cuántas encontraste?'}
          <input type="number" inputmode="numeric" min="0" step="1" id="inv-p-${a.id}" value="${pre.pares!==undefined?pre.pares:''}" oninput="invPreview('${a.id}')"></label>
        ${esPar?`<label>Lados sueltos (un solo lado)
          <input type="number" inputmode="numeric" min="0" step="1" id="inv-l-${a.id}" value="${pre.lados!==undefined?pre.lados:''}" oninput="invPreview('${a.id}')"></label>`:''}
      </div>
      <input type="text" id="inv-nota-${a.id}" class="inv-nota" maxlength="140" placeholder="Observación (opcional)" value="${escAcc(pre.nota||'')}">
      <div class="inv-prev" id="inv-prev-${a.id}"></div>
      <div class="inv-form-btns">
        <button class="btn-cancel" onclick="invCancelarReporte()">Cancelar</button>
        <button class="btn-send" onclick="invConfirmarReporte('${a.id}')">Confirmar reporte</button>
      </div>
    </div>`;
  }
  return html + '</div>';
}

function renderInventarioInstructor(){
  const cont = byId('inventario-container');
  const y = window.scrollY;
  const { turno, momento, zona } = inventarioChecklistActual;
  const Z = ZONAS[zona];
  const activos = accesoriosDeZona(Z.ubicacion);

  const segZona = Object.entries(ZONAS).map(([k,z])=>`<button class="${zona===k?'on':''}" onclick="cambiarChecklistInventario(null,null,'${k}')">${z.label}</button>`).join('');
  const segTurno = ['manana','tarde'].map(t=>`<button class="${turno===t?'on':''}" onclick="cambiarChecklistInventario('${t}',null,null)">Turno ${TURNO_LABEL[t].toLowerCase()}</button>`).join('');
  const segMom = zona==='recepcion'
    ? `<div class="inv-seg">${[['inicio','Inicio de turno'],['fin','Fin de turno']].map(([m,l])=>`<button class="${momento===m?'on':''}" onclick="cambiarChecklistInventario(null,'${m}',null)">${l}</button>`).join('')}</div>` : '';
  const notaSala = zona==='sala'
    ? `<div class="inv-banner nota">Conteo ocasional: no hace falta en cada turno. ${invUltimoSala?`Último conteo: <b>${fechaCorta(invUltimoSala.fecha)}</b> por ${escAcc(invUltimoSala.contadoPor)} (${haceFecha(invUltimoSala.fecha)}).`:'Todavía no hay conteos de sala.'}</div>` : '';
  const header = `
  <div class="inv-header">
    <div class="inv-seg inv-seg-zona">${segZona}</div>
    <div class="inv-seg">${segTurno}</div>
    ${segMom}
  </div>${notaSala}`;

  if(!activos.length){
    cont.innerHTML = header + `<div class="empty">No hay accesorios de ${Z.label.toLowerCase()} en el catálogo todavía. Pídele al supervisor que los agregue en Administración → Accesorios.</div>`;
    return;
  }
  const total = activos.length;
  const hechos = activos.filter(a=>invEstado[a.id]).length;
  const reportes = activos.filter(a=>invEstado[a.id] && !invEstado[a.id].ok).length;
  const pct = Math.round(hechos/total*100);

  let html = header + `
  ${invGuardadoInfo?`<div class="inv-banner">✓ Conteo guardado a las ${escAcc(invGuardadoInfo.hora)} por ${escAcc(invGuardadoInfo.contadoPor)}. Puedes corregirlo y volver a guardar.</div>`:''}
  <div class="inv-progreso">
    <div class="inv-progreso-txt"><b>${hechos}</b> de ${total} revisados${reportes?` · <span class="inv-progreso-rep">${reportes} con novedad</span>`:''}</div>
    <div class="inv-bar"><div class="inv-bar-fill ${hechos===total?'completo':''}" style="width:${pct}%"></div></div>
  </div>
  <div class="inv-grupo">${Z.label}<span>${total}</span></div>` + activos.map(invCardHTML).join('');

  html += `<div class="inv-savebar"><button class="btn-send" ${hechos<total?'disabled':''} onclick="guardarConteoInventario()">${hechos<total?`Faltan ${total-hechos} por revisar`:(invGuardadoInfo?'Guardar cambios':'Guardar conteo')}</button></div>`;
  cont.innerHTML = html;
  window.scrollTo(0,y);
}

window.invMarcarOk = function(id){
  const a = accesoriosData.find(x=>x.id===id); if(!a) return;
  invEstado[id] = {ok:true, esperado:invEsperado(a)};
  invAbierto = null; invGuardarDraft(); renderInventarioInstructor();
};
window.invAbrirReporte = function(id){ invAbierto = id; renderInventarioInstructor(); };
window.invCancelarReporte = function(){ invAbierto = null; renderInventarioInstructor(); };

function invLeerForm(a){
  const pv = byId(`inv-p-${a.id}`).value;
  const lv = a.unidad==='par' ? byId(`inv-l-${a.id}`).value : '';
  const p = Math.max(0, Math.floor(Number(pv)||0));
  const l = Math.max(0, Math.floor(Number(lv)||0));
  const encontrados = p + l*0.5;
  const faltante = Math.round((invEsperado(a)-encontrados)*2)/2;
  return {vacio:(pv===''&&lv===''), p, l, encontrados, faltante};
}
window.invPreview = function(id){
  const a = accesoriosData.find(x=>x.id===id); if(!a) return;
  const f = invLeerForm(a);
  const out = byId(`inv-prev-${id}`);
  if(f.vacio){ out.textContent=''; out.className='inv-prev'; return; }
  if(f.faltante>0){
    out.className='inv-prev mal';
    out.textContent=`Faltan ${cantTexto(f.faltante,a.unidad)} (encontraste ${cantTexto(f.encontrados,a.unidad)} de ${cantTexto(invEsperado(a),a.unidad)})`;
  } else {
    out.className='inv-prev ok';
    out.textContent='No falta nada: usa “Completo”.';
  }
};
window.invConfirmarReporte = function(id){
  const a = accesoriosData.find(x=>x.id===id); if(!a) return;
  const f = invLeerForm(a);
  if(f.vacio){ showToast('Escribe cuántas encontraste','err'); return; }
  if(f.faltante<=0){ showToast('No falta nada: marca “Completo”','err'); return; }
  const tipoEl = document.querySelector(`input[name="inv-tipo-${id}"]:checked`);
  invEstado[id] = {
    ok:false, tipo: tipoEl?tipoEl.value:'faltante',
    esperado: invEsperado(a), encontrados: f.encontrados, faltante: f.faltante,
    pares: f.p, lados: f.l, nota: byId(`inv-nota-${id}`).value.trim(),
  };
  invAbierto = null; invGuardarDraft(); renderInventarioInstructor();
};

window.guardarConteoInventario = async function(){
  const activos = accesoriosDeZona(ZONAS[inventarioChecklistActual.zona].ubicacion);
  if(activos.some(a=>!invEstado[a.id])){ showToast('Faltan accesorios por revisar','err'); return; }
  const { turno, momento } = inventarioChecklistActual;
  const docId = conteoDocId(turno, momento);
  const items = {};
  activos.forEach(a=>{ items[a.id] = invEstado[a.id]; });
  showLoading();
  try{
    await setDoc(doc(db,'conteo_accesorios', docId), {
      sucursal: currentSuc, fecha: fechaHoy(), turno, momento, zona: inventarioChecklistActual.zona, items,
      contadoPor: currentUser.name, hora: horaActual(), guardadoEn: new Date().toISOString(),
    });

    // Cada novedad abre (o actualiza) un CASO de seguimiento. El ID del caso es fijo
    // por conteo+accesorio+tipo, así que volver a guardar nunca duplica casos.
    // Se procesa de a uno (no en paralelo): un mismo accesorio puede tocarse dos veces.
    const iso = new Date().toISOString();
    const anular = async (a, caso, motivo)=>{
      await updateDoc(doc(db,'incidencias_accesorios',caso.id),{estado:'anulada', resolucion:'anulada', notaCierre:motivo, cerradoPor:currentUser.name, cerradoFecha:fechaHoy(), cerradoHora:horaActual(), cerradoEn:iso});
      // si ese caso ya había apartado unidades como defectuosas, vuelven a "en uso"
      const mov = casoTransferido(caso) ? await moverDefectuoso(a.id, -Number(caso.cantidad||0)) : '';
      await registrarMovimiento({accesorioId:a.id, accesorioNombre:a.nombre, incidenciaId:caso.id, tipo:'cierre', detalle:`Caso anulado: ${motivo}.${mov?' '+mov+'.':''}`});
    };
    for(const a of activos){
      const st = invEstado[a.id];
      const base = `${docId}__${a.id}`;
      if(st.ok){
        // Si en este mismo conteo había reportado algo y ahora lo corrigió, el caso se anula
        for(const tipo of ['faltante','defectuoso']){
          const prev = casosAcc.find(i=>i.id===`${base}__${tipo}` && i.estado==='abierta');
          if(prev) await anular(a, prev, 'el instructor corrigió el conteo (todo completo)');
        }
        continue;
      }
      const otro = st.tipo==='faltante' ? 'defectuoso' : 'faltante';
      const prevOtro = casosAcc.find(i=>i.id===`${base}__${otro}` && i.estado==='abierta');
      if(prevOtro) await anular(a, prevOtro, 'el instructor cambió el tipo de reporte en el mismo conteo');
      const incId = `${base}__${st.tipo}`;
      const prev = casosAcc.find(i=>i.id===incId);
      if(prev && prev.estado!=='abierta') continue; // el supervisor ya lo cerró: no se reabre solo
      const resumen = `${TIPO_CASO_LABEL[st.tipo]}: faltan ${cantTexto(st.faltante,a.unidad)} (esperado ${cantTexto(st.esperado,a.unidad)}, encontró ${cantTexto(st.encontrados,a.unidad)})${st.nota?` — “${st.nota}”`:''}`;
      if(prev){
        await updateDoc(doc(db,'incidencias_accesorios',incId),{cantidad:st.faltante, esperado:st.esperado, encontrados:st.encontrados, nota:st.nota||''});
        let mov = '';
        if(casoTransferido(prev)){ const delta = st.faltante - Number(prev.cantidad||0); if(delta) mov = await moverDefectuoso(a.id, delta); }
        await registrarMovimiento({accesorioId:a.id, accesorioNombre:a.nombre, incidenciaId:incId, tipo:'reporte', detalle:'Reporte corregido por el instructor. '+resumen+(mov?` ${mov}.`:'')});
      } else {
        const esDef = st.tipo==='defectuoso';
        await setDoc(doc(db,'incidencias_accesorios',incId),{
          sucursal:currentSuc, accesorioId:a.id, accesorioNombre:a.nombre, unidad:a.unidad,
          tipo:st.tipo, cantidad:st.faltante, esperado:st.esperado, encontrados:st.encontrados, nota:st.nota||'',
          transferido:esDef, estado:'abierta', detectadoPor:currentUser.name, fecha:fechaHoy(), hora:horaActual(), turno, momento, conteoId:docId, ts:iso,
        });
        const mov = esDef ? await moverDefectuoso(a.id, st.faltante) : '';
        await registrarMovimiento({accesorioId:a.id, accesorioNombre:a.nombre, incidenciaId:incId, tipo:'reporte', detalle:'Caso abierto. '+resumen+(mov?` Se apartó → ${mov}.`:'')});
      }
    }

    try{ localStorage.removeItem(invDraftKey()); }catch(e){}
    await Promise.all([cargarAccesoriosDatos(), cargarIncidenciasDatos()]);
    if(momento==='sala') invUltimoSala = await ultimoConteoSala();
    await cargarConteoActual();
    invAbierto = null;
    renderInventarioInstructor();
    showToast('Conteo guardado');
  } catch(e){ console.error(e); showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// Vista de lectura (recepción / supervisor): ¿ya contaron? ¿qué reportaron?
// ------------------------------------------------------------
function lecCardHTML(titulo, d, porId, extra){
  if(!d) return `<div class="lec-card"><div class="lec-top"><div class="lec-titulo">${titulo}</div><span class="inventario-check-estado inventario-check-pend">Sin contar</span></div></div>`;
  let ok = 0; const probs = [];
  Object.entries(d.items||{}).forEach(([accId,v])=>{
    const a = porId[accId]; if(!a) return;
    if(typeof v==='number'){
      const ref = Number(a.cantidadRef)||0;
      if(v===ref) ok++; else probs.push({a, tipo:'faltante', esperado:ref, encontrados:v, faltante:Math.max(0,ref-v), nota:'(registro anterior)'});
    } else if(v.ok) ok++; else probs.push({a, ...v});
  });
  return `<div class="lec-card ${probs.length?'lec-con-novedad':'lec-limpio'}">
    <div class="lec-top"><div class="lec-titulo">${titulo}</div><span class="inventario-check-estado ${probs.length?'inventario-check-dif':'inventario-check-ok'}">${probs.length?`${probs.length} con novedad`:'✓ Todo completo'}</span></div>
    <div class="accesorio-meta">${escAcc(d.contadoPor)} · ${escAcc(d.hora)} · ${ok} completo${ok===1?'':'s'}${extra||''}</div>
    ${probs.map(p=>`
      <div class="lec-prob">
        ${fotoMini(p.a)}
        <div class="accesorio-info">
          <div class="accesorio-nombre">${escAcc(p.a.nombre)} <span class="chip ${p.tipo==='defectuoso'?'chip-def':'chip-falta'}">${TIPO_CASO_LABEL[p.tipo]||'Novedad'}</span></div>
          <div class="accesorio-meta">Esperado ${cantTexto(p.esperado,p.a.unidad)} · encontró ${cantTexto(p.encontrados,p.a.unidad)} → <b class="accesorio-defectuoso">faltan ${cantTexto(p.faltante,p.a.unidad)}</b></div>
          ${p.nota?`<div class="inv-reporte-nota">“${escAcc(p.nota)}”</div>`:''}
        </div>
      </div>`).join('')}
  </div>`;
}

async function renderInventarioLectura(){
  const cont = byId('inventario-container');
  const checkpoints = [
    {turno:'manana', momento:'inicio', label:'Mañana · Inicio'},
    {turno:'manana', momento:'fin',    label:'Mañana · Fin'},
    {turno:'tarde',  momento:'inicio', label:'Tarde · Inicio'},
    {turno:'tarde',  momento:'fin',    label:'Tarde · Fin'},
  ];
  let datos, sala;
  try{
    [datos, sala] = await Promise.all([
      Promise.all(checkpoints.map(c=>getDoc(doc(db,'conteo_accesorios', conteoDocId(c.turno,c.momento))))),
      ultimoConteoSala(),
    ]);
  } catch(e){ cont.innerHTML = '<div class="empty">Error al cargar</div>'; return; }

  const porId = {}; accesoriosData.forEach(a=>{ porId[a.id]=a; });
  const abiertos = casosAcc.filter(i=>i.estado==='abierta').length;
  let html = '';
  if(abiertos) html += `<div class="inv-banner aviso">${abiertos} caso${abiertos===1?'':'s'} abierto${abiertos===1?'':'s'} en seguimiento${currentUser.role==='supervisor'?' — míralos en Administración → Seguimiento':''}.</div>`;

  html += `<div class="inv-grupo">Recepción · hoy ${fechaCorta(fechaHoy())}<span>${checkpoints.length}</span></div>`;
  checkpoints.forEach((c,i)=>{ html += lecCardHTML(c.label, datos[i].exists()?datos[i].data():null, porId); });

  html += `<div class="inv-grupo">Sala de máquinas · conteo ocasional<span></span></div>`;
  if(!sala){
    html += `<div class="lec-card"><div class="lec-top"><div class="lec-titulo">Sala de máquinas</div><span class="inventario-check-estado inventario-check-pend">Aún sin conteos</span></div></div>`;
  } else {
    const n = diasEntreFechas(sala.fecha, fechaHoy());
    const extra = ` · <span class="lec-edad ${n>=7?'alta':''}">${haceFecha(sala.fecha)}${n>=7?' — conviene recontar':''}</span>`;
    html += lecCardHTML(`Último conteo · ${fechaCorta(sala.fecha)} (${(TURNO_LABEL[sala.turno]||'').toLowerCase()})`, sala, porId, extra);
  }
  cont.innerHTML = html;
}

// ------------------------------------------------------------
// Seguimiento (supervisor): casos abiertos, cierre con registro, bitácora
// ------------------------------------------------------------
window.cargarSeguimiento = async function(){
  const cont = byId('seguimiento-container');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{ await Promise.all([cargarAccesoriosDatos(), cargarIncidenciasDatos()]); }
  catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; return; }
  renderSeguimiento();
};

function casoCardHTML(i){
  const a = accesoriosData.find(x=>x.id===i.accesorioId) || {nombre:i.accesorioNombre, unidad:i.unidad};
  const dias = diasDesde(i.ts);
  const edad = dias>=7 ? 'edad-critica' : (dias>=3 ? 'edad-alta' : '');
  return `
  <div class="seg-card tipo-${i.tipo}" onclick="abrirIncidencia('${i.id}')">
    ${fotoMini(a)}
    <div class="accesorio-info">
      <div class="accesorio-nombre">${escAcc(i.accesorioNombre||a.nombre)} <span class="chip ${i.tipo==='defectuoso'?'chip-def':'chip-falta'}">${TIPO_CASO_LABEL[i.tipo]||i.tipo}</span></div>
      <div class="seg-hero">${cantTexto(i.cantidad, i.unidad||a.unidad)}</div>
      <div class="accesorio-meta">Detectó ${escAcc(i.detectadoPor)} · ${fechaCorta(i.fecha)} ${escAcc(i.hora||'')} · ${TURNO_LABEL[i.turno]||''} ${i.momento==='fin'?'(fin)':'(inicio)'}</div>
      ${i.nota?`<div class="inv-reporte-nota">“${escAcc(i.nota)}”</div>`:''}
    </div>
    <div class="seg-lado"><div class="seg-edad ${edad}">${haceTiempo(i.ts)}</div><div class="seg-ir">Dar seguimiento ›</div></div>
  </div>`;
}

function renderSeguimiento(){
  const cont = byId('seguimiento-container');
  const abiertas = casosAcc.filter(i=>i.estado==='abierta').sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  const cerradas = casosAcc.filter(i=>i.estado!=='abierta').sort((a,b)=>(b.cerradoEn||'').localeCompare(a.cerradoEn||''));
  const nFal = abiertas.filter(i=>i.tipo==='faltante').length;
  const nDef = abiertas.filter(i=>i.tipo==='defectuoso').length;

  let html = `
  <div class="seg-kpis">
    <div class="kpi"><div class="kpi-num">${abiertas.length}</div><div class="kpi-lbl">Casos abiertos</div></div>
    <div class="kpi kpi-falta"><div class="kpi-num">${nFal}</div><div class="kpi-lbl">Faltantes</div></div>
    <div class="kpi kpi-def"><div class="kpi-num">${nDef}</div><div class="kpi-lbl">Defectuosos</div></div>
  </div>
  <div class="section-title">Por resolver · el más antiguo primero<span></span></div>`;
  html += abiertas.length ? abiertas.map(casoCardHTML).join('') : '<div class="empty">Sin casos abiertos ✓<br>Todo lo reportado por los instructores está resuelto.</div>';

  if(cerradas.length){
    html += `<details class="acc-archivados"><summary>Casos cerrados (${cerradas.length})</summary>` +
      cerradas.map(i=>`
      <div class="seg-card seg-cerrado" onclick="abrirIncidencia('${i.id}')">
        <div class="accesorio-info">
          <div class="accesorio-nombre">${escAcc(i.accesorioNombre)} <span class="chip chip-cerrado">${RES_LABEL[i.resolucion]||i.estado}</span></div>
          <div class="accesorio-meta">${TIPO_CASO_LABEL[i.tipo]||i.tipo} · ${cantTexto(i.cantidad,i.unidad)} · cerrado ${fechaCorta(i.cerradoFecha)} por ${escAcc(i.cerradoPor||'')}${i.pagadoPor?` · pagó ${escAcc(i.pagadoPor)}`:''}</div>
        </div>
        <div class="seg-ir">Ver ›</div>
      </div>`).join('') + `</details>`;
  }

  html += `<details class="acc-archivados" ontoggle="cargarRegistroGeneral(this)"><summary>Registro general de movimientos (respaldo)</summary><div id="registro-general"></div></details>`;
  cont.innerHTML = html;
}

window.cargarRegistroGeneral = async function(det){
  if(!det.open) return;
  const box = byId('registro-general');
  box.innerHTML = '<div class="empty">Cargando...</div>';
  try{
    const snap = await getDocs(query(collection(db,'movimientos_accesorios'), where('sucursal','==',currentSuc)));
    movimientosCache = snap.docs.map(d=>d.data()).sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
  }catch(e){ box.innerHTML='<div class="empty">Error al cargar</div>'; return; }
  if(!movimientosCache.length){ box.innerHTML='<div class="empty">Todavía no hay movimientos</div>'; return; }
  box.innerHTML = `
    <button class="btn-asignar" onclick="descargarRegistroCSV()">⬇ Descargar respaldo completo (CSV)</button>
    <div class="timeline">${movimientosCache.slice(0,60).map(m=>tlItemHTML(m, true)).join('')}</div>
    ${movimientosCache.length>60?`<div class="accesorio-meta">Mostrando los 60 más recientes de ${movimientosCache.length}. El CSV trae todos.</div>`:''}`;
};

window.descargarRegistroCSV = function(){
  const cols = ['fecha','hora','sucursal','accesorio','tipo','detalle','registrado_por','rol','caso'];
  const q = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const filas = [...movimientosCache].reverse().map(m=>[m.fecha,m.hora,m.sucursal,m.accesorioNombre,m.tipo,m.detalle,m.por,m.rol,m.incidenciaId||''].map(q).join(','));
  const csv = '\ufeff' + [cols.join(','), ...filas].join('\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = `respaldo_accesorios_${currentSuc.replace(/\s+/g,'_')}_${fechaHoy()}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

const TL_ICONO = {reporte:'⚠', nota:'✎', cierre:'✔', ajuste:'⚙', alta:'＋', archivo:'▣'};
function tlItemHTML(m, conNombre){
  return `<div class="tl-item tl-${m.tipo}">
    <div class="tl-dot">${TL_ICONO[m.tipo]||'•'}</div>
    <div class="tl-body">
      <div class="tl-head"><b>${escAcc(m.por||'')}</b> · ${fechaCorta(m.fecha)} ${escAcc(m.hora||'')}${conNombre&&m.accesorioNombre?` · ${escAcc(m.accesorioNombre)}`:''}</div>
      <div class="tl-texto">${escAcc(m.detalle||'')}</div>
    </div>
  </div>`;
}

window.abrirIncidencia = async function(id){
  const inc = casosAcc.find(i=>i.id===id); if(!inc) return;
  incidenciaActualId = id;
  byId('incidencia-detalle').innerHTML = '<div class="empty">Cargando...</div>';
  byId('modal-caso-acc').classList.add('open');
  let movs = [];
  try{
    const snap = await getDocs(query(collection(db,'movimientos_accesorios'), where('incidenciaId','==',id)));
    movs = snap.docs.map(d=>d.data()).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  }catch(e){ console.error(e); }
  renderIncidenciaDetalle(inc, movs);
};

function renderIncidenciaDetalle(inc, movs){
  const a = accesoriosData.find(x=>x.id===inc.accesorioId) || {nombre:inc.accesorioNombre, unidad:inc.unidad};
  const unidad = inc.unidad || a.unidad;
  const abierta = inc.estado==='abierta';
  const reserva = Number(a.cantidadReserva)||0;
  let html = `
  <div class="inc-head">
    ${fotoMini(a)}
    <div class="accesorio-info">
      <div class="accesorio-nombre">${escAcc(inc.accesorioNombre||a.nombre)} <span class="chip ${inc.tipo==='defectuoso'?'chip-def':'chip-falta'}">${TIPO_CASO_LABEL[inc.tipo]||inc.tipo}</span></div>
      <div class="seg-hero">${cantTexto(inc.cantidad, unidad)}</div>
    </div>
    <span class="chip ${abierta?'chip-falta':'chip-cerrado'}">${abierta?'Abierto':(RES_LABEL[inc.resolucion]||inc.estado)}</span>
  </div>
  <div class="inc-datos">
    <div><span>Detectó</span>${escAcc(inc.detectadoPor)}</div>
    <div><span>Cuándo</span>${fechaCorta(inc.fecha)} ${escAcc(inc.hora||'')}</div>
    <div><span>Esperado</span>${cantTexto(inc.esperado,unidad)}</div>
    <div><span>Encontró</span>${cantTexto(inc.encontrados,unidad)}</div>
  </div>
  ${abierta && casoTransferido(inc)?`<div class="hint-sm">Estas unidades ya están apartadas: pasaron de “en uso” a “defectuosos”.</div>`:''}
  ${inc.nota?`<div class="inv-reporte-nota">“${escAcc(inc.nota)}”</div>`:''}
  <div class="section-title" style="margin-top:16px">Historial del caso<span></span></div>
  <div class="timeline">${movs.length?movs.map(m=>tlItemHTML(m,false)).join(''):'<div class="accesorio-meta">Sin movimientos registrados</div>'}</div>`;

  if(abierta){
    html += `
    <div class="inc-bloque">
      <label class="inc-label">Agregar nota de seguimiento</label>
      <div class="inc-fila">
        <input type="text" id="inc-nota" placeholder="Ej: se le preguntó a recepción, se revisó cámara..." maxlength="200">
        <button class="btn-cancel" onclick="agregarNotaIncidencia()">Agregar</button>
      </div>
    </div>
    <div class="inc-bloque inc-resolver">
      <label class="inc-label">Resolver el caso</label>
      <select id="inc-res" onchange="incResCambio()">
        <option value="">Elige cómo se resuelve…</option>
        <option value="aparecio">${inc.tipo==='defectuoso'?'Reparado — vuelve a uso':'Apareció'}</option>
        <option value="pagado">Un cliente pagó</option>
        <option value="baja">${inc.tipo==='defectuoso'?'Dar de baja (se desecha)':'Dar de baja del sistema'}</option>
        <option value="anulada">Anular (error de registro)</option>
      </select>
      <div id="inc-blq-pago" style="display:none">
        <div class="field-row">
          <div class="field"><label>¿Quién pagó?</label><input type="text" id="inc-pago-nombre" placeholder="Nombre del cliente"></div>
          <div class="field"><label>Monto Bs. (opcional)</label><input type="number" id="inc-pago-monto" min="0" step="0.5" placeholder="0"></div>
        </div>
      </div>
      <div id="inc-blq-repo" style="display:none">
        ${reserva>0?`<div class="field"><label>Reponer desde reserva (disponible: ${cantTexto(reserva,unidad)})</label>
          <input type="number" id="inc-repo" min="0" step="${unidad==='par'?'0.5':'1'}" value="${Math.min(inc.cantidad,reserva)}"></div>`
          :`<div class="accesorio-meta">No hay reserva disponible para reponer.</div>`}
      </div>
      <div id="inc-blq-nota" style="display:none"><div class="field"><label id="inc-nota-res-lbl">Nota (opcional)</label><input type="text" id="inc-res-nota" maxlength="200"></div></div>
      <div id="inc-efecto" class="inv-prev"></div>
      <button class="btn-send" id="inc-btn-cerrar" style="display:none" onclick="cerrarIncidencia()">Cerrar caso</button>
    </div>`;
  } else {
    html += `<div class="inc-bloque inc-cerrado">
      <b>${RES_LABEL[inc.resolucion]||inc.estado}</b> · ${fechaCorta(inc.cerradoFecha)} ${escAcc(inc.cerradoHora||'')} · ${escAcc(inc.cerradoPor||'')}
      ${inc.pagadoPor?`<div>Pagó: <b>${escAcc(inc.pagadoPor)}</b>${inc.monto!=null?` · Bs. ${inc.monto}`:''}</div>`:''}
      ${inc.reposicion>0?`<div>Reposición desde reserva: ${cantTexto(inc.reposicion,unidad)}</div>`:''}
      ${inc.notaCierre?`<div class="inv-reporte-nota">“${escAcc(inc.notaCierre)}”</div>`:''}
    </div>`;
  }
  byId('incidencia-detalle').innerHTML = html;
}

window.incResCambio = function(){
  const r = byId('inc-res').value;
  byId('inc-blq-pago').style.display = r==='pagado' ? 'block' : 'none';
  byId('inc-blq-repo').style.display = (r==='pagado'||r==='baja') ? 'block' : 'none';
  byId('inc-blq-nota').style.display = r ? 'block' : 'none';
  byId('inc-nota-res-lbl').textContent = r==='anulada' ? 'Motivo (obligatorio)' : 'Nota (opcional)';
  byId('inc-btn-cerrar').style.display = r ? 'block' : 'none';
  const inc = casosAcc.find(i=>i.id===incidenciaActualId);
  const ef = byId('inc-efecto');
  if(!inc || !r){ ef.textContent=''; ef.className='inv-prev'; return; }
  const esDef = casoTransferido(inc);
  const textos = {
    aparecio: esDef ? 'Las unidades pasan de “defectuosos” de vuelta a “en uso”.' : 'No cambia el inventario: la unidad vuelve a contarse en sala.',
    pagado:   esDef ? 'Sale de “defectuosos” y queda registrado quién pagó.' : 'Sale del inventario (baja) y queda registrado quién pagó.',
    baja:     esDef ? 'Sale de “defectuosos” (se desecha). Puedes reponer desde reserva.' : 'Sale del inventario: baja el número “en uso”.',
    anulada:  esDef ? 'Las unidades vuelven de “defectuosos” a “en uso”.' : 'No cambia el inventario. El caso queda guardado como anulado.',
  };
  ef.className = 'inv-prev' + (r==='baja'||r==='pagado' ? ' mal' : ' ok');
  ef.textContent = textos[r];
};

window.agregarNotaIncidencia = async function(){
  const inc = casosAcc.find(i=>i.id===incidenciaActualId); if(!inc) return;
  const nota = byId('inc-nota').value.trim();
  if(!nota){ showToast('Escribe la nota','err'); return; }
  showLoading();
  try{
    await registrarMovimiento({accesorioId:inc.accesorioId, accesorioNombre:inc.accesorioNombre, incidenciaId:inc.id, tipo:'nota', detalle:nota});
    await abrirIncidencia(inc.id);
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

window.cerrarIncidencia = async function(){
  const inc = casosAcc.find(i=>i.id===incidenciaActualId); if(!inc) return;
  const res = byId('inc-res').value;
  const nota = byId('inc-res-nota').value.trim();
  if(!res){ showToast('Elige cómo se resuelve','err'); return; }
  let pagadoPor = '', monto = null, repo = 0;
  if(res==='pagado'){
    pagadoPor = byId('inc-pago-nombre').value.trim();
    if(!pagadoPor){ showToast('Escribe quién pagó','err'); return; }
    const m = byId('inc-pago-monto').value; monto = m==='' ? null : Number(m);
  }
  if(res==='anulada' && !nota){ showToast('Explica el motivo de la anulación','err'); return; }
  if(res==='pagado' || res==='baja'){ const r = byId('inc-repo'); repo = r ? Number(r.value)||0 : 0; }
  if(!confirm(`¿Cerrar este caso como “${RES_LABEL[res]}”? Queda guardado en el historial y no se puede editar.`)) return;

  showLoading();
  try{
    let detalle = `Caso cerrado: ${RES_LABEL[res]}.`;
    if(res==='pagado') detalle += ` Pagó: ${pagadoPor}${monto!=null?` (Bs. ${monto})`:''}.`;
    const esDef = casoTransferido(inc);
    if(res==='pagado' || res==='baja' || (esDef && (res==='aparecio' || res==='anulada'))){
      const accRef = doc(db,'accesorios',inc.accesorioId);
      const snap = await getDoc(accRef);   // se lee fresco para no pisar cambios recientes
      if(snap.exists()){
        const a = snap.data(); const u = a.unidad; const q = Number(inc.cantidad||0);
        const antesUso = Number(a.cantidadRef)||0, antesRes = Number(a.cantidadReserva)||0, antesDef = Number(a.cantidadDefectuosa)||0;
        repo = Math.min(Math.max(0, redondearCant(repo,u)), antesRes);
        let nuevoUso = antesUso, nuevaDef = antesDef;
        if(esDef){
          nuevaDef = Math.max(0, antesDef - q);                              // sale de "defectuosos"
          if(res==='aparecio' || res==='anulada') nuevoUso = antesUso + q;   // reparado / error: vuelve a uso
        } else {
          nuevoUso = Math.max(0, antesUso - q);                              // faltante: baja del inventario
        }
        nuevoUso += repo; const nuevaRes = antesRes - repo;
        await updateDoc(accRef, {cantidadRef:nuevoUso, cantidadReserva:nuevaRes, cantidadDefectuosa:nuevaDef});
        const partes = [];
        if(nuevoUso!==antesUso) partes.push(`En uso: ${cantTexto(antesUso,u)} → ${cantTexto(nuevoUso,u)}`);
        if(nuevaDef!==antesDef) partes.push(`Defectuosos: ${cantTexto(antesDef,u)} → ${cantTexto(nuevaDef,u)}`);
        if(repo>0) partes.push(`Reposición desde reserva: ${cantTexto(repo,u)} (reserva ${cantTexto(antesRes,u)} → ${cantTexto(nuevaRes,u)})`);
        if(partes.length) detalle += ' ' + partes.join(' · ') + '.';
      }
    }
    if(nota) detalle += ` Nota: ${nota}`;
    await updateDoc(doc(db,'incidencias_accesorios',inc.id),{
      estado: res==='anulada'?'anulada':'cerrada', resolucion:res, pagadoPor, monto, reposicion:repo, notaCierre:nota,
      cerradoPor:currentUser.name, cerradoFecha:fechaHoy(), cerradoHora:horaActual(), cerradoEn:new Date().toISOString(),
    });
    await registrarMovimiento({accesorioId:inc.accesorioId, accesorioNombre:inc.accesorioNombre, incidenciaId:inc.id, tipo:'cierre', detalle});
    closeModal('modal-caso-acc');
    await cargarSeguimiento();
    showToast('Caso cerrado');
  } catch(e){ console.error(e); showToast('Error al cerrar el caso','err'); }
  hideLoading();
};

// ============================================================
// SESIÓN PERSISTENTE
// Antes: al actualizar (F5) la página en cualquier pestaña, se
// perdía la sesión y había que volver a poner usuario/contraseña.
// Ahora se guarda en este navegador y se restaura solo, quedando
// en la misma pestaña donde estaba.
// ============================================================
const SESSION_KEY = 'gymControlSesion';
const SESSION_PANEL_KEY = 'gymControlPanelActivo';
const DEVICE_SESSION_KEY = 'gymControlDeviceSessionId';

function idDispositivoActual(){
  let id = null;
  try{ id = localStorage.getItem(DEVICE_SESSION_KEY); }catch(e){}
  if(!id){
    id = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
    try{ localStorage.setItem(DEVICE_SESSION_KEY, id); }catch(e){}
  }
  return id;
}

function nombreDispositivo(){
  const ua = navigator.userAgent||'';
  let so = 'Dispositivo';
  if(/Windows/.test(ua)) so='Windows';
  else if(/Android/.test(ua)) so='Android';
  else if(/iPhone|iPad/.test(ua)) so='iPhone/iPad';
  else if(/Mac/.test(ua)) so='Mac';
  else if(/Linux/.test(ua)) so='Linux';
  let nav = 'navegador';
  if(/Edg\//.test(ua)) nav='Edge';
  else if(/Chrome\//.test(ua)) nav='Chrome';
  else if(/Firefox\//.test(ua)) nav='Firefox';
  else if(/Safari\//.test(ua)) nav='Safari';
  return `${so} · ${nav}`;
}

// Registra (o actualiza) este dispositivo como una sesión activa del
// usuario, para que después pueda verla y cerrarla a distancia desde
// cualquier otro dispositivo.
async function registrarSesionActiva(){
  if(!currentUser) return;
  try{
    await setDoc(doc(db,'sesiones_activas', idDispositivoActual()),{
      username: currentUser.username||currentUser.name, nombre: currentUser.name, rol: currentUser.role,
      sucursal: currentSuc, dispositivo: nombreDispositivo(),
      activa: true, iniciadoEn: new Date().toISOString(), ultimaActividad: new Date().toISOString(),
    }, {merge:true});
  } catch(e){}
}

function guardarSesion(){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentUser, suc: currentSuc })); }catch(e){}
  registrarSesionActiva();
}
function borrarSesion(){
  try{ localStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_PANEL_KEY); }catch(e){}
}
function guardarPanelActivo(panelId){
  try{ localStorage.setItem(SESSION_PANEL_KEY, panelId); }catch(e){}
}

(async function restaurarSesion(){
  let guardada = null;
  try{ guardada = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){}
  if(!guardada || !guardada.user || !guardada.suc) return;
  currentUser = guardada.user;
  currentSuc  = guardada.suc;
  registrarSesionActiva();
  showLoading();
  try{
    await loadDash();
    const panelGuardado = localStorage.getItem(SESSION_PANEL_KEY);
    if(panelGuardado){
      const categorias = window._categoriasDash;
      if(categorias){
        const catDueña = categorias.find(c=>c.tabs.some(t=>t.id===panelGuardado));
        if(catDueña) seleccionarCategoria(catDueña.id, true);
      }
      const tabEl = [...document.querySelectorAll('.tab')].find(t=>t.dataset.panel===panelGuardado);
      if(tabEl) tabEl.click();
    }
  }catch(e){ hideLoading(); }
})();

// ============================================================
// REINICIO AUTOMÁTICO A MEDIANOCHE
// El checklist se guarda con la fecha en el id del documento,
// pero si la pestaña queda abierta toda la noche nadie vuelve a
// pedirle los datos a Firebase, entonces se ve todo tildado
// igual que el día anterior. Este chequeo revisa cada minuto si
// cambió la fecha y, si cambió, vuelve a cargar el checklist
// (que al ser un día nuevo, sale limpio/sin marcar).
// ============================================================
let fechaVigente = fechaHoy();
setInterval(async ()=>{
  if(!currentUser) return;
  const hoy = fechaHoy();
  if(hoy !== fechaVigente){
    fechaVigente = hoy;
    try{
      await renderChecklist();
      if(currentUser.role==='recepcionista') renderRevision();
      showToast('Nuevo día — el checklist se reinició');
    }catch(e){}
  }
  if(currentUser.role==='limpieza'){
    try{ await cargarReportes(); }catch(e){}
  }
  // Late (mantiene la sesión "viva") y revisa si alguien la cerró
  // desde otro dispositivo — si es así, te saca de acá también.
  try{
    const idSesion = idDispositivoActual();
    const snap = await getDoc(doc(db,'sesiones_activas', idSesion));
    if(snap.exists() && snap.data().activa===false){
      borrarSesion();
      currentUser=null; reportes=[]; usuarios=[];
      goHome();
      showToast('Tu sesión fue cerrada desde otro dispositivo','err');
      return;
    }
    await updateDoc(doc(db,'sesiones_activas', idSesion), {ultimaActividad:new Date().toISOString()});
  }catch(e){}
}, 60000);

// ============================================================
// SESIONES ACTIVAS — ver en qué dispositivos está iniciada la
// sesión de este usuario, y poder cerrarlas a distancia (útil si
// se dejó una abierta en una compu compartida de otra sucursal).
// ============================================================
function tiempoDesde(fechaISO){
  if(!fechaISO) return '';
  const min = Math.round((Date.now()-new Date(fechaISO).getTime())/60000);
  if(min<1) return 'justo ahora';
  if(min<60) return `hace ${min} min`;
  const h = Math.round(min/60);
  if(h<24) return `hace ${h}h`;
  return `hace ${Math.round(h/24)}d`;
}

window.abrirModalSesiones = async function(){
  document.getElementById('modal-sesiones').classList.add('open');
  const cont = document.getElementById('sesiones-lista');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{
    const username = currentUser.username||currentUser.name;
    const q = query(collection(db,'sesiones_activas'), where('username','==',username), where('sucursal','==',currentSuc), where('activa','==',true));
    const snap = await getDocs(q);
    const propia = idDispositivoActual();
    const sesiones = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.ultimaActividad||'').localeCompare(a.ultimaActividad||''));
    if(!sesiones.length){ cont.innerHTML='<div class="empty">Sin sesiones activas registradas</div>'; return; }
    cont.innerHTML = sesiones.map(s=>`
      <div class="sesion-dispositivo-row">
        <div>
          <div class="sesion-dispositivo-nombre">${s.dispositivo}${s.id===propia?' <span class="cat-badge" style="background:var(--neon)">Este dispositivo</span>':''}</div>
          <div class="sesion-dispositivo-meta">${s.sucursal} · última actividad ${tiempoDesde(s.ultimaActividad)}</div>
        </div>
        ${s.id!==propia?`<button class="btn-sm btn-noatend" onclick="cerrarSesionRemota('${s.id}')">Cerrar</button>`:''}
      </div>`).join('');
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar las sesiones</div>'; }
};

window.cerrarSesionRemota = async function(sessionId){
  if(!confirm('¿Cerrar esa sesión? Esa pantalla va a volver sola al inicio en menos de un minuto.')) return;
  try{
    await updateDoc(doc(db,'sesiones_activas', sessionId), {activa:false});
    showToast('Sesión cerrada');
    abrirModalSesiones();
  } catch(e){ showToast('Error al cerrar la sesión','err'); }
};

window.cerrarTodasLasDemasSesiones = async function(){
  if(!confirm('¿Cerrar todas tus sesiones abiertas en otros dispositivos?')) return;
  try{
    const username = currentUser.username||currentUser.name;
    const propia = idDispositivoActual();
    const q = query(collection(db,'sesiones_activas'), where('username','==',username), where('sucursal','==',currentSuc), where('activa','==',true));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.filter(d=>d.id!==propia).map(d=>updateDoc(doc(db,'sesiones_activas',d.id),{activa:false})));
    showToast('Se cerraron las demás sesiones');
    abrirModalSesiones();
  } catch(e){ showToast('Error','err'); }
};


// Antes: si alguien dejaba la pestaña abierta varios días, el
// navegador nunca volvía a pedir una copia nueva de app.js aunque
// yo subiera una corrección — se quedaba corriendo el código
// viejo indefinidamente. Esto revisa cada pocos minutos si ya hay
// una versión más nueva publicada y, si la hay, recarga la
// página sola, sin que nadie tenga que hacer nada.
// ============================================================
const APP_VERSION = '20261007c';
setInterval(async ()=>{
  try{
    const r = await fetch('/version.json?t='+Date.now(), {cache:'no-store'});
    const data = await r.json();
    if(data.version && data.version !== APP_VERSION) location.reload();
  }catch(e){}
}, 180000); // cada 3 minutos

// ============================================================
// CONTROL DE ENTRENADORES PERSONALES
// Colecciones en Firestore:
//   'entrenadores'  -> registro global de entrenadores (no por sucursal,
//                       porque un mismo entrenador puede estar habilitado
//                       en varias sucursales a la vez)
//   'sesiones_pt'   -> cada sesión de entrenamiento (sí por sucursal)
//   'auditoria_pt'  -> registro de todo cambio (alta/edición/anulación),
//                       nunca se borra nada, solo se anula con motivo
// ============================================================
const SUCURSALES = SUCURSALES_DATA.map(m=>m.SUCURSAL_ID);

let entrenadoresData = [];
let sesionesHoyData  = [];
let vistaActualPT = 'sesiones';

function estadoClienteLabel(e){ return {nuevo:'Nuevo',activo:'Activo',congelado:'Congelado',otro:'Otro'}[e]||e; }
function estadoEntrenadorLabel(e){ return {activo:'Activo',suspendido:'Suspendido',inactivo:'Inactivo'}[e]||e; }
function estadoSesionLabel(e){ return {en_curso:'En curso',finalizada:'Finalizada',anulada:'Anulada'}[e]||e; }

function duracionHoras(ini, fin){
  if(!ini || !fin) return 0;
  const [h1,m1]=ini.split(':').map(Number), [h2,m2]=fin.split(':').map(Number);
  let mins=(h2*60+m2)-(h1*60+m1);
  if(mins<0) mins+=1440;
  return mins/60;
}

// ------------------------------------------------------------
// Entrada del panel
// ------------------------------------------------------------
window.initPTPanel = async function(){
  const esSup = currentUser.role==='supervisor';
  document.getElementById('btn-nuevo-entrenador').style.display = esSup?'inline-flex':'none';
  document.getElementById('btn-vista-auditoria-pt').style.display = esSup?'inline-flex':'none';
  document.getElementById('btn-vista-historial-pt').style.display = esSup?'inline-flex':'none';
  // recepción solo opera sesiones, no administra entrenadores ni ve indicadores/auditoría
  document.querySelectorAll('#switch-pt [data-vista="entrenadores"], #switch-pt [data-vista="indicadores"]')
    .forEach(b=>b.style.display = esSup?'inline-flex':'none');

  showLoading();
  try{
    const se = await getDocs(collection(db,'entrenadores'));
    entrenadoresData = se.docs.map(d=>({id:d.id,...d.data()}));

    const qs = query(collection(db,'sesiones_pt'), where('sucursal','==',currentSuc), where('fecha','==',fechaHoy()));
    const ss = await getDocs(qs);
    sesionesHoyData = ss.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ showToast('Error al cargar entrenadores','err'); }
  hideLoading();

  cambiarVistaPT('sesiones');
};

window.cambiarVistaPT = function(vista){
  vistaActualPT = vista;
  document.querySelectorAll('#switch-pt .clases-switch-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.querySelector(`#switch-pt [data-vista="${vista}"]`);
  if(btn) btn.classList.add('active');
  ['sesiones','entrenadores','indicadores','historial','auditoria'].forEach(v=>{
    document.getElementById(`pt-${v}-container`).style.display = v===vista?'block':'none';
  });
  const esSup = currentUser.role==='supervisor';
  document.getElementById('btn-nueva-sesion-pt').style.display = vista==='sesiones'?'inline-flex':'none';
  document.getElementById('btn-nuevo-entrenador').style.display = (vista==='entrenadores' && esSup)?'inline-flex':'none';

  if(vista==='sesiones')     renderSesionesPT();
  if(vista==='entrenadores') renderEntrenadoresPT();
  if(vista==='indicadores')  renderIndicadoresPT();
  if(vista==='historial')    renderHistorialPT();
  if(vista==='auditoria')    renderAuditoriaPT();
};

// ------------------------------------------------------------
// SESIONES DE HOY (registro operativo — recepción y supervisor)
// ------------------------------------------------------------
function renderSesionesPT(){
  const cont = document.getElementById('pt-sesiones-container');
  const orden = {en_curso:0, finalizada:1, anulada:2};
  const lista = [...sesionesHoyData].sort((a,b)=> (orden[a.estado]-orden[b.estado]) || (a.horaInicio||'').localeCompare(b.horaInicio||''));
  if(!lista.length){ cont.innerHTML='<div class="empty">Sin sesiones registradas hoy en esta sucursal</div>'; return; }

  const esSup = currentUser.role==='supervisor';
  cont.innerHTML = lista.map(s=>`
    <div class="sesion-card ${s.estado==='en_curso'?'en-curso':''} ${s.estado==='anulada'?'anulada':''}">
      <div class="sesion-top">
        <div style="display:flex;align-items:center;gap:10px">
          ${s.entrenadorFoto?`<img src="${s.entrenadorFoto}" class="entrenador-avatar zoomable-img" alt="${s.entrenadorNombre||''}">`:`<div class="entrenador-avatar entrenador-avatar-vacio">${(s.entrenadorNombre||'?')[0].toUpperCase()}</div>`}
          <div>
            <div class="sesion-cliente">${s.cliente}</div>
            <div class="sesion-entrenador">${s.entrenadorNombre} ${s.entrenadorCodigo?'· '+s.entrenadorCodigo:''}</div>
          </div>
        </div>
        <span class="estado-badge estado-${s.estado}">${estadoSesionLabel(s.estado)}</span>
      </div>
      <div class="sesion-hora">
        🕐 ${s.horaInicio}${s.horaFin?' – '+s.horaFin:''} ${!s.horaFin?'<span class="sesion-hora-curso">en curso</span>':''}
      </div>
      <div class="sesion-meta">
        Cliente ${estadoClienteLabel(s.estadoCliente)} · Registró: ${s.recepcionista}
      </div>
      ${s.observaciones?`<div class="sesion-obs">${s.observaciones}</div>`:''}
      ${s.estado==='anulada'?`<div class="sesion-obs">Anulada por ${s.anuladoPor}: ${s.motivoAnulacion}</div>`:''}
      <div class="sesion-actions">
        ${s.estado==='en_curso'?`<button class="btn-sm btn-atend" onclick="finalizarSesionPT('${s.id}')">✓ Finalizar sesión</button>`:''}
        ${esSup && s.estado!=='anulada'?`<button class="btn-sm btn-noatend" onclick="abrirModalAnularSesion('${s.id}')">Anular</button>`:''}
      </div>
    </div>`).join('');
}

window.abrirModalSesionPT = function(){
  const disponibles = entrenadoresData.filter(e=>e.estado==='activo' && (e.sucursalesHabilitadas||[]).includes(currentSuc));
  const sel = document.getElementById('sesion-entrenador');
  if(!disponibles.length){
    sel.innerHTML = `<option value="">Sin entrenadores autorizados en esta sucursal</option>`;
  } else {
    sel.innerHTML = disponibles.map(e=>`<option value="${e.id}">${e.nombre} (${e.codigo})</option>`).join('');
  }
  document.getElementById('sesion-cliente').value='';
  document.getElementById('sesion-estado-cliente').value='nuevo';
  document.getElementById('sesion-obs').value='';
  document.getElementById('sesion-hora-actual').textContent = horaActual();
  document.getElementById('modal-sesion-pt').classList.add('open');
};

window.guardarSesionPT = async function(){
  const entrenadorId = document.getElementById('sesion-entrenador').value;
  const cliente = document.getElementById('sesion-cliente').value.trim();
  const estadoCliente = document.getElementById('sesion-estado-cliente').value;
  const obs = document.getElementById('sesion-obs').value.trim();
  if(!entrenadorId){ showToast('No hay entrenador autorizado seleccionable','err'); return; }
  if(!cliente){ showToast('Escribe el nombre del cliente','err'); return; }
  const entrenador = entrenadoresData.find(e=>e.id===entrenadorId);
  showLoading();
  try{
    await setDoc(doc(collection(db,'sesiones_pt')),{
      sucursal:currentSuc, entrenadorId, entrenadorCodigo:entrenador?entrenador.codigo:'', entrenadorNombre:entrenador?entrenador.nombre:'',
      entrenadorFoto: entrenador?(entrenador.foto||null):null,
      cliente, estadoCliente, fecha:fechaHoy(), horaInicio:horaActual(), horaFin:null,
      estado:'en_curso', observaciones:obs, recepcionista:currentUser.name,
      creadoEn:new Date().toISOString(),
    });
    closeModal('modal-sesion-pt');
    showToast('Sesión registrada');
    await initPTPanel();
  } catch(e){ showToast('Error al registrar la sesión','err'); }
  hideLoading();
};

window.finalizarSesionPT = async function(id){
  if(!confirm(`¿Marcar esta sesión como finalizada? Se registrará como hora de salida: ${horaActual()}`)) return;
  showLoading();
  try{
    await updateDoc(doc(db,'sesiones_pt',id),{ horaFin:horaActual(), estado:'finalizada', finalizadoPor:currentUser.name });
    await initPTPanel();
    showToast('Sesión finalizada');
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// No se borran sesiones nunca — solo se anulan, con motivo, quedando en
// el historial para la auditoría.
window.abrirModalAnularSesion = function(id){
  document.getElementById('anular-sesion-id').value=id;
  document.getElementById('anular-motivo').value='';
  document.getElementById('modal-anular-pt').classList.add('open');
};

window.confirmarAnularSesion = async function(){
  const id = document.getElementById('anular-sesion-id').value;
  const motivo = document.getElementById('anular-motivo').value.trim();
  if(!motivo){ showToast('Indica el motivo de la anulación','err'); return; }
  const s = sesionesHoyData.find(x=>x.id===id);
  showLoading();
  try{
    await updateDoc(doc(db,'sesiones_pt',id),{ estado:'anulada', anuladoPor:currentUser.name, anuladoEn:new Date().toISOString(), motivoAnulacion:motivo });
    await registrarAuditoria('sesion', id, s?`${s.cliente} con ${s.entrenadorNombre}`:'Sesión', 'Sesión anulada', motivo);
    closeModal('modal-anular-pt');
    showToast('Sesión anulada');
    await initPTPanel();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// ENTRENADORES (administración — solo supervisor puede crear/editar;
// recepción puede ver el listado para saber quién está autorizado)
// ------------------------------------------------------------
function renderEntrenadoresPT(){
  const cont = document.getElementById('pt-entrenadores-container');
  if(!entrenadoresData.length){ cont.innerHTML='<div class="empty">Todavía no hay entrenadores registrados</div>'; return; }
  const esSup = currentUser.role==='supervisor';
  const lista = [...entrenadoresData].sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  cont.innerHTML = lista.map(e=>{
    const vencido = e.vigenciaHasta && e.vigenciaHasta < fechaHoy();
    return `
    <div class="entrenador-card" ${esSup?`onclick="abrirModalEntrenador('${e.id}')"`:''}>
      <div class="entrenador-top">
        <div style="display:flex;align-items:center;gap:12px">
          ${e.foto?`<img src="${e.foto}" class="entrenador-avatar zoomable-img" alt="${e.nombre||''}">`:`<div class="entrenador-avatar entrenador-avatar-vacio">${(e.nombre||'?')[0].toUpperCase()}</div>`}
          <div>
            <div class="entrenador-nombre">${e.nombre}</div>
            <div class="entrenador-codigo">${e.codigo}</div>
          </div>
        </div>
        <span class="estado-badge estado-${e.estado}">${estadoEntrenadorLabel(e.estado)}${vencido?' · vencido':''}</span>
      </div>
      <div class="entrenador-meta">
        Autorizado ${e.fechaAutorizacion||'—'} por ${e.autorizadoPor||'—'}
        ${e.vigenciaHasta?' · vigencia hasta '+e.vigenciaHasta:''}
        ${(e.incidencias||[]).length?' · '+e.incidencias.length+' incidencia(s)':''}
      </div>
      ${e.observaciones?`<div class="sesion-obs">${e.observaciones}</div>`:''}
      <div class="entrenador-sucs">
        ${(e.sucursalesHabilitadas||[]).map(s=>`<span class="suc-tag-mini">${s}</span>`).join('')||'<span class="suc-tag-mini">Sin sucursales asignadas</span>'}
      </div>
    </div>`;
  }).join('');
}

function siguienteCodigoEntrenador(){
  const nums = entrenadoresData.map(e=>{
    const m=(e.codigo||'').match(/(\d+)$/);
    return m?parseInt(m[1],10):0;
  });
  const next = (nums.length?Math.max(...nums):0)+1;
  return 'PT-'+String(next).padStart(3,'0');
}

function renderChecksSucursalesPT(seleccionadas){
  const cont = document.getElementById('entrenador-sucursales');
  cont.innerHTML = SUCURSALES.map(s=>`
    <label class="checkbox-chip ${seleccionadas.includes(s)?'checked':''}">
      <input type="checkbox" value="${s}" ${seleccionadas.includes(s)?'checked':''}
        onchange="this.parentElement.classList.toggle('checked',this.checked)">
      ${s}
    </label>`).join('');
}

let fotoEntrenadorActual = null;

window.previewFotoEntrenador = async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoEntrenadorActual = await comprimirImagen(input.files[0]);
    const img = document.getElementById('entrenador-foto-preview');
    img.src = fotoEntrenadorActual; img.style.display='block';
    document.getElementById('entrenador-foto-placeholder').style.display='none';
  } catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.abrirModalEntrenador = function(id){
  const e = id ? entrenadoresData.find(x=>x.id===id) : null;
  document.getElementById('entrenador-id-edit').value = id||'';
  document.getElementById('modal-entrenador-titulo').textContent = e?'Editar entrenador':'Nuevo entrenador';
  fotoEntrenadorActual = e?(e.foto||null):null;
  const preview = document.getElementById('entrenador-foto-preview');
  const placeholder = document.getElementById('entrenador-foto-placeholder');
  if(fotoEntrenadorActual){ preview.src=fotoEntrenadorActual; preview.style.display='block'; placeholder.style.display='none'; }
  else { preview.style.display='none'; placeholder.style.display='flex'; }
  document.getElementById('entrenador-foto-cam').value='';
  document.getElementById('entrenador-foto-gal').value='';
  const codigoInput = document.getElementById('entrenador-codigo');
  codigoInput.value = e?e.codigo:siguienteCodigoEntrenador();
  codigoInput.readOnly = !!e; // el código no se cambia una vez creado, por trazabilidad
  document.getElementById('entrenador-nombre').value = e?e.nombre:'';
  document.getElementById('entrenador-estado').value = e?e.estado:'activo';
  document.getElementById('entrenador-vigencia').value = e?(e.vigenciaHasta||''):'';
  document.getElementById('entrenador-fecha-autorizacion').value = e?(e.fechaAutorizacion||''):fechaHoy();
  document.getElementById('entrenador-responsable').value = e?(e.autorizadoPor||''):currentUser.name;
  document.getElementById('entrenador-obs').value = e?(e.observaciones||''):'';
  document.getElementById('entrenador-nueva-incidencia').value='';
  document.getElementById('campo-nueva-incidencia').style.display = e?'block':'none';
  renderChecksSucursalesPT(e?(e.sucursalesHabilitadas||[]):[currentSuc]);
  document.getElementById('modal-entrenador').classList.add('open');
};

window.guardarEntrenador = async function(){
  const id = document.getElementById('entrenador-id-edit').value;
  const codigo = document.getElementById('entrenador-codigo').value.trim();
  const nombre = document.getElementById('entrenador-nombre').value.trim();
  const estado = document.getElementById('entrenador-estado').value;
  const vigenciaHasta = document.getElementById('entrenador-vigencia').value;
  const fechaAutorizacion = document.getElementById('entrenador-fecha-autorizacion').value;
  const autorizadoPor = document.getElementById('entrenador-responsable').value.trim();
  const observaciones = document.getElementById('entrenador-obs').value.trim();
  const nuevaIncidencia = document.getElementById('entrenador-nueva-incidencia').value.trim();
  const sucursalesHabilitadas = [...document.querySelectorAll('#entrenador-sucursales input:checked')].map(cb=>cb.value);

  if(!codigo || !nombre){ showToast('Completa código y nombre','err'); return; }
  showLoading();
  try{
    if(id){
      const anterior = entrenadoresData.find(x=>x.id===id);
      const incidencias = anterior?.incidencias||[];
      if(nuevaIncidencia) incidencias.push({fecha:fechaHoy(), descripcion:nuevaIncidencia, registradoPor:currentUser.name});
      await updateDoc(doc(db,'entrenadores',id),{
        nombre, estado, vigenciaHasta, fechaAutorizacion, autorizadoPor, observaciones,
        sucursalesHabilitadas, incidencias, foto: fotoEntrenadorActual,
        actualizadoPor:currentUser.name, actualizadoEn:new Date().toISOString(),
      });
      let cambio = 'Editó datos del entrenador';
      if(anterior && anterior.estado!==estado) cambio = `Cambió el estado de ${estadoEntrenadorLabel(anterior.estado)} a ${estadoEntrenadorLabel(estado)}`;
      await registrarAuditoria('entrenador', id, nombre, cambio, nuevaIncidencia||'');
    } else {
      const ref = doc(collection(db,'entrenadores'));
      await setDoc(ref,{
        codigo, nombre, estado, vigenciaHasta, fechaAutorizacion, autorizadoPor, observaciones,
        sucursalesHabilitadas, incidencias:[], foto: fotoEntrenadorActual,
        creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
      });
      await registrarAuditoria('entrenador', ref.id, nombre, 'Entrenador registrado (alta inicial)', '');
    }
    closeModal('modal-entrenador');
    showToast('Entrenador guardado');
    await initPTPanel();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// HISTORIAL COMPLETO DE SESIONES (más allá de "hoy") — permite
// buscar por cliente, por entrenador, o por rango de fechas. Es el
// "historial completo" / "reporte por cliente" que pedía la
// especificación, sin depender solo de los totales de Indicadores.
// ------------------------------------------------------------
function renderHistorialPT(){
  const cont = document.getElementById('pt-historial-container');
  const hoy = fechaHoy();
  const hace7 = fechaLocal(new Date(Date.now()-6*86400000));
  cont.innerHTML = `
    <div class="pt-filtros">
      <input type="date" id="pt-hist-desde" value="${hace7}">
      <input type="date" id="pt-hist-hasta" value="${hoy}">
      <select id="pt-hist-entrenador">
        <option value="">Todos los entrenadores</option>
        ${entrenadoresData.map(e=>`<option value="${e.id}">${e.nombre}</option>`).join('')}
      </select>
      <input type="text" id="pt-hist-cliente" placeholder="Buscar cliente...">
      <button class="btn-mini btn-mini-ok" onclick="buscarHistorialPT()">Buscar</button>
    </div>
    <div id="pt-historial-resultado"><div class="empty">Elegí un rango y tocá Buscar</div></div>`;
}

window.buscarHistorialPT = async function(){
  const cont = document.getElementById('pt-historial-resultado');
  const desde = document.getElementById('pt-hist-desde').value;
  const hasta = document.getElementById('pt-hist-hasta').value;
  const entFiltro = document.getElementById('pt-hist-entrenador').value;
  const clienteFiltro = document.getElementById('pt-hist-cliente').value.trim().toLowerCase();
  cont.innerHTML = '<div class="empty">Buscando...</div>';
  try{
    const snap = await getDocs(query(collection(db,'sesiones_pt'), where('sucursal','==',currentSuc)));
    let lista = snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(s=>s.fecha>=desde && s.fecha<=hasta);
    if(entFiltro) lista = lista.filter(s=>s.entrenadorId===entFiltro);
    if(clienteFiltro) lista = lista.filter(s=>(s.cliente||'').toLowerCase().includes(clienteFiltro));
    lista.sort((a,b)=> (b.fecha+b.horaInicio).localeCompare(a.fecha+a.horaInicio));

    if(!lista.length){ cont.innerHTML='<div class="empty">Sin sesiones en ese rango</div>'; return; }

    const horas = lista.filter(s=>s.estado!=='anulada').reduce((acc,s)=>acc+duracionHoras(s.horaInicio,s.horaFin),0);
    cont.innerHTML = `<div class="rev-resumen-sup">${lista.length} sesión(es) encontradas · ${horas.toFixed(1)}h en total</div>` +
      lista.map(s=>`
      <div class="sesion-card ${s.estado==='en_curso'?'en-curso':''} ${s.estado==='anulada'?'anulada':''}">
        <div class="sesion-top">
          <div style="display:flex;align-items:center;gap:10px">
            ${s.entrenadorFoto?`<img src="${s.entrenadorFoto}" class="entrenador-avatar zoomable-img" alt="${s.entrenadorNombre||''}">`:`<div class="entrenador-avatar entrenador-avatar-vacio">${(s.entrenadorNombre||'?')[0].toUpperCase()}</div>`}
            <div>
              <div class="sesion-cliente">${s.cliente}</div>
              <div class="sesion-entrenador">${s.entrenadorNombre} ${s.entrenadorCodigo?'· '+s.entrenadorCodigo:''}</div>
            </div>
          </div>
          <span class="estado-badge estado-${s.estado}">${estadoSesionLabel(s.estado)}</span>
        </div>
        <div class="sesion-hora">🕐 ${s.fecha} · ${s.horaInicio}${s.horaFin?' – '+s.horaFin:''} ${!s.horaFin?'<span class="sesion-hora-curso">en curso</span>':''}</div>
        <div class="sesion-meta">
          Cliente ${estadoClienteLabel(s.estadoCliente)} · Registró: ${s.recepcionista}
        </div>
        ${s.observaciones?`<div class="sesion-obs">${s.observaciones}</div>`:''}
        ${s.estado==='anulada'?`<div class="sesion-obs">Anulada por ${s.anuladoPor}: ${s.motivoAnulacion}</div>`:''}
      </div>`).join('');
  } catch(e){ cont.innerHTML='<div class="empty">Error al buscar</div>'; }
};


// ------------------------------------------------------------
// AUDITORÍA — nunca se borra nada; toda alta, edición o anulación
// queda registrada acá con usuario, fecha y motivo.
// ------------------------------------------------------------
async function registrarAuditoria(entidad, entidadId, entidadNombre, cambio, motivo){
  try{
    await setDoc(doc(collection(db,'auditoria_pt')),{
      entidad, entidadId, entidadNombre, usuario:currentUser.name,
      fecha:fechaHoy(), hora:horaActual(), cambio, motivo:motivo||'',
      sucursal:currentSuc, timestamp:tsAhora(),
    });
  } catch(e){ /* la auditoría no debe frenar la operación principal */ }
}

async function renderAuditoriaPT(){
  const cont = document.getElementById('pt-auditoria-container');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{
    const snap = await getDocs(query(collection(db,'auditoria_pt')));
    const lista = snap.docs.map(d=>d.data()).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)).slice(0,150);
    if(!lista.length){ cont.innerHTML='<div class="empty">Sin movimientos registrados todavía</div>'; return; }
    cont.innerHTML = lista.map(a=>`
      <div class="auditoria-row">
        <div>
          <div class="auditoria-cambio"><strong>${a.entidadNombre}</strong> — ${a.cambio}${a.motivo?': '+a.motivo:''}</div>
          <div class="auditoria-meta">${a.usuario} · ${a.fecha} ${a.hora||''} · ${a.entidad}</div>
        </div>
      </div>`).join('');
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; }
}

// ------------------------------------------------------------
// INDICADORES + CONTROLES AUTOMÁTICOS + RANKING
// ------------------------------------------------------------
async function renderIndicadoresPT(){
  const cont = document.getElementById('pt-indicadores-container');
  cont.innerHTML = `
    <div class="pt-filtros">
      <select id="pt-periodo" onchange="cargarIndicadoresPT()">
        <option value="hoy">Hoy</option>
        <option value="semana">Últimos 7 días</option>
        <option value="mes" selected>Este mes</option>
      </select>
      <select id="pt-filtro-entrenador" onchange="cargarIndicadoresPT()">
        <option value="">Todos los entrenadores</option>
        ${entrenadoresData.map(e=>`<option value="${e.id}">${e.nombre}</option>`).join('')}
      </select>
    </div>
    <div id="pt-indicadores-resultado"><div class="empty">Cargando...</div></div>`;
  await cargarIndicadoresPT();
}

window.cargarIndicadoresPT = async function(){
  const cont = document.getElementById('pt-indicadores-resultado');
  const periodo = document.getElementById('pt-periodo').value;
  const filtroEnt = document.getElementById('pt-filtro-entrenador').value;
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{
    const hoy = fechaHoy();
    const desde = periodo==='hoy' ? hoy
      : periodo==='semana' ? fechaLocal(new Date(Date.now()-6*86400000))
      : mesActual()+'-01';

    const snap = await getDocs(query(collection(db,'sesiones_pt'), where('sucursal','==',currentSuc)));
    let sesiones = snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.fecha>=desde);
    if(filtroEnt) sesiones = sesiones.filter(s=>s.entrenadorId===filtroEnt);

    // Chequeo cruzado de sucursal (para detectar entrenadores que se
    // mueven de una sucursal a otra el mismo día) — necesita ver TODAS
    // las sucursales, no solo la actual.
    let sesionesHoyTodas = [];
    try{
      const snapHoy = await getDocs(query(collection(db,'sesiones_pt'), where('fecha','==',hoy)));
      sesionesHoyTodas = snapHoy.docs.map(d=>d.data());
    }catch(e){}

    renderResultadoIndicadoresPT(cont, sesiones, sesionesHoyTodas, desde, hoy);
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; }
};

function renderResultadoIndicadoresPT(cont, sesiones, sesionesHoyTodas, desde, hoy){
  const validas = sesiones.filter(s=>s.estado!=='anulada');
  const horasTotales = validas.reduce((acc,s)=>acc+duracionHoras(s.horaInicio,s.horaFin),0);
  const clientesUnicos = new Set(validas.map(s=>(s.cliente||'').trim().toLowerCase())).size;
  const entrenadoresConSesion = new Set(validas.map(s=>s.entrenadorId)).size;
  const diasDistintos = new Set(validas.map(s=>s.fecha)).size || 1;
  const promedioDiario = (validas.length/diasDistintos).toFixed(1);

  // Ranking por entrenador
  const porEntrenador = {};
  validas.forEach(s=>{
    const k=s.entrenadorNombre||'—';
    porEntrenador[k] = porEntrenador[k] || {sesiones:0, horas:0, clientes:new Set()};
    porEntrenador[k].sesiones++;
    porEntrenador[k].horas += duracionHoras(s.horaInicio,s.horaFin);
    porEntrenador[k].clientes.add((s.cliente||'').trim().toLowerCase());
  });
  const ranking = Object.entries(porEntrenador).sort((a,b)=>b[1].sesiones-a[1].sesiones).slice(0,10);

  // Clientes recurrentes (2 o más sesiones en el período)
  const porCliente = {};
  validas.forEach(s=>{
    const k=(s.cliente||'—').trim();
    porCliente[k]=(porCliente[k]||0)+1;
  });
  const recurrentes = Object.entries(porCliente).filter(([,n])=>n>1).length;

  // --- Controles automáticos ---
  const alertas = [];

  // Entrenador no autorizado con sesiones
  validas.forEach(s=>{
    const e = entrenadoresData.find(x=>x.id===s.entrenadorId);
    if(e && e.estado!=='activo'){
      alertas.push(`<b>${s.entrenadorNombre}</b> tiene una sesión con ${s.cliente} (${s.fecha}) pero su estado es "${estadoEntrenadorLabel(e.estado)}", no autorizado.`);
    }
    if(e && e.vigenciaHasta && e.vigenciaHasta < s.fecha){
      alertas.push(`<b>${s.entrenadorNombre}</b> dio una sesión el ${s.fecha} con la autorización ya vencida (${e.vigenciaHasta}).`);
    }
  });

  // Sesiones sin cerrar hace más de 3 horas (permanencia excesiva)
  sesionesHoyData.filter(s=>s.estado==='en_curso').forEach(s=>{
    const dur = duracionHoras(s.horaInicio, horaActual());
    if(dur>3){
      alertas.push(`<b>${s.entrenadorNombre}</b> tiene una sesión con ${s.cliente} abierta hace más de ${dur.toFixed(1)}h sin finalizar.`);
    }
  });

  // Solapamiento de horario (mismo entrenador, mismo día, rangos que se cruzan)
  const porEntDia = {};
  validas.forEach(s=>{
    const k=`${s.entrenadorId}_${s.fecha}`;
    (porEntDia[k]=porEntDia[k]||[]).push(s);
  });
  Object.values(porEntDia).forEach(list=>{
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
      const a=list[i], b=list[j];
      if(a.horaInicio && b.horaInicio && a.horaFin && b.horaFin && a.horaInicio<b.horaFin && b.horaInicio<a.horaFin){
        alertas.push(`<b>${a.entrenadorNombre}</b> tiene 2 sesiones que se cruzan en horario el ${a.fecha}: ${a.cliente} (${a.horaInicio}–${a.horaFin}) y ${b.cliente} (${b.horaInicio}–${b.horaFin}).`);
      }
    }
  });

  // Cliente con más de un entrenador el mismo día
  const porClienteDia = {};
  validas.forEach(s=>{
    const k=`${(s.cliente||'').trim().toLowerCase()}_${s.fecha}`;
    (porClienteDia[k]=porClienteDia[k]||new Set()).add(s.entrenadorNombre);
  });
  Object.entries(porClienteDia).forEach(([k,ents])=>{
    if(ents.size>1){
      const [cliente,fecha]=k.split('_');
      alertas.push(`El cliente <b>${cliente}</b> aparece con ${ents.size} entrenadores distintos el ${fecha}.`);
    }
  });

  // Muchas sesiones seguidas de un mismo entrenador en un día
  const porEntDiaCount = {};
  validas.forEach(s=>{ const k=`${s.entrenadorNombre}_${s.fecha}`; porEntDiaCount[k]=(porEntDiaCount[k]||0)+1; });
  Object.entries(porEntDiaCount).forEach(([k,n])=>{
    if(n>6){ const [ent,fecha]=k.split('_'); alertas.push(`<b>${ent}</b> registró ${n} sesiones el ${fecha} — revisar si es correcto.`); }
  });

  // Entrenador en más de una sucursal el mismo día
  const porEntSucHoy = {};
  sesionesHoyTodas.forEach(s=>{
    (porEntSucHoy[s.entrenadorNombre]=porEntSucHoy[s.entrenadorNombre]||new Set()).add(s.sucursal);
  });
  Object.entries(porEntSucHoy).forEach(([ent,sucs])=>{
    if(sucs.size>1) alertas.push(`<b>${ent}</b> tiene sesiones hoy en ${sucs.size} sucursales distintas: ${[...sucs].join(', ')}.`);
  });

  cont.innerHTML = `
    <div class="pt-kpi-grid">
      <div class="pt-kpi-card"><div class="pt-kpi-num">${validas.length}</div><div class="pt-kpi-label">Sesiones</div></div>
      <div class="pt-kpi-card"><div class="pt-kpi-num">${horasTotales.toFixed(1)}h</div><div class="pt-kpi-label">Horas trabajadas</div></div>
      <div class="pt-kpi-card"><div class="pt-kpi-num">${clientesUnicos}</div><div class="pt-kpi-label">Clientes atendidos</div></div>
      <div class="pt-kpi-card"><div class="pt-kpi-num">${entrenadoresConSesion}</div><div class="pt-kpi-label">Entrenadores activos</div></div>
      <div class="pt-kpi-card"><div class="pt-kpi-num">${promedioDiario}</div><div class="pt-kpi-label">Sesiones / día (prom.)</div></div>
      <div class="pt-kpi-card"><div class="pt-kpi-num">${recurrentes}</div><div class="pt-kpi-label">Clientes recurrentes</div></div>
    </div>

    ${alertas.length?`
      <div class="section-title">⚠ Controles automáticos <span></span></div>
      ${alertas.slice(0,20).map(a=>`<div class="alerta-auto"><span class="icono">⚠</span><span>${a}</span></div>`).join('')}
    `:`<div class="section-title">⚠ Controles automáticos <span></span></div><div class="empty">Sin anomalías detectadas en el período</div>`}

    <div class="section-title">Ranking de entrenadores <span></span></div>
    ${ranking.length?ranking.map(([nombre,d],i)=>`
      <div class="ranking-row">
        <div class="ranking-pos">${i+1}</div>
        <div class="ranking-nombre">${nombre}</div>
        <div class="ranking-num">${d.sesiones} sesiones · ${d.horas.toFixed(1)}h · ${d.clientes.size} clientes</div>
      </div>`).join(''):'<div class="empty">Sin datos en el período</div>'}
  `;
}

// ============================================================
// AGENDA / CALENDARIO (solo supervisor)
// Visitas, recordatorios, compras, llamadas, reuniones y
// seguimientos, con vista de calendario mensual + lista de
// próximos eventos. Nunca se borran eventos: se marcan como
// completados o cancelados, quedando en el historial.
// ============================================================
let agendaEventos = [];
let mesAgendaActual = new Date();
let diaSeleccionadoAgenda = null; // 'YYYY-MM-DD' o null (= vista "próximos")

const TIPO_EVENTO_LABEL = {
  visita:'🏢 Visita', recordatorio:'🔔 Recordatorio', compra:'🛒 Compra',
  llamada:'📞 Llamada', reunion:'🤝 Reunión', seguimiento:'📌 Seguimiento',
};
const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_SEMANA_MINI = ['D','L','M','M','J','V','S'];

window.initAgendaPanel = async function(){
  document.getElementById('agenda-filtro-suc').innerHTML =
    `<option value="">Todas las sucursales</option>` + SUCURSALES.map(s=>`<option value="${s}">${s}</option>`).join('');

  showLoading();
  try{
    const snap = await getDocs(collection(db,'agenda_eventos'));
    agendaEventos = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ agendaEventos=[]; showToast('Error al cargar la agenda','err'); }
  hideLoading();

  mesAgendaActual = new Date();
  diaSeleccionadoAgenda = null;
  renderCalendarioAgenda();
  renderAgenda();
};

window.cambiarMesAgenda = function(delta){
  mesAgendaActual.setMonth(mesAgendaActual.getMonth()+delta);
  diaSeleccionadoAgenda = null;
  renderCalendarioAgenda();
  renderAgenda();
};

function filtrarEventosAgenda(lista){
  const tipo = document.getElementById('agenda-filtro-tipo')?.value || '';
  const suc  = document.getElementById('agenda-filtro-suc')?.value || '';
  return lista.filter(e=>{
    if(tipo && e.tipo!==tipo) return false;
    if(suc && e.sucursal!==suc) return false;
    return true;
  });
}

function renderCalendarioAgenda(){
  const year=mesAgendaActual.getFullYear(), month=mesAgendaActual.getMonth();
  document.getElementById('cal-mes-label').textContent = `${MESES_NOMBRE[month]} ${year}`;
  const primerDia = new Date(year, month, 1).getDay();
  const diasEnMes = new Date(year, month+1, 0).getDate();
  const hoy = fechaHoy();
  const fechasConEventos = new Set(filtrarEventosAgenda(agendaEventos).map(e=>e.fecha));

  let html = DIAS_SEMANA_MINI.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<primerDia;i++) html += `<div class="cal-day cal-day-empty"></div>`;
  for(let d=1; d<=diasEnMes; d++){
    const fechaStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const clases = ['cal-day'];
    if(fechaStr===hoy) clases.push('cal-day-hoy');
    if(fechaStr===diaSeleccionadoAgenda) clases.push('cal-day-sel');
    html += `<div class="${clases.join(' ')}" onclick="seleccionarDiaAgenda('${fechaStr}')">
      <span>${d}</span>${fechasConEventos.has(fechaStr)?'<span class="cal-dot"></span>':''}
    </div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

window.seleccionarDiaAgenda = function(fechaStr){
  diaSeleccionadoAgenda = (diaSeleccionadoAgenda===fechaStr) ? null : fechaStr;
  renderCalendarioAgenda();
  renderAgenda();
};

window.renderAgenda = function(){
  renderCalendarioAgenda();
  const cont = document.getElementById('agenda-lista');
  const hoy = fechaHoy();
  let lista = filtrarEventosAgenda(agendaEventos);

  if(diaSeleccionadoAgenda){
    lista = lista.filter(e=>e.fecha===diaSeleccionadoAgenda);
  } else {
    // Vista "próximos": lo pendiente (incluso vencido, para no perderlo
    // de vista) + lo que todavía está por venir.
    lista = lista.filter(e=> e.estado==='pendiente' || e.fecha>=hoy);
  }
  lista.sort((a,b)=> (a.fecha+'_'+(a.hora||'99:99')).localeCompare(b.fecha+'_'+(b.hora||'99:99')));

  if(!lista.length){ cont.innerHTML='<div class="empty">Sin eventos para mostrar</div>'; return; }

  cont.innerHTML = lista.map(e=>{
    const vencido = e.estado==='pendiente' && e.fecha<hoy;
    return `
    <div class="evento-card ${vencido?'evento-vencido':''} ${e.estado!=='pendiente'?'evento-resuelto':''}">
      <div class="evento-top">
        <div>
          <div class="evento-titulo">${TIPO_EVENTO_LABEL[e.tipo]||e.tipo} — ${e.titulo}</div>
          <div class="evento-meta">${e.fecha}${e.hora?' · '+e.hora:''} · ${e.sucursal||'Todas las sucursales'}</div>
        </div>
        ${e.prioridad==='alta'?'<span class="estado-badge estado-cancelada">Alta</span>':''}
      </div>
      ${e.descripcion?`<div class="evento-desc">${e.descripcion}</div>`:''}
      ${vencido?'<div class="alerta-msg">⚠ Vencido, sin resolver</div>':''}
      ${e.estado!=='pendiente'?`<div class="check-meta">${e.estado==='completado'?'✓ Completado':'Cancelado'} por ${e.resueltoPor||''}</div>`:''}
      <div class="report-actions">
        ${e.estado==='pendiente'?`
          <button class="btn-sm btn-atend" onclick="resolverEvento('${e.id}','completado')">✓ Completar</button>
          <button class="btn-sm btn-defer" onclick="abrirModalEvento('${e.id}')">Editar</button>
          <button class="btn-sm btn-noatend" onclick="resolverEvento('${e.id}','cancelado')">Cancelar</button>
        `:''}
      </div>
    </div>`;
  }).join('');
};

window.abrirModalEvento = function(id){
  const e = id ? agendaEventos.find(x=>x.id===id) : null;
  document.getElementById('evento-id-edit').value = id||'';
  document.getElementById('modal-evento-titulo').textContent = e?'Editar evento':'Nuevo evento';
  document.getElementById('evento-tipo').value = e?e.tipo:'visita';
  document.getElementById('evento-titulo').value = e?e.titulo:'';
  document.getElementById('evento-fecha').value = e?e.fecha:(diaSeleccionadoAgenda||fechaHoy());
  document.getElementById('evento-hora').value = e?(e.hora||''):'';
  document.getElementById('evento-sucursal').innerHTML =
    `<option value="">Todas las sucursales</option>` + SUCURSALES.map(s=>`<option value="${s}">${s}</option>`).join('');
  document.getElementById('evento-sucursal').value = e?(e.sucursal||''):(currentSuc||'');
  document.getElementById('evento-prioridad').value = e?e.prioridad:'normal';
  document.getElementById('evento-desc').value = e?(e.descripcion||''):'';
  document.getElementById('modal-evento').classList.add('open');
};

window.guardarEvento = async function(){
  const id = document.getElementById('evento-id-edit').value;
  const tipo = document.getElementById('evento-tipo').value;
  const titulo = document.getElementById('evento-titulo').value.trim();
  const fecha = document.getElementById('evento-fecha').value;
  const hora = document.getElementById('evento-hora').value;
  const sucursal = document.getElementById('evento-sucursal').value;
  const prioridad = document.getElementById('evento-prioridad').value;
  const descripcion = document.getElementById('evento-desc').value.trim();
  if(!titulo || !fecha){ showToast('Completa el título y la fecha','err'); return; }
  showLoading();
  try{
    const data = { tipo, titulo, fecha, hora, sucursal, prioridad, descripcion };
    if(id){
      await updateDoc(doc(db,'agenda_eventos',id), data);
    } else {
      await setDoc(doc(collection(db,'agenda_eventos')), {
        ...data, estado:'pendiente', creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
      });
    }
    closeModal('modal-evento');
    showToast('Evento guardado');
    await initAgendaPanel();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// Nunca se borran eventos — solo se marcan como completados o
// cancelados, quedando siempre en el historial de la agenda.
window.resolverEvento = async function(id, nuevoEstado){
  showLoading();
  try{
    await updateDoc(doc(db,'agenda_eventos',id),{
      estado:nuevoEstado, resueltoPor:currentUser.name, resueltoEn:new Date().toISOString(),
    });
    showToast(nuevoEstado==='completado'?'Marcado como completado':'Evento cancelado');
    await initAgendaPanel();
  } catch(e){ showToast('Error','err'); }
  hideLoading();
};

// ============================================================
// OPERACIONES: Dashboard + Incidencias + Bitácora + Checklist
// operativo (apertura/cierre). Módulo de uso exclusivo del
// supervisor — centro de control de las 5 sucursales.
// ============================================================
let incidenciasData = [];
let bitacoraData = [];
let vistaActualOps = 'dashboard';
let tipoChecklistOpsActual = 'apertura';
let checklistOpsConfig = {apertura:[], cierre:[]};
let checklistOpsRegistroHoy = {apertura:{}, cierre:{}};
let fotosIncidenciaActual = {antes:null, durante:null, despues:null};

const DEFAULT_CHECKLIST_APERTURA = ['Encender neones','Encender música','Revisar baños','Revisar duchas','Revisar recepción','Revisar internet','Encender televisores','Revisar cámaras','Revisar caja','Revisar aromatización'];
const DEFAULT_CHECKLIST_CIERRE   = ['Apagar equipos','Apagar televisores','Cerrar caja','Apagar luces','Cerrar puertas','Activar alarma'];

function estadoIncidenciaLabel(e){ return {abierta:'Abierta',en_proceso:'En proceso',resuelta:'Resuelta',cancelada:'Cancelada'}[e]||e; }
function prioridadIncidenciaLabel(p){ return {baja:'Baja',media:'Media',alta:'Alta',critica:'Crítica'}[p]||p; }

async function registrarAuditoriaOps(entidad, entidadId, entidadNombre, cambio, motivo){
  try{
    await setDoc(doc(collection(db,'auditoria_ops')),{
      entidad, entidadId, entidadNombre, usuario:currentUser.name,
      fecha:fechaHoy(), hora:horaActual(), cambio, motivo:motivo||'',
      sucursal:currentSuc, timestamp:tsAhora(),
    });
  } catch(e){ /* la auditoría no debe frenar la operación principal */ }
}

// ------------------------------------------------------------
// Entrada del panel
// ------------------------------------------------------------
window.initOpsPanel = async function(){
  document.getElementById('bitacora-sucursal').innerHTML = SUCURSALES.map(s=>`<option value="${s}" ${s===currentSuc?'selected':''}>${s}</option>`).join('');
  showLoading();
  try{
    const si = await getDocs(collection(db,'incidencias')); // todas las sucursales, para el dashboard ejecutivo
    incidenciasData = si.docs.map(d=>({id:d.id,...d.data()}));
    const sb = await getDocs(query(collection(db,'bitacora'), where('sucursal','==',currentSuc)));
    bitacoraData = sb.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.creadoEn||'').localeCompare(a.creadoEn||''));
    const sm = await getDocs(query(collection(db,'mantenimientos'), where('sucursal','==',currentSuc)));
    mantenimientoData = sm.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
    const sg = await getDocs(query(collection(db,'gastos'), where('sucursal','==',currentSuc)));
    gastosData = sg.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
    const sinsp = await getDocs(query(collection(db,'inspecciones'), where('sucursal','==',currentSuc)));
    inspeccionesData = sinsp.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.creadoEn||'').localeCompare(a.creadoEn||''));
  } catch(e){ showToast('Error al cargar operaciones','err'); }
  hideLoading();
  cambiarVistaOps('dashboard');
};

window.cambiarVistaOps = function(vista){
  vistaActualOps = vista;
  document.querySelectorAll('#switch-ops .clases-switch-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`#switch-ops [data-vista="${vista}"]`);
  if(btn) btn.classList.add('active');
  ['dashboard','incidencias','bitacora','checklist','inspecciones','mantenimiento','gastos','expediente'].forEach(v=>{
    document.getElementById(`ops-${v}-container`).style.display = v===vista?'block':'none';
  });
  document.getElementById('btn-nueva-incidencia').style.display = vista==='incidencias'?'inline-flex':'none';
  document.getElementById('btn-nueva-bitacora').style.display = vista==='bitacora'?'inline-flex':'none';
  document.getElementById('btn-editar-checklist-ops').style.display = vista==='checklist'?'inline-flex':'none';
  document.getElementById('btn-nueva-inspeccion').style.display = vista==='inspecciones'?'inline-flex':'none';
  document.getElementById('btn-nuevo-mantenimiento').style.display = vista==='mantenimiento'?'inline-flex':'none';
  document.getElementById('btn-nuevo-gasto').style.display = vista==='gastos'?'inline-flex':'none';
  document.getElementById('btn-editar-expediente').style.display = vista==='expediente'?'inline-flex':'none';

  if(vista==='dashboard')   renderDashboardOps();
  if(vista==='incidencias') renderIncidencias();
  if(vista==='bitacora')    renderBitacora();
  if(vista==='checklist')   cargarChecklistOps();
  if(vista==='inspecciones')    cargarInspecciones();
  if(vista==='mantenimiento')   cargarMantenimiento();
  if(vista==='gastos')          cargarGastos();
  if(vista==='expediente')      cargarExpediente();
};

// ------------------------------------------------------------
// DASHBOARD EJECUTIVO
// ------------------------------------------------------------
function renderDashboardOps(){
  const cont = document.getElementById('ops-dashboard-container');
  const abiertas = incidenciasData.filter(i=>i.estado==='abierta'||i.estado==='en_proceso');
  const criticas = abiertas.filter(i=>i.prioridad==='critica');
  const abiertasSuc = incidenciasData.filter(i=>i.sucursal===currentSuc && (i.estado==='abierta'||i.estado==='en_proceso'));

  cont.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-top"><span class="stat-label">Incidencias abiertas</span><span class="stat-icon warn">!</span></div><div class="stat-num">${abiertas.length}</div><div class="stat-sub">en las 5 sucursales</div></div>
      <div class="stat-card"><div class="stat-top"><span class="stat-label">Críticas sin resolver</span><span class="stat-icon warn">⚠</span></div><div class="stat-num">${criticas.length}</div><div class="stat-sub">prioridad más alta</div></div>
      <div class="stat-card"><div class="stat-top"><span class="stat-label">Abiertas en esta sucursal</span><span class="stat-icon ok">◔</span></div><div class="stat-num">${abiertasSuc.length}</div><div class="stat-sub">${currentSuc}</div></div>
    </div>
    <div class="section-title">Incidencias críticas <span></span></div>
    ${criticas.length?criticas.slice(0,8).map(i=>`
      <div class="incidencia-card">
        <div class="incidencia-top">
          <div><div class="incidencia-titulo">${i.codigo} — ${i.titulo}</div><div class="incidencia-meta">${i.sucursal} · ${i.area} · ${i.fecha}</div></div>
          <span class="estado-badge estado-${i.estado}">${estadoIncidenciaLabel(i.estado)}</span>
        </div>
      </div>`).join(''):'<div class="empty">Sin incidencias críticas abiertas</div>'}

    <div class="section-title">Actividad reciente en bitácora (${currentSuc}) <span></span></div>
    ${bitacoraData.length?bitacoraData.slice(0,5).map(b=>`
      <div class="bitacora-row"><div class="bitacora-fecha">${b.fecha} ${b.hora}</div><div class="bitacora-texto">${b.texto}</div><div class="bitacora-autor">— ${b.autor}</div></div>
    `).join(''):'<div class="empty">Sin entradas todavía en esta sucursal</div>'}
  `;
}

// ------------------------------------------------------------
// INCIDENCIAS — nunca se borran, solo cambian de estado
// ------------------------------------------------------------
function siguienteCodigoIncidencia(){
  const nums = incidenciasData.map(i=>{ const m=(i.codigo||'').match(/(\d+)$/); return m?parseInt(m[1],10):0; });
  const next = (nums.length?Math.max(...nums):0)+1;
  return 'INC-'+String(next).padStart(3,'0');
}

window.renderIncidencias = function(){
  const cont = document.getElementById('ops-incidencias-lista');
  const estadoF = document.getElementById('inc-filtro-estado').value;
  const prioF = document.getElementById('inc-filtro-prioridad').value;
  let lista = incidenciasData.filter(i=>i.sucursal===currentSuc);
  if(estadoF) lista = lista.filter(i=>i.estado===estadoF);
  if(prioF) lista = lista.filter(i=>i.prioridad===prioF);
  const orden = {critica:0,alta:1,media:2,baja:3};
  lista.sort((a,b)=> (orden[a.prioridad]-orden[b.prioridad]) || (b.creadoEn||'').localeCompare(a.creadoEn||''));

  if(!lista.length){ cont.innerHTML='<div class="empty">Sin incidencias con estos filtros</div>'; return; }

  cont.innerHTML = lista.map(i=>`
    <div class="incidencia-card" onclick="abrirModalIncidencia('${i.id}')">
      <div class="incidencia-top">
        <div>
          <div class="incidencia-titulo">${i.codigo} — ${i.titulo}</div>
          <div class="incidencia-meta">${i.area} · ${i.fecha} · detectado por ${i.detectadoPor}</div>
        </div>
        <span class="estado-badge estado-${i.estado}">${estadoIncidenciaLabel(i.estado)}</span>
      </div>
      <div class="incidencia-tags">
        <span class="prioridad-tag prioridad-${i.prioridad}">${prioridadIncidenciaLabel(i.prioridad)}</span>
        ${i.responsable?`<span class="suc-tag-mini">Resp: ${i.responsable}</span>`:''}
        ${i.costo?`<span class="suc-tag-mini">Bs ${i.costo}</span>`:''}
        ${(i.fotoAntes||i.fotoDurante||i.fotoDespues)?'<span class="suc-tag-mini">📷 con fotos</span>':''}
      </div>
    </div>`).join('');
};

window.abrirModalIncidencia = function(id){
  const i = id ? incidenciasData.find(x=>x.id===id) : null;
  document.getElementById('incidencia-id-edit').value = id||'';
  document.getElementById('modal-incidencia-titulo').textContent = i ? `${i.codigo} — Editar` : `Nueva incidencia (${siguienteCodigoIncidencia()})`;
  document.getElementById('incidencia-area').value = i?i.area:'Recepción';
  document.getElementById('incidencia-prioridad').value = i?i.prioridad:'media';
  document.getElementById('incidencia-titulo').value = i?i.titulo:'';
  document.getElementById('incidencia-desc').value = i?(i.descripcion||''):'';
  document.getElementById('campo-incidencia-estado').style.display = i?'block':'none';
  document.getElementById('incidencia-estado').value = i?i.estado:'abierta';
  document.getElementById('incidencia-responsable').value = i?(i.responsable||''):'';
  document.getElementById('incidencia-costo').value = i?(i.costo??''):'';
  document.getElementById('incidencia-proveedor').value = i?(i.proveedor||''):'';

  fotosIncidenciaActual = {antes:i?(i.fotoAntes||null):null, durante:i?(i.fotoDurante||null):null, despues:i?(i.fotoDespues||null):null};
  ['antes','durante','despues'].forEach(slot=>{
    const img = document.getElementById(`inc-foto-${slot}-preview`);
    if(fotosIncidenciaActual[slot]){ img.src=fotosIncidenciaActual[slot]; img.style.display='block'; }
    else { img.style.display='none'; img.src=''; }
    document.getElementById(`inc-foto-${slot}-cam`).value='';
    document.getElementById(`inc-foto-${slot}-gal`).value='';
  });

  document.getElementById('incidencia-comentarios-bloque').style.display = i?'block':'none';
  renderComentariosIncidencia(i?(i.comentarios||[]):[]);
  document.getElementById('incidencia-nuevo-comentario').value='';

  document.getElementById('modal-incidencia').classList.add('open');
};

function renderComentariosIncidencia(comentarios){
  const cont = document.getElementById('incidencia-comentarios-lista');
  if(!comentarios.length){ cont.innerHTML = '<div class="empty" style="padding:8px 0">Sin comentarios</div>'; return; }
  cont.innerHTML = comentarios.map(c=>`
    <div class="comentario-row"><strong>${c.autor}</strong> · ${c.fecha} ${c.hora}<div>${c.texto}</div></div>
  `).join('');
}

window.agregarComentarioIncidencia = async function(){
  const id = document.getElementById('incidencia-id-edit').value;
  if(!id){ showToast('Guarda la incidencia primero','err'); return; }
  const input = document.getElementById('incidencia-nuevo-comentario');
  const texto = input.value.trim();
  if(!texto) return;
  const i = incidenciasData.find(x=>x.id===id);
  const comentarios = (i.comentarios||[]).concat([{texto, autor:currentUser.name, fecha:fechaHoy(), hora:horaActual()}]);
  try{
    await updateDoc(doc(db,'incidencias',id),{comentarios});
    i.comentarios = comentarios;
    renderComentariosIncidencia(comentarios);
    input.value='';
    showToast('Comentario agregado');
  } catch(e){ showToast('Error al agregar comentario','err'); }
};

window.previewFotoIncidencia = async function(input, slot){
  if(!input.files || !input.files[0]) return;
  try{
    const dataUrl = await comprimirImagen(input.files[0]);
    fotosIncidenciaActual[slot] = dataUrl;
    const img = document.getElementById(`inc-foto-${slot}-preview`);
    img.src = dataUrl; img.style.display='block';
  } catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.guardarIncidencia = async function(){
  const id = document.getElementById('incidencia-id-edit').value;
  const area = document.getElementById('incidencia-area').value;
  const prioridad = document.getElementById('incidencia-prioridad').value;
  const titulo = document.getElementById('incidencia-titulo').value.trim();
  const descripcion = document.getElementById('incidencia-desc').value.trim();
  const estado = document.getElementById('incidencia-estado').value;
  const responsable = document.getElementById('incidencia-responsable').value.trim();
  const costoVal = document.getElementById('incidencia-costo').value;
  const costo = costoVal!==''?Number(costoVal):null;
  const proveedor = document.getElementById('incidencia-proveedor').value.trim();
  if(!titulo){ showToast('Escribe un título','err'); return; }
  showLoading();
  try{
    const data = {
      sucursal: currentSuc, area, prioridad, titulo, descripcion, responsable, costo, proveedor,
      fotoAntes: fotosIncidenciaActual.antes, fotoDurante: fotosIncidenciaActual.durante, fotoDespues: fotosIncidenciaActual.despues,
    };
    if(id){
      const anterior = incidenciasData.find(x=>x.id===id);
      await updateDoc(doc(db,'incidencias',id),{...data, estado, actualizadoPor:currentUser.name, actualizadoEn:new Date().toISOString()});
      const cambio = (anterior && anterior.estado!==estado)
        ? `Cambió el estado de ${estadoIncidenciaLabel(anterior.estado)} a ${estadoIncidenciaLabel(estado)}`
        : 'Editó datos de la incidencia';
      await registrarAuditoriaOps('incidencia', id, `${anterior?anterior.codigo:''} — ${titulo}`, cambio, '');
    } else {
      const ref = doc(collection(db,'incidencias'));
      const codigo = siguienteCodigoIncidencia();
      await setDoc(ref, {
        ...data, codigo, estado:'abierta', comentarios:[], detectadoPor:currentUser.name,
        fecha:fechaHoy(), creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
      });
      await registrarAuditoriaOps('incidencia', ref.id, `${codigo} — ${titulo}`, 'Incidencia registrada (alta inicial)', '');
    }
    closeModal('modal-incidencia');
    showToast('Incidencia guardada');
    await initOpsPanel();
    cambiarVistaOps('incidencias');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// BITÁCORA — diario operativo, cronológico, nunca se edita ni borra
// ------------------------------------------------------------
window.renderBitacora = function(){
  const cont = document.getElementById('ops-bitacora-container');
  const lista = bitacoraData;
  if(!lista.length){ cont.innerHTML = '<div class="empty">Sin entradas todavía en esta sucursal</div>'; return; }
  const porFecha = {};
  lista.forEach(b=>{ (porFecha[b.fecha]=porFecha[b.fecha]||[]).push(b); });
  const fechas = Object.keys(porFecha).sort((a,b)=>b.localeCompare(a));
  cont.innerHTML = fechas.map(f=>`
    <div class="section-title">${f} <span></span></div>
    ${porFecha[f].map(b=>`
      <div class="bitacora-row">
        <div class="bitacora-fecha">${b.hora}</div>
        <div class="bitacora-texto">${b.texto}</div>
        <div class="bitacora-autor">— ${b.autor}</div>
      </div>`).join('')}
  `).join('');
};

window.abrirModalBitacora = function(){
  document.getElementById('bitacora-sucursal').innerHTML = SUCURSALES.map(s=>`<option value="${s}" ${s===currentSuc?'selected':''}>${s}</option>`).join('');
  document.getElementById('bitacora-texto').value='';
  document.getElementById('modal-bitacora').classList.add('open');
};

window.guardarBitacora = async function(){
  const sucursal = document.getElementById('bitacora-sucursal').value;
  const texto = document.getElementById('bitacora-texto').value.trim();
  if(!texto){ showToast('Escribe qué pasó','err'); return; }
  showLoading();
  try{
    await setDoc(doc(collection(db,'bitacora')),{
      sucursal, texto, autor:currentUser.name, fecha:fechaHoy(), hora:horaActual(), creadoEn:new Date().toISOString(),
    });
    closeModal('modal-bitacora');
    showToast('Entrada agregada a la bitácora');
    await initOpsPanel();
    cambiarVistaOps('bitacora');
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// CHECKLIST OPERATIVO (apertura/cierre) — reutilizable, editable
// por sucursal, con registro diario de quién marcó qué y cuándo
// ------------------------------------------------------------
window.cambiarTipoChecklistOps = function(tipo){
  tipoChecklistOpsActual = tipo;
  document.querySelectorAll('#switch-checklist-ops .clases-switch-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`#switch-checklist-ops [data-tipo="${tipo}"]`);
  if(btn) btn.classList.add('active');
  renderChecklistOps();
};

window.cargarChecklistOps = async function(){
  const cont = document.getElementById('ops-checklist-lista');
  cont.innerHTML = '<div class="empty">Cargando...</div>';
  try{
    for(const tipo of ['apertura','cierre']){
      const ref = doc(db,'checklist_ops_config', `${currentSuc}_${tipo}`);
      const snap = await getDoc(ref);
      if(snap.exists()){
        checklistOpsConfig[tipo] = snap.data().items || [];
      } else {
        const defaults = tipo==='apertura'?DEFAULT_CHECKLIST_APERTURA:DEFAULT_CHECKLIST_CIERRE;
        await setDoc(ref, {items:defaults, sucursal:currentSuc, tipo});
        checklistOpsConfig[tipo] = defaults;
      }
      const regRef = doc(db,'checklist_ops_registro', `${currentSuc}_${tipo}_${fechaHoy()}`);
      const regSnap = await getDoc(regRef);
      checklistOpsRegistroHoy[tipo] = regSnap.exists() ? (regSnap.data().items||{}) : {};
    }
  } catch(e){ cont.innerHTML='<div class="empty">Error al cargar</div>'; return; }
  renderChecklistOps();
};

function renderChecklistOps(){
  const cont = document.getElementById('ops-checklist-lista');
  const tipo = tipoChecklistOpsActual;
  const items = checklistOpsConfig[tipo] || [];
  const estado = checklistOpsRegistroHoy[tipo] || {};
  if(!items.length){ cont.innerHTML = '<div class="empty">Sin ítems configurados — tocá "Editar lista"</div>'; return; }
  const hechos = items.filter((_,i)=>estado[i]?.hecho).length;
  cont.innerHTML = `
    <div class="rev-resumen-sup">${hechos} de ${items.length} completados hoy (${fechaHoy()})</div>
    ${items.map((texto,i)=>{
      const dat = estado[i]||{};
      const hecho = dat.hecho||false;
      return `
      <div class="check-item ${hecho?'item-done':''}">
        <input type="checkbox" ${hecho?'checked':''} onchange="marcarChecklistOps(${i},this.checked)">
        <div class="check-content">
          <div class="check-label ${hecho?'done':''}">${texto}</div>
          ${hecho?`<div class="check-meta">✓ ${dat.hora} — ${dat.quien}</div>`:''}
        </div>
      </div>`;
    }).join('')}
  `;
}

window.marcarChecklistOps = async function(idx, marcado){
  const tipo = tipoChecklistOpsActual;
  checklistOpsRegistroHoy[tipo][idx] = marcado ? {hecho:true, hora:horaActual(), quien:currentUser.name} : {hecho:false};
  try{
    await setDoc(doc(db,'checklist_ops_registro', `${currentSuc}_${tipo}_${fechaHoy()}`),{
      sucursal:currentSuc, tipo, fecha:fechaHoy(), items:checklistOpsRegistroHoy[tipo],
    });
  } catch(e){ showToast('Error al guardar','err'); }
  renderChecklistOps();
};

window.abrirModalEditarChecklistOps = function(){
  const tipo = tipoChecklistOpsActual;
  const items = checklistOpsConfig[tipo] || [];
  document.getElementById('checklist-ops-edit-tipo').value = tipo;
  document.getElementById('checklist-ops-edit-textarea').value = items.join('\n');
  document.getElementById('modal-editar-checklist-ops').classList.add('open');
};

window.guardarChecklistOpsConfig = async function(){
  const tipo = document.getElementById('checklist-ops-edit-tipo').value;
  const texto = document.getElementById('checklist-ops-edit-textarea').value;
  const items = texto.split('\n').map(t=>t.trim()).filter(Boolean);
  if(!items.length){ showToast('Agrega al menos un ítem','err'); return; }
  showLoading();
  try{
    await setDoc(doc(db,'checklist_ops_config', `${currentSuc}_${tipo}`), {items, sucursal:currentSuc, tipo});
    checklistOpsConfig[tipo] = items;
    closeModal('modal-editar-checklist-ops');
    showToast('Lista actualizada');
    renderChecklistOps();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ============================================================
// FASE 2 — INSPECCIONES, MANTENIMIENTO Y GASTOS
// ============================================================
let inspeccionesData = [];
let mantenimientoData = [];
let gastosData = [];
let inspeccionActual = null; // inspección en curso que se está viendo/llenando
let fotoMantActual = null;
let fotoGastoActual = null;

const CATEGORIAS_INSPECCION = [
  'Recepción','Sala de musculación','Cardio','Peso libre','Baños','Duchas','Vestidores','Casilleros',
  'Pisos','Techos','Paredes','Pintura','Electricidad','Iluminación','Neones','Letreros','Internet',
  'Televisores','Sonido','Cámaras','Seguridad','Limpieza','Almacén','Oficina','Exterior',
];
const CALIFICACIONES = ['excelente','bueno','regular','malo','critico'];
const CALIFICACION_LABEL = {excelente:'Excelente',bueno:'Bueno',regular:'Regular',malo:'Malo',critico:'Crítico'};

// ------------------------------------------------------------
// INSPECCIONES — recorrido por las 25 categorías con calificación
// de 5 niveles. Las categorías marcadas "Crítico" generan
// automáticamente una incidencia vinculada (no hay que cargarla
// dos veces).
// ------------------------------------------------------------
function cargarInspecciones(){
  inspeccionActual = null;
  renderInspecciones();
}

window.renderInspecciones = function(){
  const cont = document.getElementById('ops-inspecciones-container');
  if(inspeccionActual){ renderDetalleInspeccion(); return; }

  const lista = inspeccionesData;
  if(!lista.length){ cont.innerHTML='<div class="empty">Sin inspecciones registradas todavía</div>'; return; }
  cont.innerHTML = lista.map(insp=>{
    const total = CATEGORIAS_INSPECCION.length;
    const calificadas = Object.keys(insp.categorias||{}).length;
    const criticos = Object.values(insp.categorias||{}).filter(c=>c.calificacion==='critico').length;
    return `
    <div class="incidencia-card" onclick="abrirInspeccion('${insp.id}')">
      <div class="incidencia-top">
        <div>
          <div class="incidencia-titulo">Inspección ${insp.fecha} ${insp.hora}</div>
          <div class="incidencia-meta">${insp.administrador} · ${calificadas}/${total} categorías${insp.duracionMin?' · '+insp.duracionMin+' min':''}</div>
        </div>
        <span class="estado-badge estado-${insp.estado==='finalizada'?'finalizada':'en_curso'}">${insp.estado==='finalizada'?'Finalizada':'En curso'}</span>
      </div>
      ${criticos?`<div class="incidencia-tags"><span class="prioridad-tag prioridad-critica">${criticos} categoría(s) crítica(s)</span></div>`:''}
    </div>`;
  }).join('');
};

window.crearInspeccion = async function(){
  showLoading();
  try{
    const ref = doc(collection(db,'inspecciones'));
    const data = {
      sucursal: currentSuc, administrador: currentUser.name,
      fecha: fechaHoy(), hora: horaActual(), horaInicioTs: tsAhora(),
      estado: 'en_curso', categorias: {}, creadoEn: new Date().toISOString(),
    };
    await setDoc(ref, data);
    inspeccionesData.unshift({id:ref.id, ...data});
    inspeccionActual = {id:ref.id, ...data};
    renderDetalleInspeccion();
  } catch(e){ showToast('Error al crear la inspección','err'); }
  hideLoading();
};

window.abrirInspeccion = function(id){
  inspeccionActual = inspeccionesData.find(x=>x.id===id);
  renderDetalleInspeccion();
};

window.volverListaInspecciones = function(){
  inspeccionActual = null;
  renderInspecciones();
};

function renderDetalleInspeccion(){
  const cont = document.getElementById('ops-inspecciones-container');
  const insp = inspeccionActual;
  const soloLectura = insp.estado==='finalizada';
  const cat = insp.categorias||{};

  cont.innerHTML = `
    <button class="btn-link-report" onclick="volverListaInspecciones()">← Volver a inspecciones</button>
    <div class="rev-resumen-sup">${insp.fecha} ${insp.hora} · ${insp.administrador} · ${Object.keys(cat).length}/${CATEGORIAS_INSPECCION.length} categorías revisadas</div>
    ${CATEGORIAS_INSPECCION.map(nombre=>{
      const id = slugArea(nombre);
      const c = cat[id];
      const necesitaDetalle = c && (c.calificacion==='regular'||c.calificacion==='malo'||c.calificacion==='critico');
      return `
      <div class="area-block">
        <div class="area-header-rev">
          <div style="flex:1;min-width:180px">
            <div class="area-name">${nombre}</div>
            ${c
              ? `<div class="rev-marca niv-${c.calificacion==='excelente'||c.calificacion==='bueno'?'bien':'falta'}">${CALIFICACION_LABEL[c.calificacion]}${c.observacion?' — '+c.observacion:''}</div>`
              : `<div class="rev-marca rev-pendiente">Sin calificar</div>`}
          </div>
          ${!soloLectura?`
          <div class="rev-btns" style="flex-wrap:wrap">
            ${CALIFICACIONES.map(cal=>`<button class="btn-rev btn-cal-${cal} ${c&&c.calificacion===cal?'activo':''}" onclick="calificarCategoria('${id}','${nombre.replace(/'/g,"\\'")}','${cal}')">${CALIFICACION_LABEL[cal]}</button>`).join('')}
          </div>`:''}
        </div>
        ${!soloLectura && necesitaDetalle ? `
        <div style="padding:0 16px 14px">
          <textarea class="obs-input" style="width:100%;min-height:50px" placeholder="¿Qué se encontró? (opcional)"
            onchange="guardarObsCategoria('${id}',this.value)">${c?.observacion||''}</textarea>
        </div>`:''}
      </div>`;
    }).join('')}
    ${!soloLectura?`<button class="btn-send" style="width:100%;margin-top:10px" onclick="finalizarInspeccion()">Finalizar inspección</button>`:''}
  `;
}

window.calificarCategoria = async function(id, nombre, calificacion){
  const insp = inspeccionActual;
  insp.categorias = insp.categorias || {};
  insp.categorias[id] = {nombre, calificacion, observacion: insp.categorias[id]?.observacion||''};
  try{
    await updateDoc(doc(db,'inspecciones',insp.id), {categorias: insp.categorias});
  } catch(e){ showToast('Error al guardar','err'); }
  renderDetalleInspeccion();
};

window.guardarObsCategoria = async function(id, texto){
  const insp = inspeccionActual;
  if(!insp.categorias[id]) return;
  insp.categorias[id].observacion = texto;
  try{ await updateDoc(doc(db,'inspecciones',insp.id), {categorias: insp.categorias}); }catch(e){}
};

// Al finalizar: calcula duración, y cualquier categoría "Crítico" se
// convierte automáticamente en una incidencia (con prioridad crítica),
// para no tener que cargarla dos veces por separado.
window.finalizarInspeccion = async function(){
  const insp = inspeccionActual;
  const duracionMin = Math.round((tsAhora()-insp.horaInicioTs)/60000);
  showLoading();
  try{
    await updateDoc(doc(db,'inspecciones',insp.id), {estado:'finalizada', duracionMin});
    insp.estado='finalizada'; insp.duracionMin=duracionMin;

    const criticos = Object.entries(insp.categorias||{}).filter(([,c])=>c.calificacion==='critico');
    for(const [id,c] of criticos){
      const codigo = siguienteCodigoIncidencia();
      const ref = doc(collection(db,'incidencias'));
      const data = {
        sucursal: currentSuc, area: c.nombre, prioridad:'critica',
        titulo: `Detectado en inspección: ${c.nombre}`, descripcion: c.observacion||'Calificado como crítico en inspección',
        responsable:'', costo:null, proveedor:'', fotoAntes:null, fotoDurante:null, fotoDespues:null,
        codigo, estado:'abierta', comentarios:[], detectadoPor:currentUser.name,
        fecha:fechaHoy(), creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
        origenInspeccionId: insp.id,
      };
      await setDoc(ref, data);
      incidenciasData.unshift({id:ref.id, ...data});
    }
    showToast(criticos.length?`Inspección finalizada — se generaron ${criticos.length} incidencia(s) crítica(s)`:'Inspección finalizada');
    inspeccionActual = insp;
    renderDetalleInspeccion();
  } catch(e){ showToast('Error al finalizar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// MANTENIMIENTO — historial por máquina/equipo, con alerta cuando
// el próximo mantenimiento está por vencer o ya venció.
// ------------------------------------------------------------
function estadoMantenimiento(m){
  if(!m.proximoMantenimiento) return 'vigente';
  const hoy = fechaHoy();
  const en7 = fechaLocal(new Date(Date.now()+7*86400000));
  if(m.proximoMantenimiento < hoy) return 'vencido';
  if(m.proximoMantenimiento <= en7) return 'por_vencer';
  return 'vigente';
}
function estadoMantLabel(e){ return {vigente:'Vigente',por_vencer:'Por vencer',vencido:'Vencido'}[e]||e; }

function cargarMantenimiento(){ renderMantenimiento(); }

window.renderMantenimiento = function(){
  const cont = document.getElementById('ops-mantenimiento-lista');
  const filtro = document.getElementById('mant-filtro-estado').value;
  let lista = mantenimientoData.map(m=>({...m, _estado:estadoMantenimiento(m)}));
  if(filtro) lista = lista.filter(m=>m._estado===filtro);
  if(!lista.length){ cont.innerHTML='<div class="empty">Sin registros de mantenimiento</div>'; return; }

  cont.innerHTML = lista.map(m=>`
    <div class="incidencia-card" style="cursor:default">
      <div class="incidencia-top">
        <div>
          <div class="incidencia-titulo">${m.maquina}</div>
          <div class="incidencia-meta">${m.tipo==='preventivo'?'Preventivo':'Correctivo'} · ${m.fecha} · ${m.proveedor||'sin proveedor'}</div>
        </div>
        <span class="estado-badge estado-${m._estado==='vencido'?'cancelada':m._estado==='por_vencer'?'en_proceso':'finalizada'}">${estadoMantLabel(m._estado)}</span>
      </div>
      ${m.observaciones?`<div class="incidencia-meta" style="margin-bottom:6px">${m.observaciones}</div>`:''}
      <div class="incidencia-tags">
        ${m.costo?`<span class="suc-tag-mini">Bs ${m.costo}</span>`:''}
        ${m.proximoMantenimiento?`<span class="suc-tag-mini">Próximo: ${m.proximoMantenimiento}</span>`:''}
        ${m.foto?`<span class="suc-tag-mini">📷 con foto</span>`:''}
      </div>
      ${m.foto?`<img src="${m.foto}" class="report-foto" onclick="window.open('${m.foto}')" style="margin-top:8px">`:''}
    </div>`).join('');
};

window.abrirModalMantenimiento = function(){
  document.getElementById('mant-maquina').value='';
  document.getElementById('mant-tipo').value='preventivo';
  document.getElementById('mant-fecha').value=fechaHoy();
  document.getElementById('mant-proveedor').value='';
  document.getElementById('mant-costo').value='';
  document.getElementById('mant-proximo').value='';
  document.getElementById('mant-obs').value='';
  fotoMantActual=null;
  document.getElementById('mant-foto-preview').style.display='none';
  document.getElementById('modal-mantenimiento').classList.add('open');
};

window.previewFotoMant = async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoMantActual = await comprimirImagen(input.files[0]);
    const img = document.getElementById('mant-foto-preview');
    img.src = fotoMantActual; img.style.display='block';
  } catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.guardarMantenimiento = async function(){
  const maquina = document.getElementById('mant-maquina').value.trim();
  const tipo = document.getElementById('mant-tipo').value;
  const fecha = document.getElementById('mant-fecha').value;
  const proveedor = document.getElementById('mant-proveedor').value.trim();
  const costoVal = document.getElementById('mant-costo').value;
  const costo = costoVal!==''?Number(costoVal):null;
  const proximoMantenimiento = document.getElementById('mant-proximo').value || null;
  const observaciones = document.getElementById('mant-obs').value.trim();
  if(!maquina || !fecha){ showToast('Completa la máquina y la fecha','err'); return; }
  showLoading();
  try{
    const ref = doc(collection(db,'mantenimientos'));
    const data = {
      sucursal:currentSuc, maquina, tipo, fecha, proveedor, costo, proximoMantenimiento,
      observaciones, foto:fotoMantActual, creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
    };
    await setDoc(ref, data);
    mantenimientoData.unshift({id:ref.id, ...data});
    closeModal('modal-mantenimiento');
    showToast('Mantenimiento registrado');
    renderMantenimiento();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ------------------------------------------------------------
// GASTOS — se puede vincular a una incidencia o mantenimiento
// existente para no perder la trazabilidad del costo.
// ------------------------------------------------------------
function cargarGastos(){ renderGastos(); }

window.renderGastos = function(){
  const cont = document.getElementById('ops-gastos-lista');
  const filtro = document.getElementById('gasto-filtro-categoria').value;
  let lista = gastosData;
  if(filtro) lista = lista.filter(g=>g.categoria===filtro);
  if(!lista.length){ cont.innerHTML='<div class="empty">Sin gastos registrados</div>'; return; }
  const total = lista.reduce((acc,g)=>acc+(g.monto||0),0);

  cont.innerHTML = `<div class="rev-resumen-sup">${lista.length} gasto(s) · Bs ${total.toFixed(2)} en total</div>` +
    lista.map(g=>`
    <div class="incidencia-card" style="cursor:default">
      <div class="incidencia-top">
        <div>
          <div class="incidencia-titulo">${g.concepto} — Bs ${g.monto}</div>
          <div class="incidencia-meta">${g.fecha} · ${g.proveedor||'sin proveedor'} · registró ${g.creadoPor}</div>
        </div>
        <span class="prioridad-tag prioridad-media">${g.categoria}</span>
      </div>
      ${g.observaciones?`<div class="incidencia-meta">${g.observaciones}</div>`:''}
      ${g.foto?`<img src="${g.foto}" class="report-foto" onclick="window.open('${g.foto}')" style="margin-top:8px">`:''}
    </div>`).join('');
};

window.abrirModalGasto = function(){
  document.getElementById('gasto-concepto').value='';
  document.getElementById('gasto-monto').value='';
  document.getElementById('gasto-categoria').value='mantenimiento';
  document.getElementById('gasto-proveedor').value='';
  document.getElementById('gasto-obs').value='';
  fotoGastoActual=null;
  document.getElementById('gasto-foto-preview').style.display='none';
  document.getElementById('modal-gasto').classList.add('open');
};

window.previewFotoGasto = async function(input){
  if(!input.files || !input.files[0]) return;
  try{
    fotoGastoActual = await comprimirImagen(input.files[0]);
    const img = document.getElementById('gasto-foto-preview');
    img.src = fotoGastoActual; img.style.display='block';
  } catch(e){ showToast('No se pudo cargar la foto','err'); }
};

window.guardarGasto = async function(){
  const concepto = document.getElementById('gasto-concepto').value.trim();
  const montoVal = document.getElementById('gasto-monto').value;
  const monto = montoVal!==''?Number(montoVal):0;
  const categoria = document.getElementById('gasto-categoria').value;
  const proveedor = document.getElementById('gasto-proveedor').value.trim();
  const observaciones = document.getElementById('gasto-obs').value.trim();
  if(!concepto || !monto){ showToast('Completa el concepto y el monto','err'); return; }
  showLoading();
  try{
    const ref = doc(collection(db,'gastos'));
    const data = {
      sucursal:currentSuc, concepto, monto, categoria, proveedor, observaciones,
      foto:fotoGastoActual, fecha:fechaHoy(), creadoPor:currentUser.name, creadoEn:new Date().toISOString(),
    };
    await setDoc(ref, data);
    gastosData.unshift({id:ref.id, ...data});
    closeModal('modal-gasto');
    showToast('Gasto registrado');
    renderGastos();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};

// ============================================================
// EXPEDIENTE POR SUCURSAL — junta en una sola vista todo lo que
// ya se carga en Operaciones (pendientes, gastos, bitácora, fotos)
// más los datos propios del local (dirección, infraestructura,
// equipamiento, personal). Organizado por secciones en una sola
// página, en vez de pestañas dentro de pestañas, para no sumar
// otro nivel más de navegación.
// ============================================================
let expedienteData = null;

async function cargarExpediente(){
  showLoading();
  try{
    const snap = await getDoc(doc(db,'sucursales_info',currentSuc));
    expedienteData = snap.exists() ? snap.data() : {};
    await cargarUsuarios(); // llena el arreglo global `usuarios` de esta sucursal
  } catch(e){ expedienteData = {}; }
  hideLoading();
  renderExpediente();
}

function renderExpediente(){
  const cont = document.getElementById('ops-expediente-container');
  const e = expedienteData || {};

  const pendientes = incidenciasData.filter(i=>i.estado==='abierta'||i.estado==='en_proceso');
  const gastoTotal = gastosData.reduce((acc,g)=>acc+(g.monto||0),0);
  const equipamientoLista = (e.equipamiento||'').split('\n').map(x=>x.trim()).filter(Boolean);

  // Galería: junta todas las fotos que ya existen en incidencias,
  // mantenimiento y gastos de esta sucursal
  const fotos = [];
  incidenciasData.forEach(i=>{
    if(i.fotoAntes) fotos.push({src:i.fotoAntes, label:`${i.codigo} — antes`});
    if(i.fotoDurante) fotos.push({src:i.fotoDurante, label:`${i.codigo} — durante`});
    if(i.fotoDespues) fotos.push({src:i.fotoDespues, label:`${i.codigo} — después`});
  });
  mantenimientoData.forEach(m=>{ if(m.foto) fotos.push({src:m.foto, label:m.maquina}); });
  gastosData.forEach(g=>{ if(g.foto) fotos.push({src:g.foto, label:g.concepto}); });

  // Actividad reciente: mezcla incidencias + bitácora + mantenimiento,
  // ordenado del más nuevo al más viejo
  const actividad = [
    ...incidenciasData.map(i=>({fecha:i.fecha, texto:`Incidencia ${i.codigo}: ${i.titulo}`, ts:i.creadoEn})),
    ...bitacoraData.map(b=>({fecha:b.fecha, texto:b.texto, ts:b.creadoEn})),
    ...mantenimientoData.map(m=>({fecha:m.fecha, texto:`Mantenimiento: ${m.maquina}`, ts:m.creadoEn})),
  ].sort((a,b)=>(b.ts||'').localeCompare(a.ts||'')).slice(0,10);

  cont.innerHTML = `
    <div class="rep-section-title">Información general</div>
    <div class="expediente-info-grid">
      <div><span class="stat-label">Dirección</span><div>${e.direccion||'—'}</div></div>
      <div><span class="stat-label">Teléfono</span><div>${e.telefono||'—'}</div></div>
      <div><span class="stat-label">Horario</span><div>${e.horario||'—'}</div></div>
      <div><span class="stat-label">Encargado</span><div>${e.encargado||'—'}</div></div>
    </div>
    ${e.observaciones?`<div class="evento-desc" style="margin-top:8px">${e.observaciones}</div>`:''}

    <div class="rep-section-title">Infraestructura</div>
    <div class="evento-desc">${e.infraestructura||'Sin información cargada todavía.'}</div>

    <div class="rep-section-title">Equipamiento</div>
    ${equipamientoLista.length
      ? `<div class="incidencia-tags">${equipamientoLista.map(x=>`<span class="suc-tag-mini">${x}</span>`).join('')}</div>`
      : `<div class="empty">Sin equipamiento cargado todavía.</div>`}

    <div class="rep-section-title">Personal (${usuarios.length})</div>
    ${usuarios.length ? usuarios.map(u=>`
      <div class="bitacora-row">
        <span class="bitacora-fecha">${u.role}</span>
        <span class="bitacora-texto">${u.name}</span>
        <span class="bitacora-autor">${turnoLabel(u.turno)}</span>
      </div>`).join('') : '<div class="empty">Sin personal asignado en el sistema todavía.</div>'}

    <div class="rep-section-title">Pendientes (${pendientes.length})</div>
    ${pendientes.length ? pendientes.slice(0,6).map(i=>`
      <div class="incidencia-card" onclick="cambiarVistaOps('incidencias')" style="margin-bottom:6px">
        <div class="incidencia-top">
          <div class="incidencia-titulo">${i.codigo} — ${i.titulo}</div>
          <span class="prioridad-tag prioridad-${i.prioridad}">${prioridadIncidenciaLabel(i.prioridad)}</span>
        </div>
      </div>`).join('') : '<div class="empty">Sin pendientes abiertos ✓</div>'}

    <div class="rep-section-title">Gastos (Bs ${gastoTotal.toFixed(2)} en total)</div>
    ${gastosData.length ? gastosData.slice(0,5).map(g=>`
      <div class="bitacora-row">
        <span class="bitacora-fecha">${g.fecha}</span>
        <span class="bitacora-texto">${g.concepto}</span>
        <span class="bitacora-autor">Bs ${g.monto}</span>
      </div>`).join('') : '<div class="empty">Sin gastos registrados</div>'}

    <div class="rep-section-title">Fotos (${fotos.length})</div>
    ${fotos.length ? `<div class="expediente-galeria">${fotos.slice(0,12).map(f=>`
      <img src="${f.src}" title="${f.label}" onclick="window.open('${f.src}')">`).join('')}</div>`
      : '<div class="empty">Sin fotos guardadas todavía</div>'}

    <div class="rep-section-title">Actividad reciente</div>
    ${actividad.length ? actividad.map(a=>`
      <div class="bitacora-row">
        <span class="bitacora-fecha">${a.fecha}</span>
        <span class="bitacora-texto">${a.texto}</span>
      </div>`).join('') : '<div class="empty">Sin actividad registrada</div>'}
  `;
}

window.abrirModalExpediente = function(){
  const e = expedienteData || {};
  document.getElementById('exp-direccion').value = e.direccion||'';
  document.getElementById('exp-telefono').value = e.telefono||'';
  document.getElementById('exp-horario').value = e.horario||'';
  document.getElementById('exp-encargado').value = e.encargado||'';
  document.getElementById('exp-infraestructura').value = e.infraestructura||'';
  document.getElementById('exp-equipamiento').value = e.equipamiento||'';
  document.getElementById('exp-observaciones').value = e.observaciones||'';
  document.getElementById('modal-expediente').classList.add('open');
};

window.guardarExpediente = async function(){
  const data = {
    direccion: document.getElementById('exp-direccion').value.trim(),
    telefono: document.getElementById('exp-telefono').value.trim(),
    horario: document.getElementById('exp-horario').value.trim(),
    encargado: document.getElementById('exp-encargado').value.trim(),
    infraestructura: document.getElementById('exp-infraestructura').value.trim(),
    equipamiento: document.getElementById('exp-equipamiento').value.trim(),
    observaciones: document.getElementById('exp-observaciones').value.trim(),
    actualizadoPor: currentUser.name, actualizadoEn: new Date().toISOString(),
  };
  showLoading();
  try{
    await setDoc(doc(db,'sucursales_info',currentSuc), data, {merge:true});
    expedienteData = data;
    closeModal('modal-expediente');
    showToast('Información guardada');
    renderExpediente();
  } catch(e){ showToast('Error al guardar','err'); }
  hideLoading();
};


// ============================================================
// LIGHTBOX — tocar cualquier foto chica (.zoomable-img) la abre en
// grande. Un solo listener delegado: funciona para fotos que ya
// existen Y para las que se agreguen después (listas que se vuelven
// a pintar), sin tener que cablear un onclick en cada <img>.
// ============================================================
document.addEventListener('click', function(e){
  const img = e.target.closest('.zoomable-img');
  if(img && img.tagName==='IMG' && img.src){
    document.getElementById('lightbox-img').src = img.src;
    document.getElementById('lightbox-caption').textContent = img.alt || '';
    document.getElementById('lightbox').classList.add('open');
  }
});
window.cerrarLightbox = function(){
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
};
