// ═══════════════════════════════════════════
//  IDSJE — Reporte de Asistencia (mensual / lista en blanco)
//  Uso: asistencia-reporte.html?grado=<id>&mes=YYYY-MM[&blanco=1]
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO, ESTADOS_ASISTENCIA } from './config.js';
import { diasHabilesDelMes, calcularTotalesAsistencia, notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion } from './utils.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function init() {
    const params  = new URLSearchParams(location.search);
    const gradoId = params.get('grado');
    const mes     = params.get('mes'); // YYYY-MM
    const blanco  = params.get('blanco') === '1';
    const cont = document.getElementById('contenedor-asistencia');

    if (!gradoId || !mes) {
        cont.innerHTML = '<p style="padding:40px;text-align:center;color:#94a3b8">Falta indicar un grado y un mes en la URL.</p>';
        return;
    }

    const res = await verificarSesion();
    if (!res) return;

    await renderReporte(gradoId, mes, blanco);
}

async function renderReporte(gradoId, mes, blanco) {
    const cont = document.getElementById('contenedor-asistencia');
    const [anio, mesNum] = mes.split('-').map(Number);
    const dias = diasHabilesDelMes(anio, mesNum);

    try {
        const { data: grado, error: eG } = await supabase.from('grados').select('*').eq('id', gradoId).single();
        const { data: alumnos, error: eAl } = await supabase
            .from('alumnos')
            .select('*')
            .eq('grado_id', gradoId)
            .eq('activo', true)
            .order('apellidos');

        const errorDeRed = [eG, eAl].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderReporte(gradoId, mes, blanco)); return; }
        ocultarBannerSinConexion();
        if (eG) return notificarError(eG, 'Error cargando el grado');
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');

        let porAlumno = {};
        if (!blanco && alumnos?.length) {
            const desde = `${mes}-01`;
            const hasta = `${mes}-${String(new Date(anio, mesNum, 0).getDate()).padStart(2, '0')}`;
            const { data: registros, error: eR } = await supabase
                .from('asistencias')
                .select('alumno_id, fecha, estado')
                .in('alumno_id', alumnos.map(a => a.id))
                .gte('fecha', desde)
                .lte('fecha', hasta);

            if (eR && esErrorDeRed(eR)) { mostrarBannerSinConexion(() => renderReporte(gradoId, mes, blanco)); return; }
            if (eR) return notificarError(eR, 'Error cargando la asistencia');

            (registros || []).forEach(r => {
                if (!porAlumno[r.alumno_id]) porAlumno[r.alumno_id] = {};
                porAlumno[r.alumno_id][r.fecha] = r.estado;
            });
        }

        const encabezado = `${grado.nombre} ${grado.modalidad} SECCIÓN "${grado.seccion}"`;
        const titulo = blanco
            ? `LISTA DE ASISTENCIA EN BLANCO — ${encabezado} — ${MESES[mesNum - 1]} ${anio}`
            : `REPORTE DE ASISTENCIA — ${encabezado} — ${MESES[mesNum - 1]} ${anio}`;

        cont.innerHTML = generarHTML(titulo, alumnos || [], anio, mesNum, dias, porAlumno, blanco);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderReporte(gradoId, mes, blanco)); return; }
        notificarError(err, 'Error cargando el reporte');
    }
}

function fechaISO(anio, mes, dia) {
    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function generarHTML(titulo, alumnos, anio, mesNum, dias, porAlumno, blanco) {
    const filasAlumnos = alumnos.map((al, idx) => {
        const registrosAlumno = [];
        const celdas = dias.map(d => {
            if (blanco) return '<td></td>';
            const estado = porAlumno[al.id]?.[fechaISO(anio, mesNum, d)] || '';
            if (estado) registrosAlumno.push({ estado });
            return `<td>${estado}</td>`;
        }).join('');

        const totales = blanco
            ? ESTADOS_ASISTENCIA.map(e => `<td class="td-tot td-tot-${e.codigo}"></td>`).join('')
            : (() => {
                const t = calcularTotalesAsistencia(registrosAlumno);
                return ESTADOS_ASISTENCIA.map(e => `<td class="td-tot td-tot-${e.codigo}">${t[e.codigo]}</td>`).join('');
            })();

        return `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            ${celdas}
            ${totales}
        </tr>`;
    }).join('');

    const headerDias = dias.map(d => `<th rowspan="2">${d}</th>`).join('');
    const headerTotalesSub = ESTADOS_ASISTENCIA.map(e => `<th class="th-tot th-tot-${e.codigo}">${e.codigo}</th>`).join('');
    const leyenda = blanco ? '' : `<div class="leyenda-asis">${ESTADOS_ASISTENCIA.map(e => `<b>${e.codigo}</b> ${e.label}`).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>`;

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

        <div class="boleta-titulo">${titulo}</div>
        ${leyenda}

        <table class="tabla-asistencia">
            <thead>
                <tr>
                    <th class="th-num" rowspan="2">No</th>
                    <th class="th-nombre" rowspan="2">Alumno</th>
                    ${headerDias}
                    <th colspan="4">Totales</th>
                </tr>
                <tr>
                    ${headerTotalesSub}
                </tr>
            </thead>
            <tbody>${filasAlumnos}</tbody>
        </table>
    </div>`;
}

init();
