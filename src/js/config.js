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

// ── Años académicos ────────────────────────────
// Recibe el cliente de Supabase como parámetro (en vez de importarlo de
// auth.js) a propósito: auth.js importa SUPABASE_URL/SUPABASE_KEY de este
// mismo archivo, así que importar `supabase` acá crearía una dependencia
// circular (config.js → auth.js → config.js). Cada módulo que ya tiene
// `supabase` importado de auth.js simplemente lo pasa: getAñoActivo(supabase).
//
// Devuelve la fila de `años_academicos` con activo = true, o null si no hay
// ninguno configurado todavía (la UI debe mostrar una advertencia en ese caso).
export async function getAñoActivo(supabaseClient) {
    const { data, error } = await supabaseClient
        .from('años_academicos')
        .select('*')
        .eq('activo', true)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

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

// ── Expediente disciplinario (módulos independientes) ────────
// `clave` es lo que arma el timeline de cada módulo y el del Expediente
// (solo lectura, mezcla todo): 'anecdotico' (tabla anecdoticos),
// 'demerito_A'|'B'|'C'|'D' (tabla demeritos + su codigo — 'demerito_leve'|
// 'grave'|'muy_grave' para el historial de antes del rediseño por código),
// 'amonestacion_acta'|'ficha'|'castigo'|'suspension' (tabla amonestaciones +
// su tipo) y 'reconocimiento_academico'|'deportivo'|'cultural'|
// 'disciplinario' (tabla reconocimientos + su tipo).

// Las 4 categorías de falta que puede llevar un demérito. `label` es lo que
// se muestra en el select de "Nuevo Demérito" (código + descripción);
// `descripcion` se reutiliza sola en el timeline.
export const CODIGOS_DEMERITO = [
    { codigo: 'A', descripcion: 'No saludar al ingresar o dirigirse a docentes/compañeros' },
    { codigo: 'B', descripcion: 'Omitir "por favor" en solicitudes' },
    { codigo: 'C', descripcion: 'Omitir "gracias" al recibir ayuda' },
    { codigo: 'D', descripcion: 'Tono grosero, desafiante o irrespetuoso' },
];

// Tipos del módulo Amonestaciones (tabla amonestaciones.tipo).
export const TIPOS_AMONESTACION = [
    { clave: 'acta',       label: 'Acta' },
    { clave: 'ficha',      label: 'Ficha' },
    { clave: 'castigo',    label: 'Castigo' },
    { clave: 'suspension', label: 'Suspensión' },
];

// Tipos del módulo Reconocimientos (tabla reconocimientos.tipo).
export const TIPOS_RECONOCIMIENTO = [
    { clave: 'academico',     label: 'Académico' },
    { clave: 'deportivo',     label: 'Deportivo' },
    { clave: 'cultural',      label: 'Cultural' },
    { clave: 'disciplinario', label: 'Disciplinario' },
];

export const TIPOS_EXPEDIENTE = [
    { clave: 'anecdotico',         label: 'Anecdótico',        icono: '📝', color: '#2563eb', bg: '#dbeafe' },
    { clave: 'demerito_A',         label: 'Demérito A — No saludar',          icono: 'Ⓐ', color: '#d97706', bg: '#fef3c7' },
    { clave: 'demerito_B',         label: 'Demérito B — Sin "por favor"',     icono: 'Ⓑ', color: '#d97706', bg: '#fef3c7' },
    { clave: 'demerito_C',         label: 'Demérito C — Sin "gracias"',       icono: 'Ⓒ', color: '#d97706', bg: '#fef3c7' },
    { clave: 'demerito_D',         label: 'Demérito D — Tono irrespetuoso',   icono: 'Ⓓ', color: '#dc2626', bg: '#fee2e2' },
    // Categorías viejas (leve/grave/muy_grave) — se dejan para que los
    // registros anteriores al rediseño por código sigan mostrándose bien.
    { clave: 'demerito_leve',      label: 'Demérito leve',      icono: '⚠️', color: '#d97706', bg: '#fef3c7' },
    { clave: 'demerito_grave',     label: 'Demérito grave',     icono: '🔶', color: '#ea580c', bg: '#ffedd5' },
    { clave: 'demerito_muy_grave', label: 'Demérito muy grave', icono: '🔴', color: '#dc2626', bg: '#fee2e2' },
    { clave: 'amonestacion_acta',       label: 'Acta',       icono: '📋', color: '#7c3aed', bg: '#ede9fe' },
    { clave: 'amonestacion_ficha',      label: 'Ficha',      icono: '🗂️', color: '#0369a1', bg: '#e0f2fe' },
    { clave: 'amonestacion_castigo',    label: 'Castigo',    icono: '⚡', color: '#b45309', bg: '#fef3c7' },
    { clave: 'amonestacion_suspension', label: 'Suspensión', icono: '🚫', color: '#991b1b', bg: '#fee2e2' },
    { clave: 'reconocimiento_academico',     label: 'Reconocimiento académico',     icono: '⭐', color: '#059669', bg: '#d1fae5' },
    { clave: 'reconocimiento_deportivo',     label: 'Reconocimiento deportivo',     icono: '🏅', color: '#0891b2', bg: '#cffafe' },
    { clave: 'reconocimiento_cultural',      label: 'Reconocimiento cultural',      icono: '🎭', color: '#7c3aed', bg: '#ede9fe' },
    { clave: 'reconocimiento_disciplinario', label: 'Reconocimiento disciplinario', icono: '🎖️', color: '#059669', bg: '#d1fae5' },
];

// ── Escala de consecuencias por deméritos activos (no redimidos) ────────
// Tramos MUTUAMENTE EXCLUYENTES: el nivel actual de un alumno es el tramo
// donde cae su total, no todos los tramos que ya superó. `min`/`max` son
// inclusive; `max: null` = sin techo. Este orden (de mayor a menor) es el
// que espera calcularNivelDemerito() en utils.js.
export const NIVELES_DEMERITO = [
    { clave: 'no_promovido',  min: 15, max: null, umbral: '15',  icono: '⛔', label: 'No promovido de grado',                         color: '#7f1d1d', bg: '#fee2e2' },
    { clave: 'reunion',       min: 11, max: 14,   umbral: '+10', icono: '🔴', label: 'Reunión con dirección y familia, última advertencia', color: '#dc2626', bg: '#fee2e2' },
    { clave: 'suspension',    min: 10, max: 10,   umbral: '10',  icono: '🔴', label: 'Suspensión de privilegios escolares',           color: '#dc2626', bg: '#fee2e2' },
    { clave: 'comunicacion',  min: 6,  max: 9,    umbral: '6',   icono: '🟠', label: 'Comunicación a familia y tarea correctiva',     color: '#d97706', bg: '#fef3c7' },
    { clave: 'advertencia',   min: 3,  max: 5,    umbral: '3',   icono: '🟡', label: 'Advertencia verbal y reflexión escrita',        color: '#a16207', bg: '#fef9c3' },
];
