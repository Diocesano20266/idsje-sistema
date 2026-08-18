// ═══════════════════════════════════════════
//  IDSJE — Generador Automático de Horarios
//  CSP (constraint satisfaction) + backtracking, en JS puro.
//  Sin Supabase ni DOM acá — admin.js construye `config` con los datos
//  de Supabase y se encarga de guardar el resultado.
//
//  Modelo de bloques: en vez de ubicar "una hora suelta a la vez", cada
//  materia se reparte en bloques de 2 períodos consecutivos (y a lo sumo
//  UN bloque de 1 período si las horas semanales son impares). Cada grado
//  tiene, por día, una secuencia FIJA de posiciones (ver calcularPosicionesDelDia)
//  que se va llenando en orden desde la primera — eso garantiza, por
//  construcción, que el horario de un grado nunca tenga huecos: los
//  períodos ocupados de un día siempre son un prefijo 1..k.
// ═══════════════════════════════════════════
import { DIAS_HORARIO, BLOQUES_HORARIO } from './config.js';

const MAX_INTENTOS_BACKTRACK = 30000;
const MATERIAS_IMPORTANTES = /matem[aá]tica|lenguaje/i;
const ULTIMO_PERIODO_MANANA = 7; // 6:45–12:00

// Agrupa los períodos de clase en segmentos consecutivos (separados por
// receso/almuerzo) y arma pares dentro de cada segmento, dejando el período
// impar del segmento (si lo hay) como posición "suelta" de 1 período.
// Con los bloques actuales de config.js esto da exactamente:
// (P1,P2) (P3,P4) (P5,P6) (P7) (P8,P9) (P10)
function calcularPosicionesDelDia() {
    const segmentos = [];
    let actual = [];
    BLOQUES_HORARIO.forEach(b => {
        if (b.tipo === 'clase') {
            actual.push(b.periodo);
        } else if (actual.length) {
            segmentos.push(actual);
            actual = [];
        }
    });
    if (actual.length) segmentos.push(actual);

    const posiciones = [];
    segmentos.forEach(seg => {
        let i = 0;
        while (i < seg.length) {
            if (i + 1 < seg.length) {
                posiciones.push({ periodos: [seg[i], seg[i + 1]], size: 2 });
                i += 2;
            } else {
                posiciones.push({ periodos: [seg[i]], size: 1 });
                i += 1;
            }
        }
    });
    return posiciones;
}

const POSICIONES_DIA = calcularPosicionesDelDia();

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
 * Resuelve TODOS los grados presentes en `config.asignaciones` en una sola corrida,
 * así que un docente compartido entre varios grados nunca queda doble-reservado.
 *
 * @param {Object} config
 * @param {Array<{id:string, gradoId:string, materiaId:string, materiaNombre?:string, docenteId:string, horasPorSemana:number}>} config.asignaciones
 *        una fila por cada `grado_materia`. `id` es el grado_materia_id (se usa como grado_materia_id en el resultado).
 * @param {Object.<string,'completa'|'manana'>} [config.disponibilidadDocente] - docenteId -> disponibilidad. Por defecto 'completa'.
 * @param {number} [seed] - semilla del PRNG. La misma seed + config siempre da el mismo resultado.
 * @returns {Array<{grado_materia_id:string, grado_id:string, materia_id:string, docente_id:string, dia:string, periodo:number}>|null}
 *          filas listas para guardar en la tabla `horarios` (una fila por período — un bloque de
 *          2 períodos genera 2 filas con el mismo día/materia/docente), o null si no encontró
 *          una combinación sin conflictos.
 */
export function generarHorario(config, seed = 1) {
    const { asignaciones = [], disponibilidadDocente = {} } = config || {};
    const rng = crearRng(seed);

    // 1. Expandir cada asignación en bloques: pares de 2 períodos primero,
    //    y UN bloque suelto de 1 período si las horas semanales son impares.
    let variables = [];
    asignaciones.forEach(a => {
        const horas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
        const numDobles = Math.floor(horas / 2);
        const numSueltos = horas % 2;
        const base = {
            asignacionId: a.id,
            gradoId: a.gradoId,
            materiaId: a.materiaId,
            materiaNombre: a.materiaNombre || '',
            docenteId: a.docenteId,
            importante: MATERIAS_IMPORTANTES.test(a.materiaNombre || ''),
            disponibilidad: disponibilidadDocente[a.docenteId] || 'completa',
        };
        for (let i = 0; i < numDobles; i++) variables.push({ ...base, size: 2 });
        for (let i = 0; i < numSueltos; i++) variables.push({ ...base, size: 1 });
    });

    if (!variables.length) return [];

    // 2. Orden de asignación: media jornada primero (menos slots posibles → falla rápido
    //    si no hay solución), y dentro de eso, bloques dobles antes que sueltos, para que
    //    los sueltos terminen cayendo naturalmente al final de cada día (donde sobra lugar).
    variables = mezclar(variables, rng).sort((x, y) => {
        const rx = x.disponibilidad === 'manana' ? 0 : 1;
        const ry = y.disponibilidad === 'manana' ? 0 : 1;
        if (rx !== ry) return rx - ry;
        return y.size - x.size;
    });

    const ocupadoDocente = new Set(); // `${docenteId}|${dia}|${periodo}`
    const diasUsadosPorMateria  = new Set(); // heurística blanda — no se deshace al backtrackear
    const periodosPorDocenteDia = {};        // heurística blanda — `${docenteId}|${dia}` -> Set(periodos)
    const estadoDia = {};                    // `${gradoId}|${dia}` -> { siguiente, cerrado }

    function obtenerEstadoDia(gradoId, dia) {
        const key = `${gradoId}|${dia}`;
        if (!estadoDia[key]) estadoDia[key] = { siguiente: 0, cerrado: false };
        return estadoDia[key];
    }

    const asignado = new Array(variables.length).fill(null);
    let intentos = 0;

    function candidatosPara(v) {
        const candidatos = [];

        DIAS_HORARIO.forEach(dia => {
            const estado = obtenerEstadoDia(v.gradoId, dia);
            if (estado.cerrado || estado.siguiente >= POSICIONES_DIA.length) return;

            const pos = POSICIONES_DIA[estado.siguiente];
            if (v.disponibilidad === 'manana' && !pos.periodos.every(p => p <= ULTIMO_PERIODO_MANANA)) return;

            // Un bloque de 2 períodos solo entra en la siguiente posición si esta también es de 2.
            // Un bloque suelto (1 período) entra en cualquier posición (si la posición es de 2,
            // ocupa solo el primer período y cierra el día — el resto queda vacío al final,
            // que es justamente "el período suelto va al final del día").
            if (v.size === 2 && pos.size !== 2) return;

            const choqueDocente = pos.periodos
                .slice(0, v.size)
                .some(p => ocupadoDocente.has(`${v.docenteId}|${dia}|${p}`));
            if (choqueDocente) return;

            candidatos.push({ dia, posicion: pos });
        });

        // Puntaje blando — menor es mejor. No afecta las restricciones duras, solo el orden
        // en el que el backtracking prueba los candidatos.
        const puntaje = (c) => {
            let p = 0;
            if (diasUsadosPorMateria.has(`${v.gradoId}|${v.materiaId}|${c.dia}`)) p += 5; // evitar repetir materia el mismo día
            if (v.importante && c.posicion.periodos.some(per => per > 4)) p += 2; // materias importantes preferentemente en la mañana
            const periodosDocente = periodosPorDocenteDia[`${v.docenteId}|${c.dia}`];
            if (periodosDocente && periodosDocente.size) {
                let min = Infinity, max = -Infinity;
                periodosDocente.forEach(p2 => { if (p2 < min) min = p2; if (p2 > max) max = p2; });
                const primerPeriodo = c.posicion.periodos[0];
                if (primerPeriodo < min - 1 || primerPeriodo > max + 1) p += 1; // evitar huecos en el día del docente
            }
            return p;
        };

        return mezclar(candidatos, rng)
            .map(c => ({ ...c, puntaje: puntaje(c) }))
            .sort((a, b) => a.puntaje - b.puntaje);
    }

    function marcar(v, c) {
        const periodosUsados = c.posicion.periodos.slice(0, v.size);
        periodosUsados.forEach(p => ocupadoDocente.add(`${v.docenteId}|${c.dia}|${p}`));

        diasUsadosPorMateria.add(`${v.gradoId}|${v.materiaId}|${c.dia}`);
        const keyDocenteDia = `${v.docenteId}|${c.dia}`;
        if (!periodosPorDocenteDia[keyDocenteDia]) periodosPorDocenteDia[keyDocenteDia] = new Set();
        periodosUsados.forEach(p => periodosPorDocenteDia[keyDocenteDia].add(p));

        const estado = obtenerEstadoDia(v.gradoId, c.dia);
        if (v.size === 1 && c.posicion.size === 2) {
            estado.cerrado = true; // bloque suelto usando solo la mitad de una posición doble: el día termina ahí
        } else {
            estado.siguiente += 1;
        }
    }

    function desmarcarDuro(v, c) {
        const periodosUsados = c.posicion.periodos.slice(0, v.size);
        periodosUsados.forEach(p => ocupadoDocente.delete(`${v.docenteId}|${c.dia}|${p}`));

        const estado = obtenerEstadoDia(v.gradoId, c.dia);
        if (v.size === 1 && c.posicion.size === 2) {
            estado.cerrado = false;
        } else {
            estado.siguiente -= 1;
        }
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

    const filas = [];
    variables.forEach((v, i) => {
        const c = asignado[i];
        c.posicion.periodos.slice(0, v.size).forEach(periodo => {
            filas.push({
                grado_materia_id: v.asignacionId,
                grado_id: v.gradoId,
                materia_id: v.materiaId,
                docente_id: v.docenteId,
                dia: c.dia,
                periodo,
            });
        });
    });
    return filas;
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
