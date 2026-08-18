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
} from '../src/js/utils.js';
import { generarHorario, verificarConflictos } from '../src/js/generador-horarios.js';

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
// 6. Generador automático de horarios (CSP + backtracking)
// ═══════════════════════════════════════════
describe('generarHorario', () => {
    // 2 grados, 3 materias, 2 docentes (uno de ellos compartido entre grados
    // y con jornada de media mañana) — caso factible sin apuros de capacidad.
    const configFactible = {
        asignaciones: [
            { id: 'gm1', gradoId: 'G1', materiaId: 'M1', materiaNombre: 'Matemática',  docenteId: 'D1', horasPorSemana: 3 },
            { id: 'gm2', gradoId: 'G1', materiaId: 'M2', materiaNombre: 'Educación Física', docenteId: 'D2', horasPorSemana: 2 },
            { id: 'gm3', gradoId: 'G2', materiaId: 'M1', materiaNombre: 'Matemática',  docenteId: 'D1', horasPorSemana: 2 },
            { id: 'gm4', gradoId: 'G2', materiaId: 'M3', materiaNombre: 'Lenguaje',    docenteId: 'D3', horasPorSemana: 3 },
        ],
        disponibilidadDocente: { D2: 'manana' },
    };

    test('encuentra una solución para una configuración factible', () => {
        const resultado = generarHorario(configFactible, 42);
        expect(resultado).not.toBeNull();
    });

    test('el resultado no tiene choques de docente ni de grado', () => {
        const resultado = generarHorario(configFactible, 42);
        const { ok, conflictosGrado, conflictosDocente } = verificarConflictos(resultado);
        expect(ok).toBe(true);
        expect(conflictosGrado).toHaveLength(0);
        expect(conflictosDocente).toHaveLength(0);
    });

    test('cada materia aparece exactamente la cantidad de horas configurada', () => {
        const resultado = generarHorario(configFactible, 42);
        configFactible.asignaciones.forEach(a => {
            const horasAsignadas = resultado.filter(f => f.grado_materia_id === a.id).length;
            expect(horasAsignadas).toBe(a.horasPorSemana);
        });
    });

    test('un docente de media jornada (manana) nunca queda después del período 7', () => {
        const resultado = generarHorario(configFactible, 7);
        const filasD2 = resultado.filter(f => f.docente_id === 'D2');
        expect(filasD2.length).toBeGreaterThan(0);
        filasD2.forEach(f => expect(f.periodo).toBeLessThanOrEqual(7));
    });

    test('misma seed + misma config → siempre el mismo resultado (determinismo)', () => {
        const r1 = generarHorario(configFactible, 99);
        const r2 = generarHorario(configFactible, 99);
        expect(r1).toEqual(r2);
    });

    test('seeds distintas pueden dar distribuciones distintas ("Generar otro")', () => {
        const r1 = generarHorario(configFactible, 1);
        const r2 = generarHorario(configFactible, 2);
        // No es garantía matemática que difieran siempre, pero con esta config
        // (varios candidatos válidos por variable) es extremadamente probable.
        expect(r1).not.toEqual(r2);
    });

    test('devuelve [] si no hay ninguna asignación que programar', () => {
        expect(generarHorario({ asignaciones: [] }, 1)).toEqual([]);
    });

    test('devuelve null cuando la demanda excede la capacidad de un docente (caso imposible)', () => {
        // D1 es de media jornada (máx. 7 períodos × 5 días = 35 horas/semana posibles)
        // pero se le exigen 10 horas en cada uno de 4 grados = 40 horas → no cabe.
        const configImposible = {
            asignaciones: [
                { id: 'a1', gradoId: 'G1', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a2', gradoId: 'G2', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a3', gradoId: 'G3', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a4', gradoId: 'G4', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
            ],
            disponibilidadDocente: { D1: 'manana' },
        };
        expect(generarHorario(configImposible, 1)).toBeNull();
    });
});

describe('verificarConflictos', () => {
    test('no marca conflictos en un horario válido', () => {
        const horario = [
            { grado_id: 'G1', docente_id: 'D1', dia: 'Lunes', periodo: 1 },
            { grado_id: 'G1', docente_id: 'D2', dia: 'Lunes', periodo: 2 },
            { grado_id: 'G2', docente_id: 'D1', dia: 'Lunes', periodo: 2 },
        ];
        expect(verificarConflictos(horario).ok).toBe(true);
    });

    test('detecta dos materias del mismo grado en el mismo día y período', () => {
        const horario = [
            { grado_id: 'G1', docente_id: 'D1', dia: 'Lunes', periodo: 1 },
            { grado_id: 'G1', docente_id: 'D2', dia: 'Lunes', periodo: 1 }, // mismo grado+dia+periodo que la anterior
        ];
        const { ok, conflictosGrado, conflictosDocente } = verificarConflictos(horario);
        expect(ok).toBe(false);
        expect(conflictosGrado).toHaveLength(1);
        expect(conflictosDocente).toHaveLength(0);
    });

    test('detecta al mismo docente en dos grados en el mismo día y período', () => {
        const horario = [
            { grado_id: 'G1', docente_id: 'D1', dia: 'Martes', periodo: 3 },
            { grado_id: 'G2', docente_id: 'D1', dia: 'Martes', periodo: 3 }, // mismo docente+dia+periodo que la anterior
        ];
        const { ok, conflictosGrado, conflictosDocente } = verificarConflictos(horario);
        expect(ok).toBe(false);
        expect(conflictosGrado).toHaveLength(0);
        expect(conflictosDocente).toHaveLength(1);
    });
});
