// Solo se usa para que Jest pueda leer los módulos ES (import/export) de src/js/*.js.
// No afecta el código servido al navegador (que no pasa por ningún build).
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
