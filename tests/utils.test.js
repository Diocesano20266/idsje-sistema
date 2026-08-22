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

    // ── Bloques de 2 períodos consecutivos ──
    function agruparPeriodosPorGradoDia(filas) {
        const grupos = {};
        filas.forEach(f => {
            const key = `${f.grado_id}|${f.dia}`;
            if (!grupos[key]) grupos[key] = [];
            grupos[key].push(f.periodo);
        });
        return grupos;
    }

    test('una materia con horas pares queda en un único bloque de 2 períodos consecutivos', () => {
        // gm2 (Educación Física, D2, 2 horas) — con solo 2 horas, tiene que salir
        // como UN bloque de 2 períodos seguidos en un mismo día, no dos días sueltos.
        const resultado = generarHorario(configFactible, 42);
        const filasGm2 = resultado.filter(f => f.grado_materia_id === 'gm2');

        expect(filasGm2).toHaveLength(2);
        const dias = new Set(filasGm2.map(f => f.dia));
        expect(dias.size).toBe(1); // las 2 horas caen el mismo día

        const periodos = filasGm2.map(f => f.periodo).sort((a, b) => a - b);
        expect(periodos[1] - periodos[0]).toBe(1); // períodos consecutivos
    });

    test('una materia con horas impares deja exactamente un bloque suelto de 1 período y el resto en pares de 2', () => {
        const config = {
            asignaciones: [
                { id: 'x1', gradoId: 'G1', materiaId: 'M9', materiaNombre: 'Test', docenteId: 'D9', horasPorSemana: 5 },
            ],
        };
        const resultado = generarHorario(config, 5);
        expect(resultado).not.toBeNull();

        const porDia = {};
        resultado.forEach(f => { (porDia[f.dia] = porDia[f.dia] || []).push(f.periodo); });
        const tamanosDeBloque = Object.values(porDia).map(periodos => periodos.length).sort((a, b) => a - b);

        // 5 horas = 2 bloques de 2 + 1 bloque suelto de 1 → tamaños [1,2,2]
        expect(tamanosDeBloque).toEqual([1, 2, 2]);

        // Los bloques de tamaño 2 deben ser períodos consecutivos
        Object.values(porDia).filter(p => p.length === 2).forEach(periodos => {
            const [a, b] = [...periodos].sort((x, y) => x - y);
            expect(b - a).toBe(1);
        });
    });

    // ── Sin huecos dentro del día de un grado ──
    test('el horario de cada grado nunca deja huecos: los períodos ocupados en un día son siempre un prefijo 1..k', () => {
        const resultado = generarHorario(configFactible, 42);
        const grupos = agruparPeriodosPorGradoDia(resultado);

        Object.values(grupos).forEach(periodos => {
            const ordenados = [...periodos].sort((a, b) => a - b);
            ordenados.forEach((periodo, i) => expect(periodo).toBe(i + 1));
        });
    });

    test('sigue sin huecos incluso con varias materias compitiendo por el mismo grado', () => {
        // 3 materias de 2 horas cada una en el mismo grado → como mucho 6 períodos
        // ocupados ese día, pero SIEMPRE deben empezar en P1 y no dejar saltos.
        const config = {
            asignaciones: [
                { id: 'm1', gradoId: 'G1', materiaId: 'A', materiaNombre: 'A', docenteId: 'D1', horasPorSemana: 2 },
                { id: 'm2', gradoId: 'G1', materiaId: 'B', materiaNombre: 'B', docenteId: 'D2', horasPorSemana: 2 },
                { id: 'm3', gradoId: 'G1', materiaId: 'C', materiaNombre: 'C', docenteId: 'D3', horasPorSemana: 2 },
            ],
        };
        const resultado = generarHorario(config, 11);
        expect(resultado).not.toBeNull();

        const grupos = agruparPeriodosPorGradoDia(resultado);
        Object.values(grupos).forEach(periodos => {
            const ordenados = [...periodos].sort((a, b) => a - b);
            ordenados.forEach((periodo, i) => expect(periodo).toBe(i + 1));
        });
    });

    // ── Todos los grados resueltos en una sola corrida ──
    test('resuelve varios grados en una sola corrida sin que un docente compartido choque entre ellos', () => {
        const config = {
            asignaciones: [
                { id: 'g1a', gradoId: 'G1', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 2 },
                { id: 'g2a', gradoId: 'G2', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 2 },
                { id: 'g3a', gradoId: 'G3', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 2 },
                { id: 'g4a', gradoId: 'G4', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 2 },
            ],
        };
        const resultado = generarHorario(config, 3);

        expect(resultado).not.toBeNull();
        expect(resultado).toHaveLength(8); // 4 grados × 2 horas cada uno

        const gradosResueltos = new Set(resultado.map(f => f.grado_id));
        expect(gradosResueltos.size).toBe(4); // los 4 grados quedaron programados en la misma corrida

        expect(verificarConflictos(resultado).ok).toBe(true);
    });

    // ── Escala realista ──
    test('escenario realista (10 grados × 10 materias, docentes repartidos entre grados) encuentra solución', () => {
        const GRADOS = Array.from({ length: 10 }, (_, i) => `G${i + 1}`);
        const MATERIAS = [
            { nombre: 'Matemática',              horas: 5, docentes: ['DM1', 'DM2'] },
            { nombre: 'Lenguaje',                 horas: 5, docentes: ['DL1', 'DL2'] },
            { nombre: 'Ciencias Naturales',       horas: 4, docentes: ['DC1', 'DC2'] },
            { nombre: 'Estudios Sociales',        horas: 4, docentes: ['DS1', 'DS2'] },
            { nombre: 'Idioma Extranjero',        horas: 3, docentes: ['DI1'] },
            { nombre: 'Informática',              horas: 2, docentes: ['DIN1'] },
            { nombre: 'Educación Física',         horas: 2, docentes: ['DEF1', 'DEF2'] },
            { nombre: 'Educación en la Fe',       horas: 2, docentes: ['DR1'] },
            { nombre: 'Orientación para la Vida', horas: 2, docentes: ['DO1'] },
            { nombre: 'Módulo',                   horas: 3, docentes: ['DMO1', 'DMO2'] },
        ];

        const asignaciones = [];
        let contador = 0;
        GRADOS.forEach((gradoId, gi) => {
            MATERIAS.forEach(m => {
                // Reparte los grados entre los docentes de esa materia (como en una escuela real,
                // donde no es UN solo profesor de Matemática dando clase en los 10 grados).
                const docenteId = m.docentes[gi % m.docentes.length];
                asignaciones.push({
                    id: `asig-${contador++}`,
                    gradoId,
                    materiaId: m.nombre,
                    materiaNombre: m.nombre,
                    docenteId,
                    horasPorSemana: m.horas,
                });
            });
        });

        const resultado = generarHorario({ asignaciones }, 2024);

        expect(resultado).not.toBeNull();
        expect(verificarConflictos(resultado).ok).toBe(true);

        asignaciones.forEach(a => {
            const horas = resultado.filter(f => f.grado_materia_id === a.id).length;
            expect(horas).toBe(a.horasPorSemana);
        });

        const grupos = {};
        resultado.forEach(f => {
            const key = `${f.grado_id}|${f.dia}`;
            (grupos[key] = grupos[key] || []).push(f.periodo);
        });
        Object.values(grupos).forEach(periodos => {
            const ordenados = [...periodos].sort((a, b) => a - b);
            ordenados.forEach((p, i) => expect(p).toBe(i + 1));
        });
    });

    test('escenario realista (5 grados, 8 materias de 4 horas semanales, docentes compartidos entre grados) encuentra solución sin conflictos', () => {
        // Mismo caso que reportó el admin en producción: 5 grados, ~10 materias
        // por grado, 4 horas semanales cada una, con varios docentes (Ciencias
        // Naturales, Estudios Sociales, Idioma, Ed. en la Fe, Informática) dando
        // la MISMA materia en LOS 5 grados — el caso límite exacto del palomar
        // (5 grados = 5 días), que ahora debe resolverse gracias al orden
        // ponderado (no determinista) y al bloque de 2 como preferencia blanda.
        const GRADOS = Array.from({ length: 5 }, (_, i) => `G${i + 1}`);
        const MATERIAS = [
            { nombre: 'Matemática', docentes: ['DM1', 'DM2'] },
            { nombre: 'Lenguaje', docentes: ['DL1', 'DL2'] },
            { nombre: 'Ciencias Naturales', docentes: ['DC1'] },
            { nombre: 'Estudios Sociales', docentes: ['DS1'] },
            { nombre: 'Idioma Extranjero', docentes: ['DI1'] },
            { nombre: 'Educación Física', docentes: ['DEF1', 'DEF2'] },
            { nombre: 'Educación en la Fe', docentes: ['DR1'] },
            { nombre: 'Informática', docentes: ['DIN1'] },
        ];

        const asignaciones = [];
        let contador = 0;
        GRADOS.forEach((gradoId, gi) => {
            MATERIAS.forEach(m => {
                const docenteId = m.docentes[gi % m.docentes.length];
                asignaciones.push({
                    id: `asig-${contador++}`,
                    gradoId,
                    materiaId: m.nombre,
                    materiaNombre: m.nombre,
                    docenteId,
                    horasPorSemana: 4,
                });
            });
        });

        const resultado = generarHorario({ asignaciones }, 777);

        expect(resultado).not.toBeNull();
        expect(verificarConflictos(resultado).ok).toBe(true);

        asignaciones.forEach(a => {
            const horas = resultado.filter(f => f.grado_materia_id === a.id).length;
            expect(horas).toBe(4);
        });

        const grupos = {};
        resultado.forEach(f => {
            const key = `${f.grado_id}|${f.dia}`;
            (grupos[key] = grupos[key] || []).push(f.periodo);
        });
        Object.values(grupos).forEach(periodos => {
            const ordenados = [...periodos].sort((a, b) => a - b);
            ordenados.forEach((p, i) => expect(p).toBe(i + 1));
        });
    });

    // ── Configuración real del IDSJE ──
    test('escenario real del IDSJE (6 grados × 10 materias, horas 2/4/6 mixtas, docentes compartidos, algunos solo mañana) encuentra solución completa', () => {
        const GRADOS = Array.from({ length: 6 }, (_, i) => `G${i + 1}`);
        // Horas 2/4/6 mixtas, igual que la carga real del instituto. Idioma
        // Extranjero, Educación en la Fe y Orientación tienen un único docente
        // que da esa materia en LOS 6 grados (el caso más exigente para el
        // heurístico de orden) y además solo están disponibles en la mañana.
        const MATERIAS = [
            { nombre: 'Matemática',              horas: 6, docentes: ['DM1', 'DM2'] },
            { nombre: 'Lenguaje',                 horas: 6, docentes: ['DL1', 'DL2'] },
            { nombre: 'Ciencias Naturales',       horas: 4, docentes: ['DC1', 'DC2'] },
            { nombre: 'Estudios Sociales',        horas: 4, docentes: ['DS1', 'DS2'] },
            { nombre: 'Idioma Extranjero',        horas: 4, docentes: ['DI1'] },
            { nombre: 'Informática',              horas: 2, docentes: ['DIN1'] },
            { nombre: 'Educación Física',         horas: 2, docentes: ['DEF1', 'DEF2'] },
            { nombre: 'Educación en la Fe',       horas: 2, docentes: ['DR1'] },
            { nombre: 'Orientación para la Vida', horas: 2, docentes: ['DO1'] },
            { nombre: 'Módulo',                   horas: 4, docentes: ['DMO1', 'DMO2'] },
        ];

        const asignaciones = [];
        let contador = 0;
        GRADOS.forEach((gradoId, gi) => {
            MATERIAS.forEach(m => {
                const docenteId = m.docentes[gi % m.docentes.length];
                asignaciones.push({
                    id: `asig-${contador++}`,
                    gradoId,
                    materiaId: m.nombre,
                    materiaNombre: m.nombre,
                    docenteId,
                    horasPorSemana: m.horas,
                });
            });
        });

        const disponibilidadDocente = { DI1: 'manana', DR1: 'manana', DO1: 'manana' };

        const resultado = generarHorario({ asignaciones, disponibilidadDocente }, 2026);

        expect(resultado).not.toBeNull();
        expect(verificarConflictos(resultado).ok).toBe(true);

        asignaciones.forEach(a => {
            const horas = resultado.filter(f => f.grado_materia_id === a.id).length;
            expect(horas).toBe(a.horasPorSemana);
        });

        const docentesManana = new Set(['DI1', 'DR1', 'DO1']);
        resultado.forEach(f => {
            if (docentesManana.has(f.docente_id)) expect(f.periodo).toBeLessThanOrEqual(7);
        });

        const grupos = {};
        resultado.forEach(f => {
            const key = `${f.grado_id}|${f.dia}`;
            (grupos[key] = grupos[key] || []).push(f.periodo);
        });
        Object.values(grupos).forEach(periodos => {
            const ordenados = [...periodos].sort((a, b) => a - b);
            ordenados.forEach((p, i) => expect(p).toBe(i + 1));
        });
    });

    // ── Modo "mejor esfuerzo" (opciones.permitirParcial) ──
    test('con permitirParcial:true, un caso imposible devuelve la mejor combinación parcial en vez de null', () => {
        // Mismo caso "imposible por pigeonhole" que ya prueba el modo por defecto:
        // un docente de media jornada (máx. 35h/semana) con 40h de demanda repartidas
        // entre 4 grados. Sin permitirParcial, generarHorario da null; con la opción
        // activada, debe devolver lo que sí se pudo ubicar más el detalle de lo que no.
        const configImposible = {
            asignaciones: [
                { id: 'a1', gradoId: 'G1', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a2', gradoId: 'G2', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a3', gradoId: 'G3', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a4', gradoId: 'G4', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
            ],
            disponibilidadDocente: { D1: 'manana' },
        };

        expect(generarHorario(configImposible, 1)).toBeNull(); // el modo por defecto no cambia

        const resultado = generarHorario(configImposible, 1, { permitirParcial: true });

        expect(resultado.completo).toBe(false);
        expect(Array.isArray(resultado.filas)).toBe(true);
        expect(verificarConflictos(resultado.filas).ok).toBe(true); // lo parcial tampoco tiene choques
        expect(resultado.materiasNoColocadas.length).toBeGreaterThan(0);
        resultado.materiasNoColocadas.forEach(m => {
            expect(m.horasColocadas).toBeLessThan(m.horasRequeridas);
            expect(m.docenteId).toBe('D1');
        });
    });

    test('con permitirParcial:true, una configuración factible sigue devolviendo completo:true con materiasNoColocadas vacío', () => {
        const resultado = generarHorario(configFactible, 42, { permitirParcial: true });
        expect(resultado.completo).toBe(true);
        expect(resultado.materiasNoColocadas).toEqual([]);
        expect(verificarConflictos(resultado.filas).ok).toBe(true);
    });

    // ── Modo debug ──
    test('con debug:true, al no encontrar solución completa registra en consola el motivo del bloqueo sin cambiar el resultado', () => {
        const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const configImposible = {
            asignaciones: [
                { id: 'a1', gradoId: 'G1', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a2', gradoId: 'G2', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a3', gradoId: 'G3', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
                { id: 'a4', gradoId: 'G4', materiaId: 'M1', materiaNombre: 'X', docenteId: 'D1', horasPorSemana: 10 },
            ],
            disponibilidadDocente: { D1: 'manana' },
        };

        const resultado = generarHorario(configImposible, 1, { debug: true });

        expect(resultado).toBeNull(); // sin permitirParcial, el shape de retorno no cambia
        expect(spy).toHaveBeenCalled();
        const mensajes = spy.mock.calls.map(args => args.join(' ')).join('\n');
        expect(mensajes).toMatch(/D1/); // menciona el docente bloqueado

        spy.mockRestore();
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
