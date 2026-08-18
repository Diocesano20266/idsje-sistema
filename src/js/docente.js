// ═══════════════════════════════════════════
//  IDSJE — Panel Docente
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion } from './auth.js';
import { CONCEPTOS, DIAS_HORARIO, BLOQUES_HORARIO, ESTADOS_ASISTENCIA, TIPOS_EXPEDIENTE } from './config.js';
import {
    calcularNotaFinal,
    promedioPonderado,
    sumaPesos,
    pesosEquitativos,
    aplicarPesoMinimo,
    redistribuirPesos,
    colorEscala,
    puedeAccederCompetencias,
    mostrarToast,
    notificarError,
    esErrorDeRed,
    mostrarBannerSinConexion,
    ocultarBannerSinConexion,
    setBotonCargando,
    renderSkeletonFilas,
    colorPorMateria,
} from './utils.js';

let usuarioActual   = null;
let gradoMatCache   = [];  // grado_materia asignadas al docente (con grados y materias embebidos)
let gradosGuiaCache = [];  // grados donde el docente es guía (docente_guia_id)
let alumnosPorGrado = {};  // conteo de alumnos activos por grado_id

// Mi Horario
let horarioDocenteCache = null; // null = aún no cargado; [] = cargado y vacío

// Expediente disciplinario
let expAlumnos       = [];   // alumnos de los grados asignados al docente (materia o guía)
let expAlumnoSel     = null; // alumno_id elegido
let expEsGuia        = false; // ¿el docente es guía del grado de expAlumnoSel?
let expTimeline      = [];   // solo si expEsGuia — registros combinados y ordenados por fecha

// Asistencias
let asisGradoId      = null;
let asisFecha         = null; // 'YYYY-MM-DD'
let alumnosAsis       = [];
let asisCache         = {};   // alumnoId -> fila de `asistencias` guardada
let asisEdit          = {};   // alumnoId -> estado editado localmente (P/A/J/T)
let asisRegistroInfo  = null; // { nombre, hora } si ya hay asistencia guardada para esa fecha

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
    try {
        const [{ data: gm, error: eGm }, { data: guia, error: eGuia }] = await Promise.all([
            supabase.from('grado_materia').select('*, grados(id, nombre, seccion, modalidad, anio), materias(id, nombre)').eq('docente_id', usuarioActual.id),
            supabase.from('grados').select('*').eq('docente_guia_id', usuarioActual.id).order('nombre')
        ]);

        if ((eGm && esErrorDeRed(eGm)) || (eGuia && esErrorDeRed(eGuia))) {
            mostrarBannerSinConexion(() => cargarDatosDocente().then(() => mostrarVista(vistaActualDocente())));
            return;
        }
        ocultarBannerSinConexion();

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
        if (navComp) navComp.classList.toggle('hidden', !puedeAccederCompetencias(gradosGuiaCache));
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => cargarDatosDocente());
            return;
        }
        notificarError(err, 'Error cargando tus datos');
    }
}

function vistaActualDocente() {
    return document.querySelector('.nav-item.active')?.dataset.vista || 'inicio';
}

function gradosUnicosDocente() {
    return [...new Map(gradoMatCache.map(gm => [gm.grados.id, gm.grados])).values()];
}

// ── VISTAS ──────────────────────────────────
const TITULOS = {
    inicio: 'Inicio',
    materias: 'Mis Materias',
    notas: 'Registro de Notas',
    horario: 'Mi Horario',
    asistencias: 'Asistencias',
    reportes: 'Reportes',
    expediente: 'Expediente',
    competencias: 'Competencias Ciudadanas'
};

window.mostrarVista = (vista) => {
    if (vista === 'competencias' && !puedeAccederCompetencias(gradosGuiaCache)) return;

    document.querySelectorAll('[id^="vista-"]').forEach(v => v.classList.add('hidden'));
    document.getElementById(`vista-${vista}`)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-vista="${vista}"]`)?.classList.add('active');

    const t = document.getElementById('topbar-titulo');
    if (t) t.textContent = TITULOS[vista] || vista;

    if (vista === 'inicio')       renderDashboard();
    if (vista === 'materias')     renderMisMaterias();
    if (vista === 'notas')        initVistaNotas();
    if (vista === 'horario')      initVistaHorario();
    if (vista === 'asistencias')  initVistaAsistencias();
    if (vista === 'reportes')     initVistaReportes();
    if (vista === 'expediente')   initVistaExpediente();
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
                <div class="dg-nombre">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</div>
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
            <div class="mc-grado">${gm.grados.nombre} ${gm.grados.modalidad} · Sección ${gm.grados.seccion}</div>
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

// ── MI HORARIO (solo lectura) ────────────────
async function initVistaHorario() {
    if (horarioDocenteCache === null) {
        await cargarHorarioDocente();
    } else {
        renderMiHorario();
    }
}

async function cargarHorarioDocente() {
    document.getElementById('mi-horario-grid').innerHTML = '<div class="empty-state">Cargando tu horario…</div>';
    try {
        const { data, error } = await supabase
            .from('horarios')
            .select('*, grados(id, nombre, seccion, modalidad), materias(id, nombre)')
            .eq('docente_id', usuarioActual.id);

        if (error && esErrorDeRed(error)) {
            mostrarBannerSinConexion(() => cargarHorarioDocente());
            return;
        }
        ocultarBannerSinConexion();
        if (error) return notificarError(error, 'Error cargando tu horario');

        horarioDocenteCache = data || [];
        renderMiHorario();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarHorarioDocente()); return; }
        notificarError(err, 'Error cargando tu horario');
    }
}

function renderMiHorario() {
    const cont = document.getElementById('mi-horario-grid');

    if (!horarioDocenteCache.length) {
        cont.innerHTML = '<div class="empty-state">Todavía no tenés clases asignadas en el horario. Contactá al administrador.</div>';
        return;
    }

    const porCelda = {};
    horarioDocenteCache.forEach(h => { porCelda[`${h.dia}-${h.periodo}`] = h; });

    let html = '<div class="hg-cell hg-head"></div>' +
        DIAS_HORARIO.map(d => `<div class="hg-cell hg-head">${d}</div>`).join('');

    BLOQUES_HORARIO.forEach(b => {
        if (b.tipo !== 'clase') {
            html += `<div class="hg-cell hg-periodo-label"><span class="hg-periodo-hora">${b.inicio}–${b.fin}</span></div>`;
            html += `<div class="hg-cell hg-bloqueado" style="grid-column:2 / -1">${b.label}</div>`;
            return;
        }
        html += `<div class="hg-cell hg-periodo-label"><span class="hg-periodo-num">P${b.periodo}</span><span class="hg-periodo-hora">${b.inicio}–${b.fin}</span></div>`;
        DIAS_HORARIO.forEach(dia => {
            const h = porCelda[`${dia}-${b.periodo}`];
            if (h) {
                html += `
                <div class="hg-cell hg-ocupada-wrap">
                    <div class="hg-ocupada" style="background:${colorPorMateria(h.materia_id)}">
                        <div class="hg-materia">${h.materias?.nombre || ''}</div>
                        <div class="hg-grado">${h.grados?.nombre || ''} ${h.grados?.modalidad || ''} · Sección ${h.grados?.seccion || ''}</div>
                    </div>
                </div>`;
            } else {
                html += '<div class="hg-cell hg-vacia"></div>';
            }
        });
    });

    cont.innerHTML = html;
}

window.imprimirMiHorario = () => {
    if (!usuarioActual) return;
    window.open(`./horario.html?docente=${usuarioActual.id}`, '_blank');
};

// ── ASISTENCIAS ───────────────────────────────
function fechaHoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mesActualISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Grados donde el docente puede tomar asistencia: los mismos donde tiene
// materia asignada o es guía (igual criterio que la RLS de `asistencias`).
function gradosAsistenciaDocente() {
    const todos = [...gradoMatCache.map(gm => gm.grados), ...gradosGuiaCache];
    return [...new Map(todos.map(g => [g.id, g])).values()];
}

function initVistaAsistencias() {
    const grados = gradosAsistenciaDocente();
    const empty = document.getElementById('asis-empty');
    const panel = document.getElementById('asis-panel');

    if (!grados.length) {
        empty.classList.remove('hidden');
        panel.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');
    panel.classList.remove('hidden');

    const opciones = grados.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</option>`).join('');

    const selGrado = document.getElementById('asis-grado');
    selGrado.innerHTML = opciones;
    if (!asisGradoId || !grados.find(g => g.id === asisGradoId)) asisGradoId = grados[0].id;
    selGrado.value = asisGradoId;

    if (!asisFecha) asisFecha = fechaHoyISO();
    document.getElementById('asis-fecha').value = asisFecha;

    const selRepGrado = document.getElementById('asis-rep-grado');
    selRepGrado.innerHTML = opciones;
    selRepGrado.value = asisGradoId;
    const inputMes = document.getElementById('asis-rep-mes');
    if (!inputMes.value) inputMes.value = mesActualISO();

    cargarAsistenciaDia();
}

window.cambiarGradoAsistencia = () => {
    asisGradoId = document.getElementById('asis-grado').value;
    document.getElementById('asis-rep-grado').value = asisGradoId;
    cargarAsistenciaDia();
};

window.cambiarFechaAsistencia = () => {
    asisFecha = document.getElementById('asis-fecha').value;
    cargarAsistenciaDia();
};

async function cargarAsistenciaDia() {
    if (!asisGradoId || !asisFecha) return;
    document.getElementById('lista-asistencia').innerHTML = '<div class="empty-state">Cargando…</div>';
    document.getElementById('asis-banner').classList.add('hidden');

    try {
        const { data: alumnos, error: eAl } = await supabase
            .from('alumnos')
            .select('*')
            .eq('grado_id', asisGradoId)
            .eq('activo', true)
            .order('apellidos');

        if (eAl && esErrorDeRed(eAl)) { mostrarBannerSinConexion(() => cargarAsistenciaDia()); return; }
        ocultarBannerSinConexion();
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');

        alumnosAsis = alumnos || [];
        asisCache = {};
        asisEdit = {};
        asisRegistroInfo = null;

        const alumnoIds = alumnosAsis.map(a => a.id);
        if (alumnoIds.length) {
            const { data: registros, error: eReg } = await supabase
                .from('asistencias')
                .select('*, usuarios(nombre_completo)')
                .in('alumno_id', alumnoIds)
                .eq('fecha', asisFecha);

            if (eReg) return notificarError(eReg, 'Error cargando la asistencia');

            (registros || []).forEach(r => { asisCache[r.alumno_id] = r; });
            const primero = (registros || [])[0];
            if (primero) asisRegistroInfo = { nombre: primero.usuarios?.nombre_completo || '—', hora: primero.hora_registro };
        }

        renderBannerAsistencia();
        renderListaAsistencia();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarAsistenciaDia()); return; }
        notificarError(err, 'Error cargando la asistencia');
    }
}

function renderBannerAsistencia() {
    const el = document.getElementById('asis-banner');
    if (!asisRegistroInfo) { el.classList.add('hidden'); return; }
    const hora = asisRegistroInfo.hora
        ? new Date(asisRegistroInfo.hora).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
        : '';
    el.innerHTML = `Asistencia registrada por <b>${asisRegistroInfo.nombre}</b>${hora ? ` a las ${hora}` : ''}. Podés editarla y volver a guardar.`;
    el.classList.remove('hidden');
}

function renderListaAsistencia() {
    const cont = document.getElementById('lista-asistencia');
    if (!alumnosAsis.length) {
        cont.innerHTML = '<div class="empty-state">Este grado no tiene alumnos activos.</div>';
        return;
    }

    cont.innerHTML = alumnosAsis.map((al, idx) => {
        const estado = asisEdit[al.id] || asisCache[al.id]?.estado || 'P';
        const pills = ESTADOS_ASISTENCIA.map(e => {
            const simbolo = e.codigo === 'P' ? '✓' : (e.codigo === 'A' ? '✗' : e.codigo);
            return `<button type="button" class="asis-pill asis-pill-${e.codigo} ${estado === e.codigo ? 'activo' : ''}"
                onclick="marcarAsistencia('${al.id}', '${e.codigo}')" title="${e.label}">${simbolo}</button>`;
        }).join('');

        return `
        <div class="asis-fila">
            <div class="asis-num">${idx + 1}</div>
            <div class="asis-nombre">${al.apellidos}, ${al.nombres}</div>
            <div class="asis-pills">${pills}</div>
        </div>`;
    }).join('');
}

window.marcarAsistencia = (alumnoId, estado) => {
    asisEdit[alumnoId] = estado;
    renderListaAsistencia();
};

window.guardarAsistencia = async () => {
    if (!asisGradoId || !asisFecha || !alumnosAsis.length) return;

    const btn = document.getElementById('btn-guardar-asistencia');
    setBotonCargando(btn, true);

    const horaRegistro = new Date().toISOString();
    const payload = alumnosAsis.map(al => ({
        alumno_id: al.id,
        grado_id: asisGradoId,
        fecha: asisFecha,
        estado: asisEdit[al.id] || asisCache[al.id]?.estado || 'P',
        registrado_por: usuarioActual.id,
        hora_registro: horaRegistro,
    }));

    const { error } = await supabase.from('asistencias').upsert(payload, { onConflict: 'alumno_id,fecha' });

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando la asistencia');

    mostrarToast('Asistencia guardada', 'exito');
    await cargarAsistenciaDia();
};

window.imprimirReporteAsistencia = () => {
    const gradoId = document.getElementById('asis-rep-grado').value;
    const mes = document.getElementById('asis-rep-mes').value;
    if (!gradoId || !mes) { mostrarToast('Seleccioná grado y mes', 'advertencia'); return; }
    window.open(`./asistencia-reporte.html?grado=${gradoId}&mes=${mes}`, '_blank');
};

window.imprimirListaBlancoAsistencia = () => {
    const gradoId = document.getElementById('asis-rep-grado').value;
    const mes = document.getElementById('asis-rep-mes').value;
    if (!gradoId || !mes) { mostrarToast('Seleccioná grado y mes', 'advertencia'); return; }
    window.open(`./asistencia-reporte.html?grado=${gradoId}&mes=${mes}&blanco=1`, '_blank');
};

// ── OTROS REPORTES ────────────────────────────
// El Reporte de Notas Finales muestra TODAS las materias del grado, pero la RLS
// de `notas` solo deja leer las del propio docente — las demás columnas salen en blanco.
function initVistaReportes() {
    const grados = gradosUnicosDocente();
    const opciones = '<option value="">— Seleccioná un grado —</option>' +
        grados.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</option>`).join('');

    document.getElementById('rep-notas-grado').innerHTML = opciones;
    document.getElementById('rep-act-grado').innerHTML = opciones;
    document.getElementById('rep-act-materia').innerHTML = '<option value="">— Elegí un grado primero —</option>';
}

window.imprimirReporteNotasDocente = () => {
    const gradoId = document.getElementById('rep-notas-grado').value;
    const periodo = document.getElementById('rep-notas-periodo').value;
    if (!gradoId) { mostrarToast('Seleccioná un grado', 'advertencia'); return; }
    window.open(`./reporte-notas.html?grado=${gradoId}&periodo=${periodo}`, '_blank');
};

window.cambiarGradoActividadesDocente = () => {
    const gradoId = document.getElementById('rep-act-grado').value;
    const selMateria = document.getElementById('rep-act-materia');
    if (!gradoId) { selMateria.innerHTML = '<option value="">— Elegí un grado primero —</option>'; return; }

    const materias = gradoMatCache.filter(gm => gm.grado_id === gradoId);
    selMateria.innerHTML = materias.length
        ? '<option value="">— Seleccioná una materia —</option>' + materias.map(gm => `<option value="${gm.id}">${gm.materias.nombre}</option>`).join('')
        : '<option value="">No tenés materias en este grado</option>';
};

window.imprimirListaActividadesDocente = () => {
    const gradoId = document.getElementById('rep-act-grado').value;
    const materiaId = document.getElementById('rep-act-materia').value;
    const periodo = document.getElementById('rep-act-periodo').value;
    const cotidianas = document.getElementById('rep-act-cotidianas').value || 0;
    const integradoras = document.getElementById('rep-act-integradoras').value || 0;
    const examenes = document.getElementById('rep-act-examenes').value || 0;
    if (!gradoId || !materiaId) { mostrarToast('Seleccioná grado y materia', 'advertencia'); return; }
    window.open(`./reporte-lista-actividades.html?grado=${gradoId}&materia=${materiaId}&periodo=${periodo}&cotidianas=${cotidianas}&integradoras=${integradoras}&examenes=${examenes}`, '_blank');
};

// ── EXPEDIENTE DISCIPLINARIO ──────────────────
// Selector de alumno: los mismos grados que Asistencias (materia asignada o guía).
async function initVistaExpediente() {
    const grados = gradosAsistenciaDocente();
    const empty = document.getElementById('exp-empty');
    const panel = document.getElementById('exp-panel');

    if (!grados.length) {
        empty.classList.remove('hidden');
        panel.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');
    panel.classList.remove('hidden');

    try {
        const gradoIds = grados.map(g => g.id);
        const { data, error } = await supabase
            .from('alumnos')
            .select('*')
            .in('grado_id', gradoIds)
            .eq('activo', true)
            .order('apellidos');

        if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => initVistaExpediente()); return; }
        ocultarBannerSinConexion();
        if (error) return notificarError(error, 'Error cargando alumnos');

        expAlumnos = data || [];
        const sel = document.getElementById('exp-alumno');
        sel.innerHTML = '<option value="">— Seleccioná un alumno —</option>' +
            expAlumnos.map(a => `<option value="${a.id}">${a.apellidos}, ${a.nombres}</option>`).join('');

        if (expAlumnoSel && expAlumnos.find(a => a.id === expAlumnoSel)) {
            sel.value = expAlumnoSel;
            window.cambiarAlumnoExpediente();
        } else {
            expAlumnoSel = null;
            document.getElementById('exp-detalle').classList.add('hidden');
        }
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => initVistaExpediente()); return; }
        notificarError(err, 'Error cargando alumnos');
    }
}

window.cambiarAlumnoExpediente = () => {
    expAlumnoSel = document.getElementById('exp-alumno').value;
    if (!expAlumnoSel) {
        document.getElementById('exp-detalle').classList.add('hidden');
        return;
    }

    const alumno = expAlumnos.find(a => a.id === expAlumnoSel);
    expEsGuia = gradosGuiaCache.some(g => g.id === alumno?.grado_id);

    document.getElementById('exp-detalle').classList.remove('hidden');
    document.getElementById('exp-timeline-wrap').classList.toggle('hidden', !expEsGuia);
    document.getElementById('exp-solo-registro-aviso').classList.toggle('hidden', expEsGuia);

    limpiarFormularioExpediente();
    if (expEsGuia) cargarTimelineExpediente(expAlumnoSel);
};

async function cargarTimelineExpediente(alumnoId) {
    document.getElementById('exp-timeline').innerHTML = '<div class="empty-state">Cargando…</div>';
    try {
        const [{ data: anec, error: e1 }, { data: dem, error: e2 }, { data: act, error: e3 }] = await Promise.all([
            supabase.from('anecdoticos').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('demeritos').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('actas').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
        ]);

        const errorDeRed = [e1, e2, e3].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => cargarTimelineExpediente(alumnoId)); return; }
        ocultarBannerSinConexion();
        if (e1) return notificarError(e1, 'Error cargando anecdóticos');
        if (e2) return notificarError(e2, 'Error cargando deméritos');
        if (e3) return notificarError(e3, 'Error cargando actas');

        expTimeline = [
            ...(anec || []).map(r => ({ ...r, tipoClave: 'anecdotico', registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(dem  || []).map(r => ({ ...r, tipoClave: `demerito_${r.categoria}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(act  || []).map(r => ({ ...r, tipoClave: r.tipo, registradoPor: r.usuarios?.nombre_completo || '—' })),
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        renderTimelineExpediente();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarTimelineExpediente(alumnoId)); return; }
        notificarError(err, 'Error cargando el expediente');
    }
}

function renderTimelineExpediente() {
    const cont = document.getElementById('exp-timeline');
    if (!expTimeline.length) {
        cont.innerHTML = '<div class="empty-state">Este alumno no tiene registros en su expediente todavía.</div>';
        return;
    }

    cont.innerHTML = expTimeline.map(r => {
        const info = TIPOS_EXPEDIENTE.find(t => t.clave === r.tipoClave) || {};
        const extra = r.tipoClave === 'suspension' && r.dias_suspension
            ? `<span class="exp-extra">${r.dias_suspension} día(s) de suspensión</span>` : '';
        return `
        <div class="exp-item" style="--exp-color:${info.color || '#64748b'};--exp-bg:${info.bg || '#f1f5f9'}">
            <div class="exp-item-icono">${info.icono || '•'}</div>
            <div class="exp-item-cuerpo">
                <div class="exp-item-cab">
                    <span class="exp-item-tipo">${info.label || r.tipoClave}</span>
                    <span class="exp-item-fecha">${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-SV')}</span>
                </div>
                <div class="exp-item-desc">${r.descripcion}</div>
                ${extra}
                <div class="exp-item-registro">Registrado por ${r.registradoPor}</div>
            </div>
        </div>`;
    }).join('');
}

window.cambiarTipoExpediente = () => {
    const tipo = document.getElementById('exp-tipo').value;
    document.getElementById('exp-campo-categoria').classList.toggle('hidden', tipo !== 'demerito');
    document.getElementById('exp-campo-dias').classList.toggle('hidden', tipo !== 'suspension');
};

function limpiarFormularioExpediente() {
    document.getElementById('exp-tipo').value = 'anecdotico';
    document.getElementById('exp-categoria').value = 'leve';
    document.getElementById('exp-dias').value = 1;
    document.getElementById('exp-descripcion').value = '';
    window.cambiarTipoExpediente();
}

window.guardarRegistroExpediente = async () => {
    if (!expAlumnoSel) { mostrarToast('Seleccioná un alumno primero', 'advertencia'); return; }

    const tipo = document.getElementById('exp-tipo').value;
    const descripcion = document.getElementById('exp-descripcion').value.trim();
    if (!descripcion) { mostrarToast('Escribí una descripción', 'advertencia'); return; }

    const btn = document.getElementById('btn-guardar-expediente');
    setBotonCargando(btn, true);

    let error;
    if (tipo === 'anecdotico') {
        ({ error } = await supabase.from('anecdoticos').insert([{ alumno_id: expAlumnoSel, docente_id: usuarioActual.id, descripcion }]));
    } else if (tipo === 'demerito') {
        const categoria = document.getElementById('exp-categoria').value;
        ({ error } = await supabase.from('demeritos').insert([{ alumno_id: expAlumnoSel, docente_id: usuarioActual.id, categoria, descripcion }]));
    } else {
        // acta | suspension | reconocimiento
        const dias = tipo === 'suspension' ? (parseInt(document.getElementById('exp-dias').value, 10) || 0) : 0;
        ({ error } = await supabase.from('actas').insert([{ alumno_id: expAlumnoSel, registrado_por: usuarioActual.id, tipo, dias_suspension: dias, descripcion }]));
    }

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el registro');

    mostrarToast('Registro guardado', 'exito');
    limpiarFormularioExpediente();
    if (expEsGuia) await cargarTimelineExpediente(expAlumnoSel);
};

// ── REGISTRO DE NOTAS ────────────────────────
function poblarSelectGradoNotas() {
    const sel = document.getElementById('notas-grado');
    sel.innerHTML = gradosUnicosDocente().map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</option>`).join('');
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

    const btn = document.getElementById('btn-generar-tabla');
    setBotonCargando(btn, true, 'Generando...');

    const { data, error } = await supabase
        .from('criterios_evaluacion')
        .upsert([{ grado_materia_id: notasMateriaId, periodo: periodoActual, cotidianas, integradoras, examenes }], { onConflict: 'grado_materia_id,periodo' })
        .select()
        .single();

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando criterios');

    criteriosActuales = data;
    mostrarPanelConfig(false);
    await cargarAlumnosYNotas();
};

async function cargarAlumnosYNotas() {
    renderSkeletonFilas('tbody-notas', 8, 5);

    const { data: alumnos, error } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', notasGradoId)
        .eq('activo', true)
        .order('apellidos');

    if (error) { notificarError(error, 'Error cargando alumnos'); return; }

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

function combinarNotasPesos(notas, pesos) {
    return notas.map((nota, i) => ({ nota, peso: pesos[i] }));
}

// promCotRaw/promIntRaw/promExaRaw = promedio ponderado de la categoría (para mostrar en la tabla)
// promCot/promInt/promExa = esos mismos promedios ya multiplicados por 35/35/30 (para guardar en BD)
// nf = fórmula IDSJE 35/35/30 (src/js/utils.js#calcularNotaFinal)
function calcularResumen(det) {
    const promCotRaw = promedioPonderado(combinarNotasPesos(det.cotidianas,   pesosActuales.cotidianas));
    const promIntRaw = promedioPonderado(combinarNotasPesos(det.integradoras, pesosActuales.integradoras));
    const promExaRaw = promedioPonderado(combinarNotasPesos(det.examenes,     pesosActuales.examenes));
    const promCot = promCotRaw * 0.35;
    const promInt = promIntRaw * 0.35;
    const promExa = promExaRaw * 0.30;
    const nf = calcularNotaFinal(promCotRaw, promIntRaw, promExaRaw);
    return { promCotRaw, promIntRaw, promExaRaw, promCot, promInt, promExa, nf };
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
                        onchange="actualizarPesoLocal('${grupo.clave}', ${i}, this.value)">%
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
    pesosActuales[grupo] = redistribuirPesos(pesosActuales[grupo], idx, valor);

    pesosActuales[grupo].forEach((p, i) => {
        document.querySelectorAll(`.detalle-peso-input[data-grupo="${grupo}"][data-idx="${i}"]`).forEach(inp => {
            if (inp !== document.activeElement) inp.value = p;
        });
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
    if (!notasGradoId || !notasMateriaId || !criteriosActuales) return mostrarToast('Generá la tabla primero', 'advertencia');
    if (!alumnosNotas.length) return;

    const btn = document.getElementById('btn-guardar-notas');
    setBotonCargando(btn, true);

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

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando notas');

    (data || []).forEach(n => { notasCache[n.alumno_id] = n; });
    notasRecEdit = {};
    renderTablaNotas();
    mostrarToast('Notas guardadas correctamente', 'exito');
};

// ── COMPETENCIAS CIUDADANAS ──────────────────
function poblarSelectGradoComp() {
    const sel = document.getElementById('comp-grado');
    sel.innerHTML = gradosGuiaCache.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</option>`).join('');
}

function initVistaCompetencias() {
    if (!puedeAccederCompetencias(gradosGuiaCache)) {
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
    renderSkeletonFilas('tbody-comp', 8, 5);

    const { data: alumnos, error } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', compGradoId)
        .eq('activo', true)
        .order('apellidos');

    if (error) { notificarError(error, 'Error cargando alumnos'); return; }

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

    const btn = document.getElementById('btn-guardar-competencias');
    setBotonCargando(btn, true);

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

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando competencias');

    compEdit = {};
    await cargarAlumnosComp();
    mostrarToast('Competencias guardadas correctamente', 'exito');
};

window.cerrarSesionDocente = cerrarSesion;

init();
