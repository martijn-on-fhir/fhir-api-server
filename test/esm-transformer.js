/**
 * Custom Jest transformer that converts ESM (.mjs) files to CommonJS.
 * Needed because fhir-validator-mx is ESM-only and Jest runs in CJS mode.
 */
module.exports = {
  process(sourceText) {
    let code = sourceText
      // import * as X from 'mod' → const X = require('mod')
      .replace(/import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g, 'const $1 = require("$2");')
      // import { named } from 'mod' → const { named } = require('mod')
      // Special case: import { default as X } → const X = require('mod')
      .replace(/import\s*\{\s*([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, imports, mod) => {
        const names = imports.split(',').map(n => n.trim()).filter(Boolean);
        const defaultImport = names.find(n => n.startsWith('default'));
        const namedImports = names.filter(n => !n.startsWith('default'));
        const lines = [];
        if (defaultImport) {
          const alias = defaultImport.split(/\s+as\s+/)[1]?.trim();
          lines.push(alias ? `const ${alias} = require("${mod}");` : `const _default = require("${mod}");`);
        }
        if (namedImports.length) {
          const destructured = namedImports.map(n => { const [orig, alias] = n.split(/\s+as\s+/); return alias ? `${orig.trim()}: ${alias.trim()}` : orig.trim(); }).join(', ');
          lines.push(`const { ${destructured} } = require("${mod}");`);
        }
        return lines.join('\n');
      })
      // import X, { named } from 'mod'
      .replace(/import\s+(\w+)\s*,\s*\{\s*([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (_, def, imports, mod) => {
        const names = imports.split(',').map(n => n.trim()).filter(Boolean);
        const destructured = names.map(n => { const [orig, alias] = n.split(/\s+as\s+/); return alias ? `${orig.trim()}: ${alias.trim()}` : orig.trim(); }).join(', ');
        return `const ${def} = require("${mod}"); const { ${destructured} } = require("${mod}");`;
      })
      // import X from 'mod' → const X = require('mod')
      .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g, 'const $1 = require("$2");')
      // import 'mod' → require('mod')
      .replace(/import\s*['"]([^'"]+)['"]\s*;?/g, 'require("$1");')
      // export { X, Y }
      .replace(/export\s*\{\s*([^}]+)\}\s*;?/g, (_, exports) => {
        return exports.split(',').map(n => { const [orig, alias] = n.trim().split(/\s+as\s+/); return alias ? `exports.${alias.trim()} = ${orig.trim()};` : `exports.${orig.trim()} = ${orig.trim()};`; }).join('\n');
      })
      // export default X
      .replace(/export\s+default\s+/g, 'module.exports = ')
      // export const/let/var/function/class
      .replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');
    return { code };
  },
};