// ═══════════════════════════════════════════
//  IDSJE — Panel Administrador
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion, subirFoto } from './auth.js';
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET, MATERIAS_DEFAULT, SUPABASE_URL, SUPABASE_SERVICE_KEY } from './config.js';

let usuarioActual = null;
let gradosCache   = [];
let alumnosCache  = [];
let usuariosCache = [];
let materiasCache = [];
let vistaActual   = 'grados';

// ── INICIO ──────────────────────────────────
async function init() {
    const res = await verificarSesion('admin');
    if (!res) return;
    usuarioActual = res.usuario;
    document.getElementById('admin-nombre').textContent = usuarioActual.nombre_completo;
    await cargarTodo();
    mostrarVista('grados');
}

async function cargarTodo() {
    const [{ data: grados }, { data: usuarios }, { data: materias }, { count: cAlumnos }] = await Promise.all([
        supabase.from('grados').select('*').order('nombre'),
        supabase.from('usuarios').select('*').order('nombre_completo'),
        supabase.from('materias').select('*').order('nombre'),
        supabase.from('alumnos').select('*', { count: 'exact', head: true }),
    ]);
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
}

// ── VISTAS ──────────────────────────────────
const TITULOS = {
    grados: 'Grados y Secciones',
    alumnos: 'Alumnos',
    docentes: 'Docentes',
    materias: 'Materias'
};

const VISTA_CONFIG = {
    grados:          { titulo: 'Grados y Secciones',  accion: `<button class="btn-primary" onclick="abrirModalGrado()">+ Nuevo Grado</button>` },
    alumnos:         { titulo: 'Alumnos',              accion: `<input type="file" id="excel-alumnos" accept=".xlsx,.xls" class="hidden" onchange="importarAlumnosExcel(event)"><button class="btn-secondary" onclick="document.getElementById('excel-alumnos').click()">📊 Importar Excel</button><button class="btn-primary" onclick="abrirModalAlumno()">+ Nuevo Alumno</button>` },
    docentes:        { titulo: 'Docentes',             accion: `<button class="btn-primary" onclick="abrirModalDocente()">+ Nuevo Docente</button>` },
    materias:        { titulo: 'Materias',             accion: `<button class="btn-secondary" onclick="cargarMateriasDefault()">Cargar IDSJE</button><button class="btn-primary" onclick="abrirModalMateria()">+ Nueva Materia</button>` },
    'grado-materias':{ titulo: 'Materias del Grado',   accion: `<button class="btn-secondary" onclick="mostrarVista('grados')">← Volver a Grados</button>` },
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

    if (vista === 'grados')   renderGrados();
    if (vista === 'docentes') renderDocentes();
    if (vista === 'materias') renderMaterias();
    if (vista === 'alumnos') {
        // Poblar filtro grado
        const { data } = await supabase.from('grados').select('*').order('nombre');
        const sel = document.getElementById('filtro-grado');
        if (sel) {
            sel.innerHTML = '<option value="">— Todos los grados —</option>' +
                (data || []).map(g => `<option value="${g.id}">${g.nombre} ${g.seccion}</option>`).join('');
        }
        renderAlumnos();
    }
};

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

    // Generar código corto: "PRIMER AÑO" + modalidad + sección → "1GA"
    function codigoGrado(g) {
        const nom = g.nombre.toUpperCase();
        let num = '?';
        if (nom.includes('PRIMER') || nom.includes('1')) num = '1';
        else if (nom.includes('SEGUNDO') || nom.includes('2')) num = '2';
        else if (nom.includes('TERCER') || nom.includes('3')) num = '3';
        const mod = g.modalidad === 'Técnico' ? 'T' : g.modalidad === 'Vocacional' ? 'V' : 'G';
        return `${num}${mod}${g.seccion}`;
    }

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
                            <button class="ba-btn ba-mat" onclick="abrirGradoMateriasFull('${g.id}', '${g.nombre}', '${g.seccion}')">Materias</button>
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

window.abrirModalGrado = (id = null) => {
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
    const id       = document.getElementById('grado-id').value;
    const nombre   = document.getElementById('grado-nombre').value.trim().toUpperCase();
    const seccion  = document.getElementById('grado-seccion').value.trim().toUpperCase();
    const modalidad = document.getElementById('grado-modalidad').value.trim();
    const anio     = parseInt(document.getElementById('grado-anio').value);
    const guia     = document.getElementById('grado-guia').value || null;

    if (!nombre || !seccion) return alert('Nombre y sección son obligatorios');

    const payload = { nombre, seccion, modalidad, anio, docente_guia_id: guia };
    const { error } = id
        ? await supabase.from('grados').update(payload).eq('id', id)
        : await supabase.from('grados').insert([payload]);

    if (error) return alert('Error: ' + error.message);
    cerrarModal('modal-grado');
    await cargarTodo();
    renderGrados();
};

window.eliminarGrado = async (id) => {
    if (!confirm('¿Eliminar este grado y todos sus datos?')) return;
    const { error } = await supabase.from('grados').delete().eq('id', id);
    if (error) return alert('Error: ' + error.message);
    await cargarTodo();
    renderGrados();
};

// ── GESTIÓN MATERIAS POR GRADO (PANTALLA COMPLETA) ─────────────
let gradoMatFullId = null;

window.abrirGradoMateriasFull = async (gradoId, nombre, seccion) => {
    gradoMatFullId = gradoId;

    document.getElementById('grado-mat-titulo').textContent = `${nombre} — Sección ${seccion}`;
    document.getElementById('topbar-titulo').textContent = `${nombre} ${seccion} — Materias`;

    // Poblar selects
    const selM = document.getElementById('gm-materia-sel');
    const selD = document.getElementById('gm-docente-sel');
    selM.innerHTML = materiasCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
    selD.innerHTML = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}">${u.nombre_completo}</option>`).join('');

    // Ocultar todas las vistas y mostrar esta
    document.querySelectorAll('[id^="vista-"]').forEach(v => v.classList.add('hidden'));
    document.getElementById('vista-grado-materias').classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

    await renderMateriasGradoFull();
};

async function renderMateriasGradoFull() {
    const { data: asignadas } = await supabase
        .from('grado_materia')
        .select('*, materias(nombre), usuarios(nombre_completo)')
        .eq('grado_id', gradoMatFullId);

    const lista = document.getElementById('lista-materias-full');

    if (!asignadas?.length) {
        lista.innerHTML = `<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px">Sin materias asignadas. Agregá una arriba.</div>`;
        return;
    }

    lista.innerHTML = asignadas.map((a, i) => `
        <div style="display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid #f1f5f9;${i%2===0?'background:#fafbfd':''}">
            <div style="width:28px;height:28px;border-radius:50%;background:#0a1628;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#d4af37;flex-shrink:0">${i+1}</div>
            <div style="flex:1">
                <div style="font-size:14px;font-weight:600;color:#0a1628">${a.materias?.nombre}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px">${a.usuarios?.nombre_completo || 'Sin docente asignado'}</div>
            </div>
            <select onchange="cambiarDocenteMateria('${a.id}', this.value)" 
                style="padding:7px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;background:#fff;min-width:180px">
                <option value="">— Sin asignar —</option>
                ${usuariosCache.map(u => `<option value="${u.id}" ${u.id === a.docente_id ? 'selected' : ''}>${u.nombre_completo}</option>`).join('')}
            </select>
            <button onclick="quitarMateriaGradoFull('${a.id}')" 
                style="padding:7px 12px;border-radius:8px;border:none;background:#fde8e8;color:#b52828;font-size:12px;font-weight:600;cursor:pointer">
                Quitar
            </button>
        </div>
    `).join('');
}

window.agregarMateriaGradoFull = async () => {
    const materiaId = document.getElementById('gm-materia-sel').value;
    const docenteId = document.getElementById('gm-docente-sel').value || null;
    if (!materiaId) return alert('Seleccioná una materia');

    const { error } = await supabase.from('grado_materia').upsert([{
        grado_id: gradoMatFullId, materia_id: materiaId, docente_id: docenteId
    }], { onConflict: 'grado_id,materia_id' });

    if (error) return alert('Error: ' + error.message);
    await renderMateriasGradoFull();
};

window.cambiarDocenteMateria = async (gradoMateriaId, docenteId) => {
    await supabase.from('grado_materia').update({ docente_id: docenteId || null }).eq('id', gradoMateriaId);
};

window.quitarMateriaGradoFull = async (id) => {
    if (!confirm('¿Quitar esta materia del grado?')) return;
    await supabase.from('grado_materia').delete().eq('id', id);
    await renderMateriasGradoFull();
};

// ── GESTIÓN MATERIAS POR GRADO (MODAL LEGACY) ─────────────
window.gestionarMateriaGrado = async (gradoId) => {
    const grado = gradosCache.find(g => g.id === gradoId);
    document.getElementById('mgrado-titulo').textContent = `${grado.nombre} ${grado.seccion} — Materias`;
    document.getElementById('mgrado-id').value = gradoId;

    const { data: asignadas } = await supabase
        .from('grado_materia')
        .select('*, materias(nombre), usuarios(nombre_completo)')
        .eq('grado_id', gradoId);

    // Select materias
    const selM = document.getElementById('mgrado-materia');
    selM.innerHTML = materiasCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');

    // Select docentes
    const selD = document.getElementById('mgrado-docente');
    selD.innerHTML = '<option value="">— Sin asignar —</option>' +
        usuariosCache.map(u => `<option value="${u.id}">${u.nombre_completo}</option>`).join('');

    // Lista de asignadas
    document.getElementById('lista-grado-materias').innerHTML = (asignadas || []).map(a => `
        <div class="materia-asignada">
            <span>${a.materias?.nombre}</span>
            <span class="text-muted">${a.usuarios?.nombre_completo || 'Sin docente'}</span>
            <button class="btn-sm btn-del" onclick="quitarMateriaGrado('${a.id}', '${gradoId}')">✕</button>
        </div>
    `).join('') || '<p class="text-muted">Sin materias asignadas</p>';

    abrirModal('modal-grado-materias');
};

window.agregarMateriaGrado = async () => {
    const gradoId   = document.getElementById('mgrado-id').value;
    const materiaId = document.getElementById('mgrado-materia').value;
    const docenteId = document.getElementById('mgrado-docente').value || null;

    const { error } = await supabase.from('grado_materia').upsert([{
        grado_id: gradoId, materia_id: materiaId, docente_id: docenteId
    }], { onConflict: 'grado_id,materia_id' });

    if (error) return alert('Error: ' + error.message);
    window.gestionarMateriaGrado(gradoId);
};

window.quitarMateriaGrado = async (id, gradoId) => {
    if (!confirm('¿Quitar esta materia del grado?')) return;
    await supabase.from('grado_materia').delete().eq('id', id);
    window.gestionarMateriaGrado(gradoId);
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

window.abrirModalDocente = (id = null) => {
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
    const id     = document.getElementById('docente-id').value;
    const nombre = document.getElementById('docente-nombre').value.trim();
    const correo = document.getElementById('docente-correo').value.trim().toLowerCase();
    const rol    = document.getElementById('docente-rol').value;
    const pass   = document.getElementById('docente-pass').value;

    if (!nombre || !correo) return alert('Nombre y correo son obligatorios');

    if (!id) {
        // Crear usuario nuevo
        if (!pass || pass.length < 6) return alert('La contraseña debe tener al menos 6 caracteres');

        // 1. Crear en Supabase Auth usando service role key
        const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: correo,
                password: pass,
                email_confirm: true
            })
        });

        const authData = await authRes.json();
        if (!authRes.ok) return alert('Error creando cuenta: ' + (authData.message || authData.msg || JSON.stringify(authData)));

        // 2. Insertar en tabla usuarios
        const { error } = await supabase.from('usuarios').insert([{ correo, nombre_completo: nombre, rol }]);
        if (error) return alert('Error guardando usuario: ' + error.message);

        alert(`✅ Docente "${nombre}" creado correctamente.`);
    } else {
        // Actualizar datos existentes
        const { error } = await supabase.from('usuarios').update({ nombre_completo: nombre, rol }).eq('id', id);
        if (error) return alert('Error: ' + error.message);

        // Cambiar contraseña si se ingresó una nueva
        if (pass && pass.length >= 6) {
            const { data: authUser } = await supabase.auth.admin?.getUserByEmail?.(correo) || {};
            if (authUser?.id) {
                await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
                    method: 'PUT',
                    headers: {
                        'apikey': SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password: pass })
                });
            }
        }
    }

    cerrarModal('modal-docente');
    await cargarTodo();
    renderDocentes();
};

window.eliminarDocente = async (id) => {
    if (!confirm('¿Eliminar este docente?')) return;
    await supabase.from('usuarios').delete().eq('id', id);
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

window.abrirModalMateria = (id = null) => {
    const m = id ? materiasCache.find(x => x.id === id) : null;
    document.getElementById('modal-materia-title').textContent = m ? 'Editar Materia' : 'Nueva Materia';
    document.getElementById('materia-id').value     = m?.id || '';
    document.getElementById('materia-nombre').value = m?.nombre || '';
    document.getElementById('materia-codigo').value = m?.codigo || '';
    abrirModal('modal-materia');
};

window.editarMateria = (id) => window.abrirModalMateria(id);

window.guardarMateria = async () => {
    const id     = document.getElementById('materia-id').value;
    const nombre = document.getElementById('materia-nombre').value.trim();
    const codigo = document.getElementById('materia-codigo').value.trim();
    if (!nombre) return alert('El nombre es obligatorio');

    const { error } = id
        ? await supabase.from('materias').update({ nombre, codigo }).eq('id', id)
        : await supabase.from('materias').insert([{ nombre, codigo }]);
    if (error) return alert('Error: ' + error.message);

    cerrarModal('modal-materia');
    await cargarTodo();
    renderMaterias();
};

window.eliminarMateria = async (id) => {
    if (!confirm('¿Eliminar esta materia?')) return;
    await supabase.from('materias').delete().eq('id', id);
    await cargarTodo();
    renderMaterias();
};

window.cargarMateriasDefault = async () => {
    if (!confirm('¿Cargar las 10 materias del IDSJE? Solo agrega las que no existen.')) return;
    const existentes = materiasCache.map(m => m.nombre.toLowerCase());
    const nuevas = MATERIAS_DEFAULT
        .filter(n => !existentes.includes(n.toLowerCase()))
        .map(n => ({ nombre: n }));
    if (nuevas.length === 0) { alert('Todas las materias ya existen.'); return; }
    await supabase.from('materias').insert(nuevas);
    await cargarTodo();
    renderMaterias();
    alert(`✅ ${nuevas.length} materia(s) agregada(s).`);
};

// ── ALUMNOS ─────────────────────────────────
window.renderAlumnos = async function renderAlumnos() {
    const gradoFiltro = document.getElementById('filtro-grado')?.value || '';
    let query = supabase.from('alumnos').select('*, grados(nombre, seccion)').order('apellidos');
    if (gradoFiltro) query = query.eq('grado_id', gradoFiltro);
    const { data } = await query;
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

window.abrirModalAlumno = async (id = null) => {
    // Si hay id, cargar datos frescos de la BD
    let a = null;
    if (id) {
        const { data } = await supabase.from('alumnos').select('*').eq('id', id).single();
        a = data;
    }

    document.getElementById('modal-alumno-title').textContent = a ? 'Editar Alumno' : 'Nuevo Alumno';
    document.getElementById('alumno-id').value        = a?.id || '';
    document.getElementById('alumno-nie').value       = a?.nie || '';
    document.getElementById('alumno-nombres').value   = a?.nombres || '';
    document.getElementById('alumno-apellidos').value = a?.apellidos || '';
    document.getElementById('alumno-anio').value      = a?.anio_ingreso || 2026;
    document.getElementById('alumno-foto').value      = ''; // limpiar input foto
    document.getElementById('alumno-foto-preview').src = a?.foto_url || '';
    document.getElementById('alumno-foto-preview').style.display = a?.foto_url ? 'block' : 'none';

    const sel = document.getElementById('alumno-grado');
    sel.innerHTML = '<option value="">— Seleccionar grado —</option>' +
        gradosCache.map(g => `<option value="${g.id}" ${g.id === a?.grado_id ? 'selected' : ''}>${g.nombre} ${g.seccion}</option>`).join('');

    abrirModal('modal-alumno');
};

window.editarAlumno = (id) => window.abrirModalAlumno(id);

window.guardarAlumno = async () => {
    const id        = document.getElementById('alumno-id').value;
    const nie       = document.getElementById('alumno-nie').value.trim();
    const nombres   = document.getElementById('alumno-nombres').value.trim().toUpperCase();
    const apellidos = document.getElementById('alumno-apellidos').value.trim().toUpperCase();
    const gradoId   = document.getElementById('alumno-grado').value;
    const anio      = parseInt(document.getElementById('alumno-anio').value);
    const fotoFile  = document.getElementById('alumno-foto').files[0];

    if (!nie || !nombres || !apellidos || !gradoId) return alert('Todos los campos son obligatorios');

    // FIX: obtener foto actual directo de la base de datos para no mezclar con otros alumnos
    let foto_url = null;
    if (id) {
        const { data: alumnoActual } = await supabase
            .from('alumnos').select('foto_url').eq('id', id).single();
        foto_url = alumnoActual?.foto_url || null;
    }

    if (fotoFile) {
        try {
            foto_url = await subirFoto(fotoFile, CLOUDINARY_CLOUD, CLOUDINARY_PRESET);
        } catch(e) {
            alert('Error subiendo foto: ' + e.message);
        }
    }

    // Limpiar el input de foto para evitar reusos
    document.getElementById('alumno-foto').value = '';

    const payload = { nie, nombres, apellidos, grado_id: gradoId, anio_ingreso: anio, foto_url };
    const { error } = id
        ? await supabase.from('alumnos').update(payload).eq('id', id)
        : await supabase.from('alumnos').insert([{ ...payload, activo: true }]);

    if (error) return alert('Error: ' + error.message);
    cerrarModal('modal-alumno');
    await renderAlumnos();
};

window.eliminarAlumno = async (id) => {
    if (!confirm('¿Eliminar este alumno y todas sus notas?')) return;
    await supabase.from('alumnos').delete().eq('id', id);
    await renderAlumnos();
};

window.eliminarAlumnosMasivo = async () => {
    const gradoId = document.getElementById('filtro-grado').value;
    if (!gradoId) return alert('Seleccioná un grado primero para hacer eliminación masiva.');
    const grado = gradosCache.find(g => g.id === gradoId);
    if (!confirm(`¿Eliminar TODOS los alumnos de ${grado.nombre} ${grado.seccion}? Esta acción no se puede deshacer.`)) return;
    await supabase.from('alumnos').delete().eq('grado_id', gradoId);
    await renderAlumnos();
    alert('✅ Alumnos eliminados.');
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
// Modal solo se cierra con botones Guardar/Cancelar, no al hacer click afuera

// Evitar que doble click dentro del modal lo cierre
document.querySelectorAll && document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => e.stopPropagation());
        m.addEventListener('dblclick', e => e.stopPropagation());
    });
});

window.cerrarSesionAdmin = cerrarSesion;

init();

// ── IMPORTAR ALUMNOS DESDE EXCEL ─────────────
window.importarAlumnosExcel = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const gradoId = document.getElementById('filtro-grado')?.value;
    if (!gradoId) {
        alert('Seleccioná un grado en el filtro antes de importar.');
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

            if (!nuevos.length) { alert('No se encontraron alumnos en el archivo.'); return; }

            const { error } = await supabase.from('alumnos').insert(nuevos);
            if (error) { alert('Error: ' + error.message); return; }

            alert(`✅ ${nuevos.length} alumno(s) importado(s) correctamente.`);
            await renderAlumnos();
        } catch(err) {
            alert('Error leyendo el archivo: ' + err.message);
        }
    };
    reader.readAsBinaryString(file);
    event.target.value = '';
};
