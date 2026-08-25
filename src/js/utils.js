// ═══════════════════════════════════════════
//  IDSJE — Funciones puras (sin DOM ni Supabase)
//  Usadas por docente.js y cubiertas por tests/utils.test.js
// ═══════════════════════════════════════════
import { NIVELES_DEMERITO } from './config.js';

// ── Cálculo de Nota Final — fórmula IDSJE 35/35/30 ───────────
// Entrada: promedio de cotidianas, promedio de integradoras y nota de examen,
// todas ya en escala 0–10 (sin ponderar). Devuelve NF en escala 0–10.
export function calcularNotaFinal(promCotidianas, promIntegradoras, notaExamen) {
    const cot = parseFloat(promCotidianas) || 0;
    const int = parseFloat(promIntegradoras) || 0;
    const exa = parseFloat(notaExamen) || 0;
    return parseFloat((cot * 0.35 + int * 0.35 + exa * 0.30).toFixed(2));
}

// ── Promedio ponderado por categoría ─────────────────────────
// items: [{ nota, peso }, ...] — peso en %. Resultado: Σ(nota × peso%) / 100
export function promedioPonderado(items) {
    if (!items || !items.length) return 0;
    let suma = 0;
    for (const { nota, peso } of items) {
        suma += (parseFloat(nota) || 0) * (parseFloat(peso) || 0);
    }
    return suma / 100;
}

export function sumaPesos(pesos) {
    return pesos.reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

// ── Reparto equitativo por defecto ───────────────────────────
// Reparte 100% entre `n` actividades, en enteros (el último absorbe el residuo)
export function pesosEquitativos(n) {
    if (n <= 0) return [];
    const base = Math.floor(100 / n);
    const pesos = new Array(n).fill(base);
    pesos[pesos.length - 1] += 100 - base * n;
    return pesos;
}

// Ningún peso puede quedar por debajo de este mínimo (%)
export const PESO_MINIMO = 1;

// Si algún peso quedó por debajo de PESO_MINIMO, lo sube al mínimo y le quita
// la diferencia al peso más grande del conjunto (repite hasta que todo quede válido).
export function aplicarPesoMinimo(pesos) {
    const resultado = [...pesos];
    let intentos = 0;
    let ajustado = true;
    while (ajustado && intentos < resultado.length * 2) {
        ajustado = false;
        intentos++;
        for (let i = 0; i < resultado.length; i++) {
            if (resultado[i] < PESO_MINIMO) {
                const faltante = PESO_MINIMO - resultado[i];
                resultado[i] = PESO_MINIMO;

                let iMax = -1;
                for (let j = 0; j < resultado.length; j++) {
                    if (j !== i && (iMax === -1 || resultado[j] > resultado[iMax])) iMax = j;
                }
                if (iMax !== -1) resultado[iMax] -= faltante;
                ajustado = true;
            }
        }
    }
    return resultado;
}

// Al cambiar el peso de una actividad:
// 1. Se toma el valor ingresado (redondeado, acotado 0–100).
// 2. El restante (100 - ese valor) se reparte equitativamente entre los demás.
// 3. El último de los demás absorbe el residuo del redondeo.
// 4. Ningún peso queda por debajo de PESO_MINIMO (se reajusta quitándoselo al más grande).
export function redistribuirPesos(pesos, idx, nuevoValor) {
    const n = pesos.length;
    const nuevo = Math.max(0, Math.min(100, Math.round(parseFloat(nuevoValor) || 0)));
    if (n <= 1) return [100];

    const otros = pesos.map((_, i) => i).filter(i => i !== idx);
    const restante = 100 - nuevo;

    const resultado = [...pesos];
    resultado[idx] = nuevo;

    const cada = Math.floor(restante / otros.length);
    otros.forEach(i => { resultado[i] = cada; });

    // El último de "los demás" absorbe el residuo del redondeo (puede ser negativo si restante < 0)
    const residuo = restante - cada * otros.length;
    resultado[otros[otros.length - 1]] += residuo;

    return aplicarPesoMinimo(resultado);
}

// ── Color por escala de nota (0–10) ──────────────────────────
// Verde ≥6, naranja 4–5.9, rojo <4
export function colorEscala(valor) {
    if (valor >= 6) return 'nivel-verde';
    if (valor >= 4) return 'nivel-naranja';
    return 'nivel-rojo';
}

// ── Acceso a Competencias Ciudadanas ─────────────────────────
// Solo puede acceder el docente que es guía de al menos un grado
export function puedeAccederCompetencias(gradosGuia) {
    return Array.isArray(gradosGuia) && gradosGuia.length > 0;
}

// ── Escala de consecuencias por deméritos (ver NIVELES_DEMERITO) ─────
// Cuántos deméritos de una lista siguen "activos" (no redimidos) — la
// redención es por fila individual (ver supabase/demeritos-schema.sql),
// así que el total siempre se recalcula contando filas, nunca un contador.
export function contarDemeritosActivos(demeritos) {
    return (demeritos || []).filter(d => !d.redimido).length;
}

// Dado el total de deméritos ACTIVOS de un alumno, devuelve la clave del
// tramo de NIVELES_DEMERITO en el que cae (tramos mutuamente excluyentes,
// no acumulativos), o null si todavía no llega al primer umbral (< 3).
export function calcularNivelDemerito(totalActivos) {
    const total = parseInt(totalActivos, 10) || 0;
    const nivel = NIVELES_DEMERITO.find(n => total >= n.min && (n.max === null || total <= n.max));
    return nivel ? nivel.clave : null;
}

// ── Días hábiles de un mes (reportes de asistencia) ──────────
// Lunes a viernes únicamente. mes: 1–12. Devuelve el número de día (1..N).
export function diasHabilesDelMes(anio, mes) {
    const dias = [];
    const ultimoDia = new Date(anio, mes, 0).getDate();
    for (let d = 1; d <= ultimoDia; d++) {
        const diaSemana = new Date(anio, mes - 1, d).getDay(); // 0=domingo, 6=sábado
        if (diaSemana >= 1 && diaSemana <= 5) dias.push(d);
    }
    return dias;
}

// ── Totales de asistencia (P/A/J/T) ──────────────────────────
// registros: [{ estado: 'P'|'A'|'J'|'T' }, ...]
export function calcularTotalesAsistencia(registros) {
    const totales = { P: 0, A: 0, J: 0, T: 0 };
    (registros || []).forEach(r => { if (totales[r.estado] !== undefined) totales[r.estado]++; });
    return totales;
}

// ═══════════════════════════════════════════
//  UI reutilizable (toasts, confirm, banner de conexión, loading)
//  Todo lo de acá abajo toca el DOM — solo se ejecuta al LLAMAR
//  las funciones, nunca al importar el módulo, así que no rompe
//  los tests de Jest (que corren sin `document`).
// ═══════════════════════════════════════════

// ── Toasts ────────────────────────────────────────────────────
const TOAST_ICONOS = { exito: '✓', error: '✕', advertencia: '⚠', info: 'ℹ' };
const TOAST_DURACION_MS = 3000;

function obtenerContenedorToasts() {
    let cont = document.getElementById('toast-contenedor');
    if (!cont) {
        cont = document.createElement('div');
        cont.id = 'toast-contenedor';
        document.body.appendChild(cont);
    }
    return cont;
}

// mostrarToast(mensaje, tipo) — tipo: 'exito' | 'error' | 'advertencia' | 'info'
export function mostrarToast(mensaje, tipo = 'info') {
    if (typeof document === 'undefined') return;
    const tipoValido = TOAST_ICONOS[tipo] ? tipo : 'info';
    const cont = obtenerContenedorToasts();

    const toast = document.createElement('div');
    toast.className = `toast toast-${tipoValido}`;
    toast.innerHTML = `
        <span class="toast-icono">${TOAST_ICONOS[tipoValido]}</span>
        <span class="toast-msg"></span>
        <button type="button" class="toast-cerrar" aria-label="Cerrar">✕</button>`;
    toast.querySelector('.toast-msg').textContent = mensaje;
    cont.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-show'));

    const cerrar = () => {
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 250);
    };
    toast.querySelector('.toast-cerrar').addEventListener('click', cerrar);
    setTimeout(cerrar, TOAST_DURACION_MS);
}

// ── Modal de confirmación (reemplaza confirm()) ──────────────
// mostrarConfirm(mensaje, { textoConfirmar, textoCancelar, peligroso }) → Promise<boolean>
export function mostrarConfirm(mensaje, opciones = {}) {
    if (typeof document === 'undefined') return Promise.resolve(false);
    const {
        textoConfirmar = 'Confirmar',
        textoCancelar = 'Cancelar',
        peligroso = true,
    } = opciones;

    return new Promise((resolve) => {
        let overlay = document.getElementById('confirm-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'confirm-overlay';
            overlay.innerHTML = `
                <div class="confirm-box">
                    <div class="confirm-icono">⚠</div>
                    <div class="confirm-msg"></div>
                    <div class="confirm-acciones">
                        <button type="button" class="confirm-btn confirm-cancelar"></button>
                        <button type="button" class="confirm-btn confirm-confirmar"></button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }

        overlay.querySelector('.confirm-msg').textContent = mensaje;
        const btnCancelar  = overlay.querySelector('.confirm-cancelar');
        const btnConfirmar = overlay.querySelector('.confirm-confirmar');
        btnCancelar.textContent  = textoCancelar;
        btnConfirmar.textContent = textoConfirmar;
        btnConfirmar.classList.toggle('confirm-confirmar-peligro', peligroso);

        const cerrar = (resultado) => {
            overlay.classList.remove('show');
            btnCancelar.onclick = null;
            btnConfirmar.onclick = null;
            overlay.onclick = null;
            resolve(resultado);
        };

        btnCancelar.onclick  = () => cerrar(false);
        btnConfirmar.onclick = () => cerrar(true);
        overlay.onclick = (e) => { if (e.target === overlay) cerrar(false); };

        overlay.classList.add('show');
    });
}

// ── Banner "sin conexión" ─────────────────────────────────────
let reintentarConexionActual = null;

export function mostrarBannerSinConexion(onReintentar) {
    if (typeof document === 'undefined') return;
    if (onReintentar) reintentarConexionActual = onReintentar;

    let banner = document.getElementById('banner-conexion');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'banner-conexion';
        banner.innerHTML = `
            <span>Sin conexión. Verificá tu internet e intentá de nuevo.</span>
            <button type="button" class="banner-reintentar">Reintentar</button>`;
        banner.querySelector('.banner-reintentar').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (!reintentarConexionActual) return;
            btn.disabled = true;
            try {
                await reintentarConexionActual();
            } finally {
                btn.disabled = false;
            }
        });
        document.body.appendChild(banner);
    }
    banner.classList.add('show');
}

export function ocultarBannerSinConexion() {
    if (typeof document === 'undefined') return;
    document.getElementById('banner-conexion')?.classList.remove('show');
}

// Heurística para distinguir una falla de red real de un error de negocio/validación
export function esErrorDeRed(error) {
    if (!error) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const msg = String(error?.message || error).toLowerCase();
    return msg.includes('failed to fetch')
        || msg.includes('networkerror')
        || msg.includes('network request failed')
        || msg.includes('load failed')
        || msg.includes('conexión');
}

// Punto único para reportar errores de Supabase: banner si es de red, toast si no
export function notificarError(error, prefijo = 'Error') {
    if (esErrorDeRed(error)) {
        mostrarBannerSinConexion();
        return;
    }
    mostrarToast(`${prefijo}: ${error?.message || error}`, 'error');
}

// ── Estado de carga en botones ("Guardando...") ──────────────
export function setBotonCargando(boton, cargando, textoCargando = 'Guardando...') {
    if (!boton) return;
    if (cargando) {
        if (boton.dataset.textoOriginal === undefined) boton.dataset.textoOriginal = boton.textContent;
        boton.textContent = textoCargando;
        boton.disabled = true;
    } else {
        boton.textContent = boton.dataset.textoOriginal ?? boton.textContent;
        boton.disabled = false;
    }
}

// ── Validación inline de campos ───────────────────────────────
export function mostrarErrorCampo(inputId, mensaje) {
    if (typeof document === 'undefined') return;
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.add('campo-invalido');

    let error = input.parentElement.querySelector('.campo-error');
    if (!error) {
        error = document.createElement('div');
        error.className = 'campo-error';
        input.insertAdjacentElement('afterend', error);
    }
    error.textContent = mensaje;
    error.classList.add('show');
}

export function limpiarErrorCampo(inputId) {
    if (typeof document === 'undefined') return;
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.remove('campo-invalido');
    input.parentElement.querySelector('.campo-error')?.classList.remove('show');
}

export function limpiarErroresFormulario(inputIds) {
    inputIds.forEach(limpiarErrorCampo);
}

// ── Skeleton de carga para tablas ─────────────────────────────
export function renderSkeletonFilas(tbodyId, columnas, filas = 5) {
    if (typeof document === 'undefined') return;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const fila = `<tr class="skeleton-fila">${'<td><div class="skeleton-bar"></div></td>'.repeat(columnas)}</tr>`;
    tbody.innerHTML = fila.repeat(filas);
}
