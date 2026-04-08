// ═══════════════════════════════════════════
//  IDSJE — Generador de Boletas v2
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO } from './config.js';

let gradosCache = [];
let periodoSel  = 1;
let gradoSel    = null;

export async function init() {
    const res = await verificarSesion('admin');
    if (!res) return;
    await cargarGrados();
}

async function cargarGrados() {
    const { data } = await supabase
        .from('grados')
        .select('*, usuarios!grados_docente_guia_id_fkey(nombre_completo)')
        .order('nombre');
    gradosCache = data || [];

    const sel = document.getElementById('sel-grado');
    sel.innerHTML = '<option value="">— Seleccionar sección —</option>' +
        gradosCache.map(g => `<option value="${g.id}">${g.nombre} — Sección ${g.seccion}</option>`).join('');
}

window.setPeriodoBoleta = (n) => {
    periodoSel = n;
    document.querySelectorAll('.periodo-btn-b').forEach((b, i) => {
        b.classList.toggle('active', i + 1 === n);
    });
};

window.generarBoletas = async () => {
    const gradoId = document.getElementById('sel-grado').value;
    if (!gradoId) return alert('Seleccioná un grado primero');

    gradoSel = gradosCache.find(g => g.id === gradoId);
    const loading = document.getElementById('loading-boletas');
    loading.classList.remove('hidden');
    document.getElementById('contenedor-boletas').innerHTML = '';

    const { data: alumnos } = await supabase
        .from('alumnos').select('*')
        .eq('grado_id', gradoId).eq('activo', true).order('apellidos');

    if (!alumnos?.length) {
        loading.classList.add('hidden');
        alert('No hay alumnos en este grado.');
        return;
    }

    const { data: gradoMaterias } = await supabase
        .from('grado_materia')
        .select('*, materias(id, nombre)')
        .eq('grado_id', gradoId);

    const materiaIds = (gradoMaterias || []).map(gm => gm.id);

    const { data: todasNotas } = await supabase
        .from('notas').select('*')
        .in('grado_materia_id', materiaIds)
        .eq('periodo', periodoSel);

    const alumnoIds = alumnos.map(a => a.id);
    const { data: competencias } = await supabase
        .from('competencias').select('*')
        .in('alumno_id', alumnoIds)
        .eq('grado_id', gradoId)
        .eq('periodo', periodoSel);

    const contenedor = document.getElementById('contenedor-boletas');
    let html = '';

    alumnos.forEach((al, idx) => {
        const notasAl = {};
        (todasNotas || []).forEach(n => { if (n.alumno_id === al.id) notasAl[n.grado_materia_id] = n; });
        const compAl = (competencias || []).find(c => c.alumno_id === al.id) || {};
        html += generarBoleta(al, gradoMaterias || [], notasAl, compAl, idx + 1, alumnos.length);
    });

    loading.classList.add('hidden');
    contenedor.innerHTML = html;
};

function calcPromedio(materias, notas) {
    const vals = materias.map(gm => {
        const n = notas[gm.id];
        if (!n) return null;
        return n.nota_final_rec ?? n.nota_final ?? 0;
    }).filter(v => v !== null && v > 0);
    if (!vals.length) return '0.00';
    return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
}

function reprobadas(materias, notas) {
    return materias.filter(gm => {
        const n = notas[gm.id];
        if (!n) return false;
        return (n.nota_final_rec ?? n.nota_final ?? 0) < 6;
    }).length;
}

function generarBoleta(al, materias, notas, comp, num, total) {
    const nombreCompleto = `${al.apellidos} ${al.nombres}`;
    const gradoNombre = `${gradoSel.nombre} ${gradoSel.modalidad} — SECCIÓN "${gradoSel.seccion}"`;
    const docGuia = gradoSel.usuarios?.nombre_completo || '________________________________';
    const promedio = calcPromedio(materias, notas);
    const nRep = reprobadas(materias, notas);
    const promedioNum = parseFloat(promedio);

    const filasNotas = materias.map((gm, i) => {
        const n = notas[gm.id] || {};
        const act = parseFloat(n.actividades || 0).toFixed(2);
        const lab = parseFloat(n.laboratorio || 0).toFixed(2);
        const exa = parseFloat(n.examen || 0).toFixed(2);
        const nf  = parseFloat(n.nota_final || 0).toFixed(1);
        const rec = n.recuperacion ? parseFloat(n.recuperacion).toFixed(2) : '';
        const nfr = n.nota_final_rec ? parseFloat(n.nota_final_rec).toFixed(1) : '';
        const nfFinal = parseFloat(n.nota_final_rec ?? n.nota_final ?? 0);
        const reprobada = nfFinal < 6 && nfFinal > 0;

        return `
        <tr>
            <td class="td-num">${i+1}</td>
            <td>${gm.materias?.nombre || ''}</td>
            <td>${act}</td>
            <td>${lab}</td>
            <td>${exa}</td>
            <td class="td-nf ${reprobada ? 'td-reprobado' : nfFinal>=6?'td-aprobado':''}">${nf}</td>
            <td>${rec}</td>
            <td class="${nfr && parseFloat(nfr)<6 ? 'td-reprobado' : ''}">${nfr}</td>
        </tr>`;
    }).join('');

    const COMP_LABELS = [
        ['Evidencia actitudes favorables para la convivencia democrática y cultura de paz', comp.convivencia || ''],
        ['Toma decisiones de forma autónoma y responsable frente a situaciones de su vida', comp.autonomia || ''],
        ['Se expresa y participa con respeto, tolerancia y asertividad', comp.expresion || ''],
        ['Muestra sentido de pertenencia, identidad cultural y respeto por la diversidad', comp.pertenencia || ''],
    ];

    return `
    <div class="boleta-page">
        <div class="boleta-top-stripe"></div>

        <!-- ENCABEZADO -->
        <div class="boleta-encabezado">
            <div class="enc-logo">
                <div class="enc-logo-text">IDSJE</div>
            </div>
            <div class="enc-info">
                <div class="enc-inst">${INSTITUTO.nombre.toUpperCase()}</div>
                <div class="enc-lema">DIOS, CIENCIA Y EDUCACIÓN</div>
                <div class="enc-dir">${INSTITUTO.direccion}</div>
                <div class="enc-dir">Tel: ${INSTITUTO.telefono} | ${INSTITUTO.correo}</div>
            </div>
            <div class="enc-mined">
                <div class="enc-mined-text">MINEDUCYT<br>El Salvador</div>
            </div>
        </div>

        <!-- TÍTULO -->
        <div class="boleta-titulo-wrap">
            <div class="boleta-titulo">Boleta de Calificaciones — Educación Media</div>
            <div class="boleta-periodo">Periodo ${periodoSel} · Año ${INSTITUTO.anio}</div>
        </div>

        <!-- DATOS ALUMNO -->
        <div class="alumno-section">
            <div class="alumno-datos">
                <div class="dato-fila">
                    <span class="dato-etiqueta">Estudiante:</span>
                    <span class="dato-valor">${nombreCompleto}</span>
                </div>
                <div class="dato-fila">
                    <span class="dato-etiqueta">NIE:</span>
                    <span class="dato-valor">${al.nie}</span>
                </div>
                <div class="dato-fila">
                    <span class="dato-etiqueta">Grado:</span>
                    <span class="dato-valor">${gradoNombre}</span>
                </div>
                <div class="dato-fila">
                    <span class="dato-etiqueta">Docente Guía:</span>
                    <span class="dato-valor">${docGuia}</span>
                </div>
            </div>
            ${al.foto_url
                ? `<img src="${al.foto_url}" class="alumno-foto" alt="${nombreCompleto}">`
                : `<div class="alumno-foto-vacia">Sin<br>fotografía</div>`
            }
        </div>

        <!-- TABLA NOTAS -->
        <div class="notas-section">
            <div class="section-titulo">Registro de Calificaciones</div>
            <table class="tabla-notas">
                <thead>
                    <tr>
                        <th>N°</th>
                        <th style="text-align:left">Asignatura</th>
                        <th>Actividades<br><small style="font-weight:400;font-size:8px">35% / 3.5</small></th>
                        <th>Laboratorio<br><small style="font-weight:400;font-size:8px">35% / 3.5</small></th>
                        <th>Examen<br><small style="font-weight:400;font-size:8px">30% / 3.0</small></th>
                        <th>N.F.</th>
                        <th>Recuper.</th>
                        <th>N.F.R.</th>
                    </tr>
                </thead>
                <tbody>${filasNotas}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="5" style="text-align:right;font-size:9px;color:#64748b">Asignaturas reprobadas:</td>
                        <td colspan="3" style="color:${nRep>0?'#991b1b':'#166534'};font-size:13px">${nRep}</td>
                    </tr>
                </tfoot>
            </table>
        </div>

        <!-- COMPETENCIAS -->
        <div class="comp-section">
            <div class="section-titulo" style="margin-bottom:0">Competencias Ciudadanas</div>
            <table class="tabla-comp">
                <thead>
                    <tr>
                        <th>Competencia</th>
                        <th style="text-align:center;width:80px">Concepto<br><small style="font-weight:400;font-size:8px">E·MB·B·R·D</small></th>
                    </tr>
                </thead>
                <tbody>
                    ${COMP_LABELS.map(([label, val]) => `
                    <tr>
                        <td>${label}</td>
                        <td style="text-align:center;font-weight:800;font-size:13px;color:#0a1628">${val}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>

        <!-- RESUMEN -->
        <div class="resumen-section">
            <div class="resumen-item">
                <div class="resumen-label">Promedio General</div>
                <div class="resumen-val ${promedioNum>=6?'aprobado':'reprobado'}">${promedio}</div>
            </div>
            <div class="resumen-item">
                <div class="resumen-label">Inasistencias</div>
                <div class="resumen-val">${comp.inasistencias || 0}</div>
            </div>
            <div class="resumen-item" style="flex:2;text-align:left">
                <div class="resumen-label">Observación</div>
                <div style="font-size:12px;color:#1e293b;margin-top:4px;min-height:28px">${comp.observacion || ''}</div>
            </div>
        </div>

        <!-- FIRMAS -->
        <div class="firmas-section">
            <div class="firma-bloque">
                <div class="firma-linea"></div>
                <div class="firma-nombre">Licda. María Mirna Miranda de Solorzano</div>
                <div class="firma-cargo">Directora</div>
            </div>
            <div class="firma-bloque">
                <div class="firma-linea"></div>
                <div class="firma-nombre">${docGuia}</div>
                <div class="firma-cargo">Docente Guía</div>
            </div>
            <div class="firma-bloque">
                <div class="firma-linea"></div>
                <div class="firma-nombre">Padre / Madre / Encargado</div>
                <div class="firma-cargo">Firma y Sello</div>
            </div>
        </div>

        <div class="boleta-footer">
            <span>Generado el ${new Date().toLocaleDateString('es-SV', {day:'numeric',month:'long',year:'numeric'})}</span>
            <span>Página ${num} de ${total}</span>
        </div>
        <div class="boleta-footer-stripe"></div>
    </div>`;
}

window.imprimirBoletas = () => window.print();

window.cerrarSesionBoleta = async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
};

init();
