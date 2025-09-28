import fs from 'node:fs';

type CompilableModule = NodeModule & { _compile(code: string, filename: string): void };

declare const require: NodeRequire;

if (typeof require !== 'undefined' && typeof require.extensions === 'object') {
	const extensions = require.extensions as Record<string, (module: CompilableModule, filename: string) => void>;
	if (!extensions['.glsl']) {
		extensions['.glsl'] = (module: CompilableModule, filename: string) => {
			const source = fs.readFileSync(filename, 'utf8');
			module._compile(`module.exports = ${JSON.stringify(source)};`, filename);
		};
	}
}

import './rompacker';
