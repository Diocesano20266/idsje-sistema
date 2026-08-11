// ═══════════════════════════════════════════
//  IDSJE — Panel Docente
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion } from './auth.js';
import { CONCEPTOS } from './config.js';

let usuarioActual   = null;
let gradoMatCache   = [];  // grado_materia asignadas al docente (con grados y materias embebidos)
let gradosGuiaCache = [];  // grados donde el docente es guía (docente_guia_id)
let alumnosPorGrado = {};  // conteo de alumnos activos por grado_id

// Registro de notas
let notasGradoId      = null;
let notasMateriaId    = null; // id de grado_materia
let periodoActual     = 1;
let alumnosNotas      = [];
let notasCache        = {};   // alumnoId -> fila de `notas` guardada en BD
let criteriosActuales = null; // { cotidianas, integradoras, examenes } del grado_materia + período actual
let notasDetalle      = {};   // alumnoId -> { cotidianas:[], integradoras:[], examenes:[] } (notas, edición local)
let notasRecEdit      = {};   // alumnoId -> valor de recuperación editado localmente
let detallesAbiertos  = new Set(); // ids de alumnos con la fila de detalle expandida
let pesosActuales     = {};   // { cotidianas:[%,%,...], integradoras:[...], examenes:[...] } — compartido por todo el grado_materia + período

// Competencias ciudadanas
let compGradoId  = null;
let compPeriodo  = 1;
let alumnosComp  = [];
let compCache    = {};
let compEdit     = {};

// ── INICIO ──────────────────────────────────
async function init() {
    const res = await verificarSesion();
    if (!res) return;
    usuarioActual = res.usuario;
    document.getElementById('docente-nombre').textContent = usuarioActual.nombre_completo;
    document.getElementById('docente-rol').textContent = usuarioActual.rol === 'admin' ? 'Administrador' : 'Docente';
    const av = document.getElementById('docente-iniciales');
    if (av) av.textContent = (usuarioActual.nombre_completo || 'D').charAt(0).toUpperCase();

    await cargarDatosDocente();
    mostrarVista('inicio');
}

async function cargarDatosDocente() {
    const [{ data: gm }, { data: guia }] = await Promise.all([
        supabase.from('grado_materia').select('*, grados(id, nombre, seccion, modalidad, anio), materias(id, nombre)').eq('docente_id', usuarioActual.id),
        supabase.from('grados').select('*').eq('docente_guia_id', usuarioActual.id).order('nombre')
    ]);

    gradoMatCache   = gm   || [];
    gradosGuiaCache = guia || [];

    const gradoIds = [...new Set([
        ...gradoMatCache.map(x => x.grado_id),
        ...gradosGuiaCache.map(g => g.id)
    ])];

    alumnosPorGrado = {};
    if (gradoIds.length) {
        const { data: alumnos } = await supabase
            .from('alumnos')
            .select('id, grado_id')
            .eq('activo', true)
            .in('grado_id', gradoIds);
        (alumnos || []).forEach(a => { alumnosPorGrado[a.grado_id] = (alumnosPorGrado[a.grado_id] || 0) + 1; });
    }

    // Competencias Ciudadanas solo es visible/accesible si el docente es guía de algún grado
    const navComp = document.getElementById('nav-competencias');
    if (navComp) navComp.classList.toggle('hidden', gradosGuiaCache.length === 0);
}

function gradosUnicosDocente() {
    return [...new Map(gradoMatCache.map(gm => [gm.grados.id, gm.grados])).values()];
}

// ── VISTAS ──────────────────────────────────
const TITULOS = {
    inicio: 'Inicio',
    materias: 'Mis Materias',
    notas: 'Registro de Notas',
    competencias: 'Competencias Ciudadanas'
};

window.mostrarVista = (vista) => {
    if (vista === 'competencias' && gradosGuiaCache.length === 0) return;

    document.querySelectorAll('[id^="vista-"]').forEach(v => v.classList.add('hidden'));
    document.getElementById(`vista-${vista}`)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-vista="${vista}"]`)?.classList.add('active');

    const t = document.getElementById('topbar-titulo');
    if (t) t.textContent = TITULOS[vista] || vista;

    if (vista === 'inicio')       renderDashboard();
    if (vista === 'materias')     renderMisMaterias();
    if (vista === 'notas')        initVistaNotas();
    if (vista === 'competencias') initVistaCompetencias();
};

// ── DASHBOARD (INICIO) ───────────────────────
function renderDashboard() {
    const grados = gradosUnicosDocente();

    document.getElementById('stat-mis-grados').textContent   = grados.length;
    document.getElementById('stat-mis-materias').textContent = gradoMatCache.length;
    document.getElementById('stat-alumnos-cargo').textContent =
        grados.reduce((sum, g) => sum + (alumnosPorGrado[g.id] || 0), 0);
    document.getElementById('stat-periodo').textContent = `Periodo ${periodoActual}`;

    const cont = document.getElementById('dash-mis-grados');
    if (!grados.length) {
        cont.innerHTML = '<div class="empty-state">No tenés grados asignados todavía.</div>';
        return;
    }

    cont.innerHTML = grados.map(g => {
        const materias = gradoMatCache.filter(gm => gm.grados.id === g.id).map(gm => gm.materias.nombre);
        return `
        <div class="dg-item">
            <div class="dg-info">
                <div class="dg-nombre">${g.nombre} · Sección ${g.seccion}</div>
                <div class="dg-materias">${materias.join(' · ')}</div>
            </div>
            <div>
                <div class="dg-count">${alumnosPorGrado[g.id] || 0}</div>
                <div class="dg-count-label">Alumnos</div>
            </div>
        </div>`;
    }).join('');
}

// ── MIS MATERIAS ──────────────────────────────
function renderMisMaterias() {
    const cont = document.getElementById('mis-materias');
    if (!gradoMatCache.length) {
        cont.innerHTML = '<div class="empty-state">No tenés materias asignadas todavía. Contactá al administrador.</div>';
        return;
    }

    cont.innerHTML = gradoMatCache.map(gm => `
        <div class="materia-card">
            <div class="mc-nombre">${gm.materias.nombre}</div>
            <div class="mc-grado">${gm.grados.nombre} · Sección ${gm.grados.seccion}</div>
            <div class="mc-foot">
                <div class="mc-alumnos"><b>${alumnosPorGrado[gm.grados.id] || 0}</b>&nbsp;alumnos</div>
                <button class="btn-primary" onclick="irARegistrarNotas('${gm.grado_id}', '${gm.id}')">Registrar Notas</button>
            </div>
        </div>
    `).join('');
}

window.irARegistrarNotas = (gradoId, gradoMateriaId) => {
    notasGradoId   = gradoId;
    notasMateriaId = gradoMateriaId;
    mostrarVista('notas');
};

// ── REGISTRO DE NOTAS ────────────────────────
function poblarSelectGradoNotas() {
    const sel = document.getElementById('notas-grado');
    sel.innerHTML = gradosUnicosDocente().map(g => `<option value="${g.id}">${g.nombre} ${g.seccion}</option>`).join('');
}

function poblarSelectMateriaNotas(gradoId) {
    const materias = gradoMatCache.filter(gm => gm.grado_id === gradoId);
    const sel = document.getElementById('notas-materia');
    sel.innerHTML = materias.map(gm => `<option value="${gm.id}">${gm.materias.nombre}</option>`).join('');
}

function initVistaNotas() {
    const grados = gradosUnicosDocente();
    if (!grados.length) {
        document.getElementById('notas-empty').classList.remove('hidden');
        document.getElementById('panel-criterios').classList.add('hidden');
        document.getElementById('wrap-tabla-notas').classList.add('hidden');
        return;
    }
    document.getElementById('notas-empty').classList.add('hidden');

    poblarSelectGradoNotas();
    if (!notasGradoId || !grados.find(g => g.id === notasGradoId)) {
        notasGradoId = grados[0].id;
    }
    document.getElementById('notas-grado').value = notasGradoId;

    poblarSelectMateriaNotas(notasGradoId);
    const materiasGrado = gradoMatCache.filter(gm => gm.grado_id === notasGradoId);
    if (!notasMateriaId || !materiasGrado.find(gm => gm.id === notasMateriaId)) {
        notasMateriaId = materiasGrado[0]?.id || null;
    }
    document.getElementById('notas-materia').value = notasMateriaId || '';

    cargarCriteriosYTabla();
}

window.cambiarGradoNotas = () => {
    notasGradoId = document.getElementById('notas-grado').value;
    poblarSelectMateriaNotas(notasGradoId);
    const materiasGrado = gradoMatCache.filter(gm => gm.grado_id === notasGradoId);
    notasMateriaId = materiasGrado[0]?.id || null;
    document.getElementById('notas-materia').value = notasMateriaId || '';
    cargarCriteriosYTabla();
};

window.cambiarMateriaNotas = () => {
    notasMateriaId = document.getElementById('notas-materia').value;
    cargarCriteriosYTabla();
};

window.setPeriodo = (n) => {
    periodoActual = n;
    document.querySelectorAll('.periodo-btn').forEach((b, i) => b.classList.toggle('active', i + 1 === n));
    cargarCriteriosYTabla();
};

function mostrarPanelConfig(mostrar) {
    document.getElementById('panel-criterios').classList.toggle('hidden', !mostrar);
    document.getElementById('wrap-tabla-notas').classList.toggle('hidden', mostrar);
}

// Paso 1: revisa si ya existen criterios guardados para este grado_materia + período
async function cargarCriteriosYTabla() {
    if (!notasGradoId || !notasMateriaId) return;

    const { data: criterio } = await supabase
        .from('criterios_evaluacion')
        .select('*')
        .eq('grado_materia_id', notasMateriaId)
        .eq('periodo', periodoActual)
        .maybeSingle();

    if (criterio) {
        criteriosActuales = criterio;
        mostrarPanelConfig(false);
        await cargarAlumnosYNotas();
    } else {
        criteriosActuales = null;
        document.getElementById('crit-cotidianas').value   = 4;
        document.getElementById('crit-integradoras').value = 2;
        document.getElementById('crit-examenes').value     = 1;
        mostrarPanelConfig(true);
    }
}

window.editarCriterios = () => {
    document.getElementById('crit-cotidianas').value   = criteriosActuales?.cotidianas   ?? 4;
    document.getElementById('crit-integradoras').value = criteriosActuales?.integradoras ?? 2;
    document.getElementById('crit-examenes').value     = criteriosActuales?.examenes     ?? 1;
    mostrarPanelConfig(true);
};

// Paso 1 → guarda los criterios elegidos y genera la tabla (paso 2)
window.generarTablaNotas = async () => {
    if (!notasMateriaId) return;

    const cotidianas   = Math.max(1, parseInt(document.getElementById('crit-cotidianas').value) || 1);
    const integradoras = Math.max(1, parseInt(document.getElementById('crit-integradoras').value) || 1);
    const examenes     = Math.max(1, parseInt(document.getElementById('crit-examenes').value) || 1);

    const { data, error } = await supabase
        .from('criterios_evaluacion')
        .upsert([{ grado_materia_id: notasMateriaId, periodo: periodoActual, cotidianas, integradoras, examenes }], { onConflict: 'grado_materia_id,periodo' })
        .select()
        .single();

    if (error) return alert('Error guardando criterios: ' + error.message);

    criteriosActuales = data;
    mostrarPanelConfig(false);
    await cargarAlumnosYNotas();
};

async function cargarAlumnosYNotas() {
    const { data: alumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', notasGradoId)
        .eq('activo', true)
        .order('apellidos');
    alumnosNotas = alumnos || [];

    notasCache      = {};
    notasDetalle    = {};
    notasRecEdit    = {};
    detallesAbiertos = new Set();

    const alumnoIds = alumnosNotas.map(a => a.id);
    if (alumnoIds.length) {
        const { data: notas } = await supabase
            .from('notas')
            .select('*')
            .in('alumno_id', alumnoIds)
            .eq('grado_materia_id', notasMateriaId)
            .eq('periodo', periodoActual);
        (notas || []).forEach(n => { notasCache[n.alumno_id] = n; });
    }

    alumnosNotas.forEach(al => inicializarDetalle(al.id));
    inicializarPesos();

    renderTablaNotas();
}

// Ajusta el arreglo guardado (detalle) al número de columnas definido por los criterios actuales
function ajustarLongitud(arr, n) {
    const base = Array.isArray(arr) ? arr.slice(0, n) : [];
    while (base.length < n) base.push('');
    return base;
}

// El campo `detalle` de una categoría puede venir en formato viejo (arreglo plano de notas,
// sin pesos) o en el formato nuevo { notas:[...], pesos:[...] }. Estas dos funciones normalizan
// la lectura para que las notas guardadas antes de esta función sigan funcionando.
function extraerNotas(detalleGrupo) {
    if (Array.isArray(detalleGrupo)) return detalleGrupo;
    return detalleGrupo?.notas || [];
}
function extraerPesos(detalleGrupo) {
    if (Array.isArray(detalleGrupo)) return null;
    return Array.isArray(detalleGrupo?.pesos) ? detalleGrupo.pesos : null;
}

function inicializarDetalle(alumnoId) {
    const detalle = notasCache[alumnoId]?.detalle || {};
    notasDetalle[alumnoId] = {
        cotidianas:   ajustarLongitud(extraerNotas(detalle.cotidianas),   criteriosActuales.cotidianas),
        integradoras: ajustarLongitud(extraerNotas(detalle.integradoras), criteriosActuales.integradoras),
        examenes:     ajustarLongitud(extraerNotas(detalle.examenes),     criteriosActuales.examenes),
    };
}

// Reparte 100% equitativamente entre `n` actividades (ajustando la última para que sume exacto)
function pesosEquitativos(n) {
    if (n <= 0) return [];
    const base = parseFloat((100 / n).toFixed(2));
    const pesos = new Array(n).fill(base);
    const suma = pesos.reduce((a, b) => a + b, 0);
    pesos[pesos.length - 1] = parseFloat((pesos[pesos.length - 1] + (100 - suma)).toFixed(2));
    return pesos;
}

// Los pesos son compartidos por todo el grado_materia + período (no por alumno).
// Se buscan en cualquier alumno que ya tenga guardados pesos con la cantidad correcta;
// si nadie los tiene todavía, se reparte equitativamente.
function inicializarPesos() {
    pesosActuales = {};
    GRUPOS_NOTAS.forEach(g => {
        const cantidad = criteriosActuales[g.clave];
        const guardados = Object.values(notasCache)
            .map(n => extraerPesos(n.detalle?.[g.clave]))
            .find(p => Array.isArray(p) && p.length === cantidad);
        pesosActuales[g.clave] = guardados ? [...guardados] : pesosEquitativos(cantidad);
    });
}

function sumaPesos(pesos) {
    return pesos.reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

// Σ(nota × peso%) / 100
function promedioPonderado(notas, pesos) {
    if (!notas.length) return 0;
    let suma = 0;
    for (let i = 0; i < notas.length; i++) {
        suma += (parseFloat(notas[i]) || 0) * (parseFloat(pesos[i]) || 0);
    }
    return suma / 100;
}

// Fórmula IDSJE 35/35/30 sobre notas ingresadas en escala 0–10, ponderadas por el peso de cada actividad
// promCotRaw/promIntRaw/promExaRaw = promedio ponderado de la categoría (para mostrar en la tabla)
// promCot/promInt/promExa = esos mismos promedios ya multiplicados por 35/35/30 (para guardar y calcular NF)
function calcularResumen(det) {
    const promCotRaw = promedioPonderado(det.cotidianas,   pesosActuales.cotidianas);
    const promIntRaw = promedioPonderado(det.integradoras, pesosActuales.integradoras);
    const promExaRaw = promedioPonderado(det.examenes,     pesosActuales.examenes);
    const promCot = promCotRaw * 0.35;
    const promInt = promIntRaw * 0.35;
    const promExa = promExaRaw * 0.30;
    const nf = parseFloat((promCot + promInt + promExa).toFixed(2));
    return { promCotRaw, promIntRaw, promExaRaw, promCot, promInt, promExa, nf };
}

// Escala de color: verde ≥6, naranja 4–6, rojo <4
function colorEscala(valor) {
    if (valor >= 6) return 'nivel-verde';
    if (valor >= 4) return 'nivel-naranja';
    return 'nivel-rojo';
}

const GRUPOS_NOTAS = [
    { clave: 'cotidianas',   card: 'Cotidianas',   item: 'Cotidiana',   peso: '35%' },
    { clave: 'integradoras', card: 'Integradoras', item: 'Integradora', peso: '35%' },
    { clave: 'examenes',     card: 'Examen',       item: 'Examen',      peso: '30%' },
];

const ICONO_ESTRELLA = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 1.5l2.47 5.27 5.78.63-4.31 3.95 1.19 5.7L10 14.15l-5.13 2.9 1.19-5.7L1.75 7.4l5.78-.63L10 1.5z"/></svg>';

function tarjetaDetalle(alumnoId, grupo, valores) {
    const pesos = pesosActuales[grupo.clave] || [];

    const items = valores.map((v, i) => `
        <div class="detalle-item">
            <span>${grupo.item} ${i + 1}</span>
            <div class="detalle-item-campos">
                <input type="number" step="0.01" min="0" max="10" value="${v}" placeholder="0.00"
                    class="detalle-nota" title="Nota"
                    oninput="actualizarDetalleLocal('${alumnoId}','${grupo.clave}',${i},this.value)">
                <span class="detalle-peso-wrap">
                    <input type="number" step="1" min="0" max="100" value="${pesos[i] ?? 0}"
                        class="detalle-peso-input" title="Peso %"
                        data-grupo="${grupo.clave}" data-idx="${i}"
                        oninput="actualizarPesoLocal('${grupo.clave}', ${i}, this.value)">%
                </span>
            </div>
        </div>`).join('');

    return `
    <div class="detalle-card">
        <div class="detalle-card-title">${grupo.card} <span class="detalle-peso">${grupo.peso}</span></div>
        <div class="detalle-items">${items}</div>
        <div class="${claseTotalPeso(grupo.clave)}" data-grupo="${grupo.clave}">${textoTotalPeso(grupo.clave)}</div>
    </div>`;
}

function textoTotalPeso(grupo) {
    const total = sumaPesos(pesosActuales[grupo] || []);
    const ok = Math.abs(total - 100) < 0.01;
    return `Total: ${total.toFixed(0)}% ${ok ? '✓' : '⚠'}`;
}

function claseTotalPeso(grupo) {
    const total = sumaPesos(pesosActuales[grupo] || []);
    return 'detalle-total ' + (Math.abs(total - 100) < 0.01 ? 'total-ok' : 'total-mal');
}

function filaRecuperacionHTML(al, visible) {
    const recValor = notasRecEdit[al.id] ?? notasCache[al.id]?.recuperacion ?? '';
    return `
    <div class="detalle-recuperacion ${visible ? '' : 'hidden'}" id="rec-wrap-${al.id}">
        <label>Nota de Recuperación</label>
        <input type="number" step="0.01" min="0" max="10" value="${recValor}" placeholder="—"
            class="nota-rec" oninput="actualizarRecuperacionLocal('${al.id}', this.value)">
    </div>`;
}

function filaNotas(al, idx) {
    const det = notasDetalle[al.id];
    const { promCotRaw, promIntRaw, promExaRaw, nf } = calcularResumen(det);
    const abierta = detallesAbiertos.has(al.id);

    const filaPrincipal = `
    <tr class="fila-alumno">
        <td class="td-num">${idx + 1}</td>
        <td class="td-apellido">${al.apellidos}</td>
        <td class="td-nombre-alumno">${al.nombres}</td>
        <td class="td-prom-color ${colorEscala(promCotRaw)}" id="promcot-${al.id}">${promCotRaw.toFixed(2)}</td>
        <td class="td-prom-color ${colorEscala(promIntRaw)}" id="promint-${al.id}">${promIntRaw.toFixed(2)}</td>
        <td class="td-prom-color ${colorEscala(promExaRaw)}" id="promexa-${al.id}">${promExaRaw.toFixed(2)}</td>
        <td class="td-final ${colorEscala(nf)}" id="nf-${al.id}">${nf.toFixed(2)}</td>
        <td class="td-detalle-btn">
            <button class="btn-detalle ${abierta ? 'activo' : ''}" id="btn-detalle-${al.id}" onclick="toggleDetalleAlumno('${al.id}')">${ICONO_ESTRELLA}</button>
        </td>
    </tr>`;

    const filaDetalle = `
    <tr class="fila-detalle ${abierta ? '' : 'hidden'}" id="detalle-${al.id}">
        <td colspan="8">
            <div class="detalle-cards">
                ${GRUPOS_NOTAS.map(g => tarjetaDetalle(al.id, g, det[g.clave])).join('')}
            </div>
            ${filaRecuperacionHTML(al, nf < 6)}
        </td>
    </tr>`;

    return filaPrincipal + filaDetalle;
}

function renderTablaNotas() {
    const tbody = document.getElementById('tbody-notas');
    if (!alumnosNotas.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Este grado no tiene alumnos activos.</td></tr>';
        return;
    }
    tbody.innerHTML = alumnosNotas.map((al, idx) => filaNotas(al, idx)).join('');
}

window.toggleDetalleAlumno = (alumnoId) => {
    if (detallesAbiertos.has(alumnoId)) detallesAbiertos.delete(alumnoId);
    else detallesAbiertos.add(alumnoId);

    document.getElementById(`detalle-${alumnoId}`)?.classList.toggle('hidden', !detallesAbiertos.has(alumnoId));
    document.getElementById(`btn-detalle-${alumnoId}`)?.classList.toggle('activo', detallesAbiertos.has(alumnoId));
};

function actualizarCeldaResumen(id, valor) {
    const celda = document.getElementById(id);
    if (!celda) return;
    celda.textContent = valor.toFixed(2);
    celda.className = 'td-prom-color ' + colorEscala(valor);
}

// Recalcula y repinta las celdas de un alumno (promedios + NF + bloque de recuperación)
function actualizarResumenAlumno(alumnoId) {
    const det = notasDetalle[alumnoId];
    if (!det) return;
    const { promCotRaw, promIntRaw, promExaRaw, nf } = calcularResumen(det);

    actualizarCeldaResumen(`promcot-${alumnoId}`, promCotRaw);
    actualizarCeldaResumen(`promint-${alumnoId}`, promIntRaw);
    actualizarCeldaResumen(`promexa-${alumnoId}`, promExaRaw);

    const celdaNF = document.getElementById(`nf-${alumnoId}`);
    if (celdaNF) {
        celdaNF.textContent = nf.toFixed(2);
        celdaNF.className = 'td-final ' + colorEscala(nf);
    }

    // La recuperación solo aplica si NF < 6 — su bloque cambia de visibilidad sin destruir los demás inputs
    const wrapRec = document.getElementById(`rec-wrap-${alumnoId}`);
    if (wrapRec) wrapRec.classList.toggle('hidden', nf >= 6);
}

window.actualizarDetalleLocal = (alumnoId, tipo, idx, valor) => {
    if (!notasDetalle[alumnoId]) return;
    notasDetalle[alumnoId][tipo][idx] = valor;
    actualizarResumenAlumno(alumnoId);
};

// El peso es compartido por todo el grado_materia + período: al cambiarlo hay que
// sincronizar el mismo campo en las demás cards abiertas y recalcular a TODOS los alumnos.
window.actualizarPesoLocal = (grupo, idx, valor) => {
    if (!pesosActuales[grupo]) return;
    pesosActuales[grupo][idx] = valor;

    document.querySelectorAll(`.detalle-peso-input[data-grupo="${grupo}"][data-idx="${idx}"]`).forEach(inp => {
        if (inp !== document.activeElement) inp.value = valor;
    });

    document.querySelectorAll(`.detalle-total[data-grupo="${grupo}"]`).forEach(el => {
        el.textContent = textoTotalPeso(grupo);
        el.className   = claseTotalPeso(grupo);
    });

    alumnosNotas.forEach(al => actualizarResumenAlumno(al.id));
};

window.actualizarRecuperacionLocal = (alumnoId, valor) => {
    notasRecEdit[alumnoId] = valor;
};

window.guardarTodasLasNotas = async () => {
    if (!notasGradoId || !notasMateriaId || !criteriosActuales) return alert('Generá la tabla primero.');
    if (!alumnosNotas.length) return;

    const payload = alumnosNotas.map(al => {
        const det = notasDetalle[al.id];
        const { promCot, promInt, promExa, nf } = calcularResumen(det);
        const recValor = notasRecEdit[al.id] ?? notasCache[al.id]?.recuperacion ?? null;

        let notaFinalRec = null;
        if (recValor && nf < 6) {
            notaFinalRec = Math.min(10, parseFloat(recValor) || 0);
        }

        return {
            alumno_id:        al.id,
            grado_materia_id: notasMateriaId,
            periodo:          periodoActual,
            actividades:      parseFloat(promCot.toFixed(2)),
            laboratorio:      parseFloat(promInt.toFixed(2)),
            examen:           parseFloat(promExa.toFixed(2)),
            nota_final:       nf,
            recuperacion:     recValor || null,
            nota_final_rec:   notaFinalRec,
            detalle: {
                cotidianas:   { notas: det.cotidianas.map(v => parseFloat(v) || 0),   pesos: (pesosActuales.cotidianas   || []).map(v => parseFloat(v) || 0) },
                integradoras: { notas: det.integradoras.map(v => parseFloat(v) || 0), pesos: (pesosActuales.integradoras || []).map(v => parseFloat(v) || 0) },
                examenes:     { notas: det.examenes.map(v => parseFloat(v) || 0),     pesos: (pesosActuales.examenes     || []).map(v => parseFloat(v) || 0) },
            },
        };
    });

    const { data, error } = await supabase
        .from('notas')
        .upsert(payload, { onConflict: 'alumno_id,grado_materia_id,periodo' })
        .select();

    if (error) return alert('Error guardando notas: ' + error.message);

    (data || []).forEach(n => { notasCache[n.alumno_id] = n; });
    notasRecEdit = {};
    renderTablaNotas();
    alert('✅ Notas guardadas correctamente.');
};

// ── COMPETENCIAS CIUDADANAS ──────────────────
function poblarSelectGradoComp() {
    const sel = document.getElementById('comp-grado');
    sel.innerHTML = gradosGuiaCache.map(g => `<option value="${g.id}">${g.nombre} ${g.seccion}</option>`).join('');
}

function initVistaCompetencias() {
    if (!gradosGuiaCache.length) {
        document.getElementById('tbody-comp').innerHTML = '<tr><td colspan="8" class="empty-state">No sos docente guía de ningún grado.</td></tr>';
        return;
    }

    poblarSelectGradoComp();
    if (!compGradoId || !gradosGuiaCache.find(g => g.id === compGradoId)) {
        compGradoId = gradosGuiaCache[0].id;
    }
    document.getElementById('comp-grado').value = compGradoId;

    cargarAlumnosComp();
}

window.cambiarGradoComp = () => {
    compGradoId = document.getElementById('comp-grado').value;
    cargarAlumnosComp();
};

window.setCompPeriodo = (n) => {
    compPeriodo = n;
    document.querySelectorAll('.comp-periodo-btn').forEach((b, i) => b.classList.toggle('active', i + 1 === n));
    cargarAlumnosComp();
};

async function cargarAlumnosComp() {
    if (!compGradoId) return;

    const { data: alumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', compGradoId)
        .eq('activo', true)
        .order('apellidos');
    alumnosComp = alumnos || [];

    compCache = {};
    compEdit  = {};
    const alumnoIds = alumnosComp.map(a => a.id);
    if (alumnoIds.length) {
        const { data: comps } = await supabase
            .from('competencias')
            .select('*')
            .in('alumno_id', alumnoIds)
            .eq('grado_id', compGradoId)
            .eq('periodo', compPeriodo);
        (comps || []).forEach(c => { compCache[c.alumno_id] = c; });
    }

    renderTablaCompetencias();
}

function selectConcepto(alumnoId, campo, valorActual) {
    return `<select class="comp-select" onchange="actualizarCompLocal('${alumnoId}', '${campo}', this.value)">
        ${CONCEPTOS.map(c => `<option value="${c}" ${c === valorActual ? 'selected' : ''}>${c}</option>`).join('')}
    </select>`;
}

function renderTablaCompetencias() {
    const tbody = document.getElementById('tbody-comp');
    if (!alumnosComp.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Este grado no tiene alumnos activos.</td></tr>';
        return;
    }

    tbody.innerHTML = alumnosComp.map((al, idx) => {
        const c = compCache[al.id] || {};
        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            <td>${selectConcepto(al.id, 'convivencia',  c.convivencia  || 'MB')}</td>
            <td>${selectConcepto(al.id, 'autonomia',    c.autonomia    || 'MB')}</td>
            <td>${selectConcepto(al.id, 'expresion',    c.expresion    || 'MB')}</td>
            <td>${selectConcepto(al.id, 'pertenencia',  c.pertenencia  || 'MB')}</td>
            <td><input type="number" min="0" max="999" class="inasis-input"
                value="${c.inasistencias || 0}"
                oninput="actualizarCompLocal('${al.id}', 'inasistencias', this.value)"></td>
            <td><input type="text" class="obs-input" placeholder="Observación..."
                value="${c.observacion || ''}"
                oninput="actualizarCompLocal('${al.id}', 'observacion', this.value)"></td>
        </tr>`;
    }).join('');
}

window.actualizarCompLocal = (alumnoId, campo, valor) => {
    const base = compEdit[alumnoId] || { ...(compCache[alumnoId] || {}) };
    base[campo] = valor;
    compEdit[alumnoId] = base;
};

window.guardarTodasLasCompetencias = async () => {
    if (!compGradoId) return;
    if (!alumnosComp.length) return;

    const payload = alumnosComp.map(al => {
        const edit = compEdit[al.id] || compCache[al.id] || {};
        return {
            alumno_id:     al.id,
            grado_id:      compGradoId,
            periodo:       compPeriodo,
            convivencia:   edit.convivencia  || 'MB',
            autonomia:     edit.autonomia    || 'MB',
            expresion:     edit.expresion    || 'MB',
            pertenencia:   edit.pertenencia  || 'MB',
            inasistencias: parseInt(edit.inasistencias) || 0,
            observacion:   edit.observacion  || '',
        };
    });

    const { error } = await supabase
        .from('competencias')
        .upsert(payload, { onConflict: 'alumno_id,grado_id,periodo' });

    if (error) return alert('Error guardando competencias: ' + error.message);

    compEdit = {};
    await cargarAlumnosComp();
    alert('✅ Competencias guardadas correctamente.');
};

window.cerrarSesionDocente = cerrarSesion;

init();
