// ═══════════════════════════════════════════
//  IDSJE — Panel Administrador
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion, subirFoto } from './auth.js';
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET, INSTITUTO, ESTADOS_ASISTENCIA, TIPOS_EXPEDIENTE, CODIGOS_DEMERITO, NIVELES_DEMERITO, TIPOS_AMONESTACION, TIPOS_RECONOCIMIENTO, getAñoActivo } from './config.js';
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
    diasHabilesDelMes,
    calcularTotalesAsistencia,
    contarDemeritosActivos,
    calcularNivelDemerito,
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

// Expedientes disciplinarios (Módulo 5 — SOLO LECTURA, mezcla los 4 módulos)
let expAdminGradoSel     = null; // grado_id elegido en el selector
let expAdminAlumnosGrado = [];   // alumnos matriculados (año activo) en expAdminGradoSel
let expAdminAlumnoSel    = null;
let expAdminTimeline     = [];

// Deméritos (Módulo 1) — escala de consecuencias por nivel (ver NIVELES_DEMERITO en config.js)
let demGradoFiltro       = null; // grado_id elegido — sin grado, las tarjetas muestran el conteo de toda la escuela
let demNivelFiltroRoster = null; // clave de NIVELES_DEMERITO para filtrar el roster, o null = mostrar a todos los alumnos del grado
let demRosterAlumnos     = [];   // [{ alumno, total }] TODOS los alumnos de demGradoFiltro (incluidos los de total:0)
let demAlumnoDrawerId    = null; // alumno_id mostrado en el drawer
let demDrawerDemeritos   = [];   // todas las filas de `demeritos` (activas + redimidas) del alumno del drawer

// Módulos 2/3/4 (Anecdóticos, Amonestaciones, Reconocimientos) — mismo patrón
// grado → alumnos → historial + "+ Nuevo", nunca editable ni eliminable
// (registro permanente). Un solo estado por módulo, indexado por clave.
let estadoModulos = {
    anecdoticos:     { alumnos: [], alumnoSel: null },
    amonestaciones:  { alumnos: [], alumnoSel: null },
    reconocimientos: { alumnos: [], alumnoSel: null },
};

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
    asistencias: 'Asistencias',
    expedientes: 'Expedientes',
    demeritos: 'Deméritos',
    anecdoticos: 'Anecdóticos',
    amonestaciones: 'Amonestaciones',
    reconocimientos: 'Reconocimientos',
    configuracion: 'Configuración',
    reportes: 'Reportes',
    'anio-academico': 'Año Académico',
    matricula: 'Matrícula de Alumnos',
    'categorias-grado': 'Categorías de Grados',
};

const VISTA_CONFIG = {
    inicio:      { titulo: 'Inicio',               accion: `<button class="btn-primary" onclick="mostrarVista('grados')">Ver Grados</button>` },
    grados:      { titulo: 'Grados y Secciones',  accion: `<button class="btn-primary" onclick="abrirModalGrado()">+ Nuevo Grado</button>` },
    alumnos:     { titulo: 'Alumnos',              accion: `<input type="file" id="excel-alumnos" accept=".xlsx,.xls" class="hidden" onchange="importarAlumnosExcel(event)"><button class="btn-secondary" onclick="descargarPlantillaAlumnos()">📥 Descargar Plantilla</button><button class="btn-secondary" onclick="abrirModalImportarExcel()">📊 Importar Excel</button><button class="btn-secondary" onclick="imprimirMatriculaAdmin()">🖨 Reporte de matrícula</button><button class="btn-primary" onclick="abrirModalAlumno()">+ Nuevo Alumno</button>` },
    docentes:    { titulo: 'Docentes',             accion: `<button class="btn-primary" onclick="abrirModalDocente()">+ Nuevo Docente</button>` },
    materias:    { titulo: 'Materias',             accion: `<button class="btn-primary" onclick="abrirModalMateria()">+ Nueva Materia</button>` },
    asistencias: { titulo: 'Asistencias',          accion: `<button class="btn-secondary" onclick="imprimirReporteAsistenciaAdmin()">🖨 Reporte mensual</button><button class="btn-secondary" onclick="imprimirListaBlancoAsistenciaAdmin()">📄 Lista en blanco</button>` },
    expedientes: { titulo: 'Expedientes',          accion: '' },
    demeritos:   { titulo: 'Deméritos',            accion: '' },
    anecdoticos: { titulo: 'Anecdóticos',          accion: '' },
    amonestaciones: { titulo: 'Amonestaciones',    accion: '' },
    reconocimientos: { titulo: 'Reconocimientos',  accion: '' },
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
    if (vista === 'asistencias') renderVistaAsistencias();
    if (vista === 'expedientes') renderVistaExpedientes();
    if (vista === 'demeritos') renderVistaDemeritos();
    if (vista === 'anecdoticos') renderVistaModulo('anecdoticos');
    if (vista === 'amonestaciones') renderVistaModulo('amonestaciones');
    if (vista === 'reconocimientos') renderVistaModulo('reconocimientos');
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
                (data || []).map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');
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

// ── DOCENTE EFECTIVO DE GRADO_MATERIA ────────
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

// ── HELPERS COMPARTIDOS: grado → alumnos (año activo) ────────
// Usados por Deméritos, Anecdóticos, Amonestaciones, Reconocimientos y
// Expedientes — los 5 módulos disciplinarios navegan "elegir grado → ver
// sus alumnos matriculados este año" de la misma forma exacta.
function gradosDelAnioActivo() {
    if (!anioActivoCache) return [];
    return gradosCache
        .filter(g => g.año_academico_id === anioActivoCache.id || !g.año_academico_id)
        .slice()
        .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.seccion.localeCompare(b.seccion));
}

function poblarSelectGrados(selectId, valorActual, placeholder = '— Seleccioná un grado —') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
        gradosDelAnioActivo().map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');
    sel.value = valorActual || '';
}

async function obtenerAlumnosDeGrado(gradoId) {
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

function filaAlumnoClicable(a, onclickJs) {
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

// ── EXPEDIENTES (Módulo 5 — SOLO LECTURA) ────
// Flujo: elegir grado → lista de alumnos matriculados (año activo) en ese
// grado → click en un alumno → expediente completo (timeline mezclando
// anecdóticos + deméritos + amonestaciones + reconocimientos, con filtro
// por tipo). No hay ningún botón de registrar/editar/eliminar acá — cada
// módulo tiene su propio "+ Nuevo" (ver más abajo).
function renderVistaExpedientes() {
    poblarSelectGrados('exp-admin-grado', expAdminGradoSel);
    mostrarListaAlumnosExpediente();
    if (expAdminGradoSel) {
        cargarAlumnosGradoExpediente(expAdminGradoSel);
    } else {
        document.getElementById('exp-admin-lista-alumnos').innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver sus alumnos.</div>';
    }
}

// Oculta el detalle del expediente y vuelve a mostrar la lista de alumnos del grado.
function mostrarListaAlumnosExpediente() {
    document.getElementById('exp-admin-detalle').classList.add('hidden');
    document.getElementById('exp-admin-lista-wrap').classList.remove('hidden');
    expAdminAlumnoSel = null;
}

window.cambiarGradoExpedienteAdmin = () => {
    expAdminGradoSel = document.getElementById('exp-admin-grado').value || null;
    mostrarListaAlumnosExpediente();
    if (expAdminGradoSel) {
        cargarAlumnosGradoExpediente(expAdminGradoSel);
    } else {
        document.getElementById('exp-admin-lista-alumnos').innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver sus alumnos.</div>';
    }
};

window.volverListaAlumnosExpediente = () => {
    mostrarListaAlumnosExpediente();
};

async function cargarAlumnosGradoExpediente(gradoId) {
    const cont = document.getElementById('exp-admin-lista-alumnos');
    if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    try {
        expAdminAlumnosGrado = await obtenerAlumnosDeGrado(gradoId);
        if (!expAdminAlumnosGrado.length) { cont.innerHTML = '<div class="empty-bubbles">Este grado no tiene alumnos matriculados.</div>'; return; }
        cont.innerHTML = expAdminAlumnosGrado.map(a => filaAlumnoClicable(a, `seleccionarAlumnoExpedienteAdmin('${a.id}')`)).join('');
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarAlumnosGradoExpediente(gradoId)); return; }
        notificarError(err, 'Error cargando alumnos del grado');
    }
}

window.seleccionarAlumnoExpedienteAdmin = (alumnoId) => {
    expAdminAlumnoSel = alumnoId;
    const alumno = expAdminAlumnosGrado.find(a => a.id === alumnoId);
    document.getElementById('exp-admin-lista-wrap').classList.add('hidden');
    document.getElementById('exp-admin-detalle').classList.remove('hidden');
    document.getElementById('exp-admin-nombre').textContent = alumno ? `${alumno.apellidos}, ${alumno.nombres}` : '';
    const filtroTipo = document.getElementById('exp-admin-filtro-tipo');
    if (filtroTipo) filtroTipo.value = '';
    cargarExpedienteAdmin(alumnoId);
};

async function cargarExpedienteAdmin(alumnoId) {
    document.getElementById('exp-admin-timeline').innerHTML = '<div class="empty-bubbles">Cargando…</div>';
    try {
        // `demeritos` tiene DOS columnas que referencian a `usuarios` (docente_id
        // que registró la falta, redimido_por que aplicó la redención), así que
        // el embed automático `usuarios(...)` queda ambiguo — hay que nombrar
        // la FK explícitamente. Se hace igual (aunque no sea ambiguo) en las
        // otras tres tablas, por prolijidad y consistencia.
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
        if (errorDeRed) { mostrarBannerSinConexion(() => cargarExpedienteAdmin(alumnoId)); return; }
        ocultarBannerSinConexion();
        if (e1) return notificarError(e1, 'Error cargando anecdóticos');
        if (e2) return notificarError(e2, 'Error cargando deméritos');
        if (e3) return notificarError(e3, 'Error cargando amonestaciones');
        if (e4) return notificarError(e4, 'Error cargando reconocimientos');

        expAdminTimeline = [
            ...(anec || []).map(r => ({ ...r, tabla: 'anecdoticos', tipoClave: 'anecdotico', registradoPor: r.usuarios?.nombre_completo || '—' })),
            // r.codigo (A/B/C/D) es el sistema nuevo; r.categoria (leve/grave/muy_grave)
            // es lo que tienen los registros de antes del rediseño por código.
            ...(dem  || []).map(r => ({ ...r, tabla: 'demeritos', tipoClave: `demerito_${r.codigo || r.categoria}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(amon || []).map(r => ({ ...r, tabla: 'amonestaciones', tipoClave: `amonestacion_${r.tipo}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
            ...(reco || []).map(r => ({ ...r, tabla: 'reconocimientos', tipoClave: `reconocimiento_${r.tipo}`, registradoPor: r.usuarios?.nombre_completo || '—' })),
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        renderTimelineExpedienteAdmin();
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => cargarExpedienteAdmin(alumnoId)); return; }
        notificarError(err, 'Error cargando el expediente');
    }
}

// Solo lectura: sin botones de Editar/Eliminar. Los deméritos redimidos se
// muestran atenuados con el título tachado y un badge "✓ Redimido".
function renderTimelineExpedienteAdmin() {
    const cont = document.getElementById('exp-admin-timeline');
    const filtro = document.getElementById('exp-admin-filtro-tipo')?.value || '';
    const filas = filtro ? expAdminTimeline.filter(r => r.tabla === filtro) : expAdminTimeline;

    if (!filas.length) {
        cont.innerHTML = '<div class="empty-bubbles">Este alumno no tiene registros en su expediente todavía.</div>';
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

// ── DEMÉRITOS (Módulo 1) ──────────────────────
// Elegí un grado → aparecen las 5 tarjetas (conteo por nivel de consecuencia,
// ver NIVELES_DEMERITO en config.js) Y, siempre, el listado COMPLETO de los
// alumnos de ese grado — incluidos los que tienen 0 deméritos activos — cada
// uno con su total y su nivel actual. Las tarjetas son filtros sobre esa
// misma lista (clic = filtra a ese nivel, "✕ Quitar filtro" = vuelve a
// mostrar a todos), no una pantalla aparte. Sin grado elegido, las tarjetas
// muestran el conteo de TODA la escuela (para tener una foto rápida antes
// de entrar a un grado puntual). Click en un alumno (aunque tenga 0) abre el
// drawer con su historial completo, "+ Nuevo Demérito" y "Aplicar Redención"
// (esta última solo admin: la RLS de `demeritos` no le da UPDATE a los
// docentes, así que además de ocultarlo en la UI del docente, queda
// reforzado en la base).
function renderVistaDemeritos() {
    poblarSelectGrados('dem-grado-filtro', demGradoFiltro, '— Todos los grados —');
    demNivelFiltroRoster = null;
    cargarConteoNivelesDemerito();
    actualizarRosterDemeritos();
}

window.cambiarFiltroGradoDemerito = () => {
    demGradoFiltro = document.getElementById('dem-grado-filtro').value || null;
    demNivelFiltroRoster = null;
    cargarConteoNivelesDemerito();
    actualizarRosterDemeritos();
};

async function cargarConteoNivelesDemerito() {
    const cont = document.getElementById('dem-tarjetas');
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }

    let queryMatriculas = supabase.from('matriculas').select('alumno_id').eq('año_academico_id', anioActivoCache.id).eq('activo', true);
    if (demGradoFiltro) queryMatriculas = queryMatriculas.eq('grado_id', demGradoFiltro);

    const [{ data: matriculas, error: eM }, { data: demeritos, error: eD }] = await Promise.all([
        queryMatriculas,
        supabase.from('demeritos').select('alumno_id').eq('redimido', false),
    ]);
    if (eM && esErrorDeRed(eM)) { mostrarBannerSinConexion(() => cargarConteoNivelesDemerito()); return; }
    ocultarBannerSinConexion();
    if (eM) return notificarError(eM, 'Error cargando matrículas');
    if (eD) return notificarError(eD, 'Error cargando deméritos');

    const alumnosDelFiltro = new Set((matriculas || []).map(m => m.alumno_id));
    const totalPorAlumno = {};
    (demeritos || []).forEach(d => {
        if (!alumnosDelFiltro.has(d.alumno_id)) return; // fuera del año activo (o del grado filtrado) no cuenta
        totalPorAlumno[d.alumno_id] = (totalPorAlumno[d.alumno_id] || 0) + 1;
    });

    const conteoPorNivel = {};
    Object.values(totalPorAlumno).forEach(total => {
        const nivel = calcularNivelDemerito(total);
        if (nivel) conteoPorNivel[nivel] = (conteoPorNivel[nivel] || 0) + 1;
    });

    cont.innerHTML = NIVELES_DEMERITO.map(n => `
        <div class="dem-tarjeta ${demNivelFiltroRoster === n.clave ? 'activo' : ''}" onclick="abrirNivelDemerito('${n.clave}')" style="--dem-color:${n.color};--dem-bg:${n.bg}">
            <div class="dem-tarjeta-icono">${n.icono}</div>
            <div class="dem-tarjeta-umbral">${n.umbral}</div>
            <div class="dem-tarjeta-label">${n.label}</div>
            <div class="dem-tarjeta-count">${conteoPorNivel[n.clave] || 0} alumno(s)</div>
        </div>
    `).join('');
}

// Badge de nivel reutilizado en la lista y en el drawer: gris "Sin deméritos"
// en 0, amarillo "N demérito(s)" en 1-2 (todavía no dispara ninguna
// consecuencia), y el color/ícono del nivel correspondiente en 3+.
function badgeNivelDemerito(total) {
    if (total === 0) return `<span class="badge" style="background:#f1f5f9;color:#94a3b8">Sin deméritos</span>`;
    const nivel = NIVELES_DEMERITO.find(n => n.clave === calcularNivelDemerito(total));
    if (nivel) return `<span class="badge" style="background:${nivel.bg};color:${nivel.color}">${nivel.icono} ${total} — ${nivel.umbral}</span>`;
    return `<span class="badge" style="background:#fef9c3;color:#a16207">${total} demérito(s)</span>`;
}

function actualizarRosterDemeritos() {
    const wrap = document.getElementById('dem-roster-wrap');
    if (!demGradoFiltro) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    cargarRosterDemeritos();
}

async function cargarRosterDemeritos() {
    const cont = document.getElementById('dem-roster-alumnos');
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }

    const [{ data: matriculas, error: eM }, { data: demeritos, error: eD }] = await Promise.all([
        supabase.from('matriculas').select('alumno_id, alumnos(*)').eq('grado_id', demGradoFiltro).eq('año_academico_id', anioActivoCache.id).eq('activo', true),
        supabase.from('demeritos').select('alumno_id').eq('redimido', false),
    ]);
    if (eM && esErrorDeRed(eM)) { mostrarBannerSinConexion(() => cargarRosterDemeritos()); return; }
    ocultarBannerSinConexion();
    if (eM) return notificarError(eM, 'Error cargando alumnos del grado');
    if (eD) return notificarError(eD, 'Error cargando deméritos');

    const totalPorAlumno = {};
    (demeritos || []).forEach(d => { totalPorAlumno[d.alumno_id] = (totalPorAlumno[d.alumno_id] || 0) + 1; });

    demRosterAlumnos = (matriculas || [])
        .filter(m => m.alumnos)
        .map(m => ({ alumno: m.alumnos, total: totalPorAlumno[m.alumno_id] || 0 }))
        .sort((a, b) => b.total - a.total || (a.alumno.apellidos || '').localeCompare(b.alumno.apellidos || ''));

    renderRosterDemeritos();
}

function renderRosterDemeritos() {
    const cont = document.getElementById('dem-roster-alumnos');
    const titulo = document.getElementById('dem-roster-titulo');
    const btnQuitar = document.getElementById('btn-dem-quitar-filtro');

    const filtrados = demNivelFiltroRoster
        ? demRosterAlumnos.filter(x => calcularNivelDemerito(x.total) === demNivelFiltroRoster)
        : demRosterAlumnos;

    const nivelInfo = demNivelFiltroRoster ? NIVELES_DEMERITO.find(n => n.clave === demNivelFiltroRoster) : null;
    titulo.textContent = nivelInfo
        ? `${nivelInfo.icono} ${nivelInfo.label} (${filtrados.length})`
        : `Todos los alumnos del grado (${filtrados.length})`;
    btnQuitar.classList.toggle('hidden', !demNivelFiltroRoster);

    if (!filtrados.length) { cont.innerHTML = '<div class="empty-bubbles">No hay alumnos que coincidan con este filtro.</div>'; return; }

    cont.innerHTML = filtrados.map(({ alumno: a, total }) => `
        <div class="exp-resultado-item" onclick="abrirDrawerDemerito('${a.id}')">
            <div style="display:flex;align-items:center;gap:10px">
                ${a.foto_url
                    ? `<img src="${a.foto_url}" class="foto-mini" alt="${a.apellidos}">`
                    : '<div class="foto-mini foto-placeholder">?</div>'}
                <span>${a.apellidos}, ${a.nombres}</span>
            </div>
            ${badgeNivelDemerito(total)}
        </div>
    `).join('');
}

window.abrirNivelDemerito = (clave) => {
    if (!demGradoFiltro) { mostrarToast('Elegí un grado primero para ver el detalle de sus alumnos', 'advertencia'); return; }
    demNivelFiltroRoster = demNivelFiltroRoster === clave ? null : clave; // clic de nuevo = quitar el filtro
    cargarConteoNivelesDemerito(); // repinta las tarjetas para resaltar la activa
    renderRosterDemeritos();
};

window.quitarFiltroNivelDemerito = () => {
    demNivelFiltroRoster = null;
    cargarConteoNivelesDemerito();
    renderRosterDemeritos();
};

// ── Drawer de detalle + nuevo demérito + redención ────────────
window.abrirDrawerDemerito = async (alumnoId) => {
    demAlumnoDrawerId = alumnoId;
    const item = demRosterAlumnos.find(x => x.alumno.id === alumnoId);
    const grado = gradosCache.find(g => g.id === demGradoFiltro);
    document.getElementById('dem-drawer-nombre').textContent = item ? `${item.alumno.apellidos}, ${item.alumno.nombres}` : '';
    document.getElementById('dem-drawer-grado').textContent = grado ? `${grado.nombre} ${grado.seccion}` : '';
    document.getElementById('demerito-drawer-overlay').classList.add('open');
    await cargarDrawerDemerito(alumnoId);
};

window.cerrarDrawerDemerito = () => {
    document.getElementById('demerito-drawer-overlay').classList.remove('open');
    demAlumnoDrawerId = null;
};

// Agrupa las filas redimidas por "evento de redención" (misma fecha +
// actividad + quién la aplicó = una sola redención que pudo haber tocado
// varios deméritos a la vez) — no hay una tabla aparte de redenciones,
// se reconstruye a partir de las columnas fecha_redencion/actividad_redencion/
// redimido_por que ya tiene cada fila (ver supabase/demeritos-schema.sql).
function agruparRedenciones(demeritos) {
    const grupos = new Map();
    demeritos.filter(d => d.redimido).forEach(d => {
        const key = `${d.fecha_redencion}|${d.actividad_redencion}|${d.redimido_por}`;
        if (!grupos.has(key)) {
            grupos.set(key, { fecha: d.fecha_redencion, actividad: d.actividad_redencion, cantidad: 0, redimidoPor: d.redimidoPorUsuario?.nombre_completo || '—' });
        }
        grupos.get(key).cantidad++;
    });
    return [...grupos.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function cargarDrawerDemerito(alumnoId) {
    const cont = document.getElementById('dem-drawer-content');
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    // Mismo motivo que en cargarExpedienteAdmin: dos FKs a `usuarios`
    // (docente_id / redimido_por) obligan a nombrar la FK explícitamente.
    const { data, error } = await supabase
        .from('demeritos')
        .select('*, docente:usuarios!demeritos_docente_id_fkey(nombre_completo), redimidoPorUsuario:usuarios!demeritos_redimido_por_fkey(nombre_completo)')
        .eq('alumno_id', alumnoId)
        .order('fecha', { ascending: false });

    if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => cargarDrawerDemerito(alumnoId)); return; }
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
        : '<div class="empty-bubbles">Este alumno no tiene deméritos registrados.</div>';

    const redenciones = agruparRedenciones(demDrawerDemeritos);
    const filasRedenciones = redenciones.length
        ? redenciones.map(r => `
            <div class="exp-item" style="--exp-color:#1a7a40;--exp-bg:#e8fdf0">
                <div class="exp-item-icono">↩</div>
                <div class="exp-item-cuerpo">
                    <div class="exp-item-cab">
                        <span class="exp-item-tipo">${r.cantidad} demérito(s) redimido(s)</span>
                        <span class="exp-item-fecha">${r.fecha ? new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-SV') : '—'}</span>
                    </div>
                    <div class="exp-item-desc">${r.actividad || '—'}</div>
                    <div class="exp-item-registro">Aplicado por ${r.redimidoPor}</div>
                </div>
            </div>`).join('')
        : '<div class="empty-bubbles">Sin redenciones aplicadas todavía.</div>';

    cont.innerHTML = `
        <div class="exp-stats" style="grid-template-columns:1fr 1fr;margin-bottom:18px">
            <div class="exp-stat"><div class="exp-stat-val" style="color:${infoNivel?.color || '#1a7a40'}">${activos}</div><div class="exp-stat-label">Deméritos activos</div></div>
            <div class="exp-stat" style="display:flex;align-items:center;justify-content:center">${badgeNivel}</div>
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px">Deméritos recibidos</div>
        <div class="exp-timeline" style="margin-bottom:22px">${filas}</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px">Historial de redenciones</div>
        <div class="exp-timeline">${filasRedenciones}</div>
    `;
}

window.abrirModalNuevoDemerito = () => {
    if (!demAlumnoDrawerId) return;
    document.getElementById('nd-alumno-id').value = demAlumnoDrawerId;
    document.getElementById('nd-codigo').value = 'A';
    document.getElementById('nd-descripcion').value = '';
    document.getElementById('nd-fecha').value = new Date().toISOString().slice(0, 10);
    abrirModal('modal-nuevo-demerito');
};

window.guardarNuevoDemerito = async () => {
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
    await cargarDrawerDemerito(alumnoId);
    await cargarConteoNivelesDemerito();
    await cargarRosterDemeritos();
};

window.abrirModalRedencion = () => {
    if (!demAlumnoDrawerId) return;
    const activos = contarDemeritosActivos(demDrawerDemeritos);
    if (!activos) { mostrarToast('Este alumno no tiene deméritos activos para redimir', 'advertencia'); return; }

    document.getElementById('red-alumno-id').value = demAlumnoDrawerId;
    document.getElementById('red-actividad').value = '';
    document.getElementById('red-cantidad').value = 1;
    document.getElementById('red-cantidad').max = activos;
    document.getElementById('red-fecha').value = new Date().toISOString().slice(0, 10);
    abrirModal('modal-redencion');
};

window.guardarRedencion = async () => {
    const alumnoId = document.getElementById('red-alumno-id').value;
    const actividad = document.getElementById('red-actividad').value.trim();
    const cantidad = parseInt(document.getElementById('red-cantidad').value, 10) || 0;
    const fecha = document.getElementById('red-fecha').value;

    if (!actividad) { mostrarToast('Describí la actividad realizada', 'advertencia'); return; }
    if (!fecha) { mostrarToast('Elegí una fecha', 'advertencia'); return; }
    if (cantidad < 1) { mostrarToast('Ingresá una cantidad válida', 'advertencia'); return; }

    // Redime los deméritos activos MÁS ANTIGUOS primero, hasta completar la
    // cantidad pedida — cada fila queda marcada individualmente (no existe
    // un contador único que "restar", ver supabase/demeritos-schema.sql).
    const activos = demDrawerDemeritos.filter(d => !d.redimido).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (cantidad > activos.length) { mostrarToast(`Este alumno solo tiene ${activos.length} demérito(s) activo(s)`, 'advertencia'); return; }

    const idsARedimir = activos.slice(0, cantidad).map(d => d.id);

    const btn = document.getElementById('btn-guardar-redencion');
    setBotonCargando(btn, true);

    const { error } = await supabase.from('demeritos')
        .update({ redimido: true, fecha_redencion: fecha, actividad_redencion: actividad, redimido_por: usuarioActual.id })
        .in('id', idsARedimir);

    setBotonCargando(btn, false);
    if (error) return notificarError(error, 'Error aplicando la redención');

    mostrarToast('Redención aplicada correctamente', 'exito');
    cerrarModal('modal-redencion');
    await cargarDrawerDemerito(alumnoId);
    // El alumno puede haber bajado de nivel al redimir — se refrescan las
    // tarjetas y el roster de fondo para que queden al día apenas se cierre el drawer.
    await cargarConteoNivelesDemerito();
    await cargarRosterDemeritos();
};

// ── MÓDULOS 2/3/4 — Anecdóticos / Amonestaciones / Reconocimientos ──
// Mismo patrón grado → alumnos → historial + "+ Nuevo" para los 3. Ningún
// registro se puede editar ni eliminar (permanentes) — la única acción es
// crear uno nuevo, vía el modal compartido #modal-nuevo-registro.
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
    poblarSelectGrados(`${cfg.prefijo}-grado`);
    document.getElementById(`${cfg.prefijo}-detalle`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.remove('hidden');
    estadoModulos[clave].alumnoSel = null;
    document.getElementById(`${cfg.prefijo}-lista-alumnos`).innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver sus alumnos.</div>';
}

window.cambiarGradoModulo = async (clave) => {
    const cfg = MODULOS_SIMPLES[clave];
    const gradoId = document.getElementById(`${cfg.prefijo}-grado`).value || null;
    document.getElementById(`${cfg.prefijo}-detalle`).classList.add('hidden');
    document.getElementById(`${cfg.prefijo}-lista-wrap`).classList.remove('hidden');
    const cont = document.getElementById(`${cfg.prefijo}-lista-alumnos`);

    if (!gradoId) { cont.innerHTML = '<div class="empty-bubbles">Seleccioná un grado para ver sus alumnos.</div>'; return; }
    if (!anioActivoCache) { cont.innerHTML = '<div class="info-box">⚠ No hay un año académico activo.</div>'; return; }
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    try {
        const alumnos = await obtenerAlumnosDeGrado(gradoId);
        estadoModulos[clave].alumnos = alumnos;
        if (!alumnos.length) { cont.innerHTML = '<div class="empty-bubbles">Este grado no tiene alumnos matriculados.</div>'; return; }
        cont.innerHTML = alumnos.map(a => filaAlumnoClicable(a, `seleccionarAlumnoModulo('${clave}','${a.id}')`)).join('');
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
    cont.innerHTML = '<div class="empty-bubbles">Cargando…</div>';

    const { data, error } = await supabase
        .from(cfg.tabla)
        .select(`*, usuarios:usuarios!${cfg.tabla}_${cfg.campoRegistrador}_fkey(nombre_completo)`)
        .eq('alumno_id', alumnoId)
        .order('fecha', { ascending: false });

    if (error && esErrorDeRed(error)) { mostrarBannerSinConexion(() => cargarTimelineModulo(clave, alumnoId)); return; }
    ocultarBannerSinConexion();
    if (error) return notificarError(error, 'Error cargando el historial');

    if (!data || !data.length) { cont.innerHTML = '<div class="empty-bubbles">Sin registros todavía.</div>'; return; }

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

// Clona grados + grado_materia del año anterior hacia el año nuevo. Materias y
// docentes son catálogos globales (no están atados a un año), así que no hace
// falta clonarlos — solo las asociaciones que sí son por-año.
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
        `Esta acción borra TODO lo relacionado al año ${anio.anio} (grados, notas, asistencias, competencias, criterios de evaluación, matrículas y períodos académicos). No se puede deshacer.\n\nEscribí "${anio.anio}" para confirmar:`
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
// Antes de abrir el selector de archivo, se muestra un modal con las
// instrucciones (formato esperado + botón para descargar la plantilla
// oficial) — las validaciones de grado/año activo se hacen acá también,
// para no mostrar el modal si de entrada la importación va a fallar.
window.abrirModalImportarExcel = () => {
    const gradoId = document.getElementById('filtro-grado')?.value;
    if (!gradoId) { mostrarToast('Seleccioná un grado en el filtro antes de importar', 'advertencia'); return; }
    if (!anioActivoCache) { mostrarToast('No hay un año académico activo — configuralo primero en "Año Académico"', 'advertencia'); return; }
    abrirModal('modal-importar-excel');
};

window.continuarImportarExcel = () => {
    cerrarModal('modal-importar-excel');
    document.getElementById('excel-alumnos').click();
};

// Genera plantilla-alumnos.xlsx con los encabezados NIE | APELLIDOS | NOMBRES
// y 3 filas de ejemplo. Sin protección de hoja — el archivo queda totalmente
// editable para que el admin pueda llenar los datos de los alumnos.
window.descargarPlantillaAlumnos = () => {
    const datos = [
        ['NIE', 'APELLIDOS', 'NOMBRES'],
        ['20260001', 'PÉREZ GARCÍA', 'JUAN CARLOS'],
        ['20260002', 'LÓPEZ MARTÍNEZ', 'MARÍA FERNANDA'],
        ['20260003', 'HERNÁNDEZ RIVAS', 'CARLOS ALBERTO'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 24 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alumnos');
    XLSX.writeFile(wb, 'plantilla-alumnos.xlsx');
};

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

            // La primera fila es el encabezado (NIE | APELLIDOS | NOMBRES) —
            // se descarta siempre, nunca se importa como alumno.
            const nuevos = [];
            for (const row of rows.slice(1)) {
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
