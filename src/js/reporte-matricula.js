// ═══════════════════════════════════════════
//  IDSJE — Reporte de Matrícula por Grado
//  Uso: reporte-matricula.html?grado=<id>
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO, getAñoActivo } from './config.js';
import { notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion } from './utils.js';

async function init() {
    const params  = new URLSearchParams(location.search);
    const gradoId = params.get('grado');
    const cont = document.getElementById('contenedor-matricula');

    if (!gradoId) {
        cont.innerHTML = '<p style="padding:40px;text-align:center;color:#94a3b8">Falta indicar un grado en la URL.</p>';
        return;
    }

    const res = await verificarSesion();
    if (!res) return;

    await renderReporte(gradoId);
}

async function renderReporte(gradoId) {
    const cont = document.getElementById('contenedor-matricula');
    try {
        const anioActivo = await getAñoActivo(supabase);
        const [{ data: grado, error: eG }, { data: matriculas, error: eAl }] = await Promise.all([
            supabase.from('grados').select('*').eq('id', gradoId).single(),
            anioActivo
                ? supabase.from('matriculas').select('*, alumnos(*)').eq('grado_id', gradoId).eq('año_academico_id', anioActivo.id).eq('activo', true)
                : Promise.resolve({ data: [], error: null }),
        ]);

        const errorDeRed = [eG, eAl].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderReporte(gradoId)); return; }
        ocultarBannerSinConexion();
        if (eG) return notificarError(eG, 'Error cargando el grado');
        if (eAl) return notificarError(eAl, 'Error cargando alumnos');
        if (!anioActivo) return notificarError({ message: 'No hay un año académico activo configurado' }, 'Error');

        const alumnos = (matriculas || []).map(m => m.alumnos).filter(Boolean).sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));
        cont.innerHTML = generarHTML(grado, alumnos);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderReporte(gradoId)); return; }
        notificarError(err, 'Error cargando el reporte');
    }
}

function generarHTML(grado, alumnos) {
    const filas = alumnos.map((al, idx) => `
        <tr>
            <td class="td-num">${idx + 1}</td>
            <td class="td-foto">${al.foto_url ? `<img src="${al.foto_url}" class="foto-mini" alt="">` : '<span class="foto-mini-vacia"></span>'}</td>
            <td class="td-nie">${al.nie || ''}</td>
            <td class="td-apellidos">${al.apellidos}</td>
            <td>${al.nombres}</td>
        </tr>`).join('');

    const titulo = `${grado.nombre} ${grado.modalidad} SECCIÓN "${grado.seccion}"`;

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

        <div class="boleta-titulo">Reporte de Matrícula</div>
        <div class="boleta-subtitulo">${titulo} — AÑO ${INSTITUTO.anio}</div>

        <table class="tabla-matricula">
            <thead>
                <tr>
                    <th class="th-num">No</th>
                    <th class="th-foto">Foto</th>
                    <th>NIE</th>
                    <th>Apellidos</th>
                    <th>Nombres</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>

        <div class="total-matricula">Total de alumnos matriculados: ${alumnos.length}</div>
    </div>`;
}

init();
