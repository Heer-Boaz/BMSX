import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { collectSourceFiles } from '../lib/file_scan';

const TOOLCHAIN_EXTENSIONS = new Set(['.ts', '.glsl', '.wgsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.lua']);
const TOOLCHAIN_ROOTS = ['machine/ts/common', 'machine/ts/rompack', 'machine/ts/spec',
	'scripts/lint', 'scripts/rompacker', 'scripts/lib', 'toolchain/ts',
	'package.json', 'package-lock.json', 'scripts/tsconfig.json', 'tsconfig.base.json', 'tsconfig.json'];

export type RomBuildRecipe = {
	domain: 'system' | 'cart';
	debug: boolean;
	optLevel: 0 | 1 | 2 | 3;
	projectRoot: string;
	toolchain: string;
};
/** file is relative to the receipt's output root, not necessarily a basename. */
export type RomBuildOutput = { file: string; digest: string };
export type RomBuildRecord = { recipe: RomBuildRecipe; inputs: string; outputs: readonly RomBuildOutput[] };

/** Recipe inputs are code, not resources: hash once without retaining a second code tree. */
export function romToolchainIdentity(): string {
	const hash = createHash('sha256');
	hash.update(JSON.stringify([process.version, process.platform, process.arch]));
	for (const path of collectSourceFiles(TOOLCHAIN_ROOTS, TOOLCHAIN_EXTENSIONS).sort()) {
		hash.update(JSON.stringify(relative(process.cwd(), path).replace(/\\/g, '/')));
		hash.update(createHash('sha256').update(readFileSync(path)).digest());
	}
	return hash.digest('hex');
}
