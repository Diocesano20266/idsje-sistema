// ═══════════════════════════════════════════
//  IDSJE — Configuración Global
// ═══════════════════════════════════════════

export const SUPABASE_URL  = 'https://xhprlhvtdyhghhhjdztd.supabase.co';
export const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhocHJsaHZ0ZHloZ2hoaGpkenRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1OTY4NTMsImV4cCI6MjA5MTE3Mjg1M30.zPtlHNMMoOFnvy8DZk3GWF3cjTvkqvAJQ23Jj7BH9cE';

export const CLOUDINARY_CLOUD  = 'dpfwjnq1f';
export const CLOUDINARY_PRESET = 'idsje_fotos'; // Upload preset sin firmar (crear en Cloudinary)

export const INSTITUTO = {
    nombre:    'Instituto Diocesano "San Juan Evangelista"',
    direccion: '2a Calle Ote. y 2a Av. Norte Barrio El Centro | San Juan Opico',
    telefono:  '7713-1964',
    correo:    'instituto_diocesanosje@idsje.info',
    anio:      2026,
};

export const CONCEPTOS = ['E', 'MB', 'B', 'R', 'D'];

// ── Horarios ──────────────────────────────────
export const DIAS_HORARIO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

// Bloques del día en orden. tipo: 'clase' | 'receso' | 'almuerzo'.
// Los bloques de clase llevan `periodo` (1–10), que es lo que se guarda
// en la columna `periodo` de la tabla `horarios`. Los de receso/almuerzo
// son solo visuales (filas bloqueadas en la grilla) y no se guardan en BD.
export const BLOQUES_HORARIO = [
    { tipo: 'clase',    periodo: 1,  inicio: '6:45',  fin: '7:25'  },
    { tipo: 'clase',    periodo: 2,  inicio: '7:25',  fin: '8:05'  },
    { tipo: 'receso',   label: 'Receso',   inicio: '8:05',  fin: '8:25'  },
    { tipo: 'clase',    periodo: 3,  inicio: '8:25',  fin: '9:05'  },
    { tipo: 'clase',    periodo: 4,  inicio: '9:05',  fin: '9:45'  },
    { tipo: 'receso',   label: 'Receso',   inicio: '9:45',  fin: '10:00' },
    { tipo: 'clase',    periodo: 5,  inicio: '10:00', fin: '10:40' },
    { tipo: 'clase',    periodo: 6,  inicio: '10:40', fin: '11:20' },
    { tipo: 'clase',    periodo: 7,  inicio: '11:20', fin: '12:00' },
    { tipo: 'almuerzo', label: 'Almuerzo', inicio: '12:00', fin: '1:00'  },
    { tipo: 'clase',    periodo: 8,  inicio: '1:00',  fin: '1:40'  },
    { tipo: 'clase',    periodo: 9,  inicio: '1:40',  fin: '2:20'  },
    { tipo: 'receso',   label: 'Receso',   inicio: '2:20',  fin: '2:35'  },
    { tipo: 'clase',    periodo: 10, inicio: '2:35',  fin: '3:15'  },
];

// ── Asistencias ───────────────────────────────
export const ESTADOS_ASISTENCIA = [
    { codigo: 'P', label: 'Presente',    color: '#059669', bg: '#d1fae5' },
    { codigo: 'A', label: 'Ausente',     color: '#dc2626', bg: '#fee2e2' },
    { codigo: 'J', label: 'Justificado', color: '#2563eb', bg: '#dbeafe' },
    { codigo: 'T', label: 'Tardanza',    color: '#a16207', bg: '#fef3c7' },
];

// ── Expediente disciplinario ──────────────────
// `clave` es lo que arma el timeline en admin.js/docente.js a partir de la
// tabla de origen: 'anecdotico' (tabla anecdoticos), 'demerito_leve' |
// 'demerito_grave' | 'demerito_muy_grave' (tabla demeritos + su categoria),
// y 'acta' | 'suspension' | 'reconocimiento' (tabla actas + su tipo).
export const TIPOS_EXPEDIENTE = [
    { clave: 'anecdotico',         label: 'Anecdótico',        icono: '📝', color: '#2563eb', bg: '#dbeafe' },
    { clave: 'demerito_leve',      label: 'Demérito leve',      icono: '⚠️', color: '#d97706', bg: '#fef3c7' },
    { clave: 'demerito_grave',     label: 'Demérito grave',     icono: '🔶', color: '#ea580c', bg: '#ffedd5' },
    { clave: 'demerito_muy_grave', label: 'Demérito muy grave', icono: '🔴', color: '#dc2626', bg: '#fee2e2' },
    { clave: 'acta',               label: 'Acta',                icono: '📋', color: '#7c3aed', bg: '#ede9fe' },
    { clave: 'suspension',         label: 'Suspensión',         icono: '🚫', color: '#991b1b', bg: '#fee2e2' },
    { clave: 'reconocimiento',     label: 'Reconocimiento',     icono: '⭐', color: '#059669', bg: '#d1fae5' },
];
