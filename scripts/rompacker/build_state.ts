import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { collectSourceFiles } from '../lib/file_scan';
import { resolveReadPath, type FileAccess } from '../lib/file_access';

const TOOLCHAIN_EXTENSIONS = new Set(['.ts', '.glsl', '.wgsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.lua']);
const TOOLCHAIN_ROOTS = ['machine/ts/common', 'machine/ts/rompack', 'machine/ts/spec',
	'scripts/lint', 'scripts/pietious', 'scripts/rompacker', 'scripts/lib', 'toolchain/ts',
	'package.json', 'package-lock.json', 'scripts/tsconfig.json', 'tsconfig.base.json', 'tsconfig.json'];

/** Recipe inputs are code, not resources: hash once without retaining a second code tree. */
export function romToolchainIdentity(access: FileAccess): string {
	const hash = createHash('sha256');
	hash.update(JSON.stringify([process.version, process.platform, process.arch]));
	for (const path of collectSourceFiles(TOOLCHAIN_ROOTS, TOOLCHAIN_EXTENSIONS).sort()) {
		const name = relative(process.cwd(), path).replace(/\\/g, '/');
		const bytes = readFileSync(resolveReadPath(access, path));
		const content = createHash('sha256');
		if (name === 'package.json') {
			// npm commands select the invocation. The resolved options enter the
			// ROM recipe directly; module resolution and the lockfile remain inputs.
			const manifest: Record<string, unknown> = JSON.parse(bytes.toString('utf8'));
			delete manifest.scripts;
			content.update(JSON.stringify(manifest));
		} else content.update(bytes);
		hash.update(JSON.stringify(name));
		hash.update(content.digest());
	}
	return hash.digest('hex');
}
