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
        .select('*')
        .order('nombre');
    gradosCache = data || [];
    const sel = document.getElementById('sel-grado');
    sel.innerHTML = '<option value="">— Seleccionar sección —</option>' +
        gradosCache.map(g => `<option value="${g.id}">${g.nombre} — Sección ${g.seccion}</option>`).join('');
}

window.setPeriodoBoleta = (n) => {
    periodoSel = n;
    document.querySelectorAll('.periodo-btn-b').forEach((b, i) => b.classList.toggle('active', i+1===n));
};

window.generarBoletas = async () => {
    const gradoId = document.getElementById('sel-grado').value;
    if (!gradoId) return alert('Seleccioná un grado primero');
    gradoSel = gradosCache.find(g => g.id === gradoId);

    const loading = document.getElementById('loading-boletas');
    loading.classList.remove('hidden');
    document.getElementById('contenedor-boletas').innerHTML = '';

    const [{ data: alumnos }, { data: gradoMaterias }, { data: docenteGuia }] = await Promise.all([
        supabase.from('alumnos').select('*').eq('grado_id', gradoId).eq('activo', true).order('apellidos'),
        supabase.from('grado_materia').select('*, materias(id, nombre)').eq('grado_id', gradoId),
        supabase.from('usuarios').select('nombre_completo').eq('id', gradoSel.docente_guia_id).single(),
    ]);

    if (!alumnos?.length) { loading.classList.add('hidden'); alert('No hay alumnos.'); return; }

    const materiaIds = (gradoMaterias||[]).map(gm => gm.id);
    const alumnoIds  = alumnos.map(a => a.id);

    const [{ data: todasNotas }, { data: competencias }] = await Promise.all([
        supabase.from('notas').select('*').in('grado_materia_id', materiaIds).eq('periodo', periodoSel),
        supabase.from('competencias').select('*').in('alumno_id', alumnoIds).eq('grado_id', gradoId).eq('periodo', periodoSel),
    ]);

    const docNombre = docenteGuia?.nombre_completo || '';
    const contenedor = document.getElementById('contenedor-boletas');
    contenedor.innerHTML = alumnos.map((al, idx) => {
        const notasAl = {};
        (todasNotas||[]).forEach(n => { if (n.alumno_id===al.id) notasAl[n.grado_materia_id]=n; });
        const compAl = (competencias||[]).find(c => c.alumno_id===al.id) || {};
        return generarBoleta(al, gradoMaterias||[], notasAl, compAl, docNombre, idx+1, alumnos.length);
    }).join('');
    loading.classList.add('hidden');
};

function fmt(v, dec=2) { return parseFloat(v||0).toFixed(dec); }

function generarBoleta(al, materias, notas, comp, docNombre, num, total) {
    const gNombre = `${gradoSel.nombre} ${gradoSel.modalidad} SECCION "${gradoSel.seccion}"`.toUpperCase();

    const filas = materias.map((gm, i) => {
        const n = notas[gm.id] || {};
        const nf    = parseFloat(n.nota_final || 0);
        const nfr   = n.nota_final_rec ? parseFloat(n.nota_final_rec) : null;
        const nfFinal = nfr ?? nf;
        const reprobada = nfFinal < 6 && nfFinal > 0;
        const bgNF = reprobada ? 'background:#FF6B35;color:#fff;font-weight:800' : 'font-weight:800';

        return `<tr style="border-bottom:1px solid #ddd">
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd">${i+1}</td>
            <td style="padding:4px 8px;border-right:1px solid #ddd">${gm.materias?.nombre||''}</td>
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd">${fmt(n.actividades)}</td>
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd">${fmt(n.laboratorio)}</td>
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd">${fmt(n.examen)}</td>
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd;${bgNF}">${fmt(nf,1)}</td>
            <td style="padding:4px 6px;text-align:center;border-right:1px solid #ddd">${n.recuperacion ? fmt(n.recuperacion) : ''}</td>
            <td style="padding:4px 6px;text-align:center">${nfr ? fmt(nfr,1) : ''}</td>
        </tr>`;
    }).join('');

    const nRep = materias.filter(gm => {
        const n = notas[gm.id];
        if (!n) return false;
        return (n.nota_final_rec ?? n.nota_final ?? 0) < 6 && (n.nota_final ?? 0) > 0;
    }).length;

    const promedio = (() => {
        const vals = materias.map(gm => {
            const n = notas[gm.id];
            if (!n) return null;
            return n.nota_final_rec ?? n.nota_final ?? 0;
        }).filter(v => v !== null && v > 0);
        if (!vals.length) return '0.00';
        return (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
    })();

    const COMPS = [
        ['Evidencia actitudes favorables para la convivencia y cultura de paz', comp.convivencia||''],
        ['Toma decisiones de de forma autónoma y responsable', comp.autonomia||''],
        ['Se expresa y participa con respeto', comp.expresion||''],
        ['Muestra sentido de pertenencia y respeto por nuestra cultura', comp.pertenencia||''],
    ];

    return `
    <div class="boleta-page">
        <!-- ENCABEZADO -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
            <tr>
                <td style="width:80px;vertical-align:middle;text-align:center">
                    ${al.foto_url
                        ? `<img src="${al.foto_url}" style="width:72px;height:86px;object-fit:cover;border:1.5px solid #333">`
                        : `<div style="width:72px;height:86px;border:1.5px dashed #aaa;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center">Sin foto</div>`
                    }
                </td>
                <td style="text-align:center;vertical-align:middle;padding:0 12px">
                    <div style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">INSTITUTO DIOCESANO "SAN JUAN EVANGELISTA"</div>
                    <div style="font-size:10px;margin-top:3px;color:#333">Dirección: 2a Calle Ote. y 2a Av. Norte Barrio El Centro | San Juan Opico</div>
                    <div style="font-size:10px;color:#333">Teléfono: 7713-1964 | Correo electrónico: instituto_diocesanosje@idsje.info</div>
                </td>
                <td style="width:90px;vertical-align:middle;text-align:center">
                    <div style="border:1.5px solid #333;padding:6px;font-size:8px;font-weight:700;line-height:1.4;color:#333;text-align:center">MINISTERIO<br>DE EDUCACIÓN,<br>CIENCIA Y<br>TECNOLOGÍA</div>
                </td>
            </tr>
        </table>

        <hr style="border:none;border-top:2px solid #333;margin-bottom:8px">

        <!-- TÍTULO -->
        <div style="text-align:center;margin-bottom:6px">
            <div style="font-size:13px;font-weight:800;letter-spacing:.5px">BOLETA DE CALIFICACIONES PERIODO ${periodoSel} AÑO ${INSTITUTO.anio}</div>
            <div style="font-size:11px;font-weight:600;margin-top:2px">EDUCACIÓN MEDIA</div>
        </div>

        <!-- DATOS ALUMNO -->
        <div style="margin-bottom:8px;font-size:11px">
            <div style="margin-bottom:3px"><strong>NOMBRE DEL ESTUDIANTE:</strong> ${al.apellidos} ${al.nombres}</div>
            <div style="margin-bottom:3px"><strong>NIE:</strong> ${al.nie}</div>
            <div><strong>GRADO:</strong> ${gNombre}</div>
        </div>

        <!-- TABLA NOTAS -->
        <table style="width:100%;border-collapse:collapse;border:1.5px solid #333;margin-bottom:8px;font-size:10.5px">
            <thead>
                <tr style="background:#FFD700">
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center;width:24px">No</th>
                    <th style="padding:5px 8px;border:1px solid #333;text-align:left">ASIGNATURAS:</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center">ACTIVIDADES 35%</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center">LABORATORIO 35%</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center">EXAMEN 30%</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center;font-weight:800">NF</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center">Rcup.</th>
                    <th style="padding:5px 6px;border:1px solid #333;text-align:center">NFR</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
            <tfoot>
                <tr>
                    <td colspan="5" style="padding:5px 8px;text-align:right;font-weight:700;font-size:10.5px;border-top:1.5px solid #333">ASIGNATURAS REPROBADAS:</td>
                    <td colspan="3" style="padding:5px 8px;font-weight:800;font-size:13px;border-top:1.5px solid #333;color:${nRep>0?'#cc0000':'#000'}">${nRep}</td>
                </tr>
            </tfoot>
        </table>

        <!-- COMPETENCIAS -->
        <table style="width:100%;border-collapse:collapse;border:1.5px solid #333;margin-bottom:8px;font-size:10.5px">
            <thead>
                <tr style="background:#FFD700">
                    <th style="padding:5px 10px;border:1px solid #333;text-align:left;font-weight:800">COMPETENCIAS CIUDADANAS:</th>
                    <th style="padding:5px 10px;border:1px solid #333;text-align:center;width:100px;font-weight:800">CONCEPTO</th>
                </tr>
            </thead>
            <tbody>
                ${COMPS.map(([label, val]) => `
                <tr style="border-bottom:1px solid #ddd">
                    <td style="padding:4px 10px;border-right:1px solid #333">${label}</td>
                    <td style="padding:4px 10px;text-align:center;font-weight:800;font-size:12px">${val}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <!-- OBSERVACIÓN / INASISTENCIA / PROMEDIO -->
        <table style="width:100%;border-collapse:collapse;border:1.5px solid #333;font-size:10.5px">
            <tr>
                <td style="padding:5px 10px;border-bottom:1px solid #ddd;border-right:1px solid #333;font-weight:700;width:160px">OBSERVACIÓN:</td>
                <td style="padding:5px 10px;border-bottom:1px solid #ddd">${comp.observacion||''}</td>
            </tr>
            <tr>
                <td style="padding:5px 10px;border-bottom:1px solid #ddd;border-right:1px solid #333;font-weight:700">INASISTENCIA</td>
                <td style="padding:5px 10px;border-bottom:1px solid #ddd">${comp.inasistencias||''}</td>
            </tr>
            <tr>
                <td style="padding:5px 10px;border-right:1px solid #333;font-weight:700">PROMEDIO GENERAL</td>
                <td style="padding:5px 10px;font-weight:800;font-size:13px;text-align:right">${promedio}</td>
            </tr>
        </table>

        <div style="margin-top:4px;font-size:8.5px;color:#888;text-align:right">Pág. ${num}/${total}</div>
    </div>`;
}

window.imprimirBoletas = () => window.print();
window.cerrarSesionBoleta = async () => { await supabase.auth.signOut(); window.location.href='./index.html'; };
init();
