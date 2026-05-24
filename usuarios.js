// ============================================================
// USUARIOS DEL SISTEMA
// SUPERVISOR: siempre en este archivo
// RESTO: se gestionan desde el panel admin en Firebase
// ============================================================

// Para cambiar contraseña del admin: edita solo el campo "pass"
export const USERS_FIJOS = {
  'admin': {
    pass: 'gym2024',
    name: 'Supervisor General',
    role: 'supervisor',
    suc: 'ALL',
    turno: null,
  },
};

// ROLES disponibles en el sistema:
// 'supervisor'    → ve todo, todas las sucursales
// 'recepcionista' → checklist revisión + reportes de su sucursal
// 'limpieza'      → checklist de tareas + reportes pendientes
//
// TURNOS disponibles para limpieza:
// 'manana'  → 07:00 a 11:00
// 'tarde'   → 14:30 a 18:30
// 'noche'   → 18:30 a 22:30
//
// TURNOS disponibles para recepción:
// 'manana'  → 06:30 a 14:30
// 'tarde'   → 14:30 a 22:30
// 'apoyo'   → 17:00 a 21:00
