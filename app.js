// ===== USUARIOS DEL SISTEMA =====
// Para cambiar contraseña: edita el campo "pass"
// Para dar de baja: elimina la línea del usuario
// Para agregar: copia una línea y cambia los datos
const USERS = {
  // SUPERVISOR — accede a todas las sucursales
  'admin': { pass:'gym2024', name:'Supervisor General', role:'supervisor', suc:'ALL' },

  // SUCURSAL UPEA
  'recep.upea': { pass:'upea01', name:'Recepcionista UPEA', role:'recepcionista', suc:'UPEA' },
  'limp.upea':  { pass:'limp01', name:'Limpieza UPEA',      role:'limpieza',      suc:'UPEA' },

  // SUCURSAL 16 DE JULIO
  'recep.julio': { pass:'jul01',  name:'Recepcionista Julio', role:'recepcionista', suc:'16 DE JULIO' },
  'limp.julio':  { pass:'limp02', name:'Limpieza Julio',      role:'limpieza',      suc:'16 DE JULIO' },

  // SUCURSAL SATÉLITE
  'melani': { pass:'mad',  name:'Recepcionista Satélite', role:'recepcionista', suc:'SATÉLITE' },
  'limp.sat':  { pass:'limp03', name:'Limpieza Satélite',      role:'limpieza',      suc:'SATÉLITE' },

  // SUCURSAL CRUCE V. ADELA
  'recep.adela': { pass:'adela01', name:'Recepcionista Adela', role:'recepcionista', suc:'CRUCE V. ADELA' },
  'limp.adela':  { pass:'limp04', name:'Limpieza Adela',       role:'limpieza',      suc:'CRUCE V. ADELA' },
};

// ===== ÁREAS DEL CHECKLIST DE LIMPIEZA =====
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

// ===== ESTADO DE LA APLICACIÓN =====
let currentSuc  = '';
let currentUser = null;
let reportPrio  = 'normal';
let reportItem  = '';
let reports     = [];
let checkState  = {};

// ===== NAVEGACIÓN =====
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function selectSuc(suc) {
  currentSuc = suc;
  document.getElementById('login-suc-name').textContent = 'Sucursal ' + suc;
  document.getElementById('inp-user').value = '';
  document.getElementById('inp-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  document.getElementById('login-err').textContent = 'Usuario o contraseña incorrectos';
  show('screen-login');
  setTimeout(() => document.getElementById('inp-user').focus(), 300);
}

function goHome() {
  show('screen-home');
}

// ===== LOGIN =====
function doLogin() {
  const u    = document.getElementById('inp-user').value.trim().toLowerCase();
  const p    = document.getElementById('inp-pass').value;
  const user = USERS[u];
  const err  = document.getElementById('login-err');

  if (!user || user.pass !== p) {
    err.textContent = 'Usuario o contraseña incorrectos';
    err.style.display = 'block';
    return;
  }
  if (user.suc !== 'ALL' && user.suc !== currentSuc) {
    err.textContent = 'No tienes acceso a esta sucursal';
    err.style.display = 'block';
    return;
  }

  currentUser = { ...user, username: u };
  loadDash();
}

function doLogout() {
  currentUser = null;
  reports     = [];
  checkState  = {};
  goHome();
}

// ===== DASHBOARD =====
function loadDash() {
  document.getElementById('dash-suc').textContent  = 'Sucursal ' + currentSuc;
  document.getElementById('dash-user').textContent = currentUser.name;

  const roleLabels = {
    supervisor:    'Supervisor',
    recepcionista: 'Recepcionista',
    limpieza:      'Limpieza',
  };
  document.getElementById('dash-role').textContent = roleLabels[currentUser.role];

  // Definir tabs según rol
  let tabs = [];
  if (currentUser.role === 'supervisor') {
    tabs = [
      { id:'panel-limpieza', label:'Checklist' },
      { id:'panel-reportes', label:'Reportes'  },
      { id:'panel-admin',    label:'Usuarios'  },
    ];
  } else if (currentUser.role === 'recepcionista') {
    tabs = [
      { id:'panel-limpieza', label:'Checklist' },
      { id:'panel-reportes', label:'Reportes'  },
    ];
  } else if (currentUser.role === 'limpieza') {
    tabs = [
      { id:'panel-reportes', label:'Mis tareas' },
    ];
  }

  // Ocultar todos los paneles
  ['panel-limpieza','panel-reportes','panel-admin'].forEach(p => {
    document.getElementById(p).classList.remove('active');
  });

  // Construir tabs
  const tabsEl = document.getElementById('tabs-container');
  tabsEl.innerHTML = '';
  tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === 0 ? ' active' : '');
    el.textContent = t.label;
    el.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      ['panel-limpieza','panel-reportes','panel-admin'].forEach(p =>
        document.getElementById(p).classList.remove('active')
      );
      document.getElementById(t.id).classList.add('active');
    };
    tabsEl.appendChild(el);
  });

  // Activar primer panel
  if (tabs.length) document.getElementById(tabs[0].id).classList.add('active');

  renderChecklist();
  renderReportes();
  renderAdmin();
  show('screen-dash');
}

// ===== CHECKLIST =====
function renderChecklist() {
  const cont = document.getElementById('checklist-container');
  cont.innerHTML = '';

  AREAS.forEach(area => {
    const estado  = checkState[area.id] || [];
    const done    = estado.filter(Boolean).length;
    const total   = area.items.length;
    const badgeCls = done === total ? 'badge-ok' : done > 0 ? 'badge-pend' : 'badge-crit';
    const badgeTxt = done === total ? 'Completo' : `${done}/${total}`;

    const block = document.createElement('div');
    block.className = 'area-block';
    block.innerHTML = `
      <div class="area-header" onclick="toggleArea('${area.id}')">
        <span class="area-name">${area.name}</span>
        <span class="area-badge ${badgeCls}">${badgeTxt}</span>
        <span class="chevron" id="chev-${area.id}">▼</span>
      </div>
      <div class="area-items" id="items-${area.id}">
        ${area.items.map((item, i) => `
          <div class="check-item">
            <input type="checkbox"
              id="chk-${area.id}-${i}"
              ${estado[i] ? 'checked' : ''}
              onchange="toggleCheck('${area.id}', ${i})">
            <div>
              <div class="check-label ${estado[i] ? 'done' : ''}">${item}</div>
              ${currentUser.role !== 'limpieza'
                ? `<button class="btn-report" onclick="openReport('${item}','${area.name}')">Reportar problema</button>`
                : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
    cont.appendChild(block);
  });
}

function toggleArea(id) {
  const el   = document.getElementById('items-' + id);
  const chev = document.getElementById('chev-'  + id);
  el.classList.toggle('open');
  chev.textContent = el.classList.contains('open') ? '▲' : '▼';
}

function toggleCheck(areaId, i) {
  if (!checkState[areaId]) checkState[areaId] = [];
  checkState[areaId][i] = !checkState[areaId][i];
  renderChecklist();
  // Mantener el área abierta después de marcar
  const el = document.getElementById('items-' + areaId);
  if (el) {
    el.classList.add('open');
    document.getElementById('chev-' + areaId).textContent = '▲';
  }
}

// ===== MODAL REPORTE =====
function openReport(item, area) {
  reportItem = `${area} — ${item}`;
  reportPrio = 'normal';
  document.getElementById('modal-item-name').textContent = reportItem;
  document.getElementById('modal-desc').value = '';
  document.getElementById('modal-report').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-report').classList.remove('open');
}

function setPrio(p) {
  reportPrio = p;
  showToast('Prioridad: ' + p);
}

function sendReport() {
  const desc = document.getElementById('modal-desc').value.trim();
  const now  = new Date().toLocaleTimeString('es-BO', { hour:'2-digit', minute:'2-digit' });

  reports.unshift({
    item:   reportItem,
    desc:   desc || 'Sin descripción adicional',
    prio:   reportPrio,
    estado: reportPrio === 'alta' ? 'prioridad' : 'pendiente',
    hora:   now,
    by:     currentUser.name,
  });

  closeModal();
  renderReportes();
  showToast('Reporte enviado correctamente');
}

// ===== REPORTES =====
function renderReportes() {
  const cont = document.getElementById('reportes-container');

  if (!reports.length) {
    cont.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div>Sin reportes activos hoy</div></div>';
    return;
  }

  const estadoMap   = { pendiente:'s-pend', atendido:'s-done', prioridad:'s-prio', diferido:'s-def' };
  const estadoLabel = { pendiente:'Pendiente', atendido:'Atendido', prioridad:'Prioritario', diferido:'Diferido' };
  const canAct      = currentUser.role === 'limpieza' || currentUser.role === 'supervisor';

  cont.innerHTML = reports.map((r, i) => `
    <div class="report-card">
      <div class="report-top">
        <div class="report-area">${r.item}</div>
        <span class="status-pill ${estadoMap[r.estado]}">${estadoLabel[r.estado]}</span>
      </div>
      <div class="report-desc">
        ${r.desc}
        <span style="color:var(--muted);font-size:10px"> · ${r.hora} · por ${r.by}</span>
      </div>
      ${canAct && r.estado !== 'atendido' ? `
        <div class="report-actions">
          <button class="btn-sm btn-atend" onclick="actReport(${i},'atendido')">Marcar atendido</button>
          ${currentUser.role === 'supervisor' ? `
            <button class="btn-sm btn-prio"  onclick="actReport(${i},'prioridad')">Prioridad</button>
            <button class="btn-sm btn-defer" onclick="actReport(${i},'diferido')">Diferir turno</button>
          ` : ''}
        </div>` : ''}
    </div>
  `).join('');
}

function actReport(i, estado) {
  reports[i].estado = estado;
  renderReportes();
  const msgs = { atendido:'Marcado como atendido', prioridad:'Marcado como prioritario', diferido:'Diferido al siguiente turno' };
  showToast(msgs[estado]);
}

// ===== ADMIN =====
function renderAdmin() {
  const cont     = document.getElementById('admin-users');
  const sucUsers = Object.entries(USERS).filter(([, v]) => v.suc === currentSuc || v.suc === 'ALL');

  const roleColor = {
    supervisor:    'color:#e8c14a',
    recepcionista: 'color:#4ae8a0',
    limpieza:      'color:#e8904a',
  };

  cont.innerHTML = sucUsers.map(([k, v]) => `
    <div class="user-row">
      <div class="user-info">
        <div class="user-name">${v.name}</div>
        <div class="user-detail">@${k} · <span style="${roleColor[v.role]}">${v.role}</span></div>
      </div>
      <button class="btn-edit" onclick="showToast('Edición disponible con Firebase')">Editar</button>
      ${v.suc !== 'ALL'
        ? `<button class="btn-del" onclick="showToast('Baja disponible con Firebase')">Dar de baja</button>`
        : ''}
    </div>
  `).join('');
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Enter en campo contraseña
document.getElementById('inp-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});
