// ═══════════════════════════════════════════
//  IDSJE — Lista en Blanco para Registro Manual de Actividades
//  Uso: reporte-lista-actividades.html?grado=<id>&materia=<grado_materia_id>&periodo=1..4
//       &cotidianas=0..10&integradoras=0..5&examenes=0..3
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO } from './config.js';
import { notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion } from './utils.js';

const MAX_COTIDIANAS   = 10;
const MAX_INTEGRADORAS = 5;
const MAX_EXAMENES     = 3;

async function init() {
    const params    = new URLSearchParams(location.search);
    const gradoId   = params.get('grado');
    const materiaId = params.get('materia'); // id de grado_materia
    const periodo   = parseInt(params.get('periodo'), 10);
    const cotidianas   = Math.min(MAX_COTIDIANAS,   Math.max(0, parseInt(params.get('cotidianas'), 10) || 0));
    const integradoras = Math.min(MAX_INTEGRADORAS, Math.max(0, parseInt(params.get('integradoras'), 10) || 0));
    const examenes      = Math.min(MAX_EXAMENES,     Math.max(0, parseInt(params.get('examenes'), 10) || 0));
    const cont = document.getElementById('contenedor-actividades');

    if (!gradoId || !materiaId || !periodo) {
        cont.innerHTML = '<p style="padding:40px;text-align:center;color:#94a3b8">Falta indicar grado, materia y período en la URL.</p>';
        return;
    }

    if (cotidianas + integradoras + examenes > 6) {
        const style = document.createElement('style');
        style.textContent = '@media print { @page { size: landscape; } }';
        document.head.appendChild(style);
    }

    const res = await verificarSesion();
    if (!res) return;

    await renderReporte(gradoId, materiaId, periodo, { cotidianas, integradoras, examenes });
}

async function renderReporte(gradoId, materiaId, periodo, cantidades) {
    const cont = document.getElementById('contenedor-actividades');
    try {
        const [{ data: grado, error: eG }, { data: gm, error: eGm }, { data: alumnos, error: eAl }] = await Promise.all([
            supabase.from('grados').select('*').eq('id', gradoId).single(),
            supabase.from('grado_materia').select('*, materias(id, nombre)').eq('id', materiaId).single(),
            supabase.from('alumnos').select('*').eq('grado_id', gradoId).eq('activo', true).order('apellidos'),
        ]);

        const errorDeRed = [eG, eGm, eAl].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderReporte(gradoId, materiaId, periodo, cantidades)); return; }
        ocultarBannerSinConexion();
        if (eG) return notificarError(eG, 'Error cargando el grado');
        if (eGm) return notificarError(eGm, 'Error cargando la materia');
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');

        cont.innerHTML = generarHTML(grado, gm, alumnos || [], periodo, cantidades);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderReporte(gradoId, materiaId, periodo, cantidades)); return; }
        notificarError(err, 'Error cargando el reporte');
    }
}

// Grupo de columnas: { clave, titulo, cantidad, prefijo, claseGrupo }
const GRUPOS = [
    { clave: 'cotidianas',   titulo: 'COTIDIANAS 35%',   prefijo: 'C', claseGrupo: 'th-grupo-cot' },
    { clave: 'integradoras', titulo: 'INTEGRADORAS 35%', prefijo: 'I', claseGrupo: 'th-grupo-int' },
    { clave: 'examenes',     titulo: 'EXAMEN 30%',       prefijo: 'E', claseGrupo: 'th-grupo-exa' },
];

function generarHTML(grado, gm, alumnos, periodo, cantidades) {
    const gradoTitulo = `${grado.nombre} ${grado.modalidad} SECCIÓN "${grado.seccion}"`;
    const materiaNombre = gm.materias?.nombre || '';
    const gruposConCantidad = GRUPOS.filter(g => cantidades[g.clave] > 0);
    const totalColumnasActividad = gruposConCantidad.reduce((s, g) => s + cantidades[g.clave], 0);

    const headerGrupos = gruposConCantidad
        .map(g => `<th colspan="${cantidades[g.clave]}" class="th-grupo ${g.claseGrupo}">${g.titulo}</th>`)
        .join('');

    const headerColumnas = gruposConCantidad
        .map(g => Array.from({ length: cantidades[g.clave] }, (_, i) => `
            <th><input type="text" class="input-actividad" placeholder="${g.prefijo}${i + 1}" maxlength="12"></th>
        `).join(''))
        .join('');

    const filas = alumnos.map((al, idx) => `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-nombre">${al.apellidos}, ${al.nombres}</td>
            ${'<td></td>'.repeat(totalColumnasActividad)}
            <td></td>
        </tr>`).join('');

    return `
    <div class="boleta-page">
        <div class="boleta-toolbar no-print">
            <span class="aviso-actividades">Escribí el nombre de cada actividad en los encabezados antes de imprimir</span>
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

        <div class="boleta-titulo">Lista de Registro de Actividades</div>
        <div class="datos-lista">
            <div><b>Grado:</b> ${gradoTitulo}</div>
            <div><b>Materia:</b> ${materiaNombre} &nbsp;&nbsp; <b>Período:</b> ${periodo} &nbsp;&nbsp; <b>Año:</b> ${INSTITUTO.anio}</div>
            <div><b>Fecha:</b> ${new Date().toLocaleDateString('es-SV')}</div>
        </div>

        <table class="tabla-actividades">
            <thead>
                <tr>
                    <th class="th-num" rowspan="2">No</th>
                    <th class="th-nombre" rowspan="2">Apellidos y Nombres</th>
                    ${headerGrupos}
                    <th class="th-nf" rowspan="2">NF</th>
                </tr>
                <tr>
                    ${headerColumnas}
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    </div>`;
}

init();
