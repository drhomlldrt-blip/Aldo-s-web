// ============================================================
// TAREAS DIARIAS — SUCURSAL MIRAFLORES
//
// ⚠️ BORRADOR INICIAL — a diferencia de los otros archivos de esta
// carpeta (que vienen del documento "TAREAS ESPECÍFICAS DEL
// PERSONAL DE LIMPIEZA" con el detalle real de cada sucursal), este
// archivo es una plantilla genérica de partida: no conoce todavía
// la distribución real de Miraflores (si tiene sala de spinning,
// segundo piso, piso de goma, etc.). Reemplaza o ajusta las tareas
// de abajo con el detalle real apenas lo tengas — mándamelo y lo
// dejo igual de específico que el resto de sucursales.
// ============================================================

export const SUCURSAL_ID = "MIRAFLORES";
export const SUCURSAL_NOMBRE = "Sucursal Miraflores";

// ------------------------------------------------------------
// TURNO MAÑANA
// ------------------------------------------------------------
export const TAREAS_MANANA = [
  {
    id: "miraflores_man_01",
    hora: "",
    area: "Tiempo de imprevistos",
    tareas: [
      "Tiempo para imprevistos o tareas asignadas por recepción o supervisión (15min)",
    ]
  },
  {
    id: "miraflores_man_02",
    hora: "07:00–07:10",
    area: "Baños",
    tareas: [
      "Verificar agua caliente en duchas, si hay papel en los baños y si hay jabón líquido en el dispensador.",
      "Limpiar lavamanos",
      "Limpiar espejos de área de baños",
      "Limpiar inodoros y urinarios",
      "Limpiar duchas",
      "Limpiar y secar pisos de área de baños",
    ]
  },
  {
    id: "miraflores_man_03",
    hora: "07:10–07:40",
    area: "Barrido general",
    tareas: [
      "Barrer piso de recepción, área de máquinas y vestidores.",
    ]
  },
  {
    id: "miraflores_man_04",
    hora: "07:40–08:20",
    area: "Sala de máquinas",
    tareas: [
      "Limpiar máquinas de musculación (partes metálicas y plásticas).",
      "Limpiar superficies de trotadoras.",
    ]
  },
  {
    id: "miraflores_man_05",
    hora: "08:20–08:45",
    area: "Trapeo general",
    tareas: [
      "Trapear piso de recepción, vestidores y área de máquinas.",
    ]
  },
  {
    id: "miraflores_man_06",
    hora: "08:45–09:10",
    area: "Espejos y vidrios",
    tareas: [
      "Limpiar espejos del gimnasio",
      "Limpiar vidrios y ventanas",
    ]
  },
  {
    id: "miraflores_man_07",
    hora: "09:10–09:30",
    area: "Basureros",
    tareas: [
      "Vaciar basureros de baños y vestidores.",
    ]
  },
];

// ------------------------------------------------------------
// TURNO TARDE
// ------------------------------------------------------------
export const TAREAS_TARDE = [
  {
    id: "miraflores_tar_01",
    hora: "",
    area: "Tiempo de imprevistos",
    tareas: [
      "Tiempo para imprevistos o tareas asignadas por recepción o supervisión (5min)",
    ]
  },
  {
    id: "miraflores_tar_02",
    hora: "14:30–14:40",
    area: "Baños",
    tareas: [
      "Verificar agua caliente en duchas, si hay papel en los baños y si hay jabón líquido en el dispensador.",
      "Limpiar lavamanos",
      "Limpiar espejos de área de baños",
      "Limpiar inodoros y urinarios",
      "Limpiar duchas",
      "Limpiar y secar pisos de área de baños",
    ]
  },
  {
    id: "miraflores_tar_03",
    hora: "14:40–15:10",
    area: "Barrido general",
    tareas: [
      "Barrer piso de recepción, área de máquinas y vestidores.",
      "Retirar suciedad acumulada del tapete de ingreso.",
    ]
  },
  {
    id: "miraflores_tar_04",
    hora: "15:10–15:50",
    area: "Sala de máquinas",
    tareas: [
      "Limpiar máquinas de musculación.",
      "Limpiar trotadoras.",
    ]
  },
  {
    id: "miraflores_tar_05",
    hora: "15:50–16:15",
    area: "Trapeo general",
    tareas: [
      "Trapear piso de recepción, vestidores y área de máquinas.",
    ]
  },
  {
    id: "miraflores_tar_06",
    hora: "16:15–16:40",
    area: "Vestidores",
    tareas: [
      "Limpiar paredes y melaminas de los vestidores.",
    ]
  },
  {
    id: "miraflores_tar_07",
    hora: "16:40–17:00",
    area: "Basureros",
    tareas: [
      "Vaciar basureros de baños y vestidores.",
    ]
  },
];

// ------------------------------------------------------------
// TURNO NOCHE
// ------------------------------------------------------------
export const TAREAS_NOCHE = [
  {
    id: "miraflores_noc_01",
    hora: "",
    area: "Tiempo de imprevistos",
    tareas: [
      "Tiempo para imprevistos o tareas asignadas por recepción o supervisión (15min)",
    ]
  },
  {
    id: "miraflores_noc_02",
    hora: "18:30–18:40",
    area: "Baños",
    tareas: [
      "Verificar agua caliente en duchas",
      "Verificar papel y jabón líquido en dispensadores",
    ]
  },
  {
    id: "miraflores_noc_03",
    hora: "18:40–19:20",
    area: "Limpieza general de piso",
    tareas: [
      "Barrer y trapear recepción, área de máquinas y vestidores.",
    ]
  },
  {
    id: "miraflores_noc_04",
    hora: "19:20–19:40",
    area: "Basureros",
    tareas: [
      "Lavar y limpiar basureros.",
    ]
  },
  {
    id: "miraflores_noc_05",
    hora: "19:40–20:10",
    area: "Baños",
    tareas: [
      "Limpiar baños y duchas.",
      "Limpiar las escobas (quitar pelos o cabellos).",
    ]
  },
  {
    id: "miraflores_noc_06",
    hora: "20:10–20:40",
    area: "Sala de máquinas",
    tareas: [
      "Limpiar máquinas y trotadoras.",
    ]
  },
  {
    id: "miraflores_noc_07",
    hora: "20:40–21:00",
    area: "Basureros",
    tareas: [
      "Vaciar todos los basureros y botar la basura.",
    ]
  },
];

// ------------------------------------------------------------
// ÁREAS PARA REVISIÓN DE RECEPCIÓN (referencia; el sistema usa
// una lista general fija — ver AREAS_REVISION_GENERAL en app.js)
// ------------------------------------------------------------
export const AREAS_REVISION = [
  { id: "rev_banos", nombre: "Baños y duchas" },
  { id: "rev_vestidores", nombre: "Vestidores" },
  { id: "rev_maquinas", nombre: "Sala de máquinas" },
  { id: "rev_recepcion", nombre: "Área de recepción" },
];
