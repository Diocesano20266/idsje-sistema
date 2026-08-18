// ═══════════════════════════════════════════
//  IDSJE — Generador Automático de Horarios
//  CSP (constraint satisfaction) + backtracking, en JS puro.
//  Sin Supabase ni DOM acá — admin.js construye `config` con los datos
//  de Supabase y se encarga de guardar el resultado.
//
//  Modelo de bloques: en vez de ubicar "una hora suelta a la vez", cada
//  materia se reparte en bloques de 2 períodos consecutivos (y a lo sumo
//  UN bloque de 1 período si las horas semanales son impares). El bloque de
//  2 es una PREFERENCIA fuerte, no una restricción dura: si un bloque doble
//  no logra colocarse en ningún día (choque de docente, o no queda posición
//  doble libre), se reintenta partido en dos períodos sueltos de 1 hora antes
//  de darlo por imposible — nunca se descarta una asignación válida solo por
//  no entrar en bloque de 2 (ver el backtracking en resolverGrado). Cada
//  grado tiene, por día, una secuencia FIJA de posiciones (ver
//  calcularPosicionesDelDia) que se va llenando en orden desde la primera —
//  eso garantiza, por construcción, que el horario de un grado nunca tenga
//  huecos: los períodos ocupados de un día siempre son un prefijo 1..k. La
//  cantidad de períodos usados por día SÍ puede variar día a día (un grado
//  puede terminar en P6 un día y en P10 otro): no hay ninguna restricción de
//  que todos los días tengan la misma cantidad de horas.
//
//  Escalabilidad: resolver TODOS los bloques de TODOS los grados como una
//  única bolsa de variables (como en la primera versión) se vuelve muy
//  lento con datos reales (decenas de grados) porque, con este modelo de
//  posiciones, cada bloque tiene como mucho un candidato por día — un mal
//  orden global puede atascar el backtracking aunque exista solución.
//  Por eso el armado se DESCOMPONE por grado: cada grado resuelve su propio
//  horario con un backtracking chico e independiente, pero todos comparten
//  el mismo set de ocupación de docentes (`ocupadoDocente`), así que la
//  garantía real que importa — ningún docente en dos grados a la vez —
//  se sigue chequeando de forma global, en la misma corrida.
// ═══════════════════════════════════════════
import { DIAS_HORARIO, BLOQUES_HORARIO } from './config.js';

const MAX_INTENTOS_POR_GRADO = 20000; // backtracking local, por grado
const REINTENTOS = 8; // órdenes de grados/semillas distintas antes de rendirse
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

function expandirBloques(asignacionesGrado, disponibilidadDocente, cargaPorDocente) {
    const variables = [];
    asignacionesGrado.forEach(a => {
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
            carga: (cargaPorDocente && cargaPorDocente[a.docenteId]) || 0,
        };
        for (let i = 0; i < numDobles; i++) variables.push({ ...base, size: 2 });
        for (let i = 0; i < numSueltos; i++) variables.push({ ...base, size: 1 });
    });
    return variables;
}

/**
 * Resuelve el horario de UN grado con backtracking, chocando contra el set
 * GLOBAL de ocupación de docentes (compartido entre todos los grados de la
 * misma corrida). Si encuentra solución, dejar comprometidas (marcadas) las
 * ocupaciones de este grado en `ocupadoDocente` — el llamador las conserva
 * al pasar al siguiente grado. Si falla, deshace todo lo que haya marcado.
 */
function resolverGrado(asignacionesGrado, disponibilidadDocente, cargaPorDocente, ocupadoDocente, periodosPorDocenteDia, rng) {
    let variables = expandirBloques(asignacionesGrado, disponibilidadDocente, cargaPorDocente);
    if (!variables.length) return [];

    // Orden de asignación dentro del grado:
    // a) TODOS los bloques dobles antes que CUALQUIER bloque suelto — si un suelto se coloca
    //    antes de que el día tenga varias posiciones dobles ya ocupadas, el cursor todavía está
    //    cerca del principio del día, así que el suelto termina "cerrando" el día casi entero
    //    (desperdiciando 4-5 posiciones) en vez de caer en el hueco al final que se buscaba;
    // b) media jornada primero (menos slots posibles);
    // c) entre bloques del mismo tamaño y disponibilidad, los docentes con más carga total
    //    (más horas repartidas entre varios grados — MRV: son los más difíciles de encajar
    //    más adelante, cuando queden menos huecos libres) tienden a ir primero.
    //
    // Ojo con (c): NO es un orden determinista fijo. Se implementa como una clave
    // pseudoaleatoria ponderada por la carga (más carga → clave típicamente más chica →
    // va antes), no como "sort descendente por carga". La razón: si un mismo docente da
    // la misma materia en TODOS los grados (frecuente: Informática, Educación Física...) y
    // el orden fuera un sort estricto por carga, ese docente terminaría SIEMPRE primero en
    // la lista de CADA grado — y como el primer bloque de un grado siempre cae en la
    // posición 0 del día (todavía no se marcó nada ese día), ese único docente necesitaría
    // "la posición 0" en los 5 días para CADA grado que atiende. Con 6+ grados compitiendo
    // por ese mismo casillero es un choque garantizado (palomar), no un problema de
    // búsqueda, y ningún reintento con otra seed lo arregla porque el orden es siempre
    // el mismo. Con la clave ponderada, la prioridad sigue estando sesgada hacia los
    // docentes más cargados (se gana lo que pide la búsqueda: menos backtracking), pero
    // varía con la seed, así que REINTENTOS sí puede encontrar un orden que funcione.
    // Además, (ver más abajo) un bloque doble que no logra colocarse ya no hace fallar
    // toda la rama: se intenta partido en dos sueltos antes de descartarlo.
    variables = variables
        .map(v => ({ v, clave: -Math.log(1 - rng()) / ((v.carga || 0) + 1) }))
        .sort((a, b) => {
            if (a.v.size !== b.v.size) return b.v.size - a.v.size;
            const rx = a.v.disponibilidad === 'manana' ? 0 : 1;
            const ry = b.v.disponibilidad === 'manana' ? 0 : 1;
            if (rx !== ry) return rx - ry;
            return a.clave - b.clave;
        })
        .map(x => x.v);

    const diasUsadosPorMateria = new Set(); // heurística blanda, solo de este grado
    const estadoDia = {}; // `${dia}` -> { siguiente, cerrado } — un solo grado, así que alcanza con el día

    function obtenerEstadoDia(dia) {
        if (!estadoDia[dia]) estadoDia[dia] = { siguiente: 0, cerrado: false };
        return estadoDia[dia];
    }

    const asignado = new Array(variables.length).fill(null);
    let intentos = 0;

    function candidatosPara(v) {
        const candidatos = [];

        DIAS_HORARIO.forEach(dia => {
            const estado = obtenerEstadoDia(dia);
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
            if (diasUsadosPorMateria.has(`${v.materiaId}|${c.dia}`)) p += 5; // evitar repetir materia el mismo día
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

        diasUsadosPorMateria.add(`${v.materiaId}|${c.dia}`);
        const keyDocenteDia = `${v.docenteId}|${c.dia}`;
        if (!periodosPorDocenteDia[keyDocenteDia]) periodosPorDocenteDia[keyDocenteDia] = new Set();
        periodosUsados.forEach(p => periodosPorDocenteDia[keyDocenteDia].add(p));

        const estado = obtenerEstadoDia(c.dia);
        if (v.size === 1 && c.posicion.size === 2) {
            estado.cerrado = true; // bloque suelto usando solo la mitad de una posición doble: el día termina ahí
        } else {
            estado.siguiente += 1;
        }
    }

    function desmarcarDuro(v, c) {
        const periodosUsados = c.posicion.periodos.slice(0, v.size);
        periodosUsados.forEach(p => ocupadoDocente.delete(`${v.docenteId}|${c.dia}|${p}`));
        periodosPorDocenteDia[`${v.docenteId}|${c.dia}`]?.forEach(p => {
            if (periodosUsados.includes(p) && !ocupadoDocente.has(`${v.docenteId}|${c.dia}|${p}`)) {
                periodosPorDocenteDia[`${v.docenteId}|${c.dia}`].delete(p);
            }
        });

        const estado = obtenerEstadoDia(c.dia);
        if (v.size === 1 && c.posicion.size === 2) {
            estado.cerrado = false;
        } else {
            estado.siguiente -= 1;
        }
    }

    // Bloques de 2 períodos: preferencia FUERTE, no restricción dura. Si un bloque
    // doble no logra colocarse (el docente choca en el segundo período, o no queda
    // ninguna posición doble libre ese día en ningún día de la semana), no se rechaza
    // la asignación completa — se reintenta partida en dos períodos sueltos de 1 hora
    // (que pueden caer en días distintos). Así nunca se pierde una asignación válida
    // solo por no entrar en bloque de 2.
    function backtrack(idx) {
        if (idx >= variables.length) return true;
        const v = variables[idx];

        for (const c of candidatosPara(v)) {
            intentos++;
            if (intentos > MAX_INTENTOS_POR_GRADO) return false;

            marcar(v, c);
            asignado[idx] = [{ v, c }];
            if (backtrack(idx + 1)) return true;
            asignado[idx] = null;
            desmarcarDuro(v, c);
        }

        if (v.size === 2) {
            const vSuelto = { ...v, size: 1 };
            for (const c1 of candidatosPara(vSuelto)) {
                intentos++;
                if (intentos > MAX_INTENTOS_POR_GRADO) return false;

                marcar(vSuelto, c1);
                for (const c2 of candidatosPara(vSuelto)) {
                    intentos++;
                    if (intentos > MAX_INTENTOS_POR_GRADO) { desmarcarDuro(vSuelto, c1); return false; }

                    marcar(vSuelto, c2);
                    asignado[idx] = [{ v: vSuelto, c: c1 }, { v: vSuelto, c: c2 }];
                    if (backtrack(idx + 1)) return true;
                    asignado[idx] = null;
                    desmarcarDuro(vSuelto, c2);
                }
                desmarcarDuro(vSuelto, c1);
            }
        }

        return false;
    }

    const exito = backtrack(0);
    if (!exito) return null;

    const filas = [];
    variables.forEach((v, i) => {
        asignado[i].forEach(({ v: vColocada, c }) => {
            c.posicion.periodos.slice(0, vColocada.size).forEach(periodo => {
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
    });
    return filas;
}

/**
 * Genera un horario semanal completo a partir de las materias asignadas por grado.
 * Resuelve TODOS los grados presentes en `config.asignaciones` en una sola corrida:
 * cada grado arma su propio horario con un backtracking chico, pero todos comparten
 * el mismo set de ocupación de docentes, así que un docente compartido entre varios
 * grados nunca queda doble-reservado entre ellos.
 *
 * Internamente prueba varios órdenes de grados/variables (derivados de `seed`) antes
 * de rendirse — con datos reales (muchos grados) un solo orden "de mala suerte" puede
 * fallar aunque exista solución; reintentar con otro orden casi siempre la encuentra.
 *
 * @param {Object} config
 * @param {Array<{id:string, gradoId:string, materiaId:string, materiaNombre?:string, docenteId:string, horasPorSemana:number}>} config.asignaciones
 *        una fila por cada `grado_materia`. `id` es el grado_materia_id (se usa como grado_materia_id en el resultado).
 * @param {Object.<string,'completa'|'manana'>} [config.disponibilidadDocente] - docenteId -> disponibilidad. Por defecto 'completa'.
 * @param {number} [seed] - semilla del PRNG. La misma seed + config siempre da el mismo resultado
 *        (si el primer intento interno encuentra solución, que es el caso normal).
 * @returns {Array<{grado_materia_id:string, grado_id:string, materia_id:string, docente_id:string, dia:string, periodo:number}>|null}
 *          filas listas para guardar en la tabla `horarios` (una fila por período — un bloque de
 *          2 períodos genera 2 filas con el mismo día/materia/docente), o null si ningún intento
 *          encontró una combinación sin conflictos.
 */
export function generarHorario(config, seed = 1) {
    const { asignaciones = [], disponibilidadDocente = {} } = config || {};
    if (!asignaciones.length) return [];

    const porGrado = new Map();
    asignaciones.forEach(a => {
        if (!porGrado.has(a.gradoId)) porGrado.set(a.gradoId, []);
        porGrado.get(a.gradoId).push(a);
    });
    const gradosEntries = [...porGrado.entries()]; // [ [gradoId, asignaciones[]], ... ]

    // Carga total por docente (en bloques de 2, redondeando hacia arriba), sumada a través
    // de TODOS los grados en los que da clase. Se usa como sesgo (no como orden estricto,
    // ver comentario en resolverGrado) para intentar ubicar primero a los docentes más
    // difíciles de encajar.
    const cargaPorDocente = {};
    asignaciones.forEach(a => {
        const horas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
        cargaPorDocente[a.docenteId] = (cargaPorDocente[a.docenteId] || 0) + Math.ceil(horas / 2);
    });

    for (let intento = 0; intento < REINTENTOS; intento++) {
        const resultado = intentarUnaVez(gradosEntries, disponibilidadDocente, cargaPorDocente, seed + intento * 104729);
        if (resultado) return resultado;
    }
    return null;
}

function intentarUnaVez(gradosEntries, disponibilidadDocente, cargaPorDocente, seed) {
    const rng = crearRng(seed);

    // Orden de grados: los de mayor demanda total primero (los más difíciles de
    // encajar si se dejan para el final, cuando ya quedan menos huecos libres).
    const gradosOrdenados = mezclar(gradosEntries, rng).sort((a, b) => {
        const totalA = a[1].reduce((s, x) => s + (Math.max(0, Math.min(10, parseInt(x.horasPorSemana, 10) || 0))), 0);
        const totalB = b[1].reduce((s, x) => s + (Math.max(0, Math.min(10, parseInt(x.horasPorSemana, 10) || 0))), 0);
        return totalB - totalA;
    });

    const ocupadoDocente = new Set();       // GLOBAL — compartido por todos los grados de este intento
    const periodosPorDocenteDia = {};       // GLOBAL — heurística blanda de huecos del docente
    const filas = [];

    for (const [, asignacionesGrado] of gradosOrdenados) {
        const resultadoGrado = resolverGrado(
            asignacionesGrado, disponibilidadDocente, cargaPorDocente, ocupadoDocente, periodosPorDocenteDia, rng
        );
        if (!resultadoGrado) return null; // este intento completo falla; generarHorario prueba otra seed
        filas.push(...resultadoGrado);
    }

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
