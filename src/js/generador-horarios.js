// ═══════════════════════════════════════════
//  IDSJE — Generador Automático de Horarios
//  CSP (constraint satisfaction) + backtracking, en JS puro.
//  Sin Supabase ni DOM acá — admin.js construye `config` con los datos
//  de Supabase y se encarga de guardar el resultado.
//
//  SIN preferencia de bloques de 2: cada hora semanal de una materia es una
//  variable independiente de 1 período — no hay ningún intento de agrupar
//  horas consecutivas. Esto se quitó a propósito (no es un descuido): con
//  datos reales del IDSJE, docentes que dan varias materias repartidas entre
//  muchos grados (ej. un docente con 24h/semana entre Educación Física y
//  Educación en la Fe en 3 grados cada una) hacían que la preferencia por
//  bloques dobles le restara flexibilidad justo donde más la necesitaba: el
//  generador insistía en encontrar DOS períodos consecutivos libres para ese
//  docente en cada grado, cuando muchas veces solo había huecos sueltos
//  disponibles. Tratar cada hora como independiente le da al backtracking
//  la libertad total de acomodar horas en cualquier período libre.
//
//  Igual se garantiza, por construcción, que el horario de un grado nunca
//  tenga huecos: cada grado tiene, por día, una secuencia FIJA de posiciones
//  (una por cada período de clase — ver calcularPosicionesDelDia) que se va
//  llenando en orden desde la primera, así que los períodos ocupados de un
//  día siempre son un prefijo 1..k. La cantidad de períodos usados por día
//  SÍ puede variar día a día (un grado puede terminar en P6 un día y en P10
//  otro) — no hay ninguna restricción de que todos los días tengan la misma
//  cantidad de horas.
//
//  Escalabilidad: resolver TODAS las horas de TODOS los grados como una
//  única bolsa de variables se vuelve muy lento con datos reales (decenas de
//  grados) porque, con este modelo de posiciones, cada hora tiene como mucho
//  un candidato por día — un mal orden global puede atascar el backtracking
//  aunque exista solución. Por eso el armado se DESCOMPONE por grado: cada
//  grado resuelve su propio horario con un backtracking chico e
//  independiente, pero todos comparten el mismo set de ocupación de
//  docentes (`ocupadoDocente`), así que la garantía real que importa —
//  ningún docente en dos grados a la vez — se sigue chequeando de forma
//  global, en la misma corrida.
//
//  Modo debug / mejor esfuerzo: generarHorario(config, seed, opciones) acepta
//  { debug, permitirParcial }. `debug:true` no cambia el resultado — solo
//  imprime en consola, cuando ningún intento encuentra una solución 100%
//  completa, qué materia/docente quedó bloqueado y cuántas horas le faltaron.
//  `permitirParcial:true` sí cambia el contrato de retorno: en vez de `null`,
//  devuelve { completo, filas, materiasNoColocadas } con la mejor combinación
//  parcial encontrada (sin choques) más el detalle de lo que no entró. Sin
//  `opciones` (el uso de siempre), el comportamiento es idéntico al anterior:
//  Array de filas o `null`.
//
//  Nota: el análisis de viabilidad por carga docente (>30h = advertencia,
//  >40h = imposible) NO vive acá — se calcula en admin.js, ANTES de siquiera
//  llamar a generarHorario, para poder avisarle al admin sin gastar tiempo
//  de backtracking en un caso matemáticamente irresoluble.
// ═══════════════════════════════════════════
import { DIAS_HORARIO, BLOQUES_HORARIO } from './config.js';

const MAX_INTENTOS_POR_GRADO = 100000; // backtracking local, por grado
const REINTENTOS = 50; // órdenes de grados/semillas distintas antes de rendirse
const MATERIAS_IMPORTANTES = /matem[aá]tica|lenguaje/i;
const ULTIMO_PERIODO_MANANA = 7; // 6:45–12:00

// Peso de la preferencia por media jornada (multiplicador de probabilidad en
// el orden de asignación, ver `clave` en resolverGrado). Sí conviene
// mantenerlo marcado: a diferencia de los bloques de 2 (una preferencia de
// estilo, ya eliminada), esto refleja una escasez real de slots disponibles.
const PESO_PREFERENCIA_MEDIA_JORNADA = 2;

// Una posición por cada período de clase (los de receso/almuerzo se excluyen
// acá, ya quedan afuera de BLOQUES_HORARIO.filter). Ya no hay agrupamiento en
// pares — cada período es su propia posición de tamaño 1.
function calcularPosicionesDelDia() {
    return BLOQUES_HORARIO
        .filter(b => b.tipo === 'clase')
        .map(b => b.periodo);
}

const POSICIONES_DIA = calcularPosicionesDelDia(); // [1,2,3,4,5,6,7,8,9,10] con los bloques actuales de config.js

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

// Una variable por cada HORA semanal (ya no por bloque de 2) — una materia
// con 6 horas genera 6 variables independientes de 1 período cada una.
function expandirHoras(asignacionesGrado, disponibilidadDocente, cargaPorDocente) {
    const variables = [];
    asignacionesGrado.forEach(a => {
        const horas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
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
        for (let i = 0; i < horas; i++) variables.push({ ...base });
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
function resolverGrado(asignacionesGrado, disponibilidadDocente, cargaPorDocente, ocupadoDocente, periodosPorDocenteDia, rng, permitirParcial = false) {
    let variables = expandirHoras(asignacionesGrado, disponibilidadDocente, cargaPorDocente);
    if (!variables.length) return permitirParcial ? { filas: [], completo: true } : [];

    // Orden de asignación dentro del grado: una única clave pseudoaleatoria
    // ponderada (Efraimidis-Spirakis: ordenar ascendente por un valor
    // exponencial aleatorio dividido por un peso equivale a un muestreo
    // ponderado sin reemplazo) — NO un tier duro. Un peso más alto → tiende a
    // ir antes, pero nunca lo garantiza.
    // - Media jornada: preferencia marcada — escasez real de slots (P1-P7 nomás).
    // - Carga del docente (MRV): intenta ubicar primero a los docentes con más
    //   horas totales entre varios grados — son los más difíciles de encajar
    //   más adelante, cuando queden menos huecos libres. Ponderado (no un sort
    //   estricto) a propósito: si un solo docente da una materia en TODOS los
    //   grados, un sort estricto por carga lo pondría SIEMPRE primero en cada
    //   grado — y como el primer período de un grado siempre cae en la
    //   posición 0 del día, eso es un choque de palomar garantizado en cuanto
    //   hay más grados que días (5). Ponderado, REINTENTOS con otra seed sí
    //   puede encontrar un orden que funcione.
    variables = variables
        .map(v => {
            const pesoDisponibilidad = v.disponibilidad === 'manana' ? PESO_PREFERENCIA_MEDIA_JORNADA : 1;
            const pesoCarga = (v.carga || 0) + 1;
            const peso = pesoDisponibilidad * pesoCarga;
            return { v, clave: -Math.log(1 - rng()) / peso };
        })
        .sort((a, b) => a.clave - b.clave)
        .map(x => x.v);

    const diasUsadosPorMateria = new Set(); // heurística blanda, solo de este grado
    const estadoDia = {}; // `${dia}` -> { siguiente } — próxima posición libre de ese día para este grado

    function obtenerEstadoDia(dia) {
        if (!estadoDia[dia]) estadoDia[dia] = { siguiente: 0 };
        return estadoDia[dia];
    }

    const asignado = new Array(variables.length).fill(null);
    let intentos = 0;

    // Para el modo "mejor esfuerzo": si el backtracking termina sin éxito,
    // en vez de tirar todo, se reconstruye la solución parcial más profunda
    // que se haya alcanzado en cualquier punto de la búsqueda. `asignado[0..idx-1]`
    // es siempre una asignación válida (sin choques) en el momento en que
    // backtrack(idx) arranca — por construcción del backtracking chronológico —
    // así que basta con recordar el mayor `idx` visto y una copia de esa porción.
    let mejorProfundidad = 0;
    let mejorAsignado = [];
    function registrarProgreso(idx) {
        if (idx > mejorProfundidad) {
            mejorProfundidad = idx;
            mejorAsignado = asignado.slice(0, idx);
        }
    }

    function candidatosPara(v) {
        const candidatos = [];

        DIAS_HORARIO.forEach(dia => {
            const estado = obtenerEstadoDia(dia);
            if (estado.siguiente >= POSICIONES_DIA.length) return;

            const periodo = POSICIONES_DIA[estado.siguiente];
            if (v.disponibilidad === 'manana' && periodo > ULTIMO_PERIODO_MANANA) return;
            if (ocupadoDocente.has(`${v.docenteId}|${dia}|${periodo}`)) return;

            candidatos.push({ dia, periodo });
        });

        // Puntaje blando — menor es mejor. No afecta las restricciones duras, solo el orden
        // en el que el backtracking prueba los candidatos.
        const puntaje = (c) => {
            let p = 0;
            // Preferir REUTILIZAR un día que esta materia ya usa en este grado, en vez de
            // abrir uno nuevo. A propósito es lo opuesto de "evitar repetir materia el
            // mismo día": ahora que cada hora es independiente (sin bloques de 2), lo
            // contrario — penalizar la reutilización — hacía que una materia de varias
            // horas se esparciera por tantos días distintos como pudiera. Eso multiplica
            // la cantidad de días que un docente COMPARTIDO entre varios grados necesita
            // en total, y reintroduce el mismo choque de palomar que se buscaba evitar
            // (con pocos grados y un docente de jornada completa incluso). Preferir
            // consolidar en menos días imita el efecto compactador que antes daban los
            // bloques de 2, pero como preferencia blanda: si no hay más lugar ese día,
            // sigue cayendo a un día nuevo sin problema.
            if (!diasUsadosPorMateria.has(`${v.materiaId}|${c.dia}`)) p += 3;
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
        ocupadoDocente.add(`${v.docenteId}|${c.dia}|${c.periodo}`);
        diasUsadosPorMateria.add(`${v.materiaId}|${c.dia}`);
        const keyDocenteDia = `${v.docenteId}|${c.dia}`;
        if (!periodosPorDocenteDia[keyDocenteDia]) periodosPorDocenteDia[keyDocenteDia] = new Set();
        periodosPorDocenteDia[keyDocenteDia].add(c.periodo);
        obtenerEstadoDia(c.dia).siguiente += 1;
    }

    function desmarcarDuro(v, c) {
        ocupadoDocente.delete(`${v.docenteId}|${c.dia}|${c.periodo}`);
        periodosPorDocenteDia[`${v.docenteId}|${c.dia}`]?.delete(c.periodo);
        obtenerEstadoDia(c.dia).siguiente -= 1;
    }

    function backtrack(idx) {
        registrarProgreso(idx);
        if (idx >= variables.length) return true;
        const v = variables[idx];

        for (const c of candidatosPara(v)) {
            intentos++;
            if (intentos > MAX_INTENTOS_POR_GRADO) return false;

            marcar(v, c);
            asignado[idx] = c;
            if (backtrack(idx + 1)) return true;
            asignado[idx] = null;
            desmarcarDuro(v, c);
        }

        return false;
    }

    const exito = backtrack(0);

    function construirFilas(vars, asigns) {
        const filas = [];
        vars.forEach((v, i) => {
            const c = asigns[i];
            if (!c) return; // variable que no llegó a colocarse (solo pasa en el corte parcial)
            filas.push({
                grado_materia_id: v.asignacionId,
                grado_id: v.gradoId,
                materia_id: v.materiaId,
                docente_id: v.docenteId,
                dia: c.dia,
                periodo: c.periodo,
            });
        });
        return filas;
    }

    if (exito) {
        const filas = construirFilas(variables, asignado);
        return permitirParcial ? { filas, completo: true } : filas;
    }

    if (!permitirParcial) return null;

    // El backtracking, al fallar del todo, deshace TODAS las marcas que hizo —
    // incluidas las del mejor prefijo alcanzado (mejorAsignado) — porque
    // desmarcarDuro se llama en cada nivel al retroceder. Sin volver a marcar
    // ese prefijo acá, `ocupadoDocente`/`periodosPorDocenteDia` (compartidos
    // GLOBALMENTE entre todos los grados de esta corrida) quedarían sin
    // reflejar las horas que este grado SÍ va a devolver como parte de su
    // resultado parcial — y el próximo grado podría reutilizar esos mismos
    // horarios de docente, generando un choque real entre grados en el
    // resultado final. Se re-marca exactamente ese prefijo (ya se sabe que es
    // válido: así se llegó a esa profundidad) antes de construir las filas.
    variables.slice(0, mejorProfundidad).forEach((v, i) => marcar(v, mejorAsignado[i]));
    const filasParciales = construirFilas(variables.slice(0, mejorProfundidad), mejorAsignado);
    return { filas: filasParciales, completo: false };
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
 * @param {Object} [opciones]
 * @param {boolean} [opciones.debug=false] - si es true, cuando ningún intento encuentra una
 *        solución 100% completa, imprime en consola (console.warn) qué materia/docente quedó
 *        bloqueado y con cuántas horas sin ubicar. No cambia el valor de retorno.
 * @param {boolean} [opciones.permitirParcial=false] - si es true, cambia el contrato de retorno:
 *        en vez de `null` cuando nadie encuentra una solución completa, devuelve
 *        { completo, filas, materiasNoColocadas } con la mejor combinación parcial encontrada
 *        (sin choques, ver verificarConflictos) y el detalle de qué no se pudo ubicar. Si SÍ se
 *        encuentra una solución completa, igual devuelve ese mismo shape con completo:true.
 * @returns {Array<{grado_materia_id:string, grado_id:string, materia_id:string, docente_id:string, dia:string, periodo:number}>|null
 *           |{completo:boolean, filas:Array, materiasNoColocadas:Array<{asignacionId,gradoId,materiaId,materiaNombre,docenteId,horasRequeridas,horasColocadas}>}}
 *          Sin `opciones` (uso de siempre): filas listas para guardar en la tabla `horarios` (una
 *          fila por período), o null si ningún intento encontró una combinación 100% completa y
 *          sin conflictos. Con `opciones.permitirParcial`: ver arriba.
 */
export function generarHorario(config, seed = 1, opciones = {}) {
    // Canary de versión: se imprime SIEMPRE (no depende de debug/permitirParcial) para
    // poder confirmar desde la consola del navegador que el archivo que corre es este
    // (sin bloques de 2, con soporte de opciones) y no una copia vieja/cacheada de
    // generador-horarios.js. Si al generar un horario esta línea NO aparece en consola,
    // el navegador o el deploy están sirviendo otra versión.
    console.log('[generador-horarios] v3 (sin bloques de 2, REINTENTOS=50) iniciando — seed=', seed, 'opciones=', opciones);

    const { debug = false, permitirParcial = false } = opciones || {};
    const { asignaciones = [], disponibilidadDocente = {} } = config || {};
    if (!asignaciones.length) return permitirParcial ? { completo: true, filas: [], materiasNoColocadas: [] } : [];

    const porGrado = new Map();
    asignaciones.forEach(a => {
        if (!porGrado.has(a.gradoId)) porGrado.set(a.gradoId, []);
        porGrado.get(a.gradoId).push(a);
    });
    const gradosEntries = [...porGrado.entries()]; // [ [gradoId, asignaciones[]], ... ]

    // Carga total por docente EN HORAS (ya no en "bloques"), sumada a través de
    // TODOS los grados en los que da clase. Se usa como sesgo (no como orden
    // estricto, ver comentario en resolverGrado) para intentar ubicar primero
    // a los docentes más difíciles de encajar.
    const cargaPorDocente = {};
    asignaciones.forEach(a => {
        const horas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
        cargaPorDocente[a.docenteId] = (cargaPorDocente[a.docenteId] || 0) + horas;
    });

    for (let intento = 0; intento < REINTENTOS; intento++) {
        const resultado = intentarUnaVez(gradosEntries, disponibilidadDocente, cargaPorDocente, seed + intento * 104729);
        if (resultado) return permitirParcial ? { completo: true, filas: resultado, materiasNoColocadas: [] } : resultado;
    }

    // Ningún intento (de los REINTENTOS) encontró una solución 100% completa. Se hace UNA
    // pasada más en modo "mejor esfuerzo": a diferencia de intentarUnaVez, esta no aborta
    // apenas un grado falla — sigue con el resto y junta, por cada grado, la mejor combinación
    // parcial que el backtracking haya alcanzado (ver resolverGrado/registrarProgreso).
    const mejorEsfuerzo = intentarMejorEsfuerzo(gradosEntries, disponibilidadDocente, cargaPorDocente, seed, asignaciones);
    if (debug) logDiagnosticoFallo(mejorEsfuerzo, seed);

    if (!permitirParcial) return null;
    return mejorEsfuerzo;
}

// Orden de grados: los de mayor demanda total primero (los más difíciles de
// encajar si se dejan para el final, cuando ya quedan menos huecos libres).
// Compartido por intentarUnaVez e intentarMejorEsfuerzo.
function ordenarGrados(gradosEntries, rng) {
    return mezclar(gradosEntries, rng).sort((a, b) => {
        const totalA = a[1].reduce((s, x) => s + (Math.max(0, Math.min(10, parseInt(x.horasPorSemana, 10) || 0))), 0);
        const totalB = b[1].reduce((s, x) => s + (Math.max(0, Math.min(10, parseInt(x.horasPorSemana, 10) || 0))), 0);
        return totalB - totalA;
    });
}

function intentarUnaVez(gradosEntries, disponibilidadDocente, cargaPorDocente, seed) {
    const rng = crearRng(seed);
    const gradosOrdenados = ordenarGrados(gradosEntries, rng);

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

// Modo "mejor esfuerzo": resuelve TODOS los grados igual que intentarUnaVez, pero un grado
// que no logra completarse no aborta la corrida — se queda con su mejor solución parcial
// (permitirParcial:true en resolverGrado) y se sigue con el resto de los grados, para que
// una sola materia/docente bloqueado en un grado no oculte que los demás sí se resolvieron bien.
function intentarMejorEsfuerzo(gradosEntries, disponibilidadDocente, cargaPorDocente, seed, asignaciones) {
    const rng = crearRng(seed);
    const gradosOrdenados = ordenarGrados(gradosEntries, rng);

    const ocupadoDocente = new Set();
    const periodosPorDocenteDia = {};
    const filas = [];
    let completo = true;

    for (const [, asignacionesGrado] of gradosOrdenados) {
        const resultadoGrado = resolverGrado(
            asignacionesGrado, disponibilidadDocente, cargaPorDocente, ocupadoDocente, periodosPorDocenteDia, rng, true
        );
        filas.push(...resultadoGrado.filas);
        if (!resultadoGrado.completo) completo = false;
    }

    const materiasNoColocadas = calcularNoColocadas(asignaciones, filas);
    return { completo: completo && materiasNoColocadas.length === 0, filas, materiasNoColocadas };
}

// Compara, para cada asignación (grado_materia) original, cuántas horas quedaron
// realmente colocadas en `filas` contra las que pedía — cualquier faltante (parcial
// o total) se reporta. Funciona igual para una corrida completa (da []) o parcial.
function calcularNoColocadas(asignaciones, filas) {
    const horasColocadasPorAsignacion = {};
    filas.forEach(f => {
        horasColocadasPorAsignacion[f.grado_materia_id] = (horasColocadasPorAsignacion[f.grado_materia_id] || 0) + 1;
    });

    return asignaciones
        .map(a => {
            const horasRequeridas = Math.max(0, Math.min(10, parseInt(a.horasPorSemana, 10) || 0));
            const horasColocadas = horasColocadasPorAsignacion[a.id] || 0;
            if (horasColocadas >= horasRequeridas) return null;
            return {
                asignacionId: a.id,
                gradoId: a.gradoId,
                materiaId: a.materiaId,
                materiaNombre: a.materiaNombre || '',
                docenteId: a.docenteId,
                horasRequeridas,
                horasColocadas,
            };
        })
        .filter(Boolean);
}

// Modo debug: no cambia nada del resultado, solo informa en consola qué quedó bloqueado.
function logDiagnosticoFallo(mejorEsfuerzo, seed) {
    const { materiasNoColocadas } = mejorEsfuerzo;
    console.warn(`[generador-horarios] Ningún intento (${REINTENTOS} órdenes distintos desde la seed ${seed}) encontró una solución 100% completa.`);
    if (!materiasNoColocadas.length) {
        console.warn('[generador-horarios] La mejor combinación parcial encontrada igual quedó completa — revisar verificarConflictos() por posibles choques residuales.');
        return;
    }
    console.warn(`[generador-horarios] ${materiasNoColocadas.length} asignación(es) quedaron sin ubicar del todo:`);
    materiasNoColocadas.forEach(m => {
        console.warn(`  · Grado ${m.gradoId} — "${m.materiaNombre || m.materiaId}" (docente ${m.docenteId}): ${m.horasColocadas}/${m.horasRequeridas} horas ubicadas.`);
    });
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
