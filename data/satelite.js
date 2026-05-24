// ============================================================
// TAREAS DIARIAS — SUCURSAL SATÉLITE
// Para agregar más sucursales: copia este archivo,
// cambia el nombre y actualiza las tareas.
// ============================================================

export const SUCURSAL_ID = 'SATELITE';
export const SUCURSAL_NOMBRE = 'Sucursal Satélite';

// ------------------------------------------------------------
// TURNO MAÑANA — 07:00 a 11:00
// ------------------------------------------------------------
export const TAREAS_MANANA = [
  {
    id: 'man_01',
    hora: '07:00–07:15',
    area: 'Baños',
    tareas: [
      'Verificar agua caliente en duchas',
      'Verificar papel en dispensadores de baños',
      'Verificar jabón líquido en dispensador',
      'Limpiar lavamanos',
      'Limpiar espejos de baños',
      'Limpiar urinario de varones',
      'Limpiar inodoros',
      'Limpiar tapas de basureros (baños y pasillo)',
      'Limpiar y secar piso de área de baños',
    ]
  },
  {
    id: 'man_02',
    hora: '07:15–07:35',
    area: 'Pisos flotantes',
    tareas: [
      'Barrer piso flotante de todas las áreas',
    ]
  },
  {
    id: 'man_03',
    hora: '07:35–07:45',
    area: 'Vestidores',
    tareas: [
      'Limpiar espejos de vestidores',
      'Limpiar tapas de basureros de vestidores',
    ]
  },
  {
    id: 'man_04',
    hora: '07:45–07:50',
    area: 'Sala de aeróbicos',
    tareas: [
      'Limpiar espejos de sala de aeróbicos',
    ]
  },
  {
    id: 'man_05',
    hora: '07:50–09:00',
    area: 'Área de máquinas (piso de goma)',
    tareas: [
      'Regar y barrer piso de goma',
      'Limpiar espejos del área de máquinas',
      'Limpiar máquinas a detalle',
      'Limpiar aluminio compuesto del área',
    ]
  },
  {
    id: 'man_06',
    hora: '09:00–09:30',
    area: 'Pisos flotantes',
    tareas: [
      'Trapear piso flotante de todas las áreas',
    ]
  },
  {
    id: 'man_07',
    hora: '09:30–10:10',
    area: 'Baños (lavado profundo)',
    tareas: [
      'Lavar lavamanos',
      'Lavar paredes de baños, lavamanos, urinario y pasillos',
      'Lavar urinario',
      'Lavar inodoros',
      'Lavar tapas de basureros de baños',
    ]
  },
  {
    id: 'man_08',
    hora: '10:10–10:40',
    area: 'Aeróbicos / Spinning (según día)',
    tareas: [
      'Limpiar vidrios y espejos de sala de aeróbicos y spinning (lunes, miércoles y viernes)',
      'Limpiar trampolines (martes, jueves y sábado)',
    ]
  },
  {
    id: 'man_09',
    hora: '10:40–11:00',
    area: 'Tiempo de imprevistos',
    tareas: [
      '20 minutos para imprevistos y repasos',
    ]
  },
];

// ------------------------------------------------------------
// TURNO TARDE — 14:30 a 18:30
// ------------------------------------------------------------
export const TAREAS_TARDE = [
  {
    id: 'tar_01',
    hora: '14:30–14:45',
    area: 'Baños',
    tareas: [
      'Verificar agua caliente en duchas',
      'Verificar papel en dispensadores de baños',
      'Verificar jabón líquido en dispensador',
      'Limpiar lavamanos',
      'Limpiar espejos de baños',
      'Limpiar urinario de varones',
      'Limpiar inodoros',
      'Limpiar tapas de basureros (baños y pasillo)',
      'Limpiar y secar piso de área de baños',
    ]
  },
  {
    id: 'tar_02',
    hora: '14:45–15:05',
    area: 'Pisos flotantes',
    tareas: [
      'Barrer piso flotante de todas las áreas',
    ]
  },
  {
    id: 'tar_03',
    hora: '15:05–15:15',
    area: 'Vestidores',
    tareas: [
      'Limpiar espejos de vestidores',
      'Limpiar tapas de basureros de vestidores',
    ]
  },
  {
    id: 'tar_04',
    hora: '15:15–16:00',
    area: 'Área de máquinas (piso de goma)',
    tareas: [
      'Regar y barrer piso de goma (también debajo de máquinas)',
      'Sacar pelusas del área',
    ]
  },
  {
    id: 'tar_05',
    hora: '16:00–16:30',
    area: 'Área de cardio',
    tareas: [
      'Limpiar equipos de cardio a detalle',
      'Limpiar debajo de los equipos de cardio',
    ]
  },
  {
    id: 'tar_06',
    hora: '16:30–17:30',
    area: 'Máquinas y pisos flotantes',
    tareas: [
      'Limpiar máquinas del área de piso flotante',
      'Trapear piso flotante de área de máquinas',
      'Trapear piso flotante del bar lácteo',
      'Trapear piso flotante de vestidores',
      'Trapear piso flotante de recepción (debajo de máquinas también)',
    ]
  },
  {
    id: 'tar_07',
    hora: '17:30–17:45',
    area: 'Paredes, ventanas y espejos',
    tareas: [
      'Limpiar paredes de vestidores',
      'Limpiar ventanas',
      'Limpiar espejos del sector de piso flotante',
    ]
  },
  {
    id: 'tar_08',
    hora: '17:45–18:15',
    area: 'Duchas y baños',
    tareas: [
      'Lavar duchas: piso, paredes y puertas',
      'Quitar restos de grasa y sarro de duchas',
      'Sacar basura de baños',
      'Limpiar área de baños',
    ]
  },
  {
    id: 'tar_09',
    hora: '18:15–18:30',
    area: 'Tiempo de imprevistos',
    tareas: [
      '5 minutos para imprevistos finales',
      'Dejar todo en orden antes de salir',
    ]
  },
];

// ------------------------------------------------------------
// TURNO NOCHE — 18:30 a 22:30
// ------------------------------------------------------------
export const TAREAS_NOCHE = [
  {
    id: 'noc_01',
    hora: '18:30–18:45',
    area: 'Baños',
    tareas: [
      'Verificar agua caliente en duchas',
      'Verificar papel en dispensadores de baños',
      'Verificar jabón líquido en dispensador',
    ]
  },
  {
    id: 'noc_02',
    hora: '18:45–19:05',
    area: 'Área de máquinas (piso de goma)',
    tareas: [
      'Regar y barrer piso de goma',
    ]
  },
  {
    id: 'noc_03',
    hora: '19:05–19:30',
    area: 'Pisos flotantes',
    tareas: [
      'Barrer pisos flotantes',
      'Trapear pisos flotantes',
    ]
  },
  {
    id: 'noc_04',
    hora: '19:30–20:05',
    area: 'Basureros',
    tareas: [
      'Lavar y limpiar todos los basureros',
    ]
  },
  {
    id: 'noc_05',
    hora: '19:25–21:00',
    area: 'Mantenimiento general (turno de cuidado)',
    tareas: [
      'Revisar y mantener sala de máquinas limpia',
      'Revisar y mantener vestidores limpios',
      'Revisar y mantener área de baños limpia',
      'Barrer donde sea necesario',
      'Limpiar espejos o vidrios que estén sucios',
      'Limpiar escobas (quitar pelos y cabellos)',
      'Lavar trapos y dejar secar',
      'Dejar en orden el depósito de implementos de limpieza',
    ]
  },
  {
    id: 'noc_06',
    hora: '21:00–21:30',
    area: 'Duchas',
    tareas: [
      'Lavar gomas de duchas',
      'Lavar maderas de duchas',
      'Limpiar duchas a detalle',
    ]
  },
  {
    id: 'noc_07',
    hora: '21:30–22:00',
    area: 'Sala de spinning',
    tareas: [
      'Barrer sala de spinning',
      'Limpiar bicicletas de spinning',
      'Trapear piso de sala de spinning',
    ]
  },
  {
    id: 'noc_08',
    hora: '22:00–22:20',
    area: 'Sala de aeróbicos',
    tareas: [
      'Regar y barrer sala de aeróbicos',
    ]
  },
  {
    id: 'noc_09',
    hora: '22:20–22:30',
    area: 'Cierre',
    tareas: [
      'Recoger y sacar todos los basureros',
      'Dejar todo en orden para el siguiente turno',
    ]
  },
];

// ------------------------------------------------------------
// ÁREAS PARA REVISIÓN DE RECEPCIÓN
// Recepción turno tarde revisa estas áreas a las 17:10
// ------------------------------------------------------------
export const AREAS_REVISION = [
  { id: 'rev_banos',      nombre: 'Baños y duchas' },
  { id: 'rev_vestidores', nombre: 'Vestidores' },
  { id: 'rev_maquinas',   nombre: 'Sala de máquinas' },
  { id: 'rev_aerobicos',  nombre: 'Sala de aeróbicos' },
  { id: 'rev_spinning',   nombre: 'Sala de spinning' },
  { id: 'rev_recepcion',  nombre: 'Piso gaucho' },
  { id: 'rev_máquinas',     nombre: 'Máquinas' },
  { id: 'rev_flotante',   nombre: 'Piso flotante' },
  { id: 'rev_cardio',     nombre: 'Equipos de cardio' },
];
