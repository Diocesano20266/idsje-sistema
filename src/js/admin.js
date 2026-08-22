// ═══════════════════════════════════════════
//  IDSJE — Panel Administrador
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion, subirFoto } from './auth.js';
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET, INSTITUTO, DIAS_HORARIO, BLOQUES_HORARIO, ESTADOS_ASISTENCIA, TIPOS_EXPEDIENTE, getAñoActivo } from './config.js';
import { generarHorario, verificarConflictos } from './generador-horarios.js';
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

// Años académicos — anioActivoCache es la fila completa de `años_academicos`
// con activo=true (o null si nadie configuró ninguno todavía). Casi todas las
// queries que antes filtraban alumnos por grado_id ahora pasan por
// `matriculas`, filtrando además por año_academico_id = anioActivoCache.id.
let anioActivoCache      = null;
let aniosAcademicosCache = [];   // todos los años, para el selector "Cambiar año activo"
let categoriasGradoCache = [];   // categorias_grado, para agrupar la vista Grados
let matriculaAlumnosCache = [];  // catálogo completo de alumnos + su matrícula (si tiene) del año activo, para la subsección Matrícula

// Horarios
let horarioGradoSel  = null;  // grado_id actualmente elegido en la vista Horarios
let horariosCache    = [];    // filas de `horarios` del grado elegido
let gradoMatHorario   = [];   // grado_materia del grado elegido (para el selector de materia del modal)

// Generador automático de horarios
let genAsignaciones  = [];   // [{ id (grado_materia_id), gradoId, gradoNombre, materiaId, materiaNombre, docenteId, docenteNombre, horasPorSemana, incluida }]
let genSinDocenteCount = 0;  // materias sin docente asignado, excluidas del formulario (solo para el aviso)
let genDocentes      = [];   // [{ id, nombre, disponibilidad: 'completa'|'manana' }]
let genResultado     = null; // filas generadas (sin guardar) — null si no hay resultado aún, o [] si no se pudo ubicar nada (ver genCompleto/genMateriasNoColocadas para saber si es parcial)
let genSeed          = 1;
let genGradoPreview  = null; // grado_id que se muestra en el grid de vista previa
let genCompleto           = true; // false si genResultado es una solución PARCIAL (permitirParcial:true)
let genMateriasNoColocadas = [];  // [{asignacionId, gradoId, materiaId, materiaNombre, docenteId, horasRequeridas, horasColocadas}]

// Expedientes disciplinarios
let expAdminAlumnos    = []; // resultados de la búsqueda actual
let expAdminAlumnoSel  = null;
let expAdminTimeline   = [];
let expBuscarTimeout   = null;

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
        anioActivoCache = await getAñoActivo(supabase);

        const [
            { data: grados,   error: eGrados },
            { data: usuarios, error: eUsuarios },
            { data: materias, error: eMaterias },
            { data: categorias, error: eCategorias },
            { count: cAlumnos, error: eAlumnos },
        ] = await Promise.all([
            supabase.from('grados').select('*').order('nombre'),
            supabase.from('usuarios').select('*').order('nombre_completo'),
            supabase.from('materias').select('*').order('nombre'),
            supabase.from('categorias_grado').select('*').order('nombre'),
            // Conteo de matriculados del año activo (no de todo el catálogo de alumnos).
            anioActivoCache
                ? supabase.from('matriculas').select('*', { count: 'exact', head: true })
                    .eq('año_academico_id', anioActivoCache.id).eq('activo', true)
                : Promise.resolve({ count: 0, error: null }),
        ]);

        const errorDeRed = [eGrados, eUsuarios, eMaterias, eCategorias, eAlumnos].find(e => e && esErrorDeRed(e));
        if (errorDeRed) {
            mostrarBannerSinConexion(() => cargarTodo());
            return;
        }
        ocultarBannerSinConexion();

        gradosCache      = grados      || [];
        usuariosCache    = usuarios    || [];
        materiasCache    = materias    || [];
        categoriasGradoCache = categorias || [];
        const sg = document.getElementById('stat-grados');
        const sa = document.getElementById('stat-alumnos');
        const sd = document.getElementById('stat-docentes');
        const sm = document.getElementById('stat-materias');
        if (sg) sg.textContent = gradosCache.length;
        if (sa) sa.textContent = cAlumnos || 0;
        if (sd) sd.textContent = usuariosCache.length;
        if (sm) sm.textContent = materiasCache.length;
        const ini = document.getElementById('admin-iniciales');
        if (ini && usuarioActual?.nombre_completo) ini.textContent = usuarioActual.nombre_completo.charAt(0).toUpperCase();
        renderAnioActivoHeader();
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => cargarTodo());
            return;
        }
        notificarError(err, 'Error cargando los datos');
    }
}

// Muestra el año activo (o una advertencia si no hay ninguno configurado)
// en el badge del topbar — ver admin.html (#anio-activo-badge).
function renderAnioActivoHeader() {
    const el = document.getElementById('anio-activo-badge');
    if (!el) return;
    el.textContent = anioActivoCache ? `Año ${anioActivoCache.anio}` : '⚠ Sin año activo';
    el.classList.toggle('anio-badge-alerta', !anioActivoCache);
}

// ── VISTAS ──────────────────────────────────
const TITULOS = {
    inicio: 'Inicio',
    grados: 'Grados y Secciones',
    alumnos: 'Alumnos',
    docentes: 'Docentes',
    materias: 'Materias',
    horarios: 'Horarios',
    generador: 'Generar Horario',
    asistencias: 'Asistencias',
    expedientes: 'Expedientes',
    configuracion: 'Configuración',
    reportes: 'Reportes',
    'anio-academico': 'Año Académico',
    matricula: 'Matrícula de Alumnos',
    'categorias-grado': 'Categorías de Grados',
};

const VISTA_CONFIG = {
    inicio:      { titulo: 'Inicio',               accion: `<button class="btn-primary" onclick="mostrarVista('grados')">Ver Grados</button>` },
    grados:      { titulo: 'Grados y Secciones',  accion: `<button class="btn-primary" onclick="abrirModalGrado()">+ Nuevo Grado</button>` },
    alumnos:     { titulo: 'Alumnos',              accion: `<input type="file" id="excel-alumnos" accept=".xlsx,.xls" class="hidden" onchange="importarAlumnosExcel(event)"><button class="btn-secondary" onclick="document.getElementById('excel-alumnos').click()">📊 Importar Excel</button><button class="btn-secondary" onclick="imprimirMatriculaAdmin()">🖨 Reporte de matrícula</button><button class="btn-primary" onclick="abrirModalAlumno()">+ Nuevo Alumno</button>` },
    docentes:    { titulo: 'Docentes',             accion: `<button class="btn-primary" onclick="abrirModalDocente()">+ Nuevo Docente</button>` },
    materias:    { titulo: 'Materias',             accion: `<button class="btn-primary" onclick="abrirModalMateria()">+ Nueva Materia</button>` },
    horarios:    { titulo: 'Horarios',             accion: `<button class="btn-secondary" onclick="imprimirHorarioGrado()">🖨 Imprimir horario</button>` },
    generador:   { titulo: 'Generar Horario',      accion: '' },
    asistencias: { titulo: 'Asistencias',          accion: `<button class="btn-secondary" onclick="imprimirReporteAsistenciaAdmin()">🖨 Reporte mensual</button><button class="btn-secondary" onclick="imprimirListaBlancoAsistenciaAdmin()">📄 Lista en blanco</button>` },
    expedientes: { titulo: 'Expedientes',          accion: '' },
    configuracion: { titulo: 'Configuración',      accion: '' },
    reportes:    { titulo: 'Reportes',             accion: '' },
    'anio-academico': { titulo: 'Año Académico', accion: `<button class="btn-secondary" onclick="abrirModalCambiarAnio()">Cambiar año activo</button><button class="btn-primary" onclick="abrirModalNuevoAnio()">+ Nuevo Año Académico</button>` },
    matricula:   { titulo: 'Matrícula de Alumnos', accion: `<button class="btn-primary" onclick="abrirModalAlumno()">+ Alumno nuevo</button>` },
    'categorias-grado': { titulo: 'Categorías de Grados', accion: `<button class="btn-primary" onclick="abrirModalCategoriaGrado()">+ Nueva Categoría</button>` },
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
    if (vista === 'generador') renderVistaGenerador();
    if (vista === 'asistencias') renderVistaAsistencias();
    if (vista === 'expedientes') renderVistaExpedientes();
    if (vista === 'configuracion') renderVistaConfiguracion();
    if (vista === 'reportes') renderVistaReportes();
    if (vista === 'anio-academico') renderVistaAnioAcademico();
    if (vista === 'matricula') renderVistaMatricula();
    if (vista === 'categorias-grado') renderVistaCategoriasGrado();
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
// Alumnos MATRICULADOS en el año activo (vía `matriculas`), con su grado —
// ya no se puede leer grado_id/anio_ingreso directamente de `alumnos`
// (ver supabase/migracion-años.sql: alumnos es ahora catálogo puro).
// Devuelve objetos "aplanados" con la forma que el resto del dashboard
// espera: { ...alumno, grados, created_at: fecha_matricula }.
async function cargarAlumnosDashboard() {
    if (!anioActivoCache) return [];

    const { data, error } = await supabase
        .from('matriculas')
        .select('*, alumnos(*), grados(nombre, seccion)')
        .eq('año_academico_id', anioActivoCache.id)
        .eq('activo', true)
        .order('fecha_matricula', { ascending: false });

    if (error) return [];

    return (data || []).map(m => ({
        ...m.alumnos,
        grados: m.grados,
        created_at: m.alumnos?.created_at || m.fecha_matricula,
    }));
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

// Acordeón de Grados por categoría: qué grupos están colapsados (por key —
// categoria_id o 'sin') y los datos ya armados de la última carga, para que
// expandir/colapsar un grupo solo vuelva a pintar el DOM sin re-consultar Supabase.
let gradosAcordeonColapsado = new Set();
let gradosAcordeonDatos = null; // { grupos: Map(key -> {nombre, grados}), conteoPorGrado }

async function renderGrados() {
    const body = document.getElementById('grados-bubbles-body');
    if (!body) return;
    if (!gradosCache.length) {
        body.innerHTML = '<div class="empty-bubbles">No hay grados todavía. Creá el primero con el botón de arriba.</div>';
        return;
    }

    body.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    if (!anioActivoCache) {
        body.innerHTML = '<div class="info-box">⚠ No hay un año académico activo — configuralo en "Año Académico" antes de gestionar grados.</div>';
        return;
    }

    const { data: matriculas } = await supabase
        .from('matriculas')
        .select('grado_id')
        .eq('año_academico_id', anioActivoCache.id)
        .eq('activo', true);
    const conteoPorGrado = {};
    (matriculas || []).forEach(m => { if (m.grado_id) conteoPorGrado[m.grado_id] = (conteoPorGrado[m.grado_id] || 0) + 1; });

    // Agrupar por categoría, ordenadas alfabéticamente por nombre; los
    // grados sin categoria_id quedan en un grupo "Sin categoría" al final.
    const gradosDelAnio = gradosCache.filter(g => g.año_academico_id === anioActivoCache.id || !g.año_academico_id);
    const grupos = new Map(); // categoriaId|'sin' -> { nombre, grados: [] }
    categoriasGradoCache
        .slice()
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .forEach(c => grupos.set(c.id, { nombre: c.nombre, grados: [] }));
    grupos.set('sin', { nombre: 'Sin categoría', grados: [] });

    gradosDelAnio
        .slice()
        .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.seccion.localeCompare(b.seccion))
        .forEach(g => {
            const key = g.categoria_id && grupos.has(g.categoria_id) ? g.categoria_id : 'sin';
            grupos.get(key).grados.push(g);
        });

    gradosAcordeonDatos = { grupos, conteoPorGrado };
    renderAcordeonGrados();

    const sg = document.getElementById('stat-grados');
    if (sg) sg.textContent = gradosCache.length;
}

function renderAcordeonGrados() {
    const body = document.getElementById('grados-bubbles-body');
    if (!body || !gradosAcordeonDatos) return;
    const { grupos, conteoPorGrado } = gradosAcordeonDatos;

    const renderCard = (g) => {
        const guia = usuariosCache.find(u => u.id === g.docente_guia_id);
        return `
        <div class="grado-row-card" onclick="abrirDrawerGrado('${g.id}')">
            <div class="grc-nombre-wrap">
                <div class="grc-nombre">${g.nombre} <span class="badge-mod ${badgeMod(g.modalidad)}">${labelMod(g.modalidad)}</span></div>
                <div class="grc-seccion">Sección ${g.seccion}</div>
            </div>
            <div class="grc-guia">
                <span class="grc-guia-ico">${(guia?.nombre_completo || '?').charAt(0).toUpperCase()}</span>
                ${guia?.nombre_completo || 'Sin docente guía'}
            </div>
            <div class="grc-alumnos">
                <div class="grc-alumnos-val">${conteoPorGrado[g.id] || 0}</div>
                <div class="grc-alumnos-lbl">Alumnos</div>
            </div>
            <div class="grc-chevron">›</div>
        </div>`;
    };

    const entradas = [...grupos.entries()].filter(([, grupo]) => grupo.grados.length);

    body.innerHTML = entradas.map(([key, grupo]) => {
        const colapsado = gradosAcordeonColapsado.has(key);
        return `
        <div class="acordeon-categoria">
            <div class="acordeon-header" onclick="toggleAcordeonCategoria('${key}')">
                <span class="acordeon-icono">${colapsado ? '▶' : '▼'}</span>
                <span class="acordeon-titulo">${grupo.nombre}</span>
                <span class="acordeon-count">${grupo.grados.length}</span>
            </div>
            <div class="acordeon-body ${colapsado ? 'hidden' : ''}">
                ${grupo.grados.map(renderCard).join('')}
            </div>
        </div>`;
    }).join('') || '<div class="empty-bubbles">No hay grados para el año activo.</div>';
}

window.toggleAcordeonCategoria = (key) => {
    if (gradosAcordeonColapsado.has(key)) gradosAcordeonColapsado.delete(key);
    else gradosAcordeonColapsado.add(key);
    renderAcordeonGrados();
};

// ── DRAWER DE DETALLE DE GRADO ───────────────
let gradoDrawerId  = null;
let gradoDrawerTab = 'general';

window.abrirDrawerGrado = async (id) => {
    gradoDrawerId = id;
    gradoDrawerTab = 'general';
    renderHeaderDrawerGrado();
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'general'));
    document.getElementById('grado-drawer-overlay').classList.add('open');
    await renderTabDrawerGrado('general');
};

window.cerrarDrawerGrado = () => {
    document.getElementById('grado-drawer-overlay').classList.remove('open');
    gradoDrawerId = null;
};

window.cambiarTabDrawerGrado = async (tab) => {
    gradoDrawerTab = tab;
    document.querySelectorAll('.gd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    await renderTabDrawerGrado(tab);
};

function renderHeaderDrawerGrado() {
    const g = gradosCache.find(x => x.id === gradoDrawerId);
    if (!g) return;
    document.getElementById('gd-nombre').innerHTML =
        `${g.nombre} <span class="badge-mod ${badgeMod(g.modalidad)}">${labelMod(g.modalidad)}</span>`;
    document.getElementById('gd-seccion').textContent = `Sección ${g.seccion} · Año ${g.anio}`;
}

// Nombre del docente de una fila de grado_materia: el propio, o si no tiene,
// el docente por defecto de la materia (mismo criterio que docenteEfectivoGradoMateria).
function nombreDocenteMateriaGrado(gm) {
    return docenteEfectivoGradoMateria(gm)?.nombre || '';
}

function renderMiniGridHorario(horarios) {
    if (!horarios.length) return '<div class="empty-bubbles">Este grado no tiene horario generado todavía.</div>';

    const porCelda = {};
    horarios.forEach(h => { porCelda[`${h.dia}-${h.periodo}`] = h; });

    let html = '<div class="gd-mini-grid">';
    html += '<div class="gd-mini-cell gd-mini-head"></div>' +
        DIAS_HORARIO.map(d => `<div class="gd-mini-cell gd-mini-head">${d.slice(0, 3)}</div>`).join('');

    BLOQUES_HORARIO.forEach(b => {
        if (b.tipo !== 'clase') return; // vista compacta: solo períodos de clase
        html += `<div class="gd-mini-cell gd-mini-periodo">P${b.periodo}</div>`;
        DIAS_HORARIO.forEach(dia => {
            const h = porCelda[`${dia}-${b.periodo}`];
            html += h
                ? `<div class="gd-mini-cell gd-mini-ocupada" style="background:${colorPorMateria(h.materia_id)}">
                       <div class="gd-mini-materia">${(h.materias?.nombre || '').slice(0, 12)}</div>
                       <div class="gd-mini-docente">${nombreCortoDocente(h.usuarios?.nombre_completo)}</div>
                   </div>`
                : '<div class="gd-mini-cell"></div>';
        });
    });

    html += '</div>';
    return html;
}

async function renderTabDrawerGrado(tab) {
    const cont = document.getElementById('gd-tab-content');
    const g = gradosCache.find(x => x.id === gradoDrawerId);
    if (!cont || !g) return;
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    if (tab === 'general') {
        const guia = usuariosCache.find(u => u.id === g.docente_guia_id);
        const categoria = categoriasGradoCache.find(c => c.id === g.categoria_id);
        cont.innerHTML = `
            <div class="gd-field">
                <div class="gd-field-label">Docente guía</div>
                <div class="gd-field-val">${guia?.nombre_completo || 'Sin asignar'}</div>
            </div>
            <div class="gd-field">
                <div class="gd-field-label">Año</div>
                <div class="gd-field-val">${g.anio}</div>
            </div>
            <div class="gd-field">
                <div class="gd-field-label">Modalidad</div>
                <div class="gd-field-val">${g.modalidad}</div>
            </div>
            <div class="gd-field">
                <div class="gd-field-label">Categoría</div>
                <div class="gd-field-val">${categoria?.nombre || 'Sin categoría'}</div>
            </div>`;
        return;
    }

    if (tab === 'alumnos') {
        if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }
        const { data, error } = await supabase
            .from('matriculas')
            .select('*, alumnos(*)')
            .eq('grado_id', g.id)
            .eq('año_academico_id', anioActivoCache.id)
            .eq('activo', true);
        if (error) { cont.innerHTML = '<div class="empty-bubbles">Error cargando alumnos</div>'; return; }
        const alumnos = (data || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));
        cont.innerHTML =
            (alumnos.length
                ? alumnos.map(a => `
                    <div class="gd-alumno-row">
                        ${a.foto_url
                            ? `<img src="${a.foto_url}" class="foto-mini" alt="${a.apellidos}">`
                            : '<div class="foto-mini foto-placeholder">?</div>'}
                        <div>
                            <div class="gd-alumno-nombre">${a.apellidos}, ${a.nombres}</div>
                            <div class="gd-alumno-nie">NIE ${a.nie || '—'}</div>
                        </div>
                    </div>`).join('')
                : '<div class="empty-bubbles">Este grado no tiene alumnos todavía.</div>')
            + `<button class="gd-ver-todos" onclick="verAlumnosDeGrado('${g.id}')">Ver todos en Alumnos →</button>`;
        return;
    }

    if (tab === 'materias') {
        const { data, error } = await supabase
            .from('grado_materia')
            .select('*, materias(id, nombre, docente_id)')
            .eq('grado_id', g.id);
        if (error) { cont.innerHTML = '<div class="empty-bubbles">Error cargando materias</div>'; return; }
        const filas = data || [];
        cont.innerHTML =
            (filas.length
                ? filas.map(gm => `
                    <div class="gd-materia-row">
                        <div>
                            <div class="gd-materia-nombre">${gm.materias?.nombre || ''}</div>
                            <div class="gd-materia-docente">${nombreDocenteMateriaGrado(gm) || 'Sin asignar'}</div>
                        </div>
                        <button class="gd-materia-quitar" onclick="quitarMateriaDrawerGrado('${gm.id}')" title="Quitar">✕</button>
                    </div>`).join('')
                : '<div class="empty-bubbles">Sin materias asignadas.</div>')
            + `<button class="gd-add-materia" onclick="gestionarMateriaGrado('${g.id}')">+ Agregar / quitar materias</button>`;
        return;
    }

    if (tab === 'horario') {
        const { data, error } = await supabase
            .from('horarios')
            .select('*, materias(id, nombre), usuarios(id, nombre_completo)')
            .eq('grado_id', g.id);
        if (error) { cont.innerHTML = '<div class="empty-bubbles">Error cargando horario</div>'; return; }
        cont.innerHTML = renderMiniGridHorario(data || [])
            + `<button class="gd-editar-horario" onclick="irAHorarioCompleto('${g.id}')">Editar horario completo →</button>`;
        return;
    }
}

window.quitarMateriaDrawerGrado = async (grado_materia_id) => {
    const ok = await mostrarConfirm('¿Quitar esta materia del grado?', { textoConfirmar: 'Quitar' });
    if (!ok) return;
    const { error } = await supabase.from('grado_materia').delete().eq('id', grado_materia_id);
    if (error) return notificarError(error, 'Error quitando la materia');
    mostrarToast('Materia quitada del grado', 'exito');
    await renderTabDrawerGrado('materias');
};

window.verAlumnosDeGrado = async (gradoId) => {
    cerrarDrawerGrado();
    await mostrarVista('alumnos');
    const sel = document.getElementById('filtro-grado');
    if (sel) { sel.value = gradoId; await renderAlumnos(); }
};

window.irAHorarioCompleto = async (gradoId) => {
    cerrarDrawerGrado();
    horarioGradoSel = gradoId;
    await mostrarVista('horarios');
};

window.editarGradoDesdeDrawer = () => {
    const id = gradoDrawerId;
    cerrarDrawerGrado();
    window.abrirModalGrado(id);
};

window.eliminarGradoDesdeDrawer = async () => {
    const id = gradoDrawerId;
    const ok = await mostrarConfirm('¿Eliminar este grado y todos sus datos?', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('grados').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el grado');
    mostrarToast('Grado eliminado', 'exito');
    cerrarDrawerGrado();
    await cargarTodo();
    renderGrados();
};

const CAMPOS_GRADO = ['grado-nombre', 'grado-seccion'];

window.abrirModalGrado = (id = null) => {
    limpiarErroresFormulario(CAMPOS_GRADO);
    const grado = id ? gradosCache.find(g => g.id === id) : null;
    document.getElementById('modal-grado-title').textContent = grado ? 'Editar Grado' : 'Nuevo Grado';
    document.getElementById('grado-id').value     = grado?.id || '';
    document.getElementById('grado-nombre').value = grado?.nombre || '';
    document.getElementById('grado-seccion').value = grado?.seccion || 'A';
    document.getElementById('grado-modalidad').value = grado?.modalidad || 'General';
    document.getElementById('grado-anio').value   = grado?.anio || anioActivoCache?.anio || 2026;

    // Poblar select de docente guía
    const sel = document.getElementById('grado-guia');
    sel.innerHTML = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}" ${u.id === grado?.docente_guia_id ? 'selected' : ''}>${u.nombre_completo}</option>`).join('');

    // Poblar select de categoría
    const selCat = document.getElementById('grado-categoria');
    if (selCat) {
        selCat.innerHTML = '<option value="">— Sin categoría —</option>' +
            categoriasGradoCache.map(c => `<option value="${c.id}" ${c.id === grado?.categoria_id ? 'selected' : ''}>${c.nombre}</option>`).join('');
    }

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
    const categoriaId = document.getElementById('grado-categoria')?.value || null;

    let valido = true;
    if (!nombre)  { mostrarErrorCampo('grado-nombre', 'El nombre es obligatorio'); valido = false; }
    if (!seccion) { mostrarErrorCampo('grado-seccion', 'La sección es obligatoria'); valido = false; }
    if (!valido) return;

    const btn = document.getElementById('btn-guardar-grado');
    setBotonCargando(btn, true);

    const payload = { nombre, seccion, modalidad, anio, docente_guia_id: guia, categoria_id: categoriaId };
    // Un grado nuevo queda anclado al año activo — no se puede crear "suelto".
    if (!id) payload.año_academico_id = anioActivoCache?.id || null;
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
    if (!sel) return;
    sel.disabled = !chk.checked;

    // Al seleccionar (marcar) la materia, autocompletar el docente con el docente_id
    // por defecto de la materia. El admin igual puede cambiarlo manualmente después
    // para ese grado en particular.
    if (chk.checked) {
        const m = materiasCache.find(x => x.id === materiaId);
        sel.value = m?.docente_id || '';
    }
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
    if (gradoDrawerId === gradoId && gradoDrawerTab === 'materias') await renderTabDrawerGrado('materias');
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

    // Si el docente de la materia cambió, ese cambio se propaga a todos los grado_materia
    // de esta materia (más abajo) — se compara contra el valor previo a guardar.
    const materiaAnterior = id ? materiasCache.find(m => m.id === id) : null;
    const docenteCambio = !!materiaAnterior && materiaAnterior.docente_id !== docenteId;

    const btn = document.getElementById('btn-guardar-materia');
    setBotonCargando(btn, true);

    const { error } = id
        ? await supabase.from('materias').update({ nombre, codigo, docente_id: docenteId }).eq('id', id)
        : await supabase.from('materias').insert([{ nombre, codigo, docente_id: docenteId }]);

    if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error guardando la materia'); }

    if (docenteCambio) {
        const { error: errorProp } = await supabase.from('grado_materia')
            .update({ docente_id: docenteId })
            .eq('materia_id', id);
        if (errorProp) notificarError(errorProp, 'La materia se guardó, pero no se pudo propagar el docente a los grados que ya la tenían asignada');
    }

    setBotonCargando(btn, false);
    mostrarToast(id ? 'Materia actualizada' : 'Materia creada', 'exito');
    cerrarModal('modal-materia');
    await cargarTodo();
    renderMaterias();
};

window.eliminarMateria = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar esta materia? Se quitará de todos los grados donde está asignada.', { textoConfirmar: 'Eliminar' });
    if (!ok) return;

    // Primero quitar de todos los grados (si no, el FK de grado_materia hacia
    // materias impediría borrar la materia mientras siga asignada en algún grado).
    const { error: errorGm } = await supabase.from('grado_materia').delete().eq('materia_id', id);
    if (errorGm) return notificarError(errorGm, 'Error quitando la materia de los grados');

    const { error } = await supabase.from('materias').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando la materia');

    mostrarToast('Materia eliminada', 'exito');
    await cargarTodo();
    renderMaterias();
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

// ── GENERADOR AUTOMÁTICO DE HORARIOS ─────────
// Docente "efectivo" de una fila de grado_materia: el asignado directamente en
// grado_materia.docente_id, y si esa columna viene null, el docente por defecto
// de la materia (materias.docente_id) como fallback. Sin esto, una materia cuyo
// docente solo se configuró desde la sección Materias (no por-grado) aparecía
// como "Sin asignar" en el generador aunque en la práctica sí tuviera profesor.
function docenteEfectivoGradoMateria(gm) {
    const id = gm.docente_id || gm.materias?.docente_id || null;
    if (!id) return null;
    return { id, nombre: usuariosCache.find(u => u.id === id)?.nombre_completo || '' };
}

async function renderVistaGenerador() {
    document.getElementById('gen-formulario').classList.remove('hidden');
    document.getElementById('gen-resultado').classList.add('hidden');
    document.getElementById('gen-sin-solucion').classList.add('hidden');
    document.getElementById('gen-materias-lista').innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    try {
        // Datos frescos cada vez que se abre esta vista: recarga grados/usuarios/materias
        // (usuariosCache se usa para resolver el nombre del docente de fallback) y luego
        // las asignaciones de grado_materia.
        await cargarTodo();

        const { data, error } = await supabase
            .from('grado_materia')
            .select('*, grados(id, nombre, seccion, modalidad), materias(id, nombre, docente_id)')
            .order('grado_id');

        if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => renderVistaGenerador()); return; }
        ocultarBannerSinConexion();
        if (error) return notificarError(error, 'Error cargando materias asignadas');

        const filas = data || [];
        genSinDocenteCount = filas.filter(gm => !docenteEfectivoGradoMateria(gm)).length;

        // Conserva las horas/disponibilidad que el admin ya haya tocado si vuelve a esta vista.
        genAsignaciones = filas.filter(gm => docenteEfectivoGradoMateria(gm)).map(gm => {
            const doc = docenteEfectivoGradoMateria(gm);
            const anterior = genAsignaciones.find(a => a.id === gm.id);
            return {
                id: gm.id,
                gradoId: gm.grado_id,
                gradoNombre: `${gm.grados?.nombre || ''} ${gm.grados?.modalidad || ''} — Sección ${gm.grados?.seccion || ''}`,
                materiaId: gm.materia_id,
                materiaNombre: gm.materias?.nombre || '',
                docenteId: doc.id,
                docenteNombre: doc.nombre,
                horasPorSemana: anterior ? anterior.horasPorSemana : 4,
                incluida: anterior ? anterior.incluida : true,
            };
        });

        const docenteIds = [...new Set(genAsignaciones.map(a => a.docenteId))];
        genDocentes = docenteIds.map(id => {
            const anterior = genDocentes.find(d => d.id === id);
            const asign = genAsignaciones.find(a => a.docenteId === id);
            return { id, nombre: asign?.docenteNombre || '', disponibilidad: anterior ? anterior.disponibilidad : 'completa' };
        });

        renderFormularioGenerador();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderVistaGenerador()); return; }
        notificarError(err, 'Error cargando materias asignadas');
    }
}

function renderFormularioGenerador() {
    const avisoSinDocente = genSinDocenteCount
        ? `<div class="info-box">⚠ ${genSinDocenteCount} materia(s) sin docente asignado no se incluyen — asignalas primero en Grados → Materias del grado.</div>`
        : '';

    if (!genAsignaciones.length) {
        document.getElementById('gen-materias-lista').innerHTML = avisoSinDocente + '<div class="empty-bubbles">No hay materias con docente asignado todavía.</div>';
        document.getElementById('gen-docentes-lista').innerHTML = '';
        return;
    }

    const gradosAgrupados = new Map();
    genAsignaciones.forEach(a => {
        if (!gradosAgrupados.has(a.gradoId)) gradosAgrupados.set(a.gradoId, { nombre: a.gradoNombre, materias: [] });
        gradosAgrupados.get(a.gradoId).materias.push(a);
    });

    document.getElementById('gen-materias-lista').innerHTML = avisoSinDocente + [...gradosAgrupados.values()].map(g => `
        <div class="gen-grado-card">
            <div class="gen-grado-titulo">${g.nombre}</div>
            ${g.materias.map(a => `
                <div class="gen-materia-row ${a.incluida ? '' : 'gen-materia-excluida'}">
                    <label class="gen-materia-check">
                        <input type="checkbox" ${a.incluida ? 'checked' : ''} onchange="actualizarIncluidaGenerador('${a.id}', this.checked)">
                        <span>${a.materiaNombre} <span class="text-muted">— ${a.docenteNombre}</span></span>
                    </label>
                    <input type="number" min="1" max="10" value="${a.horasPorSemana}" class="gen-horas-input" ${a.incluida ? '' : 'disabled'}
                        onchange="actualizarHorasGenerador('${a.id}', this.value)">
                </div>
            `).join('')}
        </div>
    `).join('');

    document.getElementById('gen-docentes-lista').innerHTML = genDocentes.map(d => `
        <div class="gen-docente-row">
            <span>${d.nombre}</span>
            <select onchange="actualizarDisponibilidadGenerador('${d.id}', this.value)">
                <option value="completa" ${d.disponibilidad === 'completa' ? 'selected' : ''}>Jornada completa (P1-P10)</option>
                <option value="manana" ${d.disponibilidad === 'manana' ? 'selected' : ''}>Solo mañana (P1-P7)</option>
            </select>
        </div>
    `).join('');
}

window.actualizarHorasGenerador = (asignacionId, valor) => {
    const a = genAsignaciones.find(x => x.id === asignacionId);
    if (a) a.horasPorSemana = Math.max(1, Math.min(10, parseInt(valor, 10) || 1));
};

window.actualizarIncluidaGenerador = (asignacionId, checked) => {
    const a = genAsignaciones.find(x => x.id === asignacionId);
    if (!a) return;
    a.incluida = checked;
    renderFormularioGenerador(); // re-pinta para habilitar/deshabilitar el input de horas de esa fila
};

window.actualizarDisponibilidadGenerador = (docenteId, valor) => {
    const d = genDocentes.find(x => x.id === docenteId);
    if (d) d.disponibilidad = valor;
};

function construirConfigGenerador() {
    const disponibilidadDocente = {};
    genDocentes.forEach(d => { disponibilidadDocente[d.id] = d.disponibilidad; });
    return {
        asignaciones: genAsignaciones.filter(a => a.incluida).map(a => ({
            id: a.id, gradoId: a.gradoId, materiaId: a.materiaId,
            materiaNombre: a.materiaNombre, docenteId: a.docenteId, horasPorSemana: a.horasPorSemana,
        })),
        disponibilidadDocente,
    };
}

// debug:true imprime en consola (console.warn), cuando ningún intento encuentra
// una solución completa, qué materia/docente quedó bloqueado y con cuántas
// horas — abrí la consola del navegador (F12) antes de generar para verlo.
// permitirParcial:true cambia el contrato de retorno de generarHorario: en vez
// de Array|null, siempre devuelve { completo, filas, materiasNoColocadas }, así
// que acá se desarma esa forma en las variables de módulo de siempre
// (genResultado sigue siendo el Array de filas que usa el resto del código).
function aplicarResultadoGenerador(resultado) {
    genResultado = resultado.filas;
    genCompleto = resultado.completo;
    genMateriasNoColocadas = resultado.materiasNoColocadas;
    mostrarResultadoGenerador();
}

window.ejecutarGenerarHorario = () => {
    if (!genAsignaciones.some(a => a.incluida)) { mostrarToast('Marcá al menos una materia para generar el horario', 'advertencia'); return; }
    genSeed = Date.now() % 100000;
    aplicarResultadoGenerador(generarHorario(construirConfigGenerador(), genSeed, { debug: true, permitirParcial: true }));
};

window.generarOtroHorario = () => {
    genSeed += 1;
    aplicarResultadoGenerador(generarHorario(construirConfigGenerador(), genSeed, { debug: true, permitirParcial: true }));
};

function mostrarResultadoGenerador() {
    document.getElementById('gen-formulario').classList.add('hidden');

    // Con permitirParcial:true, generarHorario ya no devuelve null — un Array
    // vacío (nada se pudo colocar en ningún grado) es el único caso "sin nada
    // que mostrar" que queda.
    if (!genResultado || !genResultado.length) {
        document.getElementById('gen-sin-solucion').classList.remove('hidden');
        document.getElementById('gen-resultado').classList.add('hidden');
        return;
    }

    // Sanity check defensivo — el algoritmo nunca debería devolver choques,
    // pero si algo cambia en el futuro esto lo hace visible en vez de guardarlo así.
    const { ok } = verificarConflictos(genResultado);
    if (!ok) {
        genResultado = null;
        document.getElementById('gen-sin-solucion').classList.remove('hidden');
        document.getElementById('gen-resultado').classList.add('hidden');
        notificarError({ message: 'El generador produjo choques internos' }, 'Error inesperado');
        return;
    }

    document.getElementById('gen-sin-solucion').classList.add('hidden');
    document.getElementById('gen-resultado').classList.remove('hidden');
    renderAvisoMateriasNoColocadas();

    const gradosConHoras = [...new Map(genAsignaciones.map(a => [a.gradoId, a.gradoNombre])).entries()];
    const selPreview = document.getElementById('gen-grado-preview');
    selPreview.innerHTML = gradosConHoras.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
    if (!genGradoPreview || !gradosConHoras.find(([id]) => id === genGradoPreview)) {
        genGradoPreview = gradosConHoras[0]?.[0] || null;
    }
    selPreview.value = genGradoPreview;
    renderGridGenerador();
}

// Con permitirParcial:true el resultado puede ser una solución PARCIAL (no
// todas las materias/horas se pudieron ubicar) — esto avisa cuáles, sin
// bloquear la vista previa: el admin igual puede ver/guardar lo que sí se
// resolvió y completar el resto a mano en Horarios. El div se crea una sola
// vez (id fijo) y se reutiliza en cada render para no ir acumulando copias.
function renderAvisoMateriasNoColocadas() {
    let aviso = document.getElementById('gen-aviso-parcial');
    if (!aviso) {
        aviso = document.createElement('div');
        aviso.id = 'gen-aviso-parcial';
        aviso.className = 'info-box hidden';
        document.getElementById('gen-resultado').prepend(aviso);
    }

    if (genCompleto || !genMateriasNoColocadas.length) {
        aviso.classList.add('hidden');
        return;
    }

    aviso.classList.remove('hidden');
    const detalle = genMateriasNoColocadas.map(m => {
        const asign = genAsignaciones.find(a => a.id === m.asignacionId);
        return `${asign?.gradoNombre || m.gradoId} — ${m.materiaNombre || m.materiaId} (${asign?.docenteNombre || m.docenteId}): ${m.horasColocadas}/${m.horasRequeridas} horas ubicadas`;
    }).join('<br>');
    aviso.innerHTML = `⚠ No se encontró una solución 100% completa — se generó la mejor combinación posible, pero ${genMateriasNoColocadas.length} materia(s) quedaron con horas sin ubicar:<br>${detalle}`;
}

window.cambiarPreviewGenerador = () => {
    genGradoPreview = document.getElementById('gen-grado-preview').value;
    renderGridGenerador();
};

function renderGridGenerador() {
    const cont = document.getElementById('gen-grid');
    if (!genResultado || !genGradoPreview) { cont.innerHTML = ''; return; }

    const filasGrado = genResultado.filter(f => f.grado_id === genGradoPreview);
    const porCelda = {};
    filasGrado.forEach(f => { porCelda[`${f.dia}-${f.periodo}`] = f; });

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
            const f = porCelda[`${dia}-${b.periodo}`];
            if (f) {
                const asign = genAsignaciones.find(a => a.id === f.grado_materia_id);
                html += `
                <div class="hg-cell hg-ocupada-wrap">
                    <div class="hg-ocupada" style="background:${colorPorMateria(f.materia_id)}">
                        <div class="hg-materia">${asign?.materiaNombre || ''}</div>
                        <div class="hg-docente">${nombreCortoDocente(asign?.docenteNombre)}</div>
                    </div>
                </div>`;
            } else {
                html += '<div class="hg-cell hg-vacia"></div>';
            }
        });
    });

    cont.innerHTML = html;
}

window.descartarHorarioGenerado = () => {
    genResultado = null;
    genCompleto = true;
    genMateriasNoColocadas = [];
    document.getElementById('gen-resultado').classList.add('hidden');
    document.getElementById('gen-sin-solucion').classList.add('hidden');
    document.getElementById('gen-formulario').classList.remove('hidden');
};

window.guardarHorarioGenerado = async () => {
    if (!genResultado || !genResultado.length) return;

    const gradoIds = [...new Set(genResultado.map(f => f.grado_id))];
    const avisoParcial = !genCompleto
        ? ` ⚠ Esta combinación NO está completa — ${genMateriasNoColocadas.length} materia(s) quedaron con horas sin ubicar y vas a tener que completarlas manualmente después en Horarios.`
        : '';
    const ok = await mostrarConfirm(
        `Esto va a REEMPLAZAR el horario actual de ${gradoIds.length} grado(s) por el que acabás de generar.${avisoParcial} ¿Continuar?`,
        { textoConfirmar: 'Guardar y reemplazar' }
    );
    if (!ok) return;

    const btn = document.getElementById('btn-guardar-horario-generado');
    setBotonCargando(btn, true, 'Guardando...');

    const { error: eDel } = await supabase.from('horarios').delete().in('grado_id', gradoIds);
    if (eDel) { setBotonCargando(btn, false); return notificarError(eDel, 'Error limpiando el horario anterior'); }

    const { error: eIns } = await supabase.from('horarios').insert(genResultado);
    setBotonCargando(btn, false);
    if (eIns) return notificarError(eIns, 'Error guardando el horario generado');

    mostrarToast('Horario generado guardado correctamente', 'exito');
    horarioGradoSel = null; // fuerza recargar si el admin va a la vista manual de Horarios
    window.descartarHorarioGenerado();
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

    if (!anioActivoCache) {
        document.getElementById('lista-asistencia').innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>';
        return;
    }

    try {
        const { data: matriculas, error: eAl } = await supabase
            .from('matriculas')
            .select('*, alumnos(*)')
            .eq('grado_id', asisGradoId)
            .eq('año_academico_id', anioActivoCache.id)
            .eq('activo', true);

        if (eAl && esErrorDeRed(eAl)) { mostrarBannerSinConexion(() => cargarAsistenciaDiaAdmin()); return; }
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

    if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }

    let queryMatriculas = supabase.from('matriculas').select('*, alumnos(*), grados(nombre, seccion)')
        .eq('año_academico_id', anioActivoCache.id).eq('activo', true);
    if (gradoFiltro) queryMatriculas = queryMatriculas.eq('grado_id', gradoFiltro);
    const { data: matriculas, error: eAl } = await queryMatriculas;
    if (eAl) { notificarError(eAl, 'Error cargando alumnos'); return; }
    const alumnos = (matriculas || []).map(m => ({ ...m.alumnos, grados: m.grados })).filter(a => a.id);
    if (!alumnos.length) { cont.innerHTML = '<div class="empty-bubbles">No hay alumnos para este filtro.</div>'; return; }

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

// ── EXPEDIENTES DISCIPLINARIOS ───────────────
function renderVistaExpedientes() {
    document.getElementById('exp-admin-busqueda').value = '';
    document.getElementById('exp-admin-resultados').innerHTML = '';
    document.getElementById('exp-admin-detalle').classList.add('hidden');
    expAdminAlumnoSel = null;
}

window.onInputBuscarExpediente = () => {
    clearTimeout(expBuscarTimeout);
    expBuscarTimeout = setTimeout(() => window.buscarAlumnoExpediente(), 300);
};

window.buscarAlumnoExpediente = async () => {
    const texto = document.getElementById('exp-admin-busqueda').value.trim();
    const cont = document.getElementById('exp-admin-resultados');
    if (!texto) { cont.innerHTML = ''; return; }

    cont.innerHTML = '<div class="empty-bubbles">Buscando…</div>';
    // La búsqueda es sobre el catálogo de alumnos (nombres/apellidos/nie ya no
    // tienen grado_id embebido). El grado que se muestra es su matrícula del
    // año activo, si tiene una — se busca aparte porque alumnos ya no tiene FK a grados.
    const { data, error } = await supabase
        .from('alumnos')
        .select('*')
        .or(`nombres.ilike.%${texto}%,apellidos.ilike.%${texto}%,nie.ilike.%${texto}%`)
        .order('apellidos')
        .limit(20);

    if (error) { notificarError(error, 'Error buscando alumnos'); return; }

    expAdminAlumnos = data || [];
    if (!expAdminAlumnos.length) { cont.innerHTML = '<div class="empty-bubbles">Sin resultados.</div>'; return; }

    if (anioActivoCache && expAdminAlumnos.length) {
        const { data: matriculas } = await supabase
            .from('matriculas')
            .select('alumno_id, grados(nombre, seccion)')
            .in('alumno_id', expAdminAlumnos.map(a => a.id))
            .eq('año_academico_id', anioActivoCache.id)
            .eq('activo', true);
        const gradoPorAlumno = {};
        (matriculas || []).forEach(m => { gradoPorAlumno[m.alumno_id] = m.grados; });
        expAdminAlumnos = expAdminAlumnos.map(a => ({ ...a, grados: gradoPorAlumno[a.id] || null }));
    }

    cont.innerHTML = expAdminAlumnos.map(a => `
        <div class="exp-resultado-item" onclick="seleccionarAlumnoExpedienteAdmin('${a.id}')">
            <span>${a.apellidos}, ${a.nombres}</span>
            <span class="text-muted">NIE ${a.nie || '—'} · ${a.grados?.nombre || ''} ${a.grados?.seccion || ''}</span>
        </div>
    `).join('');
};

window.seleccionarAlumnoExpedienteAdmin = (alumnoId) => {
    expAdminAlumnoSel = alumnoId;
    const alumno = expAdminAlumnos.find(a => a.id === alumnoId);
    document.getElementById('exp-admin-resultados').innerHTML = '';
    document.getElementById('exp-admin-busqueda').value = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    document.getElementById('exp-admin-detalle').classList.remove('hidden');
    document.getElementById('exp-admin-nombre').textContent = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    cargarExpedienteAdmin(alumnoId);
};

async function cargarExpedienteAdmin(alumnoId) {
    document.getElementById('exp-admin-timeline').innerHTML = '<div class="empty-bubbles">Cargando…</div>';
    try {
        const [{ data: anec, error: e1 }, { data: dem, error: e2 }, { data: act, error: e3 }] = await Promise.all([
            supabase.from('anecdoticos').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('demeritos').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
            supabase.from('actas').select('*, usuarios(nombre_completo)').eq('alumno_id', alumnoId),
        ]);

        const errorDeRed = [e1, e2, e3].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => cargarExpedienteAdmin(alumnoId)); return; }
        ocultarBannerSinConexion();
        if (e1) return notificarError(e1, 'Error cargando anecdóticos');
        if (e2) return notificarError(e2, 'Error cargando deméritos');
        if (e3) return notificarError(e3, 'Error cargando actas');

        expAdminTimeline = [
            ...(anec || []).map(r => ({ ...r, tabla: 'anecdoticos', tipoClave: 'anecdotico', registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(dem  || []).map(r => ({ ...r, tabla: 'demeritos',   tipoClave: `demerito_${r.categoria}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(act  || []).map(r => ({ ...r, tabla: 'actas',       tipoClave: r.tipo, registradoPor: r.usuarios?.nombre_completo || '—' })),
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        renderResumenExpedienteAdmin();
        renderTimelineExpedienteAdmin();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarExpedienteAdmin(alumnoId)); return; }
        notificarError(err, 'Error cargando el expediente');
    }
}

function renderResumenExpedienteAdmin() {
    const cont = document.getElementById('exp-admin-resumen');
    const contar = (clave) => expAdminTimeline.filter(r => r.tipoClave === clave).length;
    cont.innerHTML = `
        <div class="exp-stat"><div class="exp-stat-val" style="color:#d97706">${contar('demerito_leve')}</div><div class="exp-stat-label">Deméritos leves</div></div>
        <div class="exp-stat"><div class="exp-stat-val" style="color:#ea580c">${contar('demerito_grave')}</div><div class="exp-stat-label">Deméritos graves</div></div>
        <div class="exp-stat"><div class="exp-stat-val" style="color:#dc2626">${contar('demerito_muy_grave')}</div><div class="exp-stat-label">Muy graves</div></div>
        <div class="exp-stat"><div class="exp-stat-val" style="color:#991b1b">${contar('suspension')}</div><div class="exp-stat-label">Suspensiones</div></div>
        <div class="exp-stat"><div class="exp-stat-val" style="color:#059669">${contar('reconocimiento')}</div><div class="exp-stat-label">Reconocimientos</div></div>
    `;
}

function renderTimelineExpedienteAdmin() {
    const cont = document.getElementById('exp-admin-timeline');
    if (!expAdminTimeline.length) {
        cont.innerHTML = '<div class="empty-bubbles">Este alumno no tiene registros en su expediente todavía.</div>';
        return;
    }

    cont.innerHTML = expAdminTimeline.map(r => {
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
                <div class="exp-item-registro">
                    Registrado por ${r.registradoPor}
                    <button type="button" class="exp-item-btn" onclick="editarRegistroExpediente('${r.tabla}', '${r.id}')">Editar</button>
                    <button type="button" class="exp-item-btn exp-item-btn-del" onclick="eliminarRegistroExpediente('${r.tabla}', '${r.id}')">Eliminar</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.editarRegistroExpediente = (tabla, id) => {
    const registro = expAdminTimeline.find(r => r.tabla === tabla && r.id === id);
    if (!registro) return;

    document.getElementById('exp-edit-tabla').value = tabla;
    document.getElementById('exp-edit-id').value = id;
    document.getElementById('exp-edit-descripcion').value = registro.descripcion;
    document.getElementById('modal-exp-editar-title').textContent =
        TIPOS_EXPEDIENTE.find(t => t.clave === registro.tipoClave)?.label || 'Editar registro';

    const campoCategoria = document.getElementById('exp-edit-campo-categoria');
    const campoDias = document.getElementById('exp-edit-campo-dias');
    const esSuspension = tabla === 'actas' && registro.tipo === 'suspension';
    campoCategoria.classList.toggle('hidden', tabla !== 'demeritos');
    campoDias.classList.toggle('hidden', !esSuspension);
    if (tabla === 'demeritos') document.getElementById('exp-edit-categoria').value = registro.categoria;
    if (esSuspension) document.getElementById('exp-edit-dias').value = registro.dias_suspension || 1;

    abrirModal('modal-exp-editar');
};

window.guardarEdicionExpediente = async () => {
    const tabla = document.getElementById('exp-edit-tabla').value;
    const id = document.getElementById('exp-edit-id').value;
    const descripcion = document.getElementById('exp-edit-descripcion').value.trim();
    if (!descripcion) { mostrarToast('Escribí una descripción', 'advertencia'); return; }

    const payload = { descripcion };
    if (tabla === 'demeritos') payload.categoria = document.getElementById('exp-edit-categoria').value;
    if (!document.getElementById('exp-edit-campo-dias').classList.contains('hidden')) {
        payload.dias_suspension = parseInt(document.getElementById('exp-edit-dias').value, 10) || 0;
    }

    const btn = document.getElementById('btn-guardar-exp-editar');
    setBotonCargando(btn, true);

    const { error } = await supabase.from(tabla).update(payload).eq('id', id);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando los cambios');

    mostrarToast('Registro actualizado', 'exito');
    cerrarModal('modal-exp-editar');
    await cargarExpedienteAdmin(expAdminAlumnoSel);
};

window.eliminarRegistroExpediente = async (tabla, id) => {
    const ok = await mostrarConfirm('¿Eliminar este registro del expediente? Esta acción no se puede deshacer.', { textoConfirmar: 'Eliminar' });
    if (!ok) return;

    const { error } = await supabase.from(tabla).delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el registro');

    mostrarToast('Registro eliminado', 'exito');
    await cargarExpedienteAdmin(expAdminAlumnoSel);
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

// ── AÑO ACADÉMICO ────────────────────────────
async function renderVistaAnioAcademico() {
    const cont = document.getElementById('anio-academico-body');
    if (!cont) return;
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    const { data, error } = await supabase.from('años_academicos').select('*').order('anio', { ascending: false });
    if (error) return notificarError(error, 'Error cargando años académicos');
    aniosAcademicosCache = data || [];

    if (!aniosAcademicosCache.length) {
        cont.innerHTML = '<div class="info-box">⚠ No hay ningún año académico configurado todavía. Creá el primero con el botón "+ Nuevo Año Académico" de arriba.</div>';
        return;
    }

    cont.innerHTML = aniosAcademicosCache.map(a => `
        <div class="grado-row-card" style="cursor:default">
            <div class="grc-nombre-wrap">
                <div class="grc-nombre">Año ${a.anio} ${a.activo ? '<span class="badge-mod mod-voc">ACTIVO</span>' : ''}</div>
                <div class="grc-seccion">${a.fecha_inicio || '—'} a ${a.fecha_fin || '—'}</div>
            </div>
            <div class="grc-guia" style="min-width:auto;margin-left:auto">
                <button class="btn-sm btn-del" onclick="eliminarAnioAcademico('${a.id}')">Eliminar</button>
            </div>
        </div>
    `).join('');
}

window.abrirModalNuevoAnio = () => {
    document.getElementById('nanio-numero').value = (anioActivoCache?.anio || new Date().getFullYear()) + 1;
    document.getElementById('nanio-inicio').value = '';
    document.getElementById('nanio-fin').value = '';
    document.getElementById('nanio-copiar').checked = !!anioActivoCache;
    document.getElementById('nanio-copiar-wrap').classList.toggle('hidden', !anioActivoCache);
    abrirModal('modal-nuevo-anio');
};

// Clona grados + grado_materia + horarios del año anterior hacia el año nuevo.
// Materias y docentes son catálogos globales (no están atados a un año), así
// que no hace falta clonarlos — solo las asociaciones que sí son por-año.
async function copiarEstructuraAnio(anioAnteriorId, anioNuevoId, anioNuevoNumero) {
    const { data: gradosViejos, error: eG } = await supabase.from('grados').select('*').eq('año_academico_id', anioAnteriorId);
    if (eG) throw eG;
    if (!gradosViejos?.length) return;

    const mapaGrados = {};
    for (const g of gradosViejos) {
        const { data: nuevo, error } = await supabase.from('grados').insert([{
            nombre: g.nombre, seccion: g.seccion, modalidad: g.modalidad, anio: anioNuevoNumero,
            docente_guia_id: g.docente_guia_id, categoria_id: g.categoria_id, año_academico_id: anioNuevoId,
        }]).select().single();
        if (error) throw error;
        mapaGrados[g.id] = nuevo.id;
    }

    const gradoIdsViejos = Object.keys(mapaGrados);

    const { data: gmViejos, error: eGm } = await supabase.from('grado_materia').select('*').in('grado_id', gradoIdsViejos);
    if (eGm) throw eGm;
    if (gmViejos?.length) {
        const nuevosGm = gmViejos.map(gm => ({ grado_id: mapaGrados[gm.grado_id], materia_id: gm.materia_id, docente_id: gm.docente_id }));
        const { error } = await supabase.from('grado_materia').insert(nuevosGm);
        if (error) throw error;
    }

    const { data: horViejos, error: eHor } = await supabase.from('horarios').select('*').in('grado_id', gradoIdsViejos);
    if (eHor) throw eHor;
    if (horViejos?.length) {
        const nuevosHor = horViejos.map(h => ({
            grado_id: mapaGrados[h.grado_id], materia_id: h.materia_id, docente_id: h.docente_id,
            dia: h.dia, periodo: h.periodo, hora_inicio: h.hora_inicio, hora_fin: h.hora_fin, año_academico_id: anioNuevoId,
        }));
        const { error } = await supabase.from('horarios').insert(nuevosHor);
        if (error) throw error;
    }
}

window.guardarNuevoAnio = async () => {
    const anio          = parseInt(document.getElementById('nanio-numero').value, 10);
    const fechaInicio    = document.getElementById('nanio-inicio').value || null;
    const fechaFin       = document.getElementById('nanio-fin').value || null;
    const copiarEstructura = document.getElementById('nanio-copiar').checked;

    if (!anio) { mostrarToast('Ingresá el año', 'advertencia'); return; }

    const btn = document.getElementById('btn-guardar-nuevo-anio');
    setBotonCargando(btn, true);

    const { data: nuevoAnio, error } = await supabase.from('años_academicos')
        .insert([{ anio, fecha_inicio: fechaInicio, fecha_fin: fechaFin, activo: false }])
        .select().single();

    if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error creando el año académico'); }

    if (copiarEstructura && anioActivoCache) {
        try {
            await copiarEstructuraAnio(anioActivoCache.id, nuevoAnio.id, anio);
        } catch (err) {
            setBotonCargando(btn, false);
            notificarError(err, 'El año se creó, pero hubo un error copiando la estructura del año anterior');
            cerrarModal('modal-nuevo-anio');
            await renderVistaAnioAcademico();
            return;
        }
    }

    setBotonCargando(btn, false);
    mostrarToast(`Año ${anio} creado` + (copiarEstructura ? ' con la estructura del año anterior copiada' : ''), 'exito');
    cerrarModal('modal-nuevo-anio');
    await renderVistaAnioAcademico();
};

window.abrirModalCambiarAnio = () => {
    const sel = document.getElementById('canio-select');
    sel.innerHTML = aniosAcademicosCache.map(a =>
        `<option value="${a.id}" ${a.activo ? 'selected' : ''}>Año ${a.anio}${a.activo ? ' (activo actualmente)' : ''}</option>`
    ).join('');
    abrirModal('modal-cambiar-anio');
};

window.guardarCambioAnioActivo = async () => {
    const nuevoId = document.getElementById('canio-select').value;
    if (!nuevoId) { mostrarToast('Seleccioná un año', 'advertencia'); return; }
    if (anioActivoCache && nuevoId === anioActivoCache.id) { cerrarModal('modal-cambiar-anio'); return; }

    const btn = document.getElementById('btn-guardar-cambio-anio');
    setBotonCargando(btn, true);

    // Primero desactivar el año actual — el índice único parcial de
    // años_academicos.activo no permite tener dos años activos a la vez,
    // así que este paso tiene que confirmarse antes de activar el nuevo.
    if (anioActivoCache) {
        const { error } = await supabase.from('años_academicos').update({ activo: false }).eq('id', anioActivoCache.id);
        if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error desactivando el año anterior'); }
    }
    const { error } = await supabase.from('años_academicos').update({ activo: true }).eq('id', nuevoId);
    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error activando el nuevo año');

    mostrarToast('Año académico activo actualizado', 'exito');
    cerrarModal('modal-cambiar-anio');
    await cargarTodo();
    if (vistaActual === 'anio-academico') await renderVistaAnioAcademico();
};

window.eliminarAnioAcademico = async (id) => {
    const anio = aniosAcademicosCache.find(a => a.id === id);
    if (!anio) return;
    const escrito = window.prompt(
        `Esta acción borra TODO lo relacionado al año ${anio.anio} (grados, horarios, notas, asistencias, competencias, criterios de evaluación, matrículas y períodos académicos). No se puede deshacer.\n\nEscribí "${anio.anio}" para confirmar:`
    );
    if (escrito !== String(anio.anio)) { mostrarToast('Cancelado', 'info'); return; }

    const { error } = await supabase.from('años_academicos').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando el año académico');
    mostrarToast(`Año ${anio.anio} eliminado`, 'exito');
    await cargarTodo();
    await renderVistaAnioAcademico();
};

// ── MATRÍCULA DE ALUMNOS ─────────────────────
async function renderVistaMatricula() {
    const cont = document.getElementById('matricula-body');
    if (!cont) return;
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    if (!anioActivoCache) {
        cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo — configuralo en "Año Académico" antes de matricular alumnos.</div>';
        return;
    }

    const [{ data: alumnos, error: eAl }, { data: matriculas, error: eMat }] = await Promise.all([
        supabase.from('alumnos').select('*').order('apellidos'),
        supabase.from('matriculas').select('*').eq('año_academico_id', anioActivoCache.id).eq('activo', true),
    ]);
    if (eAl)  return notificarError(eAl, 'Error cargando el catálogo de alumnos');
    if (eMat) return notificarError(eMat, 'Error cargando las matrículas');

    const matriculaPorAlumno = {};
    (matriculas || []).forEach(m => { matriculaPorAlumno[m.alumno_id] = m; });
    matriculaAlumnosCache = (alumnos || []).map(a => ({ ...a, matricula: matriculaPorAlumno[a.id] || null }));

    cont.innerHTML = matriculaAlumnosCache.map(a => {
        const grado = a.matricula ? gradosCache.find(g => g.id === a.matricula.grado_id) : null;
        return `
        <div class="mat-fila">
            <div class="mat-nombre">${a.apellidos}, ${a.nombres} <span class="text-muted">NIE ${a.nie || '—'}</span></div>
            <div class="mat-estado">${grado ? `${grado.nombre} ${grado.seccion}` : '<span class="text-muted">No matriculado este año</span>'}</div>
            <div class="mat-acciones">
                <select id="mat-grado-${a.id}">
                    <option value="">— Elegir grado —</option>
                    ${gradosCache.map(g => `<option value="${g.id}" ${g.id === a.matricula?.grado_id ? 'selected' : ''}>${g.nombre} ${g.seccion}</option>`).join('')}
                </select>
                <button class="btn-sm btn-info" onclick="matricularAlumno('${a.id}')">${a.matricula ? 'Cambiar' : 'Matricular'}</button>
                ${a.matricula ? `<button class="btn-sm btn-del" onclick="desmatricularAlumno('${a.matricula.id}')">Desmatricular</button>` : ''}
            </div>
        </div>`;
    }).join('') || '<div class="empty-bubbles">No hay alumnos en el catálogo todavía.</div>';
}

window.matricularAlumno = async (alumnoId) => {
    const gradoId = document.getElementById(`mat-grado-${alumnoId}`).value;
    if (!gradoId) { mostrarToast('Elegí un grado', 'advertencia'); return; }
    const { error } = await supabase.from('matriculas').upsert(
        [{ alumno_id: alumnoId, grado_id: gradoId, año_academico_id: anioActivoCache.id, activo: true }],
        { onConflict: 'alumno_id,año_academico_id' }
    );
    if (error) return notificarError(error, 'Error matriculando al alumno');
    mostrarToast('Alumno matriculado', 'exito');
    await renderVistaMatricula();
};

window.desmatricularAlumno = async (matriculaId) => {
    const ok = await mostrarConfirm('¿Desmatricular a este alumno del año activo?', { textoConfirmar: 'Desmatricular' });
    if (!ok) return;
    const { error } = await supabase.from('matriculas').update({ activo: false }).eq('id', matriculaId);
    if (error) return notificarError(error, 'Error desmatriculando al alumno');
    mostrarToast('Alumno desmatriculado', 'exito');
    await renderVistaMatricula();
};

// ── CATEGORÍAS DE GRADOS ─────────────────────
async function renderVistaCategoriasGrado() {
    const tbody = document.getElementById('tbody-categorias-grado');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Cargando…</td></tr>';

    const { data, error } = await supabase.from('categorias_grado').select('*').order('nombre');
    if (error) return notificarError(error, 'Error cargando categorías');
    categoriasGradoCache = data || [];

    tbody.innerHTML = categoriasGradoCache.map(c => `
        <tr>
            <td class="td-bold">${c.nombre}</td>
            <td>${c.descripcion || '—'}</td>
            <td>
                <button class="btn-sm btn-edit" onclick="abrirModalCategoriaGrado('${c.id}')">Editar</button>
                <button class="btn-sm btn-del" onclick="eliminarCategoriaGrado('${c.id}')">Eliminar</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="text-center text-muted">Sin categorías todavía</td></tr>';
}

window.abrirModalCategoriaGrado = (id = null) => {
    const c = id ? categoriasGradoCache.find(x => x.id === id) : null;
    document.getElementById('modal-categoria-grado-title').textContent = c ? 'Editar Categoría' : 'Nueva Categoría';
    document.getElementById('categoria-grado-id').value = c?.id || '';
    document.getElementById('categoria-grado-nombre').value = c?.nombre || '';
    document.getElementById('categoria-grado-descripcion').value = c?.descripcion || '';
    document.getElementById('categoria-grado-orden').value = c?.orden ?? categoriasGradoCache.length;
    abrirModal('modal-categoria-grado');
};

window.guardarCategoriaGrado = async () => {
    const id          = document.getElementById('categoria-grado-id').value;
    const nombre      = document.getElementById('categoria-grado-nombre').value.trim();
    const descripcion = document.getElementById('categoria-grado-descripcion').value.trim();
    const orden       = parseInt(document.getElementById('categoria-grado-orden').value, 10) || 0;
    if (!nombre) { mostrarErrorCampo('categoria-grado-nombre', 'El nombre es obligatorio'); return; }

    const btn = document.getElementById('btn-guardar-categoria-grado');
    setBotonCargando(btn, true);
    const { error } = id
        ? await supabase.from('categorias_grado').update({ nombre, descripcion, orden }).eq('id', id)
        : await supabase.from('categorias_grado').insert([{ nombre, descripcion, orden }]);
    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error guardando la categoría');

    mostrarToast(id ? 'Categoría actualizada' : 'Categoría creada', 'exito');
    cerrarModal('modal-categoria-grado');
    await renderVistaCategoriasGrado();
    await cargarTodo(); // refresca categoriasGradoCache usada al agrupar la vista Grados
};

window.eliminarCategoriaGrado = async (id) => {
    const ok = await mostrarConfirm('¿Eliminar esta categoría? Los grados que la usaban quedarán sin categoría.', { textoConfirmar: 'Eliminar' });
    if (!ok) return;
    const { error } = await supabase.from('categorias_grado').delete().eq('id', id);
    if (error) return notificarError(error, 'Error eliminando la categoría');
    mostrarToast('Categoría eliminada', 'exito');
    await renderVistaCategoriasGrado();
    await cargarTodo();
};

// ── OTROS REPORTES ───────────────────────────
window.imprimirMatriculaAdmin = () => {
    const gradoId = document.getElementById('filtro-grado')?.value;
    if (!gradoId) { mostrarToast('Seleccioná un grado en el filtro de Alumnos primero', 'advertencia'); return; }
    window.open(`./reporte-matricula.html?grado=${gradoId}`, '_blank');
};

function renderVistaReportes() {
    const opciones = '<option value="">— Seleccioná un grado —</option>' +
        gradosCache.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');

    document.getElementById('rep-matricula-grado').innerHTML = opciones;
    document.getElementById('rep-notas-grado').innerHTML = opciones;
    document.getElementById('rep-act-grado').innerHTML = opciones;
    document.getElementById('rep-act-materia').innerHTML = '<option value="">— Elegí un grado primero —</option>';
}

window.imprimirMatriculaDesdeReportes = () => {
    const gradoId = document.getElementById('rep-matricula-grado').value;
    if (!gradoId) { mostrarToast('Seleccioná un grado', 'advertencia'); return; }
    window.open(`./reporte-matricula.html?grado=${gradoId}`, '_blank');
};

window.imprimirReporteNotasAdmin = () => {
    const gradoId = document.getElementById('rep-notas-grado').value;
    const periodo = document.getElementById('rep-notas-periodo').value;
    if (!gradoId) { mostrarToast('Seleccioná un grado', 'advertencia'); return; }
    window.open(`./reporte-notas.html?grado=${gradoId}&periodo=${periodo}`, '_blank');
};

window.cambiarGradoActividadesAdmin = async () => {
    const gradoId = document.getElementById('rep-act-grado').value;
    const selMateria = document.getElementById('rep-act-materia');
    if (!gradoId) { selMateria.innerHTML = '<option value="">— Elegí un grado primero —</option>'; return; }

    selMateria.innerHTML = '<option value="">Cargando…</option>';
    const { data, error } = await supabase.from('grado_materia').select('*, materias(id, nombre)').eq('grado_id', gradoId);
    if (error) { notificarError(error, 'Error cargando materias del grado'); return; }

    selMateria.innerHTML = '<option value="">— Seleccioná una materia —</option>' +
        (data || []).map(gm => `<option value="${gm.id}">${gm.materias?.nombre || ''}</option>`).join('');
};

window.imprimirListaActividadesAdmin = () => {
    const gradoId = document.getElementById('rep-act-grado').value;
    const materiaId = document.getElementById('rep-act-materia').value;
    const periodo = document.getElementById('rep-act-periodo').value;
    const cotidianas = document.getElementById('rep-act-cotidianas').value || 0;
    const integradoras = document.getElementById('rep-act-integradoras').value || 0;
    const examenes = document.getElementById('rep-act-examenes').value || 0;
    if (!gradoId || !materiaId) { mostrarToast('Seleccioná grado y materia', 'advertencia'); return; }
    window.open(`./reporte-lista-actividades.html?grado=${gradoId}&materia=${materiaId}&periodo=${periodo}&cotidianas=${cotidianas}&integradoras=${integradoras}&examenes=${examenes}`, '_blank');
};

// ── ALUMNOS ─────────────────────────────────
// matriculaPorAlumnoCache: alumno_id -> fila de `matriculas` del año activo
// que se ve actualmente en la tabla — se usa para precargar el grado al
// editar (abrirModalAlumno) sin hacer una query extra por cada click en Editar.
let matriculaPorAlumnoCache = {};

window.renderAlumnos = async function renderAlumnos() {
    renderSkeletonFilas('tbody-alumnos', 6, 6);

    if (!anioActivoCache) {
        document.getElementById('tbody-alumnos').innerHTML =
            '<tr><td colspan="6"><div class="info-box">⚠ No hay un año académico activo — configuralo en "Año Académico".</div></td></tr>';
        alumnosCache = [];
        return;
    }

    const gradoFiltro = document.getElementById('filtro-grado')?.value || '';
    let query = supabase.from('matriculas').select('*, alumnos(*), grados(nombre, seccion)')
        .eq('año_academico_id', anioActivoCache.id).eq('activo', true);
    if (gradoFiltro) query = query.eq('grado_id', gradoFiltro);
    const { data, error } = await query;

    if (error) { notificarError(error, 'Error cargando alumnos'); return; }

    matriculaPorAlumnoCache = {};
    alumnosCache = (data || [])
        .filter(m => m.alumnos)
        .map(m => {
            matriculaPorAlumnoCache[m.alumnos.id] = m;
            return { ...m.alumnos, grados: m.grados };
        })
        .sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

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
    const matriculaActual = id ? matriculaPorAlumnoCache[id] : null;
    document.getElementById('modal-alumno-title').textContent = a ? 'Editar Alumno' : 'Nuevo Alumno';
    document.getElementById('alumno-id').value        = a?.id || '';
    document.getElementById('alumno-nie').value       = a?.nie || '';
    document.getElementById('alumno-nombres').value   = a?.nombres || '';
    document.getElementById('alumno-apellidos').value = a?.apellidos || '';
    document.getElementById('alumno-foto-preview').src = a?.foto_url || '';
    document.getElementById('alumno-foto-preview').style.display = a?.foto_url ? 'block' : 'none';

    const sel = document.getElementById('alumno-grado');
    sel.innerHTML = '<option value="">— Seleccionar grado —</option>' +
        gradosCache.map(g => `<option value="${g.id}" ${g.id === matriculaActual?.grado_id ? 'selected' : ''}>${g.nombre} ${g.seccion}</option>`).join('');

    abrirModal('modal-alumno');
};

window.editarAlumno = (id) => window.abrirModalAlumno(id);

window.guardarAlumno = async () => {
    limpiarErroresFormulario(CAMPOS_ALUMNO);
    if (!anioActivoCache) { mostrarToast('No hay un año académico activo — configuralo primero en "Año Académico"', 'advertencia'); return; }

    const id        = document.getElementById('alumno-id').value;
    const nie       = document.getElementById('alumno-nie').value.trim();
    const nombres   = document.getElementById('alumno-nombres').value.trim().toUpperCase();
    const apellidos = document.getElementById('alumno-apellidos').value.trim().toUpperCase();
    const gradoId   = document.getElementById('alumno-grado').value;
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

    // `alumnos` es catálogo puro (sin grado_id/anio_ingreso/activo) — el grado
    // se guarda aparte, como una matrícula del año activo (ver migracion-años.sql).
    const payloadAlumno = { nie, nombres, apellidos, foto_url };
    const { data: alumnoGuardado, error } = id
        ? await supabase.from('alumnos').update(payloadAlumno).eq('id', id).select().single()
        : await supabase.from('alumnos').insert([payloadAlumno]).select().single();

    if (error) { setBotonCargando(btn, false); return notificarError(error, 'Error guardando el alumno'); }

    const { error: errorMatricula } = await supabase.from('matriculas').upsert(
        [{ alumno_id: alumnoGuardado.id, grado_id: gradoId, año_academico_id: anioActivoCache.id, activo: true }],
        { onConflict: 'alumno_id,año_academico_id' }
    );

    setBotonCargando(btn, false);
    if (errorMatricula) return notificarError(errorMatricula, 'El alumno se guardó, pero no se pudo matricular en el grado');

    mostrarToast(id ? 'Alumno actualizado' : 'Alumno creado', 'exito');
    cerrarModal('modal-alumno');
    if (vistaActual === 'matricula') await renderVistaMatricula();
    else await renderAlumnos();
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
    if (!anioActivoCache) return mostrarToast('No hay un año académico activo', 'advertencia');
    const grado = gradosCache.find(g => g.id === gradoId);
    const ok = await mostrarConfirm(
        `¿Eliminar TODOS los alumnos matriculados en ${grado.nombre} ${grado.seccion} este año? Esta acción no se puede deshacer.`,
        { textoConfirmar: 'Eliminar todos' }
    );
    if (!ok) return;

    const { data: matriculas, error: eMat } = await supabase
        .from('matriculas').select('alumno_id')
        .eq('grado_id', gradoId).eq('año_academico_id', anioActivoCache.id).eq('activo', true);
    if (eMat) return notificarError(eMat, 'Error buscando los alumnos del grado');

    const alumnoIds = (matriculas || []).map(m => m.alumno_id);
    if (!alumnoIds.length) { await renderAlumnos(); return; }

    const { error } = await supabase.from('alumnos').delete().in('id', alumnoIds);
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
    if (!anioActivoCache) {
        mostrarToast('No hay un año académico activo — configuralo primero en "Año Académico"', 'advertencia');
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
                nuevos.push({ nie, apellidos, nombres });
            }

            if (!nuevos.length) { mostrarToast('No se encontraron alumnos en el archivo', 'advertencia'); return; }

            // 1. Crear en el catálogo `alumnos` (ya no lleva grado_id/activo/anio_ingreso).
            const { data: alumnosCreados, error } = await supabase.from('alumnos').insert(nuevos).select();
            if (error) { notificarError(error, 'Error importando alumnos'); return; }

            // 2. Matricularlos a todos en el grado del filtro, para el año activo.
            const matriculasNuevas = (alumnosCreados || []).map(a => ({
                alumno_id: a.id, grado_id: gradoId, año_academico_id: anioActivoCache.id, activo: true,
            }));
            const { error: errorMat } = await supabase.from('matriculas').insert(matriculasNuevas);
            if (errorMat) { notificarError(errorMat, 'Los alumnos se crearon, pero no se pudieron matricular'); return; }

            mostrarToast(`${nuevos.length} alumno(s) importado(s) y matriculado(s) correctamente`, 'exito');
            await renderAlumnos();
        } catch (err) {
            notificarError(err, 'Error leyendo el archivo');
        }
    };
    reader.readAsBinaryString(file);
    event.target.value = '';
};
