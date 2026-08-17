// ═══════════════════════════════════════════
//  IDSJE — Generador de Boletas
// ═══════════════════════════════════════════
import { supabase, verificarSesion } from './auth.js';
import { INSTITUTO } from './config.js';
import { mostrarToast, notificarError, esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion, setBotonCargando } from './utils.js';

let gradosCache = [];
let periodoSel  = 1;
let gradoSel    = null;

export async function init() {
    const res = await verificarSesion('admin');
    if (!res) return;
    await cargarGrados();
}

async function cargarGrados() {
    try {
        const { data, error } = await supabase
            .from('grados')
            .select('*, usuarios!grados_docente_guia_id_fkey(nombre_completo)')
            .order('nombre');

        if (error && esErrorDeRed(error)) {
            mostrarBannerSinConexion(() => cargarGrados());
            return;
        }
        ocultarBannerSinConexion();

        gradosCache = data || [];

        const sel = document.getElementById('sel-grado');
        sel.innerHTML = '<option value="">— Seleccionar sección —</option>' +
            gradosCache.map(g => `<option value="${g.id}">${g.nombre} ${g.modalidad} — Sección ${g.seccion}</option>`).join('');
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => cargarGrados());
            return;
        }
        notificarError(err, 'Error cargando grados');
    }
}

window.setPeriodoBoleta = (n) => {
    periodoSel = n;
    document.querySelectorAll('.periodo-btn-b').forEach((b, i) => {
        b.classList.toggle('active', i + 1 === n);
    });
    if (gradoSel) window.generarBoletas();
};

window.generarBoletas = async () => {
    const gradoId = document.getElementById('sel-grado').value;
    if (!gradoId) return mostrarToast('Seleccioná un grado primero', 'advertencia');

    const btn = document.getElementById('btn-generar-boletas');
    setBotonCargando(btn, true, 'Generando...');

    gradoSel = gradosCache.find(g => g.id === gradoId);
    document.getElementById('loading-boletas').classList.remove('hidden');
    document.getElementById('contenedor-boletas').innerHTML = '';

    // Cargar alumnos
    const { data: alumnos, error: eAlumnos } = await supabase
        .from('alumnos')
        .select('*')
        .eq('grado_id', gradoId)
        .eq('activo', true)
        .order('apellidos');

    if (eAlumnos) {
        document.getElementById('loading-boletas').classList.add('hidden');
        setBotonCargando(btn, false);
        return notificarError(eAlumnos, 'Error cargando alumnos');
    }

    if (!alumnos?.length) {
        document.getElementById('loading-boletas').classList.add('hidden');
        setBotonCargando(btn, false);
        mostrarToast('No hay alumnos en este grado', 'advertencia');
        return;
    }

    // Cargar materias del grado con sus docentes
    const { data: gradoMaterias } = await supabase
        .from('grado_materia')
        .select('*, materias(id, nombre)')
        .eq('grado_id', gradoId);

    const materiaIds = (gradoMaterias || []).map(gm => gm.id);

    // Cargar notas del periodo seleccionado y de los periodos anteriores (para las columnas de historial)
    const { data: todasNotas } = await supabase
        .from('notas')
        .select('*')
        .in('grado_materia_id', materiaIds)
        .lte('periodo', periodoSel);

    // Cargar competencias
    const alumnoIds = alumnos.map(a => a.id);
    const { data: competencias } = await supabase
        .from('competencias')
        .select('*')
        .in('alumno_id', alumnoIds)
        .eq('grado_id', gradoId)
        .eq('periodo', periodoSel);

    // Generar boletas
    const contenedor = document.getElementById('contenedor-boletas');
    let html = '';

    alumnos.forEach((al, idx) => {
        // notasAlumno[materiaId][periodo] = fila de notas
        const notasAlumno = {};
        (todasNotas || []).forEach(n => {
            if (n.alumno_id !== al.id) return;
            if (!notasAlumno[n.grado_materia_id]) notasAlumno[n.grado_materia_id] = {};
            notasAlumno[n.grado_materia_id][n.periodo] = n;
        });

        const compAlumno = (competencias || []).find(c => c.alumno_id === al.id) || {};
        const reprobadas = (gradoMaterias || []).filter(gm => {
            const n = notasAlumno[gm.id]?.[periodoSel];
            if (!n) return false;
            const nf = n.nota_final_rec ?? n.nota_final;
            return nf < 6;
        }).length;

        const promedio = calcularPromedio(gradoMaterias, notasAlumno);
        html += generarHTMLBoleta(al, gradoMaterias, notasAlumno, compAlumno, reprobadas, promedio, idx + 1, alumnos.length);
    });

    document.getElementById('loading-boletas').classList.add('hidden');
    setBotonCargando(btn, false);
    contenedor.innerHTML = html;
};

function calcularPromedio(materias, notas) {
    const nfs = materias.map(gm => {
        const n = notas[gm.id]?.[periodoSel];
        if (!n) return null;
        return n.nota_final_rec ?? n.nota_final ?? 0;
    }).filter(n => n !== null && n > 0);

    if (!nfs.length) return '0.00';
    return (nfs.reduce((a, b) => a + b, 0) / nfs.length).toFixed(2);
}

function generarHTMLBoleta(al, materias, notas, comp, reprobadas, promedio, num, total) {
    const nombreCompleto = `${al.nombres} ${al.apellidos}`;
    const gradoNombre = `${gradoSel.nombre} ${gradoSel.modalidad} SECCION "${gradoSel.seccion}"`;
    const docGuia = gradoSel.usuarios?.nombre_completo || 'Docente Guía';

    // Periodos anteriores al seleccionado, para las columnas de historial (P2→[1], P3→[1,2], P4→[1,2,3])
    const periodosAnteriores = Array.from({ length: periodoSel - 1 }, (_, i) => i + 1);

    const filasNotas = materias.map((gm, i) => {
        const historial = notas[gm.id] || {};
        const n = historial[periodoSel] || {};
        const act = n.actividades?.toFixed(2) ?? '0.00';
        const lab = n.laboratorio?.toFixed(2) ?? '0.00';
        const exa = n.examen?.toFixed(2) ?? '0.00';
        const nf  = n.nota_final?.toFixed(1) ?? '0.0';
        const rec = n.recuperacion?.toFixed(2) ?? '';
        const nfr = n.nota_final_rec?.toFixed(1) ?? '';
        const nfEfectiva = n.nota_final_rec ?? n.nota_final ?? 0;
        const reprobada = nfEfectiva < 6 && (n.nota_final ?? 0) > 0;
        const claseFila = nfEfectiva > 0 && nfEfectiva < 6 ? 'fila-roja' : '';

        const tdPeriodosAnteriores = periodosAnteriores.map(p => {
            const np = historial[p];
            const nfAnterior = np ? (np.nota_final_rec ?? np.nota_final ?? 0) : null;
            return `<td class="td-nota">${nfAnterior ? nfAnterior.toFixed(1) : ''}</td>`;
        }).join('');

        return `
        <tr class="${claseFila}">
            <td class="td-num">${i + 1}</td>
            <td class="td-materia">${gm.materias?.nombre || ''}</td>
            ${tdPeriodosAnteriores}
            <td class="td-nota">${act}</td>
            <td class="td-nota">${lab}</td>
            <td class="td-nota">${exa}</td>
            <td class="td-nf ${reprobada ? 'reprobado' : ''}">${nf}</td>
            <td class="td-nota">${rec}</td>
            <td class="td-nota">${nfr}</td>
        </tr>`;
    }).join('');

    const thPeriodosAnteriores = periodosAnteriores.map(p => `<th>P${p}</th>`).join('');
    const colspanReprobadas = 6 + periodosAnteriores.length;

    const COMPETENCIAS_LABELS = [
        ['Evidencia actitudes favorables para la convivencia y cultura de paz', comp.convivencia || ''],
        ['Toma decisiones de forma autónoma y responsable', comp.autonomia || ''],
        ['Se expresa y participa con respeto', comp.expresion || ''],
        ['Muestra sentido de pertenencia y respeto por nuestra cultura', comp.pertenencia || ''],
    ];

    return `
    <div class="boleta-page" id="boleta-${al.id}">
        <div class="boleta-toolbar no-print">
            <button type="button" class="btn-imprimir-boleta" onclick="imprimirBoletaIndividual('${al.id}')">🖨 Imprimir</button>
        </div>

        <!-- ENCABEZADO -->
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

        <div class="boleta-titulo">
            BOLETA DE CALIFICACIONES PERIODO ${periodoSel} AÑO ${INSTITUTO.anio}
        </div>
        <div class="boleta-subtitulo">EDUCACIÓN MEDIA</div>

        <!-- DATOS DEL ALUMNO -->
        <div class="alumno-datos">
            <div class="alumno-info">
                <div class="dato-row">
                    <span class="dato-label">NOMBRE DEL ESTUDIANTE:</span>
                    <span class="dato-valor">${nombreCompleto}</span>
                </div>
                <div class="dato-row">
                    <span class="dato-label">NIE:</span>
                    <span class="dato-valor">${al.nie}</span>
                </div>
                <div class="dato-row">
                    <span class="dato-label">GRADO:</span>
                    <span class="dato-valor">${gradoNombre}</span>
                </div>
            </div>
            ${al.foto_url ? `<img src="${al.foto_url}" class="foto-alumno" alt="${nombreCompleto}">` : '<div class="foto-alumno foto-vacia"></div>'}
        </div>

        <!-- TABLA DE NOTAS -->
        <table class="tabla-notas">
            <thead>
                <tr>
                    <th>No</th>
                    <th class="th-materia">ASIGNATURAS:</th>
                    ${thPeriodosAnteriores}
                    <th>ACTIVIDADES 35%</th>
                    <th>LABORATORIO 35%</th>
                    <th>EXAMEN 30%</th>
                    <th>NF</th>
                    <th>Rcup.</th>
                    <th>NFR</th>
                </tr>
            </thead>
            <tbody>${filasNotas}</tbody>
            <tfoot>
                <tr>
                    <td colspan="${colspanReprobadas}" class="td-reprobadas">
                        ASIGNATURAS REPROBADAS: <strong>${reprobadas}</strong>
                    </td>
                    <td colspan="2"></td>
                </tr>
            </tfoot>
        </table>

        <!-- COMPETENCIAS -->
        <table class="tabla-competencias">
            <thead>
                <tr>
                    <th class="th-comp">COMPETENCIAS CIUDADANAS:</th>
                    <th class="th-concepto">CONCEPTO</th>
                </tr>
            </thead>
            <tbody>
                ${COMPETENCIAS_LABELS.map(([label, val]) => `
                <tr>
                    <td class="td-comp">${label}</td>
                    <td class="td-concepto">${val}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <!-- OBSERVACIÓN E INASISTENCIAS -->
        <table class="tabla-obs">
            <tr>
                <td class="td-obs-label">OBSERVACIÓN:</td>
                <td class="td-obs-val">${comp.observacion || ''}</td>
            </tr>
            <tr>
                <td class="td-obs-label">INASISTENCIA</td>
                <td class="td-obs-val">${comp.inasistencias || ''}</td>
            </tr>
            <tr>
                <td class="td-obs-label">PROMEDIO GENERAL</td>
                <td class="td-obs-val td-promedio">${promedio}</td>
            </tr>
        </table>

        <!-- FIRMAS -->
        <div class="firmas">
            <div class="firma-bloque">
                <div class="firma-linea"></div>
                <div class="firma-nombre">Licda. María Mirna Miranda de Solorzano</div>
                <div class="firma-cargo">DIRECTORA</div>
            </div>
            <div class="firma-bloque">
                <div class="firma-linea"></div>
                <div class="firma-nombre">${docGuia}</div>
                <div class="firma-cargo">DOCENTE GUIA</div>
            </div>
        </div>

        <div class="boleta-footer">
            Fecha: ${new Date().toLocaleDateString('es-SV')} &nbsp;&nbsp; Página ${num}/${total}
        </div>
    </div>`;
}

window.imprimirBoletas = () => window.print();

window.imprimirBoletaIndividual = (alumnoId) => {
    const actual = document.getElementById(`boleta-${alumnoId}`);
    if (!actual) return;
    document.body.classList.add('imprimir-individual');
    document.querySelectorAll('.boleta-page').forEach(p => p.classList.toggle('imprimir-actual', p === actual));
    window.print();
};

window.addEventListener('afterprint', () => {
    document.body.classList.remove('imprimir-individual');
    document.querySelectorAll('.boleta-page').forEach(p => p.classList.remove('imprimir-actual'));
});

window.cerrarSesionBoleta = async () => {
    await supabase.auth.signOut();
    window.location.href = './index.html';
};

init();
