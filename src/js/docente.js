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
let notasGradoId   = null;
let notasMateriaId = null; // id de grado_materia
let periodoActual  = 1;
let alumnosNotas   = [];
let notasCache     = {};   // alumnoId -> nota guardada en BD
let notasEdit      = {};   // alumnoId -> nota editada localmente (pendiente de guardar)

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
        document.getElementById('tbody-notas').innerHTML = '<tr><td colspan="7" class="empty-state">No tenés grados asignados todavía.</td></tr>';
        return;
    }

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

    cargarAlumnosYNotas();
}

window.cambiarGradoNotas = () => {
    notasGradoId = document.getElementById('notas-grado').value;
    poblarSelectMateriaNotas(notasGradoId);
    const materiasGrado = gradoMatCache.filter(gm => gm.grado_id === notasGradoId);
    notasMateriaId = materiasGrado[0]?.id || null;
    document.getElementById('notas-materia').value = notasMateriaId || '';
    cargarAlumnosYNotas();
};

window.cambiarMateriaNotas = () => {
    notasMateriaId = document.getElementById('notas-materia').value;
    cargarAlumnosYNotas();
};

window.setPeriodo = (n) => {
    periodoActual = n;
    document.querySelectorAll('.periodo-btn').forEach((b, i) => b.classList.toggle('active', i + 1 === n));
    cargarAlumnosYNotas();
};

async function cargarAlumnosYNotas() {
    if (!notasGradoId || !notasMateriaId) {
        document.getElementById('tbody-notas').innerHTML = '<tr><td colspan="7" class="empty-state">Seleccioná un grado y materia para comenzar</td></tr>';
        return;
    }

    const { data: alumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', notasGradoId)
        .eq('activo', true)
        .order('apellidos');
    alumnosNotas = alumnos || [];

    notasCache = {};
    notasEdit  = {};
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

    renderTablaNotas();
}

function calcularNF(act, lab, exa) {
    const a = Math.min(3.5, parseFloat(act) || 0);
    const l = Math.min(3.5, parseFloat(lab) || 0);
    const e = Math.min(3.0, parseFloat(exa) || 0);
    return parseFloat((a + l + e).toFixed(2));
}

function renderTablaNotas() {
    const tbody = document.getElementById('tbody-notas');
    if (!alumnosNotas.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Este grado no tiene alumnos activos.</td></tr>';
        return;
    }

    tbody.innerHTML = alumnosNotas.map((al, idx) => {
        const n  = notasCache[al.id] || {};
        const nf = calcularNF(n.actividades, n.laboratorio, n.examen);
        const colorNF = nf >= 6 ? 'nf-aprobado' : nf > 0 ? 'nf-reprobado' : '';

        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            <td>
                <input type="number" step="0.01" min="0" max="3.5"
                    value="${n.actividades ?? ''}" placeholder="0.00"
                    class="nota-input"
                    oninput="actualizarNotaLocal('${al.id}', 'actividades', this.value)">
            </td>
            <td>
                <input type="number" step="0.01" min="0" max="3.5"
                    value="${n.laboratorio ?? ''}" placeholder="0.00"
                    class="nota-input"
                    oninput="actualizarNotaLocal('${al.id}', 'laboratorio', this.value)">
            </td>
            <td>
                <input type="number" step="0.01" min="0" max="3.0"
                    value="${n.examen ?? ''}" placeholder="0.00"
                    class="nota-input"
                    oninput="actualizarNotaLocal('${al.id}', 'examen', this.value)">
            </td>
            <td class="td-nf ${colorNF}" id="nf-${al.id}">${nf > 0 ? nf.toFixed(1) : '—'}</td>
            <td>
                <input type="number" step="0.01" min="0" max="10"
                    value="${n.recuperacion ?? ''}" placeholder="—"
                    class="nota-input nota-rec"
                    oninput="actualizarNotaLocal('${al.id}', 'recuperacion', this.value)"
                    ${nf >= 6 ? 'disabled' : ''}>
            </td>
        </tr>`;
    }).join('');
}

window.actualizarNotaLocal = (alumnoId, campo, valor) => {
    const base = notasEdit[alumnoId] || { ...(notasCache[alumnoId] || {}) };
    base[campo] = valor;
    notasEdit[alumnoId] = base;

    const nf = calcularNF(base.actividades, base.laboratorio, base.examen);
    const celda = document.getElementById(`nf-${alumnoId}`);
    if (celda) {
        celda.textContent = nf > 0 ? nf.toFixed(1) : '—';
        celda.className = 'td-nf ' + (nf >= 6 ? 'nf-aprobado' : nf > 0 ? 'nf-reprobado' : '');
    }
};

window.guardarTodasLasNotas = async () => {
    if (!notasGradoId || !notasMateriaId) return alert('Seleccioná un grado y materia primero.');
    if (!alumnosNotas.length) return;

    const payload = alumnosNotas.map(al => {
        const edit = notasEdit[al.id] || notasCache[al.id] || {};
        const actividades = parseFloat(edit.actividades) || 0;
        const laboratorio = parseFloat(edit.laboratorio) || 0;
        const examen      = parseFloat(edit.examen) || 0;
        const nf = calcularNF(actividades, laboratorio, examen);

        let notaFinalRec = null;
        if (edit.recuperacion && nf < 6) {
            notaFinalRec = Math.min(10, parseFloat(edit.recuperacion) || 0);
        }

        return {
            alumno_id:        al.id,
            grado_materia_id: notasMateriaId,
            periodo:          periodoActual,
            actividades, laboratorio, examen,
            nota_final:       nf,
            recuperacion:     edit.recuperacion || null,
            nota_final_rec:   notaFinalRec,
        };
    });

    const { data, error } = await supabase
        .from('notas')
        .upsert(payload, { onConflict: 'alumno_id,grado_materia_id,periodo' })
        .select();

    if (error) return alert('Error guardando notas: ' + error.message);

    (data || []).forEach(n => { notasCache[n.alumno_id] = n; });
    notasEdit = {};
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
