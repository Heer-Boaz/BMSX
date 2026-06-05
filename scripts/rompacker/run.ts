import fs from 'node:fs';

type CompilableModule = NodeModule & { _compile(code: string, filename: string): void };

declare const require: NodeRequire;

if (typeof require !== 'undefined' && typeof require.extensions === 'object') {
	const extensions = require.extensions as Record<string, (module: CompilableModule, filename: string) => void>;
	const loadTextShader = (module: CompilableModule, filename: string) => {
		const source = fs.readFileSync(filename, 'utf8');
		module._compile(`module.exports = ${JSON.stringify(source)};`, filename);
	};
	for (const extension of ['.glsl', '.wgsl']) {
		if (!extensions[extension]) {
			extensions[extension] = loadTextShader;
		}
	}
}

import './formater';
