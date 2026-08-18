// ═══════════════════════════════════════════
//  IDSJE — Reporte Imprimible de Horario
//  Uso: horario.html?grado=<id>   → horario semanal completo de un grado
//       horario.html?docente=<id> → horario semanal personal de un docente
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO, DIAS_HORARIO, BLOQUES_HORARIO } from './config.js';
import { notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion, nombreCortoDocente } from './utils.js';

async function init() {
    const params   = new URLSearchParams(location.search);
    const gradoId   = params.get('grado');
    const docenteId = params.get('docente');
    const cont = document.getElementById('contenedor-horario');

    if (!gradoId && !docenteId) {
        cont.innerHTML = '<p style="padding:40px;text-align:center;color:#94a3b8">Falta indicar un grado o un docente en la URL.</p>';
        return;
    }

    const res = await verificarSesion();
    if (!res) return;

    if (gradoId) await renderHorarioGrado(gradoId);
    else await renderHorarioDocente(docenteId);
}

async function renderHorarioGrado(gradoId) {
    const cont = document.getElementById('contenedor-horario');
    try {
        const [{ data: grado, error: eG }, { data: horarios, error: eH }] = await Promise.all([
            supabase.from('grados').select('*').eq('id', gradoId).single(),
            supabase.from('horarios').select('*, materias(id, nombre), usuarios(id, nombre_completo)').eq('grado_id', gradoId),
        ]);

        const errorDeRed = [eG, eH].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderHorarioGrado(gradoId)); return; }
        ocultarBannerSinConexion();
        if (eG) return notificarError(eG, 'Error cargando el grado');
        if (eH) return notificarError(eH, 'Error cargando el horario');

        const titulo = `HORARIO DE CLASES — ${grado.nombre} ${grado.modalidad} SECCIÓN "${grado.seccion}" — AÑO ${INSTITUTO.anio}`;

        const porCelda = {};
        (horarios || []).forEach(h => { porCelda[`${h.dia}-${h.periodo}`] = h; });

        const celdaFn = (dia, periodo) => {
            const h = porCelda[`${dia}-${periodo}`];
            if (!h) return '';
            return `<div class="ho-materia">${h.materias?.nombre || ''}</div><div class="ho-docente">${nombreCortoDocente(h.usuarios?.nombre_completo)}</div>`;
        };

        cont.innerHTML = generarHTMLHorario(titulo, celdaFn);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderHorarioGrado(gradoId)); return; }
        notificarError(err, 'Error cargando el horario');
    }
}

async function renderHorarioDocente(docenteId) {
    const cont = document.getElementById('contenedor-horario');
    try {
        const [{ data: docente, error: eD }, { data: horarios, error: eH }] = await Promise.all([
            supabase.from('usuarios').select('*').eq('id', docenteId).single(),
            supabase.from('horarios').select('*, grados(id, nombre, seccion, modalidad), materias(id, nombre)').eq('docente_id', docenteId),
        ]);

        const errorDeRed = [eD, eH].find(e => e && esErrorDeRed(e));
        if (errorDeRed) { mostrarBannerSinConexion(() => renderHorarioDocente(docenteId)); return; }
        ocultarBannerSinConexion();
        if (eD) return notificarError(eD, 'Error cargando el docente');
        if (eH) return notificarError(eH, 'Error cargando el horario');

        const titulo = `HORARIO DE CLASES — ${docente?.nombre_completo || 'Docente'} — AÑO ${INSTITUTO.anio}`;

        const porCelda = {};
        (horarios || []).forEach(h => { porCelda[`${h.dia}-${h.periodo}`] = h; });

        const celdaFn = (dia, periodo) => {
            const h = porCelda[`${dia}-${periodo}`];
            if (!h) return '';
            const grado = h.grados ? `${h.grados.nombre} ${h.grados.modalidad} "${h.grados.seccion}"` : '';
            return `<div class="ho-materia">${h.materias?.nombre || ''}</div><div class="ho-docente">${grado}</div>`;
        };

        cont.innerHTML = generarHTMLHorario(titulo, celdaFn);
    } catch (err) {
        if (esErrorDeRed(err)) { mostrarBannerSinConexion(() => renderHorarioDocente(docenteId)); return; }
        notificarError(err, 'Error cargando el horario');
    }
}

function generarHTMLHorario(titulo, celdaFn) {
    const filas = BLOQUES_HORARIO.map(b => {
        if (b.tipo !== 'clase') {
            return `
            <tr class="fila-bloqueada">
                <td class="td-hora">${b.inicio}–${b.fin}</td>
                <td colspan="${DIAS_HORARIO.length}" class="td-bloqueado">${b.label}</td>
            </tr>`;
        }
        const celdas = DIAS_HORARIO.map(dia => `<td>${celdaFn(dia, b.periodo)}</td>`).join('');
        return `
        <tr>
            <td class="td-hora">P${b.periodo}<span>${b.inicio}–${b.fin}</span></td>
            ${celdas}
        </tr>`;
    }).join('');

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

        <table class="tabla-horario">
            <thead>
                <tr>
                    <th></th>
                    ${DIAS_HORARIO.map(d => `<th>${d}</th>`).join('')}
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
    </div>`;
}

init();
