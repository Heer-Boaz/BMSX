import Module from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const extensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;

for (const extension of ['.glsl', '.wgsl']) {
	if (extensions[extension]) continue;
	extensions[extension] = (module, filename) => {
		const source = readFileSync(filename, 'utf8');
		module._compile(`module.exports = ${JSON.stringify(source)};`, filename);
	};
}
