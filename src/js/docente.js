// ═══════════════════════════════════════════
//  IDSJE — Panel Docente
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion } from './auth.js';

let usuarioActual  = null;
let gradoMatCache  = []; // materias asignadas al docente
let alumnosCache   = [];
let notasCache     = {};
let gradoSeleccionado   = null;
let materiaSeleccionada = null;
let periodoActual       = 1;

// ── INICIO ──────────────────────────────────
export async function init() {
    const res = await verificarSesion();
    if (!res) return;
    usuarioActual = res.usuario;
    document.getElementById('docente-nombre').textContent = usuarioActual.nombre_completo;
    await cargarMisGrados();
}

async function cargarMisGrados() {
    const { data } = await supabase
        .from('grado_materia')
        .select('*, grados(id, nombre, seccion, modalidad, anio), materias(id, nombre)')
        .eq('docente_id', usuarioActual.id);

    gradoMatCache = data || [];
    renderMisGrados();
}

function renderMisGrados() {
    const contenedor = document.getElementById('mis-grados');
    if (!gradoMatCache.length) {
        contenedor.innerHTML = `<div class="empty-state">No tenés materias asignadas todavía.<br>Contactá al administrador.</div>`;
        return;
    }

    // Agrupar por grado
    const porGrado = {};
    gradoMatCache.forEach(gm => {
        const key = gm.grados.id;
        if (!porGrado[key]) porGrado[key] = { grado: gm.grados, materias: [] };
        porGrado[key].materias.push(gm);
    });

    contenedor.innerHTML = Object.values(porGrado).map(({ grado, materias }) => `
        <div class="grado-card-doc">
            <div class="grado-card-header">
                <div>
                    <div class="grado-nombre">${grado.nombre}</div>
                    <div class="grado-sub">Sección ${grado.seccion} · ${grado.modalidad} · ${grado.anio}</div>
                </div>
            </div>
            <div class="materias-list">
                ${materias.map(gm => `
                    <button class="materia-btn" onclick="abrirMateria('${gm.grado_id}', '${gm.materia_id}', '${gm.id}')">
                        <span class="materia-nombre">${gm.materias.nombre}</span>
                        <span class="materia-arrow">→</span>
                    </button>
                `).join('')}
                <button class="btn-comp" onclick="abrirCompetencias('${grado.id}', '${grado.nombre}', '${grado.seccion}')">
                    📋 Competencias Ciudadanas e Inasistencias
                </button>
            </div>
        </div>
    `).join('');
}

// ── ABRIR MATERIA ───────────────────────────
window.abrirMateria = async (gradoId, materiaId, gradoMateriaId) => {
    gradoSeleccionado   = gradoId;
    materiaSeleccionada = gradoMateriaId;

    const gm = gradoMatCache.find(x => x.id === gradoMateriaId);
    document.getElementById('titulo-materia').textContent = gm?.materias?.nombre || 'Materia';
    document.getElementById('subtitulo-materia').textContent =
        `${gm?.grados?.nombre} · Sección ${gm?.grados?.seccion}`;

    document.getElementById('vista-grados-doc').classList.add('hidden');
    document.getElementById('vista-notas').classList.remove('hidden');

    setPeriodo(1);
};

window.volverAGrados = () => {
    document.getElementById('vista-notas').classList.add('hidden');
    document.getElementById('vista-grados-doc').classList.remove('hidden');
    gradoSeleccionado = null;
    materiaSeleccionada = null;
};

window.setPeriodo = async (n) => {
    periodoActual = n;
    document.querySelectorAll('.periodo-btn').forEach((b, i) => {
        b.classList.toggle('active', i + 1 === n);
    });
    await cargarAlumnosYNotas();
};

async function cargarAlumnosYNotas() {
    // Cargar alumnos del grado
    const { data: alumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', gradoSeleccionado)
        .eq('activo', true)
        .order('apellidos');

    alumnosCache = alumnos || [];

    // Cargar notas existentes
    const alumnoIds = alumnosCache.map(a => a.id);
    const { data: notas } = await supabase
        .from('notas')
        .select('*')
        .in('alumno_id', alumnoIds)
        .eq('grado_materia_id', materiaSeleccionada)
        .eq('periodo', periodoActual);

    notasCache = {};
    (notas || []).forEach(n => { notasCache[n.alumno_id] = n; });

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
    tbody.innerHTML = alumnosCache.map((al, idx) => {
        const n = notasCache[al.id] || {};
        const nf = calcularNF(n.actividades, n.laboratorio, n.examen);
        const colorNF = nf >= 6 ? 'nf-aprobado' : nf > 0 ? 'nf-reprobado' : '';

        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            <td>
                <input type="number" step="0.01" min="0" max="3.5"
                    value="${n.actividades || ''}" placeholder="0.00"
                    class="nota-input"
                    onchange="guardarNota('${al.id}', 'actividades', this.value)">
            </td>
            <td>
                <input type="number" step="0.01" min="0" max="3.5"
                    value="${n.laboratorio || ''}" placeholder="0.00"
                    class="nota-input"
                    onchange="guardarNota('${al.id}', 'laboratorio', this.value)">
            </td>
            <td>
                <input type="number" step="0.01" min="0" max="3.0"
                    value="${n.examen || ''}" placeholder="0.00"
                    class="nota-input"
                    onchange="guardarNota('${al.id}', 'examen', this.value)">
            </td>
            <td class="td-nf ${colorNF}">${nf > 0 ? nf.toFixed(1) : '—'}</td>
            <td>
                <input type="number" step="0.01" min="0" max="10"
                    value="${n.recuperacion || ''}" placeholder="—"
                    class="nota-input nota-rec"
                    onchange="guardarNota('${al.id}', 'recuperacion', this.value)"
                    ${nf >= 6 ? 'disabled' : ''}>
            </td>
        </tr>`;
    }).join('');
}

window.guardarNota = async (alumnoId, campo, valor) => {
    const val = parseFloat(valor) || 0;

    // Calcular nota final
    const notaActual = notasCache[alumnoId] || {};
    const updated = { ...notaActual, [campo]: val };
    const nf = calcularNF(updated.actividades, updated.laboratorio, updated.examen);

    let notaFinalRec = null;
    if (updated.recuperacion && nf < 6) {
        notaFinalRec = Math.min(10, parseFloat(updated.recuperacion) || 0);
    }

    const payload = {
        alumno_id:       alumnoId,
        grado_materia_id: materiaSeleccionada,
        periodo:         periodoActual,
        actividades:     updated.actividades || 0,
        laboratorio:     updated.laboratorio || 0,
        examen:          updated.examen || 0,
        nota_final:      nf,
        recuperacion:    updated.recuperacion || null,
        nota_final_rec:  notaFinalRec,
    };

    const { data, error } = await supabase
        .from('notas')
        .upsert([payload], { onConflict: 'alumno_id,grado_materia_id,periodo' })
        .select();

    if (!error && data?.[0]) {
        notasCache[alumnoId] = data[0];
        renderTablaNotas();
    }
};

window.cerrarSesionDocente = cerrarSesion;

init();

// ── COMPETENCIAS CIUDADANAS ──────────────────
let compGradoId = null;
let compPeriodo = 1;
let alumnosCompCache = [];

window.abrirCompetencias = async (gradoId, gradoNombre, seccion) => {
    compGradoId = gradoId;
    document.getElementById('comp-titulo').textContent = `${gradoNombre} · Sección ${seccion}`;

    document.getElementById('vista-grados-doc').classList.add('hidden');
    document.getElementById('vista-notas').classList.add('hidden');
    document.getElementById('vista-competencias').classList.remove('hidden');

    setCompPeriodo(1);
};

window.setCompPeriodo = async (n) => {
    compPeriodo = n;
    document.querySelectorAll('.comp-periodo-btn').forEach((b, i) => {
        b.classList.toggle('active', i + 1 === n);
    });
    await cargarAlumnosComp();
};

async function cargarAlumnosComp() {
    const { data: alumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', compGradoId)
        .eq('activo', true)
        .order('apellidos');

    alumnosCompCache = alumnos || [];

    const alumnoIds = alumnosCompCache.map(a => a.id);
    const { data: comps } = await supabase
        .from('competencias')
        .select('*')
        .in('alumno_id', alumnoIds)
        .eq('grado_id', compGradoId)
        .eq('periodo', compPeriodo);

    const compMap = {};
    (comps || []).forEach(c => { compMap[c.alumno_id] = c; });

    renderTablaCompetencias(alumnosCompCache, compMap);
}

const CONCEPTOS = ['E', 'MB', 'B', 'R', 'D'];

function selectConcepto(alumnoId, campo, valorActual) {
    return `<select class="comp-select" onchange="guardarCompetencia('${alumnoId}','${campo}',this.value)">
        ${CONCEPTOS.map(c => `<option value="${c}" ${c === valorActual ? 'selected' : ''}>${c}</option>`).join('')}
    </select>`;
}

function renderTablaCompetencias(alumnos, compMap) {
    const tbody = document.getElementById('tbody-comp');
    tbody.innerHTML = alumnos.map((al, idx) => {
        const c = compMap[al.id] || {};
        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre-comp">${al.apellidos}, ${al.nombres}</td>
            <td>${selectConcepto(al.id, 'convivencia',  c.convivencia  || 'MB')}</td>
            <td>${selectConcepto(al.id, 'autonomia',    c.autonomia    || 'MB')}</td>
            <td>${selectConcepto(al.id, 'expresion',    c.expresion    || 'MB')}</td>
            <td>${selectConcepto(al.id, 'pertenencia',  c.pertenencia  || 'MB')}</td>
            <td><input type="number" min="0" max="999" class="inasis-input"
                value="${c.inasistencias || 0}"
                onchange="guardarCompetencia('${al.id}','inasistencias',this.value)"></td>
            <td><input type="text" class="obs-input" placeholder="Observación..."
                value="${c.observacion || ''}"
                onchange="guardarCompetencia('${al.id}','observacion',this.value)"></td>
        </tr>`;
    }).join('');
}

window.guardarCompetencia = async (alumnoId, campo, valor) => {
    const payload = {
        alumno_id:   alumnoId,
        grado_id:    compGradoId,
        periodo:     compPeriodo,
        [campo]:     campo === 'inasistencias' ? parseInt(valor) || 0 : valor,
    };

    await supabase
        .from('competencias')
        .upsert([payload], { onConflict: 'alumno_id,grado_id,periodo' });
};

window.volverDeCompetencias = () => {
    document.getElementById('vista-competencias').classList.add('hidden');
    document.getElementById('vista-grados-doc').classList.remove('hidden');
};
