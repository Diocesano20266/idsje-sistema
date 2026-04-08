// ═══════════════════════════════════════════
//  IDSJE — Panel Administrador
// ═══════════════════════════════════════════
import { supabase, verificarSesion, cerrarSesion, subirFoto } from './auth.js';
import { CLOUDINARY_CLOUD, CLOUDINARY_PRESET, MATERIAS_DEFAULT } from './config.js';

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
    const [{ data: grados }, { data: usuarios }, { data: materias }] = await Promise.all([
        supabase.from('grados').select('*').order('nombre'),
        supabase.from('usuarios').select('*').order('nombre_completo'),
        supabase.from('materias').select('*').order('nombre'),
    ]);
    gradosCache   = grados   || [];
    usuariosCache = usuarios || [];
    materiasCache = materias || [];
}

// ── VISTAS ──────────────────────────────────
window.mostrarVista = async (vista) => {
    vistaActual = vista;
    document.querySelectorAll('.vista').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(`vista-${vista}`);
    if (el) el.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-vista="${vista}"]`)?.classList.add('active');

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
    const tbody = document.getElementById('tbody-grados');
    tbody.innerHTML = gradosCache.map(g => `
        <tr>
            <td>${g.nombre}</td>
            <td>${g.seccion}</td>
            <td>${g.modalidad}</td>
            <td>${g.anio}</td>
            <td>${usuariosCache.find(u => u.id === g.docente_guia_id)?.nombre_completo || '—'}</td>
            <td>
                <button class="btn-sm btn-edit" onclick="editarGrado('${g.id}')">Editar</button>
                <button class="btn-sm btn-del" onclick="eliminarGrado('${g.id}')">Eliminar</button>
                <button class="btn-sm btn-info" onclick="gestionarMateriaGrado('${g.id}')">Materias</button>
            </td>
        </tr>
    `).join('');
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

// ── GESTIÓN MATERIAS POR GRADO ───────────────
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
        // Crear usuario en Auth
        if (!pass || pass.length < 6) return alert('La contraseña debe tener al menos 6 caracteres');
        const { data: authData, error: authErr } = await supabase.auth.admin
            ? await fetch(`${supabase.supabaseUrl}/auth/v1/admin/users`, {
                method: 'POST',
                headers: { 'apikey': supabase.supabaseKey, 'Authorization': `Bearer ${supabase.supabaseKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: correo, password: pass, email_confirm: true })
            }).then(r => r.json())
            : { error: { message: 'Crea el usuario desde Supabase Auth' } };

        // Insertar en tabla usuarios
        const { error } = await supabase.from('usuarios').insert([{ correo, nombre_completo: nombre, rol }]);
        if (error) return alert('Error: ' + error.message);
    } else {
        const { error } = await supabase.from('usuarios').update({ nombre_completo: nombre, rol }).eq('id', id);
        if (error) return alert('Error: ' + error.message);
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
    const id        = document.getElementById('alumno-id').value;
    const nie       = document.getElementById('alumno-nie').value.trim();
    const nombres   = document.getElementById('alumno-nombres').value.trim().toUpperCase();
    const apellidos = document.getElementById('alumno-apellidos').value.trim().toUpperCase();
    const gradoId   = document.getElementById('alumno-grado').value;
    const anio      = parseInt(document.getElementById('alumno-anio').value);
    const fotoFile  = document.getElementById('alumno-foto').files[0];

    if (!nie || !nombres || !apellidos || !gradoId) return alert('Todos los campos son obligatorios');

    let foto_url = alumnosCache.find(a => a.id === id)?.foto_url || null;

    if (fotoFile) {
        try {
            foto_url = await subirFoto(fotoFile, CLOUDINARY_CLOUD, CLOUDINARY_PRESET);
        } catch(e) {
            alert('Error subiendo foto: ' + e.message);
        }
    }

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
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

window.cerrarSesionAdmin = cerrarSesion;

init();
