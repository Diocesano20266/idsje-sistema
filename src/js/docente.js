// ═══════════════════════════════════════════
//  IDSJE — Panel Docente
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion } from './auth.js';
import { CONCEPTOS, ESTADOS_ASISTENCIA, TIPOS_EXPEDIENTE, CODIGOS_DEMERITO, NIVELES_DEMERITO, TIPOS_AMONESTACION, TIPOS_RECONOCIMIENTO, getAñoActivo } from './config.js';
import {
    calcularNotaFinal,
    promedioPonderado,
    sumaPesos,
    pesosEquitativos,
    aplicarPesoMinimo,
    redistribuirPesos,
    colorEscala,
    puedeAccederCompetencias,
    contarDemeritosActivos,
    calcularNivelDemerito,
    mostrarToast,
    notificarError,
    esErrorDeRed,
    mostrarBannerSinConexion,
    ocultarBannerSinConexion,
    setBotonCargando,
    renderSkeletonFilas,
} from './utils.js';

let usuarioActual   = null;
let gradoMatCache   = [];  // grado_materia asignadas al docente (con grados y materias embebidos)
let gradosGuiaCache = [];  // grados donde el docente es guía (docente_guia_id)
let alumnosPorGrado = {};  // conteo de alumnos matriculados (año activo) por grado_id
let anioActivoCache = null; // fila de `años_academicos` con activo=true, o null si no hay ninguno configurado

// Deméritos (mismo patrón grado → alumnos → historial que el resto de los
// módulos de disciplina, sin redención — eso es solo admin).
let demAlumnos       = [];   // alumnos del grado elegido
let demAlumnoSel     = null;
let demDrawerDemeritos = []; // deméritos del alumno elegido (para el modal "+ Nuevo Demérito")

// Anecdóticos / Amonestaciones / Reconocimientos — mismo patrón grado →
// alumnos → historial + "+ Nuevo", nunca editable ni eliminable.
let estadoModulos = {
    anecdoticos:     { alumnos: [], alumnoSel: null },
    amonestaciones:  { alumnos: [], alumnoSel: null },
    reconocimientos: { alumnos: [], alumnoSel: null },
};

// Expediente (SOLO LECTURA — mezcla los 4 módulos de arriba). Solo tiene
// datos para grados donde el docente es guía (RLS de guia_lee_* así lo exige).
let expAlumnos   = []; // alumnos del grado elegido (dentro de gradosGuiaCache)
let expAlumnoSel = null;
let expTimeline  = [];

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
        anioActivoCache = await getAñoActivo(supabase);
        renderAnioActivoHeaderDocente();

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

        // Conteo de alumnos MATRICULADOS en el año activo (ya no se puede leer
        // alumnos.grado_id/activo directamente — ver supabase/migracion-años.sql).
        alumnosPorGrado = {};
        if (gradoIds.length && anioActivoCache) {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('grado_id')
                .eq('año_academico_id', anioActivoCache.id)
                .eq('activo', true)
                .in('grado_id', gradoIds);
            (matriculas || []).forEach(m => { alumnosPorGrado[m.grado_id] = (alumnosPorGrado[m.grado_id] || 0) + 1; });
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

// Muestra el año académico activo (o una advertencia si no hay ninguno) en
// el header del panel docente — ver docente.html (#anio-activo-badge-docente).
function renderAnioActivoHeaderDocente() {
    const el = document.getElementById('anio-activo-badge-docente');
    if (!el) return;
    el.textContent = anioActivoCache ? `Año ${anioActivoCache.anio}` : '⚠ Sin año activo';
    el.classList.toggle('anio-badge-alerta', !anioActivoCache);
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
    asistencias: 'Asistencias',
    reportes: 'Reportes',
    demeritos: 'Deméritos',
    anecdoticos: 'Anecdóticos',
    amonestaciones: 'Amonestaciones',
    reconocimientos: 'Reconocimientos',
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
    if (vista === 'asistencias')  initVistaAsistencias();
    if (vista === 'reportes')     initVistaReportes();
    if (vista === 'demeritos')    renderVistaDemeritoDocente();
    if (vista === 'anecdoticos')  renderVistaModulo('anecdoticos');
    if (vista === 'amonestaciones') renderVistaModulo('amonestaciones');
    if (vista === 'reconocimientos') renderVistaModulo('reconocimientos');
    if (vista === 'expediente')   renderVistaExpedienteDocente();
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

    if (!anioActivoCache) {
        document.getElementById('lista-asistencia').innerHTML = '<div class="info-box">⚠ No hay un año académico activo configurado.</div>';
        return;
    }

    try {
        const { data: matriculas, error: eAl } = await supabase
            .from('matriculas')
            .select('*, alumnos(*)')
            .eq('grado_id', asisGradoId)
            .eq('año_academico_id', anioActivoCache.id)
            .eq('activo', true);

        if (eAl && esErrorDeRed(eAl)) { mostrarBannerSinConexion(() => cargarAsistenciaDia()); return; }
        ocultarBannerSinConexion();
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');

        alumnosAsis = (matriculas || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));
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

// ── DISCIPLINA — helpers compartidos ─────────
// Los 5 módulos (Deméritos, Anecdóticos, Amonestaciones, Reconocimientos,
// Expediente) navegan "elegir grado → ver sus alumnos matriculados este
// año" de la misma forma. Deméritos/Anecdóticos/Amonestaciones/
// Reconocimientos usan gradosAsistenciaDocente() (materia O guía — puede
// registrar); Expediente usa gradosGuiaCache (SOLO guía — es lectura del
// historial, y la RLS de guia_lee_* solo deja leer si sos guía).
function poblarSelectGradosDocente(selectId, grados, valorActual) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccioná un grado —</option>' +
        grados.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} · Sección ${g.seccion}</option>`).join('');
    sel.value = valorActual || '';
}

async function obtenerAlumnosDeGradoDocente(gradoId) {
    if (!anioActivoCache || !gradoId) return [];
    const { data, error } = await supabase
        .from('matriculas')
        .select('*, alumnos(*)')
        .eq('grado_id', gradoId)
        .eq('año_academico_id', anioActivoCache.id)
        .eq('activo', true);
    if (error) throw error;
    return (data || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));
}

function filaAlumnoClicableDocente(a, onclickJs) {
    return `
        <div class="exp-resultado-item" onclick="${onclickJs}">
            <div style="display:flex;align-items:center;gap:10px">
                ${a.foto_url
                    ? `<img src="${a.foto_url}" class="foto-mini" alt="${a.apellidos}">`
                    : '<div class="foto-mini foto-placeholder">?</div>'}
                <span>${a.apellidos}, ${a.nombres}</span>
            </div>
            <span class="text-muted">NIE ${a.nie || '—'}</span>
        </div>`;
}

// ── DEMÉRITOS (docente) ───────────────────────
// Igual patrón que el admin (grado → alumnos → historial + "+ Nuevo
// Demérito"), SIN redención — eso es solo admin (la RLS de `demeritos`
// tampoco le da UPDATE al docente, así que queda reforzado en la base).
function renderVistaDemeritoDocente() {
    const grados = gradosAsistenciaDocente();
    const empty = document.getElementById('dem-empty');
    const panel = document.getElementById('dem-panel');
    if (!grados.length) { empty.classList.remove('hidden'); panel.classList.add('hidden'); return; }
    empty.classList.add('hidden');
    panel.classList.remove('hidden');

    poblarSelectGradosDocente('dem-grado', grados);
    demAlumnoSel = null;
    document.getElementById('dem-detalle').classList.add('hidden');
    document.getElementById('dem-lista-wrap').classList.remove('hidden');
    document.getElementById('dem-lista-alumnos').innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>';
}

window.cambiarGradoDemeritoDocente = async () => {
    const gradoId = document.getElementById('dem-grado').value || null;
    demAlumnoSel = null;
    document.getElementById('dem-detalle').classList.add('hidden');
    document.getElementById('dem-lista-wrap').classList.remove('hidden');
    const cont = document.getElementById('dem-lista-alumnos');
    if (!gradoId) { cont.innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>'; return; }
    cont.innerHTML = '<div class="empty-state">Cargando…</div>';

    try {
        demAlumnos = await obtenerAlumnosDeGradoDocente(gradoId);
        if (!demAlumnos.length) { cont.innerHTML = '<div class="empty-state">Este grado no tiene alumnos matriculados.</div>'; return; }
        cont.innerHTML = demAlumnos.map(a => filaAlumnoClicableDocente(a, `seleccionarAlumnoDemeritoDocente('${a.id}')`)).join('');
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => window.cambiarGradoDemeritoDocente()); return; }
        notificarError(err, 'Error cargando alumnos del grado');
    }
};

window.volverListaDemeritoDocente = () => {
    demAlumnoSel = null;
    document.getElementById('dem-detalle').classList.add('hidden');
    document.getElementById('dem-lista-wrap').classList.remove('hidden');
};

window.seleccionarAlumnoDemeritoDocente = async (alumnoId) => {
    demAlumnoSel = alumnoId;
    const alumno = demAlumnos.find(a => a.id === alumnoId);
    document.getElementById('dem-lista-wrap').classList.add('hidden');
    document.getElementById('dem-detalle').classList.remove('hidden');
    document.getElementById('dem-nombre').textContent = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    await cargarDrawerDemeritoDocente(alumnoId);
};

async function cargarDrawerDemeritoDocente(alumnoId) {
    const cont = document.getElementById('dem-drawer-content');
    cont.innerHTML = '<div class="empty-state">Cargando…</div>';

    // Dos FKs a `usuarios` (docente_id / redimido_por) obligan a nombrar la FK.
    const { data, error } = await supabase
        .from('demeritos')
        .select('*, docente:usuarios!demeritos_docente_id_fkey(nombre_completo)')
        .eq('alumno_id', alumnoId)
        .order('fecha', { ascending: false });

    if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => cargarDrawerDemeritoDocente(alumnoId)); return; }
    ocultarBannerSinConexion();
    if (error) return notificarError(error, 'Error cargando el historial de deméritos');

    demDrawerDemeritos = data || [];
    const activos = contarDemeritosActivos(demDrawerDemeritos);
    const infoNivel = NIVELES_DEMERITO.find(n => n.clave === calcularNivelDemerito(activos));
    const badgeNivel = infoNivel
        ? `<span class="badge" style="background:${infoNivel.bg};color:${infoNivel.color}">${infoNivel.icono} ${infoNivel.label}</span>`
        : `<span class="badge" style="background:#e8fdf0;color:#1a7a40">Sin nivel activo</span>`;

    const filas = demDrawerDemeritos.length
        ? demDrawerDemeritos.map(d => {
            const cod = CODIGOS_DEMERITO.find(c => c.codigo === d.codigo);
            const tituloFalta = d.codigo
                ? `Código ${d.codigo}${cod ? ' — ' + cod.descripcion : ''}`
                : (d.categoria ? `Demérito (${d.categoria})` : 'Demérito');
            const redimidoInfo = d.redimido
                ? `<span class="exp-extra" style="color:#1a7a40;background:#e8fdf0">✓ Redimido${d.fecha_redencion ? ' el ' + new Date(d.fecha_redencion + 'T00:00:00').toLocaleDateString('es-SV') : ''}</span>`
                : '';
            return `
            <div class="exp-item" style="--exp-color:${d.redimido ? '#94a3b8' : '#d97706'};--exp-bg:${d.redimido ? '#f1f5f9' : '#fef3c7'}${d.redimido ? ';opacity:.6' : ''}">
                <div class="exp-item-icono">${d.codigo || '•'}</div>
                <div class="exp-item-cuerpo">
                    <div class="exp-item-cab">
                        <span class="exp-item-tipo" style="${d.redimido ? 'text-decoration:line-through' : ''}">${tituloFalta}</span>
                        <span class="exp-item-fecha">${new Date(d.fecha + 'T00:00:00').toLocaleDateString('es-SV')}</span>
                    </div>
                    ${d.descripcion ? `<div class="exp-item-desc">${d.descripcion}</div>` : ''}
                    ${redimidoInfo}
                    <div class="exp-item-registro">Registrado por ${d.docente?.nombre_completo || '—'}</div>
                </div>
            </div>`;
        }).join('')
        : '<div class="empty-state">Este alumno no tiene deméritos registrados.</div>';

    cont.innerHTML = `
        <div class="exp-stats" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
            <div class="exp-stat" style="background:#fff;border-radius:10px;border:1px solid #e2e8f0;padding:14px;text-align:center">
                <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:${infoNivel?.color || '#1a7a40'}">${activos}</div>
                <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;margin-top:2px">Deméritos activos</div>
            </div>
            <div style="background:#fff;border-radius:10px;border:1px solid #e2e8f0;padding:14px;display:flex;align-items:center;justify-content:center">${badgeNivel}</div>
        </div>
        <div class="exp-timeline">${filas}</div>
    `;
}

window.abrirModalNuevoDemeritoDocente = () => {
    if (!demAlumnoSel) return;
    document.getElementById('nd-alumno-id').value = demAlumnoSel;
    document.getElementById('nd-codigo').value = 'A';
    document.getElementById('nd-descripcion').value = '';
    document.getElementById('nd-fecha').value = new Date().toISOString().slice(0, 10);
    abrirModal('modal-nuevo-demerito');
};

window.guardarNuevoDemeritoDocente = async () => {
    const alumnoId = document.getElementById('nd-alumno-id').value;
    const codigo = document.getElementById('nd-codigo').value;
    const descripcion = document.getElementById('nd-descripcion').value.trim();
    const fecha = document.getElementById('nd-fecha').value || undefined;

    const btn = document.getElementById('btn-guardar-nuevo-demerito');
    setBotonCargando(btn, true);

    const { error } = await supabase.from('demeritos')
        .insert([{ alumno_id: alumnoId, docente_id: usuarioActual.id, codigo, descripcion, ...(fecha ? { fecha } : {}) }]);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el demérito');

    mostrarToast('Demérito registrado', 'exito');
    cerrarModal('modal-nuevo-demerito');
    await cargarDrawerDemeritoDocente(alumnoId);
};

// ── ANECDÓTICOS / AMONESTACIONES / RECONOCIMIENTOS (docente) ──
// Mismo patrón grado → alumnos → historial + "+ Nuevo". Nunca editable ni
// eliminable (registro permanente).
const MODULOS_SIMPLES = {
    anecdoticos: {
        tabla: 'anecdoticos', prefijo: 'anec', campoRegistrador: 'docente_id',
        tipos: null, tieneDias: false, tituloNuevo: 'Nuevo Anecdótico', claveBase: 'anecdotico',
    },
    amonestaciones: {
        tabla: 'amonestaciones', prefijo: 'amon', campoRegistrador: 'registrado_por',
        tipos: TIPOS_AMONESTACION, tieneDias: true, tituloNuevo: 'Nueva Amonestación', claveBase: 'amonestacion',
    },
    reconocimientos: {
        tabla: 'reconocimientos', prefijo: 'reco', campoRegistrador: 'registrado_por',
        tipos: TIPOS_RECONOCIMIENTO, tieneDias: false, tituloNuevo: 'Nuevo Reconocimiento', claveBase: 'reconocimiento',
    },
};

function renderVistaModulo(clave) {
    const cfg = MODULOS_SIMPLES[clave];
    poblarSelectGradosDocente(`${cfg.prefijo}-grado`, gradosAsistenciaDocente());
    document.getElementById(`${cfg.prefijo}-detalle`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.remove('hidden');
    estadoModulos[clave].alumnoSel = null;
    document.getElementById(`${cfg.prefijo}-lista-alumnos`).innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>';
}

window.cambiarGradoModulo = async (clave) => {
    const cfg = MODULOS_SIMPLES[clave];
    const gradoId = document.getElementById(`${cfg.prefijo}-grado`).value || null;
    document.getElementById(`${cfg.prefijo}-detalle`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.remove('hidden');
    const cont = document.getElementById(`${cfg.prefijo}-lista-alumnos`);

    if (!gradoId) { cont.innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>'; return; }
    cont.innerHTML = '<div class="empty-state">Cargando…</div>';

    try {
        const alumnos = await obtenerAlumnosDeGradoDocente(gradoId);
        estadoModulos[clave].alumnos = alumnos;
        if (!alumnos.length) { cont.innerHTML = '<div class="empty-state">Este grado no tiene alumnos matriculados.</div>'; return; }
        cont.innerHTML = alumnos.map(a => filaAlumnoClicableDocente(a, `seleccionarAlumnoModulo('${clave}','${a.id}')`)).join('');
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => window.cambiarGradoModulo(clave)); return; }
        notificarError(err, 'Error cargando alumnos del grado');
    }
};

window.volverListaModulo = (clave) => {
    const cfg = MODULOS_SIMPLES[clave];
    estadoModulos[clave].alumnoSel = null;
    document.getElementById(`${cfg.prefijo}-detalle`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.remove('hidden');
};

window.seleccionarAlumnoModulo = async (clave, alumnoId) => {
    const cfg = MODULOS_SIMPLES[clave];
    estadoModulos[clave].alumnoSel = alumnoId;
    const alumno = estadoModulos[clave].alumnos.find(a => a.id === alumnoId);
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-detalle`).classList.remove('hidden');
    document.getElementById(`${cfg.prefijo}-nombre`).textContent = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    await cargarTimelineModulo(clave, alumnoId);
};

async function cargarTimelineModulo(clave, alumnoId) {
    const cfg = MODULOS_SIMPLES[clave];
    const cont = document.getElementById(`${cfg.prefijo}-timeline`);
    cont.innerHTML = '<div class="empty-state">Cargando…</div>';

    const { data, error } = await supabase
        .from(cfg.tabla)
        .select(`*, usuarios:usuarios!${cfg.tabla}_${cfg.campoRegistrador}_fkey(nombre_completo)`)
        .eq('alumno_id', alumnoId)
        .order('fecha', { ascending: false });

    if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => cargarTimelineModulo(clave, alumnoId)); return; }
    ocultarBannerSinConexion();
    if (error) return notificarError(error, 'Error cargando el historial');

    if (!data || !data.length) { cont.innerHTML = '<div class="empty-state">Sin registros todavía.</div>'; return; }

    cont.innerHTML = data.map(r => {
        const tipoClave = cfg.tipos ? `${cfg.claveBase}_${r.tipo}` : cfg.claveBase;
        const info = TIPOS_EXPEDIENTE.find(t => t.clave === tipoClave) || {};
        const extra = cfg.tieneDias && r.tipo === 'suspension' && r.dias_suspension
            ? `<span class="exp-extra">${r.dias_suspension} día(s) de suspensión</span>` : '';
        return `
        <div class="exp-item" style="--exp-color:${info.color || '#64748b'};--exp-bg:${info.bg || '#f1f5f9'}">
            <div class="exp-item-icono">${info.icono || '•'}</div>
            <div class="exp-item-cuerpo">
                <div class="exp-item-cab">
                    <span class="exp-item-tipo">${info.label || tipoClave}</span>
                    <span class="exp-item-fecha">${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-SV')}</span>
                </div>
                <div class="exp-item-desc">${r.descripcion}</div>
                ${extra}
                <div class="exp-item-registro">Registrado por ${r.usuarios?.nombre_completo || '—'}</div>
            </div>
        </div>`;
    }).join('');
}

window.abrirModalNuevoRegistro = (clave) => {
    const cfg = MODULOS_SIMPLES[clave];
    const alumnoId = estadoModulos[clave].alumnoSel;
    if (!alumnoId) return;

    document.getElementById('mnr-modulo').value = clave;
    document.getElementById('mnr-alumno-id').value = alumnoId;
    document.getElementById('mnr-title').textContent = cfg.tituloNuevo;
    document.getElementById('mnr-descripcion').value = '';
    document.getElementById('mnr-fecha').value = new Date().toISOString().slice(0, 10);

    const campoTipo = document.getElementById('mnr-campo-tipo');
    const selTipo = document.getElementById('mnr-tipo');
    if (cfg.tipos) {
        campoTipo.classList.remove('hidden');
        selTipo.innerHTML = cfg.tipos.map(t => `<option value="${t.clave}">${t.label}</option>`).join('');
        selTipo.value = cfg.tipos[0].clave;
    } else {
        campoTipo.classList.add('hidden');
    }
    window.cambiarTipoModalNuevoRegistro();
    abrirModal('modal-nuevo-registro');
};

window.cambiarTipoModalNuevoRegistro = () => {
    const clave = document.getElementById('mnr-modulo').value;
    const cfg = MODULOS_SIMPLES[clave];
    const tipoVal = document.getElementById('mnr-tipo').value;
    document.getElementById('mnr-campo-dias').classList.toggle('hidden', !(cfg?.tieneDias && tipoVal === 'suspension'));
};

window.guardarNuevoRegistroModulo = async () => {
    const clave = document.getElementById('mnr-modulo').value;
    const cfg = MODULOS_SIMPLES[clave];
    const alumnoId = document.getElementById('mnr-alumno-id').value;
    const descripcion = document.getElementById('mnr-descripcion').value.trim();
    const fecha = document.getElementById('mnr-fecha').value || undefined;
    if (!descripcion) { mostrarToast('Escribí una descripción', 'advertencia'); return; }

    const payload = { alumno_id: alumnoId, [cfg.campoRegistrador]: usuarioActual.id, descripcion, ...(fecha ? { fecha } : {}) };
    if (cfg.tipos) {
        const tipo = document.getElementById('mnr-tipo').value;
        payload.tipo = tipo;
        if (cfg.tieneDias) payload.dias_suspension = tipo === 'suspension' ? (parseInt(document.getElementById('mnr-dias').value, 10) || 0) : 0;
    }

    const btn = document.getElementById('btn-guardar-mnr');
    setBotonCargando(btn, true);
    const { error } = await supabase.from(cfg.tabla).insert([payload]);
    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el registro');

    mostrarToast('Registro guardado', 'exito');
    cerrarModal('modal-nuevo-registro');
    await cargarTimelineModulo(clave, alumnoId);
};

// ── EXPEDIENTE (docente, SOLO LECTURA) ────────
// Solo tiene sentido para grados donde el docente es guía: la RLS de
// guia_lee_anecdoticos/demeritos/amonestaciones/reconocimientos únicamente
// deja leer si sos guía del grado del alumno, así que el selector de grado
// se limita directo a gradosGuiaCache (no gradosAsistenciaDocente()).
function renderVistaExpedienteDocente() {
    const empty = document.getElementById('exp-empty');
    const panel = document.getElementById('exp-panel');
    if (!gradosGuiaCache.length) { empty.classList.remove('hidden'); panel.classList.add('hidden'); return; }
    empty.classList.add('hidden');
    panel.classList.remove('hidden');

    poblarSelectGradosDocente('exp-grado', gradosGuiaCache);
    expAlumnoSel = null;
    document.getElementById('exp-detalle').classList.add('hidden');
    document.getElementById('exp-lista-wrap').classList.remove('hidden');
    document.getElementById('exp-lista-alumnos').innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>';
}

window.cambiarGradoExpedienteDocente = async () => {
    const gradoId = document.getElementById('exp-grado').value || null;
    expAlumnoSel = null;
    document.getElementById('exp-detalle').classList.add('hidden');
    document.getElementById('exp-lista-wrap').classList.remove('hidden');
    const cont = document.getElementById('exp-lista-alumnos');
    if (!gradoId) { cont.innerHTML = '<div class="empty-state">Seleccioná un grado para ver sus alumnos.</div>'; return; }
    cont.innerHTML = '<div class="empty-state">Cargando…</div>';

    try {
        expAlumnos = await obtenerAlumnosDeGradoDocente(gradoId);
        if (!expAlumnos.length) { cont.innerHTML = '<div class="empty-state">Este grado no tiene alumnos matriculados.</div>'; return; }
        cont.innerHTML = expAlumnos.map(a => filaAlumnoClicableDocente(a, `seleccionarAlumnoExpedienteDocente('${a.id}')`)).join('');
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => window.cambiarGradoExpedienteDocente()); return; }
        notificarError(err, 'Error cargando alumnos del grado');
    }
};

window.volverListaExpedienteDocente = () => {
    expAlumnoSel = null;
    document.getElementById('exp-detalle').classList.add('hidden');
    document.getElementById('exp-lista-wrap').classList.remove('hidden');
};

window.seleccionarAlumnoExpedienteDocente = (alumnoId) => {
    expAlumnoSel = alumnoId;
    const alumno = expAlumnos.find(a => a.id === alumnoId);
    document.getElementById('exp-lista-wrap').classList.add('hidden');
    document.getElementById('exp-detalle').classList.remove('hidden');
    document.getElementById('exp-nombre').textContent = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    const filtroTipo = document.getElementById('exp-filtro-tipo');
    if (filtroTipo) filtroTipo.value = '';
    cargarExpedienteDocente(alumnoId);
};

async function cargarExpedienteDocente(alumnoId) {
    document.getElementById('exp-timeline').innerHTML = '<div class="empty-state">Cargando…</div>';
    try {
        const [
            { data: anec, error: e1 },
            { data: dem,  error: e2 },
            { data: amon, error: e3 },
            { data: reco, error: e4 },
        ] = await Promise.all([
            supabase.from('anecdoticos').select('*, usuarios:usuarios!anecdoticos_docente_id_fkey(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('demeritos').select('*, usuarios:usuarios!demeritos_docente_id_fkey(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('amonestaciones').select('*, usuarios:usuarios!amonestaciones_registrado_por_fkey(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('reconocimientos').select('*, usuarios:usuarios!reconocimientos_registrado_por_fkey(nombre_completo)').eq('alumno_id', alumnoId),
        ]);

        const errorDeRed = [e1, e2, e3, e4].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => cargarExpedienteDocente(alumnoId)); return; }
        ocultarBannerSinConexion();
        if (e1) return notificarError(e1, 'Error cargando anecdóticos');
        if (e2) return notificarError(e2, 'Error cargando deméritos');
        if (e3) return notificarError(e3, 'Error cargando amonestaciones');
        if (e4) return notificarError(e4, 'Error cargando reconocimientos');

        expTimeline = [
            ...(anec || []).map(r => ({ ...r, tabla: 'anecdoticos', tipoClave: 'anecdotico', registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(dem  || []).map(r => ({ ...r, tabla: 'demeritos', tipoClave: `demerito_${r.codigo || r.categoria}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(amon || []).map(r => ({ ...r, tabla: 'amonestaciones', tipoClave: `amonestacion_${r.tipo}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(reco || []).map(r => ({ ...r, tabla: 'reconocimientos', tipoClave: `reconocimiento_${r.tipo}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        renderTimelineExpedienteDocente();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarExpedienteDocente(alumnoId)); return; }
        notificarError(err, 'Error cargando el expediente');
    }
}

function renderTimelineExpedienteDocente() {
    const cont = document.getElementById('exp-timeline');
    const filtro = document.getElementById('exp-filtro-tipo')?.value || '';
    const filas = filtro ? expTimeline.filter(r => r.tabla === filtro) : expTimeline;

    if (!filas.length) {
        cont.innerHTML = '<div class="empty-state">Este alumno no tiene registros en su expediente todavía.</div>';
        return;
    }

    cont.innerHTML = filas.map(r => {
        const info = TIPOS_EXPEDIENTE.find(t => t.clave === r.tipoClave) || {};
        const esRedimido = r.tabla === 'demeritos' && r.redimido;
        const extraDias = r.tabla === 'amonestaciones' && r.tipo === 'suspension' && r.dias_suspension
            ? `<span class="exp-extra">${r.dias_suspension} día(s) de suspensión</span>` : '';
        const extraRedimido = esRedimido
            ? `<span class="exp-extra" style="color:#1a7a40;background:#e8fdf0">✓ Redimido${r.fecha_redencion ? ' el ' + new Date(r.fecha_redencion + 'T00:00:00').toLocaleDateString('es-SV') : ''}</span>`
            : '';
        return `
        <div class="exp-item" style="--exp-color:${info.color || '#64748b'};--exp-bg:${info.bg || '#f1f5f9'}${esRedimido ? ';opacity:.6' : ''}">
            <div class="exp-item-icono">${info.icono || '•'}</div>
            <div class="exp-item-cuerpo">
                <div class="exp-item-cab">
                    <span class="exp-item-tipo" style="${esRedimido ? 'text-decoration:line-through' : ''}">${info.label || r.tipoClave}</span>
                    <span class="exp-item-fecha">${new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-SV')}</span>
                </div>
                <div class="exp-item-desc">${r.descripcion || ''}</div>
                ${extraDias}${extraRedimido}
                <div class="exp-item-registro">Registrado por ${r.registradoPor}</div>
            </div>
        </div>`;
    }).join('');
}

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

    if (!anioActivoCache) { notificarError({ message: 'No hay un año académico activo' }, 'Error'); return; }

    const { data: matriculas, error } = await supabase
        .from('matriculas')
        .select('*, alumnos(*)')
        .eq('grado_id', notasGradoId)
        .eq('año_academico_id', anioActivoCache.id)
        .eq('activo', true);

    if (error) { notificarError(error, 'Error cargando alumnos'); return; }

    alumnosNotas = (matriculas || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

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

    if (!anioActivoCache) { notificarError({ message: 'No hay un año académico activo' }, 'Error'); return; }

    const { data: matriculas, error } = await supabase
        .from('matriculas')
        .select('*, alumnos(*)')
        .eq('grado_id', compGradoId)
        .eq('año_academico_id', anioActivoCache.id)
        .eq('activo', true);

    const alumnos = (matriculas || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

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

// ── MODALES ("+ Nuevo Demérito" / "+ Nuevo Registro") ──
window.abrirModal  = (id) => document.getElementById(id).classList.add('open');
window.cerrarModal = (id) => document.getElementById(id).classList.remove('open');
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

window.cerrarSesionDocente = cerrarSesion;

init();
