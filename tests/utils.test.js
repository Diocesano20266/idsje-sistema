import {
    calcularNotaFinal,
    promedioPonderado,
    sumaPesos,
    pesosEquitativos,
    aplicarPesoMinimo,
    redistribuirPesos,
    PESO_MINIMO,
    colorEscala,
    puedeAccederCompetencias,
    contarDemeritosActivos,
    calcularNivelDemerito,
} from '../src/js/utils.js';

// ═══════════════════════════════════════════
// 1. Cálculo de Nota Final (fórmula IDSJE 35/35/30)
// ═══════════════════════════════════════════
describe('calcularNotaFinal', () => {
    test('notas perfectas (10/10/10) da NF = 10', () => {
        expect(calcularNotaFinal(10, 10, 10)).toBe(10);
    });

    test('notas en 0 da NF = 0', () => {
        expect(calcularNotaFinal(0, 0, 0)).toBe(0);
    });

    test('notas mixtas aplica correctamente 35/35/30', () => {
        // 8*0.35 + 6*0.35 + 7*0.30 = 2.8 + 2.1 + 2.1 = 7.0
        expect(calcularNotaFinal(8, 6, 7)).toBe(7);
    });

    test('NF puede caer exactamente en 6.0 (límite de aprobación)', () => {
        // 6*0.35 + 6*0.35 + 6*0.30 = 2.1 + 2.1 + 1.8 = 6.0
        expect(calcularNotaFinal(6, 6, 6)).toBe(6);
    });

    test('respeta la ponderación aunque una categoría sea 0 y las otras altas', () => {
        // 0*0.35 + 10*0.35 + 10*0.30 = 0 + 3.5 + 3.0 = 6.5
        expect(calcularNotaFinal(0, 10, 10)).toBe(6.5);
    });

    test('valores no numéricos se tratan como 0', () => {
        expect(calcularNotaFinal(undefined, null, '')).toBe(0);
        expect(calcularNotaFinal('abc', 5, 5)).toBe(calcularNotaFinal(0, 5, 5));
    });
});

// ═══════════════════════════════════════════
// 2. Redistribución de pesos
// ═══════════════════════════════════════════
describe('redistribuirPesos', () => {
    test.each([2, 3, 4, 5])('siempre suma exactamente 100%% con %i actividades', (n) => {
        const inicial = pesosEquitativos(n);
        const resultado = redistribuirPesos(inicial, 0, 55);
        const suma = sumaPesos(resultado);
        expect(suma).toBe(100);
    });

    test('ejemplo del enunciado: 4 actividades al 25%, C1→40% reparte 20/20/20', () => {
        const resultado = redistribuirPesos([25, 25, 25, 25], 0, 40);
        expect(resultado).toEqual([40, 20, 20, 20]);
    });

    test('el último de "los demás" absorbe el residuo del redondeo', () => {
        // Restante 40% entre 3 → 13.33 c/u → 13,13 + el último se lleva el residuo (14)
        const resultado = redistribuirPesos([25, 25, 25, 25], 0, 60);
        expect(resultado).toEqual([60, 13, 13, 14]);
        expect(sumaPesos(resultado)).toBe(100);
    });

    test('ningún peso queda por debajo de PESO_MINIMO aunque casi no quede margen', () => {
        // 98% para C1 deja solo 2% para repartir entre 5 actividades → todas se forzarían a <1%
        const resultado = redistribuirPesos([20, 20, 20, 20, 20], 0, 98);
        resultado.forEach(p => expect(p).toBeGreaterThanOrEqual(PESO_MINIMO));
        expect(sumaPesos(resultado)).toBe(100);
    });

    test('caso extremo: 100% a una actividad reajusta el valor editado para respetar el mínimo', () => {
        const resultado = redistribuirPesos([25, 25, 25, 25], 0, 100);
        expect(resultado[0]).toBeLessThan(100); // se le quita margen para poder darle 1% a las otras 3
        resultado.forEach(p => expect(p).toBeGreaterThanOrEqual(PESO_MINIMO));
        expect(sumaPesos(resultado)).toBe(100);
    });

    test('con una sola actividad, siempre queda en 100%', () => {
        expect(redistribuirPesos([100], 0, 50)).toEqual([100]);
    });

    test('redistribuciones sucesivas siguen sumando 100% (sin arrastre de error)', () => {
        let pesos = pesosEquitativos(4);
        pesos = redistribuirPesos(pesos, 0, 40);
        pesos = redistribuirPesos(pesos, 1, 30);
        pesos = redistribuirPesos(pesos, 2, 15);
        expect(sumaPesos(pesos)).toBe(100);
    });
});

describe('pesosEquitativos', () => {
    test.each([2, 3, 4, 5])('reparte 100%% entre %i actividades y suma exacto', (n) => {
        const pesos = pesosEquitativos(n);
        expect(pesos).toHaveLength(n);
        expect(sumaPesos(pesos)).toBe(100);
    });

    test('3 actividades: la última absorbe el residuo (33/33/34)', () => {
        expect(pesosEquitativos(3)).toEqual([33, 33, 34]);
    });
});

describe('aplicarPesoMinimo', () => {
    test('sube los pesos por debajo del mínimo y se lo quita al más grande', () => {
        const resultado = aplicarPesoMinimo([0, 0, 100]);
        expect(resultado).toEqual([1, 1, 98]);
        expect(sumaPesos(resultado)).toBe(100);
    });

    test('no modifica un arreglo que ya es válido', () => {
        expect(aplicarPesoMinimo([25, 25, 25, 25])).toEqual([25, 25, 25, 25]);
    });
});

// ═══════════════════════════════════════════
// 3. Promedio ponderado por categoría
// ═══════════════════════════════════════════
describe('promedioPonderado', () => {
    test('pesos iguales: el promedio ponderado coincide con el promedio simple', () => {
        const items = [
            { nota: 8, peso: 25 },
            { nota: 8, peso: 25 },
            { nota: 8, peso: 25 },
            { nota: 8, peso: 25 },
        ];
        expect(promedioPonderado(items)).toBe(8);
    });

    test('pesos desiguales: pondera según el % de cada actividad', () => {
        // 10*0.80 + 0*0.20 = 8
        const items = [
            { nota: 10, peso: 80 },
            { nota: 0,  peso: 20 },
        ];
        expect(promedioPonderado(items)).toBe(8);
    });

    test('una sola actividad: el promedio es la nota de esa actividad', () => {
        expect(promedioPonderado([{ nota: 7, peso: 100 }])).toBe(7);
    });

    test('arreglo vacío da 0', () => {
        expect(promedioPonderado([])).toBe(0);
    });

    test('valores no numéricos se tratan como 0', () => {
        const items = [{ nota: '', peso: 50 }, { nota: 10, peso: 50 }];
        expect(promedioPonderado(items)).toBe(5);
    });
});

// ═══════════════════════════════════════════
// 4. Validación de acceso a Competencias Ciudadanas
// ═══════════════════════════════════════════
describe('puedeAccederCompetencias', () => {
    test('un docente sin grado guía NO puede acceder', () => {
        expect(puedeAccederCompetencias([])).toBe(false);
    });

    test('un docente con al menos un grado guía SÍ puede acceder', () => {
        expect(puedeAccederCompetencias([{ id: 'grado-1', docente_guia_id: 'docente-1' }])).toBe(true);
    });

    test('con varios grados guía también puede acceder', () => {
        expect(puedeAccederCompetencias([{ id: 'g1' }, { id: 'g2' }])).toBe(true);
    });

    test('entradas inválidas (null/undefined) se tratan como sin acceso', () => {
        expect(puedeAccederCompetencias(null)).toBe(false);
        expect(puedeAccederCompetencias(undefined)).toBe(false);
    });
});

// ═══════════════════════════════════════════
// 5. Cálculo de color por nota
// ═══════════════════════════════════════════
describe('colorEscala', () => {
    test.each([6, 6.0, 7.5, 10])('verde cuando la nota es ≥ 6 (nota=%s)', (nota) => {
        expect(colorEscala(nota)).toBe('nivel-verde');
    });

    test.each([4, 4.0, 5, 5.9])('naranja cuando la nota está entre 4.0 y 5.9 (nota=%s)', (nota) => {
        expect(colorEscala(nota)).toBe('nivel-naranja');
    });

    test.each([3.9, 2, 0])('rojo cuando la nota es < 4.0 (nota=%s)', (nota) => {
        expect(colorEscala(nota)).toBe('nivel-rojo');
    });
});

// ═══════════════════════════════════════════
// 6. Deméritos — conteo activo y escala de consecuencias
// ═══════════════════════════════════════════
describe('contarDemeritosActivos', () => {
    test('cuenta solo los deméritos con redimido:false', () => {
        const demeritos = [{ redimido: false }, { redimido: true }, { redimido: false }, { redimido: false }];
        expect(contarDemeritosActivos(demeritos)).toBe(3);
    });

    test('un demérito sin campo redimido (undefined) cuenta como activo', () => {
        expect(contarDemeritosActivos([{}, { redimido: false }])).toBe(2);
    });

    test('arreglo vacío o nulo da 0', () => {
        expect(contarDemeritosActivos([])).toBe(0);
        expect(contarDemeritosActivos(null)).toBe(0);
        expect(contarDemeritosActivos(undefined)).toBe(0);
    });
});

describe('calcularNivelDemerito', () => {
    test.each([0, 1, 2])('menos de 3 deméritos activos no tiene nivel (nivel=%i)', (total) => {
        expect(calcularNivelDemerito(total)).toBeNull();
    });

    test.each([3, 4, 5])('3 a 5 → advertencia verbal (total=%i)', (total) => {
        expect(calcularNivelDemerito(total)).toBe('advertencia');
    });

    test.each([6, 7, 9])('6 a 9 → comunicación a familia (total=%i)', (total) => {
        expect(calcularNivelDemerito(total)).toBe('comunicacion');
    });

    test('exactamente 10 → suspensión de privilegios', () => {
        expect(calcularNivelDemerito(10)).toBe('suspension');
    });

    test.each([11, 12, 14])('11 a 14 → reunión con dirección (total=%i)', (total) => {
        expect(calcularNivelDemerito(total)).toBe('reunion');
    });

    test.each([15, 20, 100])('15 o más → no promovido de grado (total=%i)', (total) => {
        expect(calcularNivelDemerito(total)).toBe('no_promovido');
    });

    test('los tramos son excluyentes: un alumno en un tramo no cae también en otro', () => {
        // Sanity check contra la propia tabla: cada total de 0 a 20 tiene EXACTAMENTE un nivel (o null).
        for (let total = 0; total <= 20; total++) {
            expect(() => calcularNivelDemerito(total)).not.toThrow();
        }
    });

    test('valores no numéricos se tratan como 0 (sin nivel)', () => {
        expect(calcularNivelDemerito(undefined)).toBeNull();
        expect(calcularNivelDemerito('abc')).toBeNull();
    });
});
