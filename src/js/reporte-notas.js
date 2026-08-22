// ═══════════════════════════════════════════
//  IDSJE — Reporte de Notas Finales por Grado
//  Uso: reporte-notas.html?grado=<id>&periodo=1..4
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO, getAñoActivo } from './config.js';
import { notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion } from './utils.js';

async function init() {
    const params  = new URLSearchParams(location.search);
    const gradoId = params.get('grado');
    const periodo = parseInt(params.get('periodo'), 10);
    const cont = document.getElementById('contenedor-notas');

    if (!gradoId || !periodo) {
        cont.innerHTML = '<p style="padding:40px;text-align:center;color:#94a3b8">Falta indicar un grado y un período en la URL.</p>';
        return;
    }

    const res = await verificarSesion();
    if (!res) return;

    await renderReporte(gradoId, periodo);
}

async function renderReporte(gradoId, periodo) {
    const cont = document.getElementById('contenedor-notas');
    try {
        const anioActivo = await getAñoActivo(supabase);
        const [{ data: grado, error: eG }, { data: matriculas, error: eAl }, { data: gradoMaterias, error: eGm }] = await Promise.all([
            supabase.from('grados').select('*').eq('id', gradoId).single(),
            anioActivo
                ? supabase.from('matriculas').select('*, alumnos(*)').eq('grado_id', gradoId).eq('año_academico_id', anioActivo.id).eq('activo', true)
                : Promise.resolve({ data: [], error: null }),
            supabase.from('grado_materia').select('*, materias(id, nombre)').eq('grado_id', gradoId),
        ]);

        const errorDeRed = [eG, eAl, eGm].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderReporte(gradoId, periodo)); return; }
        ocultarBannerSinConexion();
        if (eG) return notificarError(eG, 'Error cargando el grado');
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');
        if (eGm) return notificarError(eGm, 'Error cargando materias');
        if (!anioActivo) return notificarError({ message: 'No hay un año académico activo configurado' }, 'Error');

        const alumnos = (matriculas || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

        const materiaIds = (gradoMaterias || []).map(gm => gm.id);
        let notas = [];
        if (materiaIds.length) {
            const { data, error: eN } = await supabase
                .from('notas')
                .select('*')
                .in('grado_materia_id', materiaIds)
                .eq('periodo', periodo);
            if (eN) return notificarError(eN, 'Error cargando notas');
            notas = data || [];
        }

        // notasPorAlumnoMateria[alumno_id][grado_materia_id] = nota_final_rec ?? nota_final
        const notasPorAlumnoMateria = {};
        notas.forEach(n => {
            if (!notasPorAlumnoMateria[n.alumno_id]) notasPorAlumnoMateria[n.alumno_id] = {};
            notasPorAlumnoMateria[n.alumno_id][n.grado_materia_id] = n.nota_final_rec ?? n.nota_final ?? null;
        });

        const titulo = `${grado.nombre} ${grado.modalidad} SECCIÓN "${grado.seccion}"`;
        cont.innerHTML = generarHTML(titulo, alumnos || [], gradoMaterias || [], notasPorAlumnoMateria, periodo);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderReporte(gradoId, periodo)); return; }
        notificarError(err, 'Error cargando el reporte');
    }
}

function generarHTML(titulo, alumnos, gradoMaterias, notasPorAlumnoMateria, periodo) {
    const filasAlumnos = alumnos.map((al, idx) => {
        const celdas = gradoMaterias.map(gm => {
            const nf = notasPorAlumnoMateria[al.id]?.[gm.id];
            if (nf === undefined || nf === null) return '<td>—</td>';
            const roja = nf < 6;
            return `<td class="td-nf ${roja ? 'td-nf-roja' : ''}">${nf.toFixed(1)}</td>`;
        }).join('');

        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            ${celdas}
        </tr>`;
    }).join('');

    const celdasPromedio = gradoMaterias.map(gm => {
        const notasMateria = alumnos
            .map(al => notasPorAlumnoMateria[al.id]?.[gm.id])
            .filter(nf => nf !== undefined && nf !== null);
        if (!notasMateria.length) return '<td>—</td>';
        const prom = notasMateria.reduce((a, b) => a + b, 0) / notasMateria.length;
        return `<td>${prom.toFixed(1)}</td>`;
    }).join('');

    const headerMaterias = gradoMaterias.map(gm => `<th>${gm.materias?.nombre || ''}</th>`).join('');

    return `
    <div class="boleta-page">
        <div class="boleta-toolbar no-print">
            <button type="button" class="btn-imprimir-boleta" onclick="window.print()">🖨 Imprimir</button>
        </div>

        <div class="boleta-header">
            <div class="header-logos">
                <img src="https://raw.githubusercontent.com/Diocesano20266/idsje-sistema/main/logo-idsje.png" alt="Logo IDSJE" class="logo-img">
            </div>
            <div class="header-info">
                <div class="inst-nombre">${INSTITUTO.nombre}</div>
                <div class="inst-dir">${INSTITUTO.direccion}</div>
                <div class="inst-dir">Teléfono: ${INSTITUTO.telefono} | ${INSTITUTO.correo}</div>
            </div>
            <div class="header-logos">
                <img src="https://raw.githubusercontent.com/Diocesano20266/idsje-sistema/main/logo-mineducyt.png" alt="Logo MINED" class="logo-img logo-mined-img" onerror="this.onerror=null;this.src='https://www.mined.gob.sv/images/logo-mined.png'">
            </div>
        </div>

        <div class="boleta-titulo">Reporte de Notas Finales — Período ${periodo}</div>
        <div class="boleta-subtitulo">${titulo} — AÑO ${INSTITUTO.anio}</div>

        <table class="tabla-notas-finales">
            <thead>
                <tr>
                    <th class="th-num">No</th>
                    <th class="th-nombre">Alumno</th>
                    ${headerMaterias}
                </tr>
            </thead>
            <tbody>
                ${filasAlumnos}
                <tr class="fila-promedio">
                    <td colspan="2">PROMEDIO GENERAL POR MATERIA</td>
                    ${celdasPromedio}
                </tr>
            </tbody>
        </table>
    </div>`;
}

init();
