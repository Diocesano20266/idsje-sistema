// ═══════════════════════════════════════════
//  IDSJE — Generador Automático de Horarios
//  CSP (constraint satisfaction) + backtracking, en JS puro.
//  Sin Supabase ni DOM acá — admin.js construye `config` con los datos
//  de Supabase y se encarga de guardar el resultado.
// ═══════════════════════════════════════════
import { DIAS_HORARIO, BLOQUES_HORARIO } from './config.js';

const PERIODOS_CLASE  = BLOQUES_HORARIO.filter(b => b.tipo === 'clase').map(b => b.periodo); // 1..10
const PERIODOS_MANANA = PERIODOS_CLASE.filter(p => p <= 7);                                   // 1..7 (6:45–12:00)
const MAX_INTENTOS_BACKTRACK = 30000;
const MATERIAS_IMPORTANTES = /matem[aá]tica|lenguaje/i;

// PRNG determinístico (mulberry32): misma seed → mismo resultado siempre.
// "Generar otro" en la UI solo necesita pasar una seed distinta.
function crearRng(seed) {
    let a = (seed >>> 0) || 1;
    return function rng() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mezclar(arr, rng) {
    const copia = arr.slice();
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
    }
    return copia;
}

/**
 * Genera un horario semanal completo a partir de las materias asignadas por grado.
 *
 * @param {Object} config
 * @param {Array<{id:string, gradoId:string, materiaId:string, materiaNombre?:string, docenteId:string, horasPorSemana:number}>} config.asignaciones
 *        una fila por cada `grado_materia`. `id` es el grado_materia_id (se usa como grado_materia_id en el resultado).
 * @param {Object.<string,'completa'|'manana'>} [config.disponibilidadDocente] - docenteId -> disponibilidad. Por defecto 'completa'.
 * @param {number} [seed] - semilla del PRNG. La misma seed + config siempre da el mismo resultado.
 * @returns {Array<{grado_materia_id:string, grado_id:string, materia_id:string, docente_id:string, dia:string, periodo:number}>|null}
 *          filas listas para guardar en la tabla `horarios`, o null si no encontró una combinación sin conflictos.
 */
export function generarHorario(config, seed = 1) {
    const { asignaciones = [], disponibilidadDocente = {} } = config || {};
    const rng = crearRng(seed);

    // 1. Expandir cada asignación en N "variables" (una por hora semanal a ubicar).
    let variables = [];
    asignaciones.forEach(a => {
        const horas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
        for (let i = 0; i < horas; i++) {
            variables.push({
                asignacionId: a.id,
                gradoId: a.gradoId,
                materiaId: a.materiaId,
                materiaNombre: a.materiaNombre || '',
                docenteId: a.docenteId,
                importante: MATERIAS_IMPORTANTES.test(a.materiaNombre || ''),
                disponibilidad: disponibilidadDocente[a.docenteId] || 'completa',
            });
        }
    });

    if (!variables.length) return [];

    // 2. Orden de asignación: las más restringidas primero (media jornada tiene menos
    //    slots posibles), para que el backtracking falle rápido y no deshaga trabajo de más.
    variables = mezclar(variables, rng).sort((x, y) => {
        const rx = x.disponibilidad === 'manana' ? 0 : 1;
        const ry = y.disponibilidad === 'manana' ? 0 : 1;
        return rx - ry;
    });

    const ocupadoGrado   = new Set(); // `${gradoId}|${dia}|${periodo}`
    const ocupadoDocente = new Set(); // `${docenteId}|${dia}|${periodo}`
    const diasUsadosPorMateria   = new Set(); // heurística blanda — no se deshace al backtrackear
    const periodosPorDocenteDia  = {};        // heurística blanda — `${docenteId}|${dia}` -> Set(periodos)

    const asignado = new Array(variables.length).fill(null);
    let intentos = 0;

    function candidatosPara(v) {
        const periodosPermitidos = v.disponibilidad === 'manana' ? PERIODOS_MANANA : PERIODOS_CLASE;
        const candidatos = [];
        DIAS_HORARIO.forEach(dia => {
            periodosPermitidos.forEach(periodo => {
                if (ocupadoGrado.has(`${v.gradoId}|${dia}|${periodo}`)) return;
                if (ocupadoDocente.has(`${v.docenteId}|${dia}|${periodo}`)) return;
                candidatos.push({ dia, periodo });
            });
        });

        // Puntaje blando — menor es mejor. No afecta las restricciones duras, solo el orden
        // en el que el backtracking prueba los candidatos.
        const puntaje = (c) => {
            let p = 0;
            if (diasUsadosPorMateria.has(`${v.gradoId}|${v.materiaId}|${c.dia}`)) p += 5; // evitar repetir materia el mismo día
            if (v.importante && c.periodo > 4) p += 2; // materias importantes preferentemente en la mañana
            const periodosDocente = periodosPorDocenteDia[`${v.docenteId}|${c.dia}`];
            if (periodosDocente && periodosDocente.size) {
                let min = Infinity, max = -Infinity;
                periodosDocente.forEach(p2 => { if (p2 < min) min = p2; if (p2 > max) max = p2; });
                if (c.periodo < min - 1 || c.periodo > max + 1) p += 1; // evitar huecos en el día del docente
            }
            return p;
        };

        return mezclar(candidatos, rng)
            .map(c => ({ ...c, puntaje: puntaje(c) }))
            .sort((a, b) => a.puntaje - b.puntaje);
    }

    function marcar(v, c) {
        ocupadoGrado.add(`${v.gradoId}|${c.dia}|${c.periodo}`);
        ocupadoDocente.add(`${v.docenteId}|${c.dia}|${c.periodo}`);
        diasUsadosPorMateria.add(`${v.gradoId}|${v.materiaId}|${c.dia}`);
        const keyDocenteDia = `${v.docenteId}|${c.dia}`;
        if (!periodosPorDocenteDia[keyDocenteDia]) periodosPorDocenteDia[keyDocenteDia] = new Set();
        periodosPorDocenteDia[keyDocenteDia].add(c.periodo);
    }

    function desmarcarDuro(v, c) {
        ocupadoGrado.delete(`${v.gradoId}|${c.dia}|${c.periodo}`);
        ocupadoDocente.delete(`${v.docenteId}|${c.dia}|${c.periodo}`);
    }

    function backtrack(idx) {
        if (idx >= variables.length) return true;
        const v = variables[idx];
        const candidatos = candidatosPara(v);

        for (const c of candidatos) {
            intentos++;
            if (intentos > MAX_INTENTOS_BACKTRACK) return false;

            marcar(v, c);
            asignado[idx] = c;
            if (backtrack(idx + 1)) return true;
            asignado[idx] = null;
            desmarcarDuro(v, c);
        }
        return false;
    }

    const exito = backtrack(0);
    if (!exito) return null;

    return variables.map((v, i) => ({
        grado_materia_id: v.asignacionId,
        grado_id: v.gradoId,
        materia_id: v.materiaId,
        docente_id: v.docenteId,
        dia: asignado[i].dia,
        periodo: asignado[i].periodo,
    }));
}

/**
 * Verifica que un horario (generado o no) no tenga choques de docente ni de grado.
 * @param {Array<{grado_id, docente_id, dia, periodo}>} horario
 * @returns {{ok:boolean, conflictosGrado:Array, conflictosDocente:Array}}
 */
export function verificarConflictos(horario) {
    const vistoGrado = new Set();
    const vistoDocente = new Set();
    const conflictosGrado = [];
    const conflictosDocente = [];

    (horario || []).forEach(fila => {
        const keyGrado = `${fila.grado_id}|${fila.dia}|${fila.periodo}`;
        const keyDocente = `${fila.docente_id}|${fila.dia}|${fila.periodo}`;

        if (vistoGrado.has(keyGrado)) conflictosGrado.push(fila);
        else vistoGrado.add(keyGrado);

        if (vistoDocente.has(keyDocente)) conflictosDocente.push(fila);
        else vistoDocente.add(keyDocente);
    });

    return {
        ok: conflictosGrado.length === 0 && conflictosDocente.length === 0,
        conflictosGrado,
        conflictosDocente,
    };
}
