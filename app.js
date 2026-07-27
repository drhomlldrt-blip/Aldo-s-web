// ============================================================
// GYM CONTROL — LÓGICA PRINCIPAL v3
// ============================================================
import { db } from './firebase.js';
import { USERS_FIJOS } from './usuarios.js';
import * as SATELITE from './data/satelite.js';
import * as UPEA     from './data/upea.js';
import * as JUL16     from './data/jul16.js';
import * as CEJA      from './data/ceja.js';
import * as CRUCE     from './data/cruce.js';
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
// ============================================================
const SUCURSALES_DATA = [SATELITE, UPEA, JUL16, CEJA, CRUCE];

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
    document.getElementById('dash-suc').textContent = currentSuc;
    guardarSesion();
    showLoading();
    Promise.all([renderChecklist(), cargarReportes()]).then(()=>{
      if(currentUser.role==='supervisor') cargarAlertas();
      const panelActivo = document.querySelector('.panel.active');
      if(panelActivo){
        if(panelActivo.id==='panel-historial')  cargarHistorial();
        if(panelActivo.id==='panel-aerobicos')  initClasesPanel('aerobicos');
        if(panelActivo.id==='panel-spinning')   initClasesPanel('spinning');
      }
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
    guardarSesion();
    await loadDash(); return;
  }

  try {
    const snap = await getDoc(doc(db,'usuarios',u));
    if(!snap.exists()){ hideLoading(); err.textContent='Usuario no encontrado'; err.style.display='block'; return; }
    const user = snap.data();
    if(user.pass !== p){ hideLoading(); err.textContent='Contraseña incorrecta'; err.style.display='block'; return; }
    if(user.suc !== currentSuc){ hideLoading(); err.textContent='No tienes acceso a esta sucursal'; err.style.display='block'; return; }
    currentUser = {...user, username:u};
    guardarSesion();
    await loadDash();
  } catch(e){ hideLoading(); err.textContent='Error de conexión'; err.style.display='block'; }
};

window.doLogout = function(){ currentUser=null; reportes=[]; usuarios=[]; borrarSesion(); goHome(); };
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
      {id:'panel-revision',  label:'Revisión áreas'},
      {id:'panel-historial', label:'Historial'},
      {id:'panel-aerobicos', label:'Aeróbicos'},
      {id:'panel-spinning',  label:'Spinning'},
      {id:'panel-alertas',   label:'Alertas'},
      {id:'panel-admin',     label:'Usuarios'},
    ];
  } else if(currentUser.role==='recepcionista'){
    tabs=[
      {id:'panel-revision',  label:'Revisión áreas'},
      {id:'panel-reportes',  label:'Mis reportes'},
      {id:'panel-aerobicos', label:'Aeróbicos'},
      {id:'panel-spinning',  label:'Spinning'},
    ];
  } else if(currentUser.role==='limpieza'){
    tabs=[
      {id:'panel-checklist', label:'Mis tareas'},
      {id:'panel-reportes',  label:'Reportes a atender'},
    ];
  }

  const allPanels=['panel-checklist','panel-reportes','panel-revision','panel-historial','panel-alertas','panel-admin','panel-aerobicos','panel-spinning'];
  allPanels.forEach(p=>document.getElementById(p).classList.remove('active'));

  const tabsEl=document.getElementById('tabs-container');
  tabsEl.innerHTML='';
  tabs.forEach((t,i)=>{
    const el=document.createElement('div');
    el.className='tab'+(i===0?' active':'');
    el.dataset.panel=t.id;
    if(t.id==='panel-reportes' && currentUser.role==='limpieza'){
      el.innerHTML = `${t.label} <span class="tab-badge" id="tab-badge-reportes" style="display:none">0</span>`;
    } else {
      el.textContent=t.label;
    }
    el.onclick=()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
      allPanels.forEach(p=>document.getElementById(p).classList.remove('active'));
      document.getElementById(t.id).classList.add('active');
      guardarPanelActivo(t.id);
      if(t.id==='panel-historial')  cargarHistorial();
      if(t.id==='panel-revision')   renderRevision();
      if(t.id==='panel-alertas')    cargarAlertas();
      if(t.id==='panel-admin')      cargarUsuarios();
      if(t.id==='panel-aerobicos')  initClasesPanel('aerobicos');
      if(t.id==='panel-spinning')   initClasesPanel('spinning');
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
      Los horarios de cada tarea son una <strong>guía aproximada</strong>, no un horario exacto — lo que importa
      es completar los minutos indicados en cada bloque, siguiendo el orden como referencia.
      <strong>Baños y vestidores son prioridad</strong>: hay que revisarlos y mantenerlos limpios con frecuencia
      durante todo el turno (piso mojado, papel higiénico, inodoros sucios), no solo dentro de su bloque de horario.
    </div>`;

  let totalHechas=0, totalTareas=0, bloquesCompletos=0;
  const bloquesHtml = lista.map(bloque=>{
    const hechas = bloque.tareas.filter((_,i)=>estado[`${bloque.id}_${i}`]?.hecho).length;
    const total  = bloque.tareas.length;
    const pct    = Math.round(hechas/total*100);
    const badgeCls = hechas===total?'badge-ok':hechas>0?'badge-pend':'badge-crit';
    totalHechas+=hechas; totalTareas+=total; if(hechas===total) bloquesCompletos++;

    return `
    <div class="area-block">
      <div class="area-header" onclick="toggleBloque('${bloque.id}')">
        <div style="flex:1">
          <div class="area-name">${bloque.area}</div>
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
        <div class="stat-num">${bloquesCompletos}/${lista.length}</div>
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

  const nivelLabel={bien:'✓ Bien',regular:'◐ Regular',falta:'⚠ Falta atención'};
  const nivelCls  ={bien:'niv-bien',regular:'niv-regular',falta:'niv-falta'};

  if(esSup){
    const revisadas=Object.keys(hoyMap).length;
    cont.innerHTML = `<div class="rev-resumen-sup">Hoy se revisaron <strong>${revisadas}</strong> de <strong>${areas.length}</strong> áreas</div>` +
    areas.map(nombre=>{
      const areaId=slugArea(nombre);
      const marca=hoyMap[areaId];
      return `
      <div class="area-block">
        <div class="area-header-rev">
          <div style="flex:1;min-width:180px">
            <div class="area-name">${nombre}</div>
            ${marca
              ? `<div class="rev-marca ${nivelCls[marca.nivel]}">${nivelLabel[marca.nivel]} · ${marca.hora} — reportado por ${marca.registradoPor}</div>`
              : `<div class="rev-marca rev-pendiente">Todavía no la revisó nadie hoy</div>`}
          </div>
        </div>
      </div>`;
    }).join('');
    return;
  }

  cont.innerHTML = areas.map(nombre=>{
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
          <button class="btn-rev btn-regular" onclick="abrirReporteArea('${areaId}','${nombreEsc}','regular')">◐ Regular</button>
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
      desc:desc||(reporteAreaActual.nivel==='regular'?'Revisión: estado regular':'Requiere atención'),
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

window.verFotoGrande=function(id){
  const r=reportes.find(x=>x.id===id);
  if(r && r.foto) window.open(r.foto,'_blank');
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
    const hechas = bloque.tareas.filter((_,i)=>estado[`${bloque.id}_${i}`]?.hecho).length;
    const total  = bloque.tareas.length;
    const pct    = total ? Math.round(hechas/total*100) : 0;
    const badgeCls = hechas===total?'badge-ok':hechas>0?'badge-pend':'badge-crit';
    const uid = `${fecha}_${turno}_${bloque.id}`; // id único por fecha+turno+bloque

    return `
    <div class="area-block">
      <div class="area-header" onclick="toggleBloque('${uid}')">
        <div style="flex:1">
          <div class="area-name">${bloque.area}</div>
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
// SESIÓN PERSISTENTE
// Antes: al actualizar (F5) la página en cualquier pestaña, se
// perdía la sesión y había que volver a poner usuario/contraseña.
// Ahora se guarda en este navegador y se restaura solo, quedando
// en la misma pestaña donde estaba.
// ============================================================
const SESSION_KEY = 'gymControlSesion';
const SESSION_PANEL_KEY = 'gymControlPanelActivo';

function guardarSesion(){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify({ user: currentUser, suc: currentSuc })); }catch(e){}
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
  showLoading();
  try{
    await loadDash();
    const panelGuardado = localStorage.getItem(SESSION_PANEL_KEY);
    if(panelGuardado){
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
}, 60000);

// ============================================================
// AUTO-ACTUALIZACIÓN
// Antes: si alguien dejaba la pestaña abierta varios días, el
// navegador nunca volvía a pedir una copia nueva de app.js aunque
// yo subiera una corrección — se quedaba corriendo el código
// viejo indefinidamente. Esto revisa cada pocos minutos si ya hay
// una versión más nueva publicada y, si la hay, recarga la
// página sola, sin que nadie tenga que hacer nada.
// ============================================================
const APP_VERSION = '20260727a';
setInterval(async ()=>{
  try{
    const r = await fetch('/version.json?t='+Date.now(), {cache:'no-store'});
    const data = await r.json();
    if(data.version && data.version !== APP_VERSION) location.reload();
  }catch(e){}
}, 180000); // cada 3 minutos
