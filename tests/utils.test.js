// ═══════════════════════════════════════════
//  IDSJE — Funciones puras (sin DOM ni Supabase)
//  Usadas por docente.js y cubiertas por tests/utils.test.js
// ═══════════════════════════════════════════

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
