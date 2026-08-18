// ═══════════════════════════════════════════
//  IDSJE — Panel Administrador
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion, subirFoto } from './auth.js';
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET, MATERIAS_DEFAULT, INSTITUTO, DIAS_HORARIO, BLOQUES_HORARIO, ESTADOS_ASISTENCIA } from './config.js';
import {
    mostrarToast,
    mostrarConfirm,
    notificarError,
    esErrorDeRed,
    mostrarBannerSinConexion,
    ocultarBannerSinConexion,
    setBotonCargando,
    mostrarErrorCampo,
    limpiarErroresFormulario,
    renderSkeletonFilas,
    colorPorMateria,
    nombreCortoDocente,
    diasHabilesDelMes,
    calcularTotalesAsistencia,
} from './utils.js';

let usuarioActual = null;
let gradosCache   = [];
let alumnosCache  = [];
let usuariosCache = [];
let materiasCache = [];
let vistaActual   = 'inicio';
let dashChart     = null;

// Horarios
let horarioGradoSel  = null;  // grado_id actualmente elegido en la vista Horarios
let horariosCache    = [];    // filas de `horarios` del grado elegido
let gradoMatHorario   = [];   // grado_materia del grado elegido (para el selector de materia del modal)

// Asistencias
let asisGradoId      = null;
let asisFecha         = null; // 'YYYY-MM-DD'
let alumnosAsis       = [];
let asisCache         = {};   // alumnoId -> fila de `asistencias` guardada
let asisEdit          = {};   // alumnoId -> estado editado localmente (P/A/J/T)
let asisRegistroInfo  = null; // { nombre, hora } si ya hay asistencia guardada para esa fecha

// Configuración — Períodos académicos
let configAnioSel           = null;
let periodosAcademicosCache = []; // filas de `periodos_academicos` del año elegido

// Llama al endpoint serverless que gestiona usuarios con la service key
async function llamarApiAdmin(action, datos) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin-usuarios', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ action, ...datos })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
    return data;
}

// ── INICIO ──────────────────────────────────
async function init() {
    const res = await verificarSesion('admin');
    if (!res) return;
    usuarioActual = res.usuario;
    document.getElementById('admin-nombre').textContent = usuarioActual.nombre_completo;
    await cargarTodo();
    mostrarVista('inicio');
}

async function cargarTodo() {
    try {
        const [
            { data: grados,   error: eGrados },
            { data: usuarios, error: eUsuarios },
            { data: materias, error: eMaterias },
            { count: cAlumnos, error: eAlumnos },
        ] = await Promise.all([
            supabase.from('grados').select('*').order('nombre'),
            supabase.from('usuarios').select('*').order('nombre_completo'),
            supabase.from('materias').select('*').order('nombre'),
            supabase.from('alumnos').select('*', { count: 'exact', head: true }),
        ]);

        const errorDeRed = [eGrados, eUsuarios, eMaterias, eAlumnos].find(e => e && esErrorDeRed(e));
        if (errorDeRed) {
            mostrarBannerSinConexion(() => cargarTodo());
            return;
        }
        ocultarBannerSinConexion();

        gradosCache   = grados   || [];
        usuariosCache = usuarios || [];
        materiasCache = materias || [];
        const sg = document.getElementById('stat-grados');
        const sa = document.getElementById('stat-alumnos');
        const sd = document.getElementById('stat-docentes');
        const sm = document.getElementById('stat-materias');
        if (sg) sg.textContent = gradosCache.length;
        if (sa) sa.textContent = cAlumnos || 0;
        if (sd) sd.textContent = usuariosCache.length;
        if (sm) sm.textContent = materiasCache.length;
        const ini = document.getElementById('admin-inicial');
        if (ini && usuarioActual?.nombre_completo) ini.textContent = usuarioActual.nombre_completo.charAt(0).toUpperCase();
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => cargarTodo());
            return;
        }
        notificarError(err, 'Error cargando los datos');
    }
}

// ── VISTAS ──────────────────────────────────
const TITULOS = {
    inicio: 'Inicio',
    grados: 'Grados y Secciones',
    alumnos: 'Alumnos',
    docentes: 'Docentes',
    materias: 'Materias',
    horarios: 'Horarios',
    asistencias: 'Asistencias',
    configuracion: 'Configuración',
};

const VISTA_CONFIG = {
    inicio:      { titulo: 'Inicio',               accion: `<button class="btn-primary" onclick="mostrarVista('grados')">Ver Grados</button>` },
    grados:      { titulo: 'Grados y Secciones',  accion: `<button class="btn-primary" onclick="abrirModalGrado()">+ Nuevo Grado</button>` },
    alumnos:     { titulo: 'Alumnos',              accion: `<input type="file" id="excel-alumnos" accept=".xlsx,.xls" class="hidden" onchange="importarAlumnosExcel(event)"><button class="btn-secondary" onclick="document.getElementById('excel-alumnos').click()">📊 Importar Excel</button><button class="btn-primary" onclick="abrirModalAlumno()">+ Nuevo Alumno</button>` },
    docentes:    { titulo: 'Docentes',             accion: `<button class="btn-primary" onclick="abrirModalDocente()">+ Nuevo Docente</button>` },
    materias:    { titulo: 'Materias',             accion: `<button class="btn-secondary" onclick="cargarMateriasDefault()">Cargar IDSJE</button><button class="btn-primary" onclick="abrirModalMateria()">+ Nueva Materia</button>` },
    horarios:    { titulo: 'Horarios',             accion: `<button class="btn-secondary" onclick="imprimirHorarioGrado()">🖨 Imprimir horario</button>` },
    asistencias: { titulo: 'Asistencias',          accion: `<button class="btn-secondary" onclick="imprimirReporteAsistenciaAdmin()">🖨 Reporte mensual</button><button class="btn-secondary" onclick="imprimirListaBlancoAsistenciaAdmin()">📄 Lista en blanco</button>` },
    configuracion: { titulo: 'Configuración',      accion: '' },
};

window.mostrarVista = async (vista) => {
    vistaActual = vista;
    document.querySelectorAll('[id^="vista-"]').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(`vista-${vista}`);
    if (el) el.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-vista="${vista}"]`)?.classList.add('active');

    // Actualizar topbar
    const cfg = VISTA_CONFIG[vista];
    if (cfg) {
        const t = document.getElementById('topbar-titulo');
        const a = document.getElementById('topbar-actions');
        if (t) t.textContent = cfg.titulo;
        if (a) a.innerHTML = cfg.accion;
    }
    const tt = document.getElementById('topbar-titulo');
    if (tt) tt.textContent = TITULOS[vista] || vista;

    if (vista === 'inicio')   renderDashboard();
    if (vista === 'grados')   renderGrados();
    if (vista === 'docentes') renderDocentes();
    if (vista === 'materias') renderMaterias();
    if (vista === 'horarios') renderVistaHorarios();
    if (vista === 'asistencias') renderVistaAsistencias();
    if (vista === 'configuracion') renderVistaConfiguracion();
    if (vista === 'alumnos') {
        // Poblar filtro grado
        const { data, error } = await supabase.from('grados').select('*').order('nombre');
        if (error) { notificarError(error, 'Error cargando grados'); return; }
        const sel = document.getElementById('filtro-grado');
        if (sel) {
            sel.innerHTML = '<option value="">— Todos los grados —</option>' +
                (data || []).map(g => `<option value="${g.id}">${g.nombre} ${g.seccion}</option>`).join('');
        }
        renderAlumnos();
    }
};

// Genera código corto: "PRIMER AÑO" + modalidad + sección → "1GA"
function codigoGrado(g) {
    const nom = g.nombre.toUpperCase();
    let num = '?';
    if (nom.includes('PRIMER') || nom.includes('1')) num = '1';
    else if (nom.includes('SEGUNDO') || nom.includes('2')) num = '2';
    else if (nom.includes('TERCER') || nom.includes('3')) num = '3';
    const mod = g.modalidad === 'Técnico' ? 'T' : g.modalidad === 'Vocacional' ? 'V' : 'G';
    return `${num}${mod}${g.seccion}`;
}

// ── DASHBOARD (INICIO) ───────────────────────
async function cargarAlumnosDashboard() {
    const { data, error } = await supabase
        .from('alumnos')
        .select('*, grados(nombre, seccion)')
        .order('created_at', { ascending: false });

    if (!error) return data || [];

    // La tabla podría no tener columna created_at: reintentar sin ese orden
    const fallback = await supabase.from('alumnos').select('*, grados(nombre, seccion)');
    const alumnos = fallback.data || [];
    alumnos.sort((a, b) => (b.anio_ingreso || 0) - (a.anio_ingreso || 0));
    return alumnos;
}

// Variación de un conteo respecto al año anterior. Null si no hay dato del año anterior.
function calcularVariacion(items, campoAnio) {
    const anioActual = INSTITUTO.anio;
    const actual    = items.filter(x => x[campoAnio] === anioActual).length;
    const anterior  = items.filter(x => x[campoAnio] === anioActual - 1).length;
    if (!anterior) return null;
    return Math.round(((actual - anterior) / anterior) * 100);
}

function formatFechaAlumno(a) {
    if (a.created_at) {
        return new Date(a.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return a.anio_ingreso ? `Año ${a.anio_ingreso}` : '—';
}

async function renderDashboard() {
    // Notas de variación (grados y alumnos tienen campo de año; docentes/materias no)
    const varGrados = calcularVariacion(gradosCache, 'anio');
    const notaGrados = document.getElementById('stat-grados-note');
    if (notaGrados) {
        notaGrados.textContent = varGrados === null
            ? 'Secciones activas'
            : `${varGrados >= 0 ? '▲' : '▼'} ${Math.abs(varGrados)}% vs. ${INSTITUTO.anio - 1}`;
        notaGrados.className = 'sc-note' + (varGrados === null ? '' : varGrados >= 0 ? ' up' : ' down');
    }

    const cont = document.getElementById('dash-recientes');
    const gc   = document.getElementById('dash-grado-cards');
    if (cont) cont.innerHTML = '<div class="skeleton-bar" style="height:52px;margin-bottom:10px"></div>'.repeat(3);
    if (gc)   gc.innerHTML   = '<div class="skeleton-bar" style="height:88px"></div>'.repeat(3);

    const alumnosDash = await cargarAlumnosDashboard();

    const varAlumnos = calcularVariacion(alumnosDash, 'anio_ingreso');
    const notaAlumnos = document.getElementById('stat-alumnos-note');
    if (notaAlumnos) {
        notaAlumnos.textContent = varAlumnos === null
            ? `Matriculados ${INSTITUTO.anio}`
            : `${varAlumnos >= 0 ? '▲' : '▼'} ${Math.abs(varAlumnos)}% vs. ${INSTITUTO.anio - 1}`;
        notaAlumnos.className = 'sc-note' + (varAlumnos === null ? '' : varAlumnos >= 0 ? ' up' : ' down');
    }

    // Conteo de alumnos por grado
    const conteoPorGrado = {};
    alumnosDash.forEach(a => {
        if (!a.grado_id) return;
        conteoPorGrado[a.grado_id] = (conteoPorGrado[a.grado_id] || 0) + 1;
    });

    // Gráfica de barras
    const canvas = document.getElementById('chart-alumnos-grado');
    if (canvas && window.Chart) {
        const labels = gradosCache.map(g => `${codigoGrado(g)}`);
        const valores = gradosCache.map(g => conteoPorGrado[g.id] || 0);

        if (dashChart) dashChart.destroy();
        dashChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Alumnos',
                    data: valores,
                    backgroundColor: '#1B3A6B',
                    borderRadius: 5,
                    maxBarThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5fb' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // Últimos alumnos registrados
    if (cont) {
        const recientes = alumnosDash.slice(0, 5);
        cont.innerHTML = recientes.map(a => `
            <div class="dash-recientes-item">
                <div>
                    <div class="dr-nombre">${a.nombres} ${a.apellidos}</div>
                    <div class="dr-grado">${a.grados ? `${a.grados.nombre} ${a.grados.seccion}` : 'Sin grado'}</div>
                </div>
                <div class="dr-fecha">${formatFechaAlumno(a)}</div>
            </div>
        `).join('') || '<div class="empty-bubbles">Sin alumnos todavía</div>';
    }

    // Tarjetas de grados
    if (gc) {
        gc.innerHTML = gradosCache.map(g => {
            const guia = usuariosCache.find(u => u.id === g.docente_guia_id);
            return `
            <div class="grado-card">
                <div class="gc-top">
                    <div>
                        <div class="gc-nombre">${g.nombre}</div>
                        <div class="gc-seccion">Sección ${g.seccion}</div>
                    </div>
                    <div class="gc-count">${conteoPorGrado[g.id] || 0}</div>
                </div>
                <div class="gc-guia">👤 ${guia?.nombre_completo || 'Sin docente guía'}</div>
            </div>
        `;
        }).join('') || '<div class="empty-bubbles">No hay grados todavía.</div>';
    }
}

// ── GRADOS ──────────────────────────────────
function renderGrados() {
    const body = document.getElementById('grados-bubbles-body');
    if (!body) return;
    if (!gradosCache.length) {
        body.innerHTML = '<div class="empty-bubbles">No hay grados todavía. Creá el primero con el botón de arriba.</div>';
        return;
    }

    // Agrupar por nombre de grado
    const grupos = {};
    gradosCache.forEach(g => {
        const key = g.nombre;
        if (!grupos[key]) grupos[key] = [];
        grupos[key].push(g);
    });

    function badgeMod(m) {
        if (m === 'Técnico') return 'mod-tec';
        if (m === 'Vocacional') return 'mod-voc';
        return 'mod-gen';
    }
    function labelMod(m) {
        if (m === 'Técnico') return 'TEC';
        if (m === 'Vocacional') return 'VOC';
        return 'GEN';
    }

    body.innerHTML = Object.entries(grupos).map(([nombre, grados]) => `
        <div class="grados-group">
            <div class="group-label">${nombre}</div>
            <div class="bubbles">
                ${grados.map(g => `
                    <div class="grado-bubble">
                        <div class="bubble-circle">
                            <span class="badge-mod ${badgeMod(g.modalidad)}">${labelMod(g.modalidad)}</span>
                            <span class="bubble-code">${codigoGrado(g)}</span>
                            <span class="bubble-sub">Secc. ${g.seccion}</span>
                        </div>
                        <span class="bubble-label">${usuariosCache.find(u=>u.id===g.docente_guia_id)?.nombre_completo?.split(' ')[0] || 'Sin guía'}</span>
                        <div class="bubble-actions">
                            <button class="ba-btn ba-edit" onclick="editarGrado('${g.id}')">Editar</button>
                            <button class="ba-btn ba-mat" onclick="gestionarMateriaGrado('${g.id}')">Materias</button>
                            <button class="ba-btn ba-del" onclick="eliminarGrado('${g.id}')">Eliminar</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    // Actualizar stats
    const sg = document.getElementById('stat-grados');
    if (sg) sg.textContent = gradosCache.length;
}

const CAMPOS_GRADO = ['grado-nombre', 'grado-seccion'];

window.abrirModalGrado = (id = null) => {
    limpiarErroresFormulario(CAMPOS_GRADO);
    const grado = id ? gradosCache.find(g => g.id === id) : null;
    document.getElementById('modal-grado-title').textContent = grado ? 'Editar Grado' : 'Nuevo Grado';
    document.getElementById('grado-id').value     = grado?.id || '';
    document.getElementById('grado-nombre').value = grado?.nombre || '';
    document.getElementById('grado-seccion').value = grado?.seccion || 'A';
    document.getElementById('grado-modalidad').value = grado?.modalidad || 'General';
    document.getElementById('grado-anio').value   = grado?.anio || 2026;

    // Poblar select de docente guía
    const sel = document.getElementById('grado-guia');
    sel.innerHTML = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}" ${u.id === grado?.docente_guia_id ? 'selected' : ''}>${u.nombre_completo}</option>`).join('');

    abrirModal('modal-grado');
};

window.editarGrado = (id) => window.abrirModalGrado(id);

window.guardarGrado = async () => {
    limpiarErroresFormulario(CAMPOS_GRADO);
    const id       = document.getElementById('grado-id').value;
    const nombre   = document.getElementById('grado-nombre').value.trim().toUpperCase();
    const seccion  = document.getElementById('grado-seccion').value.trim().toUpperCase();
    const modalidad = document.getElementById('grado-modalidad').value.trim();
    const anio     = parseInt(document.getElementById('grado-anio').value);
    const guia     = document.getElementById('grado-guia').value || null;

    let valido = true;
    if (!nombre)  { mostrarErrorCampo('grado-nombre', 'El nombre es obligatorio'); valido = false; }
    if (!seccion) { mostrarErrorCampo('grado-seccion', 'La sección es obligatoria'); valido = false; }
    if (!valido) return;

    const btn = document.getElementById('btn-guardar-grado');
    setBotonCargando(btn, true);

    const payload = { nombre, seccion, modalidad, anio, docente_guia_id: guia };
    const { error } = id
        ? await supabase.from('grados').update(payload).eq('id', id)
        : await supabase.from('grados').insert([payload]);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el grado');

    mostrarToast(id ? 'Grado actualizado correctamente' : 'Grado creado correctamente', 'exito');
    cerrarModal('modal-grado');
    await cargarTodo();
    renderGrados();
};

window.eliminarGrado = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar este grado y todos sus datos?', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('grados').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el grado');
    mostrarToast('Grado eliminado', 'exito');
    await cargarTodo();
    renderGrados();
};

// ── GESTIÓN MATERIAS POR GRADO ───────────────
window.gestionarMateriaGrado = async (gradoId) => {
    const grado = gradosCache.find(g => g.id === gradoId);
    document.getElementById('mgrado-titulo').textContent = `${grado.nombre} ${grado.seccion} — Materias`;
    document.getElementById('mgrado-id').value = gradoId;

    const { data: asignadas, error } = await supabase
        .from('grado_materia')
        .select('*')
        .eq('grado_id', gradoId);

    if (error) { notificarError(error, 'Error cargando materias del grado'); return; }

    const asignadasPorMateria = {};
    (asignadas || []).forEach(a => { asignadasPorMateria[a.materia_id] = a; });

    const opcionesDocentes = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}">${u.nombre_completo}</option>`).join('');

    document.getElementById('lista-grado-materias').innerHTML = materiasCache.map(m => {
        const asignada = asignadasPorMateria[m.id];
        const marcada  = !!asignada;
        return `
        <div class="mgm-row">
            <label class="mgm-check">
                <input type="checkbox" class="mgm-checkbox" data-materia-id="${m.id}" ${marcada ? 'checked' : ''} onchange="toggleMgmRow('${m.id}')">
                <span>${m.nombre}</span>
            </label>
            <select id="mgm-docente-${m.id}" ${marcada ? '' : 'disabled'}>${opcionesDocentes}</select>
        </div>`;
    }).join('') || '<p class="text-muted">No hay materias registradas</p>';

    // Autocompletar docente sugerido: el de la asignación existente, o si no, el docente_id de la materia
    materiasCache.forEach(m => {
        const asignada  = asignadasPorMateria[m.id];
        const docenteId = asignada ? (asignada.docente_id || '') : (m.docente_id || '');
        const sel = document.getElementById(`mgm-docente-${m.id}`);
        if (sel) sel.value = docenteId;
    });

    abrirModal('modal-grado-materias');
};

window.toggleMgmRow = (materiaId) => {
    const chk = document.querySelector(`.mgm-checkbox[data-materia-id="${materiaId}"]`);
    const sel = document.getElementById(`mgm-docente-${materiaId}`);
    if (sel) sel.disabled = !chk.checked;
};

window.guardarMateriasGrado = async () => {
    const gradoId = document.getElementById('mgrado-id').value;
    const checks  = document.querySelectorAll('.mgm-checkbox');
    const btn     = document.getElementById('btn-guardar-materias-grado');

    const paraGuardar = [];
    const paraQuitar  = [];

    checks.forEach(chk => {
        const materiaId = chk.dataset.materiaId;
        const docenteId = document.getElementById(`mgm-docente-${materiaId}`).value || null;
        if (chk.checked) {
            paraGuardar.push({ grado_id: gradoId, materia_id: materiaId, docente_id: docenteId });
        } else {
            paraQuitar.push(materiaId);
        }
    });

    setBotonCargando(btn, true);

    if (paraGuardar.length) {
        const { error } = await supabase.from('grado_materia')
            .upsert(paraGuardar, { onConflict: 'grado_id,materia_id' });
        if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error guardando materias'); }
    }

    if (paraQuitar.length) {
        const { error } = await supabase.from('grado_materia')
            .delete()
            .eq('grado_id', gradoId)
            .in('materia_id', paraQuitar);
        if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error quitando materias'); }
    }

    setBotonCargando(btn, false);
    mostrarToast('Materias del grado actualizadas', 'exito');
    cerrarModal('modal-grado-materias');
};

// ── DOCENTES ────────────────────────────────
function renderDocentes() {
    document.getElementById('tbody-docentes').innerHTML = usuariosCache.map(u => `
        <tr>
            <td>${u.nombre_completo}</td>
            <td>${u.correo}</td>
            <td><span class="badge ${u.rol === 'admin' ? 'badge-admin' : 'badge-docente'}">${u.rol}</span></td>
            <td>
                <button class="btn-sm btn-edit" onclick="editarDocente('${u.id}')">Editar</button>
                <button class="btn-sm btn-del" onclick="eliminarDocente('${u.id}')">Eliminar</button>
            </td>
        </tr>
    `).join('');
}

const CAMPOS_DOCENTE = ['docente-nombre', 'docente-correo', 'docente-pass'];

window.abrirModalDocente = (id = null) => {
    limpiarErroresFormulario(CAMPOS_DOCENTE);
    const u = id ? usuariosCache.find(x => x.id === id) : null;
    document.getElementById('modal-docente-title').textContent = u ? 'Editar Docente' : 'Nuevo Docente';
    document.getElementById('docente-id').value     = u?.id || '';
    document.getElementById('docente-nombre').value = u?.nombre_completo || '';
    document.getElementById('docente-correo').value = u?.correo || '';
    document.getElementById('docente-rol').value    = u?.rol || 'docente';
    document.getElementById('docente-pass').value   = '';
    document.getElementById('docente-pass').required = !u;
    abrirModal('modal-docente');
};

window.editarDocente = (id) => window.abrirModalDocente(id);

window.guardarDocente = async () => {
    limpiarErroresFormulario(CAMPOS_DOCENTE);
    const id     = document.getElementById('docente-id').value;
    const nombre = document.getElementById('docente-nombre').value.trim();
    const correo = document.getElementById('docente-correo').value.trim().toLowerCase();
    const rol    = document.getElementById('docente-rol').value;
    const pass   = document.getElementById('docente-pass').value;

    let valido = true;
    if (!nombre) { mostrarErrorCampo('docente-nombre', 'El nombre es obligatorio'); valido = false; }
    if (!correo) { mostrarErrorCampo('docente-correo', 'El correo es obligatorio'); valido = false; }
    if (!id && (!pass || pass.length < 6)) {
        mostrarErrorCampo('docente-pass', 'La contraseña debe tener al menos 6 caracteres');
        valido = false;
    }
    if (!valido) return;

    const btn = document.getElementById('btn-guardar-docente');
    setBotonCargando(btn, true);

    if (!id) {
        // Crear usuario nuevo — 1. Crear en Supabase Auth vía endpoint serverless
        try {
            await llamarApiAdmin('crear', { correo, password: pass });
        } catch (err) {
            setBotonCargando(btn, false);
            return notificarError(err, 'Error creando la cuenta');
        }

        // 2. Insertar en tabla usuarios
        const { error } = await supabase.from('usuarios').insert([{ correo, nombre_completo: nombre, rol }]);
        setBotonCargando(btn, false);
        if (error) return notificarError(error, 'Error guardando el usuario');

        mostrarToast(`Docente "${nombre}" creado correctamente`, 'exito');
    } else {
        // Actualizar datos existentes
        const { error } = await supabase.from('usuarios').update({ nombre_completo: nombre, rol }).eq('id', id);
        if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error actualizando el docente'); }

        // Cambiar contraseña si se ingresó una nueva
        if (pass && pass.length >= 6) {
            try {
                await llamarApiAdmin('cambiar-password', { correo, password: pass });
            } catch (err) {
                setBotonCargando(btn, false);
                return notificarError(err, 'Error cambiando la contraseña');
            }
        }

        setBotonCargando(btn, false);
        mostrarToast('Docente actualizado correctamente', 'exito');
    }

    cerrarModal('modal-docente');
    await cargarTodo();
    renderDocentes();
};

window.eliminarDocente = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar este docente?', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el docente');
    mostrarToast('Docente eliminado', 'exito');
    await cargarTodo();
    renderDocentes();
};

// ── MATERIAS ────────────────────────────────
function renderMaterias() {
    document.getElementById('tbody-materias').innerHTML = materiasCache.map(m => `
        <tr>
            <td>${m.nombre}</td>
            <td>${m.codigo || '—'}</td>
            <td>
                <button class="btn-sm btn-edit" onclick="editarMateria('${m.id}')">Editar</button>
                <button class="btn-sm btn-del" onclick="eliminarMateria('${m.id}')">Eliminar</button>
            </td>
        </tr>
    `).join('');
}

const CAMPOS_MATERIA = ['materia-nombre'];

window.abrirModalMateria = (id = null) => {
    limpiarErroresFormulario(CAMPOS_MATERIA);
    const m = id ? materiasCache.find(x => x.id === id) : null;
    document.getElementById('modal-materia-title').textContent = m ? 'Editar Materia' : 'Nueva Materia';
    document.getElementById('materia-id').value     = m?.id || '';
    document.getElementById('materia-nombre').value = m?.nombre || '';
    document.getElementById('materia-codigo').value = m?.codigo || '';

    const selDoc = document.getElementById('materia-docente');
    selDoc.innerHTML = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}">${u.nombre_completo}</option>`).join('');
    selDoc.value = m?.docente_id || '';

    abrirModal('modal-materia');
};

window.editarMateria = (id) => window.abrirModalMateria(id);

window.guardarMateria = async () => {
    limpiarErroresFormulario(CAMPOS_MATERIA);
    const id        = document.getElementById('materia-id').value;
    const nombre    = document.getElementById('materia-nombre').value.trim();
    const codigo    = document.getElementById('materia-codigo').value.trim();
    const docenteId = document.getElementById('materia-docente').value || null;

    if (!nombre) { mostrarErrorCampo('materia-nombre', 'El nombre es obligatorio'); return; }

    const btn = document.getElementById('btn-guardar-materia');
    setBotonCargando(btn, true);

    const { error } = id
        ? await supabase.from('materias').update({ nombre, codigo, docente_id: docenteId }).eq('id', id)
        : await supabase.from('materias').insert([{ nombre, codigo, docente_id: docenteId }]);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando la materia');

    mostrarToast(id ? 'Materia actualizada' : 'Materia creada', 'exito');
    cerrarModal('modal-materia');
    await cargarTodo();
    renderMaterias();
};

window.eliminarMateria = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar esta materia?', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('materias').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando la materia');
    mostrarToast('Materia eliminada', 'exito');
    await cargarTodo();
    renderMaterias();
};

window.cargarMateriasDefault = async () => {
    const ok = await mostrarConfirm('¿Cargar las 10 materias del IDSJE? Solo agrega las que no existen.', {
        textoConfirmar: 'Cargar',
        peligroso: false,
    });
    if (!ok) return;

    const existentes = materiasCache.map(m => m.nombre.toLowerCase());
    const nuevas = MATERIAS_DEFAULT
        .filter(n => !existentes.includes(n.toLowerCase()))
        .map(n => ({ nombre: n }));

    if (nuevas.length === 0) { mostrarToast('Todas las materias ya existen', 'info'); return; }

    const { error } = await supabase.from('materias').insert(nuevas);
    if (error) return notificarError(error, 'Error cargando materias');

    await cargarTodo();
    renderMaterias();
    mostrarToast(`${nuevas.length} materia(s) agregada(s)`, 'exito');
};

// ── HORARIOS ────────────────────────────────
async function renderVistaHorarios() {
    const sel = document.getElementById('horario-grado');
    if (sel && !sel.dataset.poblado) {
        sel.innerHTML = '<option value="">— Seleccioná un grado —</option>' +
            gradosCache.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');
        sel.dataset.poblado = '1';
    }
    if (horarioGradoSel) {
        sel.value = horarioGradoSel;
        await cargarHorarioGrado(horarioGradoSel);
    } else {
        document.getElementById('horario-grid').innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver o editar su horario.</div>';
    }
}

window.cambiarGradoHorario = async () => {
    const gradoId = document.getElementById('horario-grado').value;
    horarioGradoSel = gradoId || null;
    if (!horarioGradoSel) {
        document.getElementById('horario-grid').innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver o editar su horario.</div>';
        return;
    }
    await cargarHorarioGrado(horarioGradoSel);
};

async function cargarHorarioGrado(gradoId) {
    document.getElementById('horario-grid').innerHTML = '<div class="empty-bubbles">Cargando horario…</div>';
    try {
        const [{ data: horarios, error: eHor }, { data: gm, error: eGm }] = await Promise.all([
            supabase.from('horarios').select('*, materias(id, nombre), usuarios(id, nombre_completo)').eq('grado_id', gradoId),
            supabase.from('grado_materia').select('*, materias(id, nombre)').eq('grado_id', gradoId),
        ]);

        const errorDeRed = [eHor, eGm].find(e => e && esErrorDeRed(e));
        if (errorDeRed) {
            mostrarBannerSinConexion(() => cargarHorarioGrado(gradoId));
            return;
        }
        ocultarBannerSinConexion();
        if (eHor) return notificarError(eHor, 'Error cargando el horario');
        if (eGm)  return notificarError(eGm, 'Error cargando materias del grado');

        horariosCache   = horarios || [];
        gradoMatHorario = gm || [];
        renderGridHorario();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarHorarioGrado(gradoId)); return; }
        notificarError(err, 'Error cargando el horario');
    }
}

function renderGridHorario() {
    const cont = document.getElementById('horario-grid');
    const porCelda = {};
    horariosCache.forEach(h => { porCelda[`${h.dia}-${h.periodo}`] = h; });

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
                        <button type="button" class="hg-del-btn" onclick="eliminarCeldaHorario('${h.id}')" title="Quitar">✕</button>
                        <div class="hg-materia">${h.materias?.nombre || ''}</div>
                        <div class="hg-docente">${nombreCortoDocente(h.usuarios?.nombre_completo)}</div>
                    </div>
                </div>`;
            } else {
                html += `
                <div class="hg-cell hg-vacia">
                    <button type="button" class="hg-add-btn" onclick="abrirModalCeldaHorario('${dia}', ${b.periodo})" title="Asignar">+</button>
                </div>`;
            }
        });
    });

    cont.innerHTML = html;
}

window.abrirModalCeldaHorario = (dia, periodo) => {
    if (!horarioGradoSel) return;
    if (!gradoMatHorario.length) {
        mostrarToast('Este grado no tiene materias asignadas todavía', 'advertencia');
        return;
    }
    const bloque = BLOQUES_HORARIO.find(b => b.tipo === 'clase' && b.periodo === periodo);

    document.getElementById('modal-celda-horario-title').textContent = `${dia} — Período ${periodo} (${bloque.inicio}–${bloque.fin})`;
    document.getElementById('hcelda-grado-id').value     = horarioGradoSel;
    document.getElementById('hcelda-dia').value          = dia;
    document.getElementById('hcelda-periodo').value      = periodo;
    document.getElementById('hcelda-hora-inicio').value  = bloque.inicio;
    document.getElementById('hcelda-hora-fin').value     = bloque.fin;
    document.getElementById('hcelda-docente-id').value   = '';
    document.getElementById('hcelda-docente-nombre').textContent = '—';

    const selMat = document.getElementById('hcelda-materia');
    selMat.innerHTML = '<option value="">— Seleccioná una materia —</option>' +
        gradoMatHorario.map(gm => `<option value="${gm.materia_id}" data-docente="${gm.docente_id || ''}">${gm.materias?.nombre || ''}</option>`).join('');
    selMat.value = '';

    abrirModal('modal-celda-horario');
};

window.materiaCeldaHorarioCambio = () => {
    const selMat    = document.getElementById('hcelda-materia');
    const docenteId = selMat.options[selMat.selectedIndex]?.dataset.docente || '';
    const docente   = usuariosCache.find(u => u.id === docenteId);
    document.getElementById('hcelda-docente-id').value = docenteId;
    document.getElementById('hcelda-docente-nombre').textContent =
        docente ? docente.nombre_completo : (selMat.value ? 'Sin docente asignado en este grado' : '—');
};

window.guardarCeldaHorario = async () => {
    const gradoId    = document.getElementById('hcelda-grado-id').value;
    const dia        = document.getElementById('hcelda-dia').value;
    const periodo    = parseInt(document.getElementById('hcelda-periodo').value, 10);
    const horaInicio = document.getElementById('hcelda-hora-inicio').value;
    const horaFin    = document.getElementById('hcelda-hora-fin').value;
    const materiaId  = document.getElementById('hcelda-materia').value;
    const docenteId  = document.getElementById('hcelda-docente-id').value || null;

    if (!materiaId) { mostrarToast('Seleccioná una materia', 'advertencia'); return; }

    const btn = document.getElementById('btn-guardar-celda-horario');
    setBotonCargando(btn, true);

    const { error } = await supabase.from('horarios').upsert(
        [{ grado_id: gradoId, materia_id: materiaId, docente_id: docenteId, dia, periodo, hora_inicio: horaInicio, hora_fin: horaFin }],
        { onConflict: 'grado_id,dia,periodo' }
    );

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el horario');

    mostrarToast('Horario actualizado', 'exito');
    cerrarModal('modal-celda-horario');
    await cargarHorarioGrado(gradoId);
};

window.eliminarCeldaHorario = async (id) => {
    const ok = await mostrarConfirm('¿Quitar esta clase del horario?', { textoConfirmar: 'Quitar' });
    if (!ok) return;
    const { error } = await supabase.from('horarios').delete().eq('id', id);
    if (error) return notificarError(error, 'Error quitando la clase');
    mostrarToast('Clase quitada del horario', 'exito');
    await cargarHorarioGrado(horarioGradoSel);
};

window.imprimirHorarioGrado = () => {
    if (!horarioGradoSel) { mostrarToast('Seleccioná un grado primero', 'advertencia'); return; }
    window.open(`./horario.html?grado=${horarioGradoSel}`, '_blank');
};

// ── ASISTENCIAS ─────────────────────────────
function fechaHoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mesActualISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderVistaAsistencias() {
    const opciones = gradosCache.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');

    const selGrado = document.getElementById('asis-grado');
    selGrado.innerHTML = opciones;
    if (!asisGradoId && gradosCache.length) asisGradoId = gradosCache[0].id;
    if (asisGradoId) selGrado.value = asisGradoId;

    if (!asisFecha) asisFecha = fechaHoyISO();
    document.getElementById('asis-fecha').value = asisFecha;

    const selResGrado = document.getElementById('asis-res-grado');
    selResGrado.innerHTML = '<option value="">— Todos los grados —</option>' + opciones;
    const inputMes = document.getElementById('asis-res-mes');
    if (!inputMes.value) inputMes.value = mesActualISO();

    if (asisGradoId) cargarAsistenciaDiaAdmin();
    cargarResumenMensualAdmin();
}

window.cambiarGradoAsistenciaAdmin = () => {
    asisGradoId = document.getElementById('asis-grado').value || null;
    if (asisGradoId) cargarAsistenciaDiaAdmin();
    else document.getElementById('lista-asistencia').innerHTML = '<div class="empty-bubbles">Seleccioná un grado.</div>';
};

window.cambiarFechaAsistenciaAdmin = () => {
    asisFecha = document.getElementById('asis-fecha').value;
    if (asisGradoId) cargarAsistenciaDiaAdmin();
};

async function cargarAsistenciaDiaAdmin() {
    if (!asisGradoId || !asisFecha) return;
    document.getElementById('lista-asistencia').innerHTML = '<div class="empty-bubbles">Cargando…</div>';
    document.getElementById('asis-banner').classList.add('hidden');

    try {
        const { data: alumnos, error: eAl } = await supabase
            .from('alumnos')
            .select('*')
            .eq('grado_id', asisGradoId)
            .eq('activo', true)
            .order('apellidos');

        if (eAl && esErrorDeRed(eAl)) { mostrarBannerSinConexion(() => cargarAsistenciaDiaAdmin()); return; }
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

        renderBannerAsistenciaAdmin();
        renderListaAsistenciaAdmin();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarAsistenciaDiaAdmin()); return; }
        notificarError(err, 'Error cargando la asistencia');
    }
}

function renderBannerAsistenciaAdmin() {
    const el = document.getElementById('asis-banner');
    if (!asisRegistroInfo) { el.classList.add('hidden'); return; }
    const hora = asisRegistroInfo.hora
        ? new Date(asisRegistroInfo.hora).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
        : '';
    el.innerHTML = `Asistencia registrada por <b>${asisRegistroInfo.nombre}</b>${hora ? ` a las ${hora}` : ''}. Podés editarla y volver a guardar.`;
    el.classList.remove('hidden');
}

function renderListaAsistenciaAdmin() {
    const cont = document.getElementById('lista-asistencia');
    if (!alumnosAsis.length) {
        cont.innerHTML = '<div class="empty-bubbles">Este grado no tiene alumnos activos.</div>';
        return;
    }

    cont.innerHTML = alumnosAsis.map((al, idx) => {
        const estado = asisEdit[al.id] || asisCache[al.id]?.estado || 'P';
        const pills = ESTADOS_ASISTENCIA.map(e => {
            const simbolo = e.codigo === 'P' ? '✓' : (e.codigo === 'A' ? '✗' : e.codigo);
            return `<button type="button" class="asis-pill asis-pill-${e.codigo} ${estado === e.codigo ? 'activo' : ''}"
                onclick="marcarAsistenciaAdmin('${al.id}', '${e.codigo}')" title="${e.label}">${simbolo}</button>`;
        }).join('');

        return `
        <div class="asis-fila">
            <div class="asis-num">${idx + 1}</div>
            <div class="asis-nombre">${al.apellidos}, ${al.nombres}</div>
            <div class="asis-pills">${pills}</div>
        </div>`;
    }).join('');
}

window.marcarAsistenciaAdmin = (alumnoId, estado) => {
    asisEdit[alumnoId] = estado;
    renderListaAsistenciaAdmin();
};

window.guardarAsistenciaAdmin = async () => {
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
    await cargarAsistenciaDiaAdmin();
    cargarResumenMensualAdmin();
};

// Tabla de alerta: alumnos con más de 3 ausencias ('A') en el mes elegido,
// opcionalmente filtrado por grado.
window.cambiarFiltroResumenAsistencia = () => cargarResumenMensualAdmin();

async function cargarResumenMensualAdmin() {
    const cont = document.getElementById('asis-resumen');
    const mes = document.getElementById('asis-res-mes')?.value;
    const gradoFiltro = document.getElementById('asis-res-grado')?.value || '';
    if (!mes) return;

    cont.innerHTML = '<div class="empty-bubbles">Cargando resumen…</div>';

    const [anio, mesNum] = mes.split('-').map(Number);
    const desde = `${mes}-01`;
    const hasta = `${mes}-${String(new Date(anio, mesNum, 0).getDate()).padStart(2, '0')}`;

    let queryAlumnos = supabase.from('alumnos').select('*, grados(nombre, seccion)').eq('activo', true);
    if (gradoFiltro) queryAlumnos = queryAlumnos.eq('grado_id', gradoFiltro);
    const { data: alumnos, error: eAl } = await queryAlumnos;
    if (eAl) { notificarError(eAl, 'Error cargando alumnos'); return; }
    if (!alumnos?.length) { cont.innerHTML = '<div class="empty-bubbles">No hay alumnos para este filtro.</div>'; return; }

    const alumnoIds = alumnos.map(a => a.id);
    const { data: registros, error: eReg } = await supabase
        .from('asistencias')
        .select('alumno_id, estado')
        .in('alumno_id', alumnoIds)
        .gte('fecha', desde)
        .lte('fecha', hasta);
    if (eReg) { notificarError(eReg, 'Error cargando asistencia'); return; }

    const porAlumno = {};
    (registros || []).forEach(r => {
        if (!porAlumno[r.alumno_id]) porAlumno[r.alumno_id] = [];
        porAlumno[r.alumno_id].push(r);
    });

    const alerta = alumnos
        .map(al => ({ alumno: al, totales: calcularTotalesAsistencia(porAlumno[al.id] || []) }))
        .filter(x => x.totales.A > 3)
        .sort((a, b) => b.totales.A - a.totales.A);

    if (!alerta.length) {
        cont.innerHTML = '<div class="empty-bubbles">Ningún alumno supera las 3 ausencias este mes. ✅</div>';
        return;
    }

    cont.innerHTML = `
    <table>
        <thead><tr><th>Alumno</th><th>Grado</th><th>Ausencias</th><th>Justificadas</th><th>Tardanzas</th></tr></thead>
        <tbody>
            ${alerta.map(({ alumno: al, totales: t }) => `
                <tr>
                    <td class="td-bold">${al.apellidos}, ${al.nombres}</td>
                    <td>${al.grados?.nombre || ''} ${al.grados?.seccion || ''}</td>
                    <td><span class="badge" style="background:#fde8e8;color:#b52828">${t.A}</span></td>
                    <td>${t.J}</td>
                    <td>${t.T}</td>
                </tr>`).join('')}
        </tbody>
    </table>`;
}

window.imprimirReporteAsistenciaAdmin = () => {
    const gradoId = document.getElementById('asis-res-grado')?.value || asisGradoId;
    const mes = document.getElementById('asis-res-mes')?.value;
    if (!gradoId || !mes) { mostrarToast('Seleccioná un grado y un mes', 'advertencia'); return; }
    window.open(`./asistencia-reporte.html?grado=${gradoId}&mes=${mes}`, '_blank');
};

window.imprimirListaBlancoAsistenciaAdmin = () => {
    const gradoId = document.getElementById('asis-res-grado')?.value || asisGradoId;
    const mes = document.getElementById('asis-res-mes')?.value;
    if (!gradoId || !mes) { mostrarToast('Seleccioná un grado y un mes', 'advertencia'); return; }
    window.open(`./asistencia-reporte.html?grado=${gradoId}&mes=${mes}&blanco=1`, '_blank');
};

// ── CONFIGURACIÓN — PERÍODOS ACADÉMICOS ─────
function renderVistaConfiguracion() {
    if (!configAnioSel) configAnioSel = new Date().getFullYear();
    document.getElementById('config-anio').value = configAnioSel;
    cargarPeriodosAcademicos();
}

window.cambiarAnioConfiguracion = () => {
    configAnioSel = parseInt(document.getElementById('config-anio').value, 10) || new Date().getFullYear();
    cargarPeriodosAcademicos();
};

async function cargarPeriodosAcademicos() {
    document.getElementById('periodos-academicos-tabla').innerHTML = '<div class="empty-bubbles">Cargando…</div>';
    try {
        const { data, error } = await supabase
            .from('periodos_academicos')
            .select('*')
            .eq('anio', configAnioSel)
            .order('periodo');

        if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => cargarPeriodosAcademicos()); return; }
        ocultarBannerSinConexion();
        if (error) return notificarError(error, 'Error cargando los períodos académicos');

        periodosAcademicosCache = data || [];
        renderPeriodosAcademicos();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarPeriodosAcademicos()); return; }
        notificarError(err, 'Error cargando los períodos académicos');
    }
}

function renderPeriodosAcademicos() {
    const cont = document.getElementById('periodos-academicos-tabla');
    const porPeriodo = {};
    periodosAcademicosCache.forEach(p => { porPeriodo[p.periodo] = p; });

    const aviso = periodosAcademicosCache.length < 4
        ? `<div class="info-box">⚠ Configurá las fechas del año ${configAnioSel} para habilitar el conteo de inasistencias en las boletas.</div>`
        : '';

    cont.innerHTML = `
    ${aviso}
    <table>
        <thead><tr><th>Período</th><th>Fecha inicio</th><th>Fecha fin</th></tr></thead>
        <tbody>
            ${[1, 2, 3, 4].map(p => {
                const row = porPeriodo[p];
                return `
                <tr>
                    <td class="td-bold">Período ${p}</td>
                    <td><input type="date" id="periodo-inicio-${p}" value="${row?.fecha_inicio || ''}" style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px"></td>
                    <td><input type="date" id="periodo-fin-${p}" value="${row?.fecha_fin || ''}" style="padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px"></td>
                </tr>`;
            }).join('')}
        </tbody>
    </table>
    <div class="tabla-header" style="justify-content:flex-end;border-top:1px solid #f1f5fb;border-bottom:none">
        <button class="btn-primary" id="btn-guardar-periodos" onclick="guardarPeriodosAcademicos()">Guardar</button>
    </div>`;
}

window.guardarPeriodosAcademicos = async () => {
    const payload = [1, 2, 3, 4]
        .map(p => ({
            anio: configAnioSel,
            periodo: p,
            fecha_inicio: document.getElementById(`periodo-inicio-${p}`).value || null,
            fecha_fin: document.getElementById(`periodo-fin-${p}`).value || null,
        }))
        .filter(r => r.fecha_inicio && r.fecha_fin);

    if (!payload.length) { mostrarToast('Completá al menos un período (inicio y fin)', 'advertencia'); return; }

    const btn = document.getElementById('btn-guardar-periodos');
    setBotonCargando(btn, true);

    const { error } = await supabase.from('periodos_academicos').upsert(payload, { onConflict: 'anio,periodo' });

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando los períodos académicos');

    mostrarToast('Períodos académicos guardados', 'exito');
    await cargarPeriodosAcademicos();
};

// ── ALUMNOS ─────────────────────────────────
window.renderAlumnos = async function renderAlumnos() {
    renderSkeletonFilas('tbody-alumnos', 6, 6);

    const gradoFiltro = document.getElementById('filtro-grado')?.value || '';
    let query = supabase.from('alumnos').select('*, grados(nombre, seccion)').order('apellidos');
    if (gradoFiltro) query = query.eq('grado_id', gradoFiltro);
    const { data, error } = await query;

    if (error) { notificarError(error, 'Error cargando alumnos'); return; }

    alumnosCache = data || [];

    document.getElementById('tbody-alumnos').innerHTML = alumnosCache.map(a => `
        <tr>
            <td>
                ${a.foto_url
                    ? `<img src="${a.foto_url}" class="foto-mini" alt="${a.apellidos}">`
                    : '<div class="foto-mini foto-placeholder">?</div>'}
            </td>
            <td>${a.apellidos}</td>
            <td>${a.nombres}</td>
            <td>${a.nie}</td>
            <td>${a.grados ? `${a.grados.nombre} ${a.grados.seccion}` : '—'}</td>
            <td>
                <button class="btn-sm btn-edit" onclick="editarAlumno('${a.id}')">Editar</button>
                <button class="btn-sm btn-del" onclick="eliminarAlumno('${a.id}')">Eliminar</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="text-center text-muted">Sin alumnos</td></tr>';
}

const CAMPOS_ALUMNO = ['alumno-nie', 'alumno-nombres', 'alumno-apellidos', 'alumno-grado'];

window.abrirModalAlumno = async (id = null) => {
    limpiarErroresFormulario(CAMPOS_ALUMNO);
    const a = id ? alumnosCache.find(x => x.id === id) : null;
    document.getElementById('modal-alumno-title').textContent = a ? 'Editar Alumno' : 'Nuevo Alumno';
    document.getElementById('alumno-id').value        = a?.id || '';
    document.getElementById('alumno-nie').value       = a?.nie || '';
    document.getElementById('alumno-nombres').value   = a?.nombres || '';
    document.getElementById('alumno-apellidos').value = a?.apellidos || '';
    document.getElementById('alumno-anio').value      = a?.anio_ingreso || 2026;
    document.getElementById('alumno-foto-preview').src = a?.foto_url || '';
    document.getElementById('alumno-foto-preview').style.display = a?.foto_url ? 'block' : 'none';

    const sel = document.getElementById('alumno-grado');
    sel.innerHTML = '<option value="">— Seleccionar grado —</option>' +
        gradosCache.map(g => `<option value="${g.id}" ${g.id === a?.grado_id ? 'selected' : ''}>${g.nombre} ${g.seccion}</option>`).join('');

    abrirModal('modal-alumno');
};

window.editarAlumno = (id) => window.abrirModalAlumno(id);

window.guardarAlumno = async () => {
    limpiarErroresFormulario(CAMPOS_ALUMNO);
    const id        = document.getElementById('alumno-id').value;
    const nie       = document.getElementById('alumno-nie').value.trim();
    const nombres   = document.getElementById('alumno-nombres').value.trim().toUpperCase();
    const apellidos = document.getElementById('alumno-apellidos').value.trim().toUpperCase();
    const gradoId   = document.getElementById('alumno-grado').value;
    const anio      = parseInt(document.getElementById('alumno-anio').value);
    const fotoFile  = document.getElementById('alumno-foto').files[0];

    let valido = true;
    if (!nie)       { mostrarErrorCampo('alumno-nie', 'El NIE es obligatorio'); valido = false; }
    if (!nombres)   { mostrarErrorCampo('alumno-nombres', 'Los nombres son obligatorios'); valido = false; }
    if (!apellidos) { mostrarErrorCampo('alumno-apellidos', 'Los apellidos son obligatorios'); valido = false; }
    if (!gradoId)   { mostrarErrorCampo('alumno-grado', 'Seleccioná un grado'); valido = false; }
    if (!valido) return;

    const btn = document.getElementById('btn-guardar-alumno');
    setBotonCargando(btn, true);

    let foto_url = alumnosCache.find(a => a.id === id)?.foto_url || null;

    if (fotoFile) {
        try {
            foto_url = await subirFoto(fotoFile, CLOUDINARY_CLOUD, CLOUDINARY_PRESET);
        } catch (e) {
            notificarError(e, 'Error subiendo la foto');
        }
    }

    const payload = { nie, nombres, apellidos, grado_id: gradoId, anio_ingreso: anio, foto_url };
    const { error } = id
        ? await supabase.from('alumnos').update(payload).eq('id', id)
        : await supabase.from('alumnos').insert([{ ...payload, activo: true }]);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando el alumno');

    mostrarToast(id ? 'Alumno actualizado' : 'Alumno creado', 'exito');
    cerrarModal('modal-alumno');
    await renderAlumnos();
};

window.eliminarAlumno = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar este alumno y todas sus notas?', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('alumnos').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el alumno');
    mostrarToast('Alumno eliminado', 'exito');
    await renderAlumnos();
};

window.eliminarAlumnosMasivo = async () => {
    const gradoId = document.getElementById('filtro-grado').value;
    if (!gradoId) return mostrarToast('Seleccioná un grado primero para hacer eliminación masiva', 'advertencia');
    const grado = gradosCache.find(g => g.id === gradoId);
    const ok = await mostrarConfirm(
        `¿Eliminar TODOS los alumnos de ${grado.nombre} ${grado.seccion}? Esta acción no se puede deshacer.`,
        { textoConfirmar: 'Eliminar todos' }
    );
    if (!ok) return;
    const { error } = await supabase.from('alumnos').delete().eq('grado_id', gradoId);
    if (error) return notificarError(error, 'Error eliminando alumnos');
    await renderAlumnos();
    mostrarToast('Alumnos eliminados', 'exito');
};

window.previsualizarFoto = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = e => {
            const preview = document.getElementById('alumno-foto-preview');
            preview.src = e.target.result;
            preview.style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// ── MODALES ─────────────────────────────────
window.abrirModal  = (id) => document.getElementById(id).classList.add('open');
window.cerrarModal = (id) => document.getElementById(id).classList.remove('open');
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

window.cerrarSesionAdmin = cerrarSesion;

init();

// ── IMPORTAR ALUMNOS DESDE EXCEL ─────────────
window.importarAlumnosExcel = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const gradoId = document.getElementById('filtro-grado')?.value;
    if (!gradoId) {
        mostrarToast('Seleccioná un grado en el filtro antes de importar', 'advertencia');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const wb   = XLSX.read(e.target.result, { type: 'binary' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

            const nuevos = [];
            for (const row of rows) {
                const nie       = (row[0] || '').toString().trim();
                const apellidos = (row[1] || '').toString().trim().toUpperCase();
                const nombres   = (row[2] || '').toString().trim().toUpperCase();
                if (!nie || !apellidos || !nombres) continue;
                nuevos.push({ nie, apellidos, nombres, grado_id: gradoId, activo: true, anio_ingreso: 2026 });
            }

            if (!nuevos.length) { mostrarToast('No se encontraron alumnos en el archivo', 'advertencia'); return; }

            const { error } = await supabase.from('alumnos').insert(nuevos);
            if (error) { notificarError(error, 'Error importando alumnos'); return; }

            mostrarToast(`${nuevos.length} alumno(s) importado(s) correctamente`, 'exito');
            await renderAlumnos();
        } catch (err) {
            notificarError(err, 'Error leyendo el archivo');
        }
    };
    reader.readAsBinaryString(file);
    event.target.value = '';
};
