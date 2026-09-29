import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
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
export type RomBuildOutput = { file: string; digest: string };
export type RomBuildRecord = { recipe: RomBuildRecipe; inputs: string; outputs: readonly RomBuildOutput[] };
export type RomBuildStatus = 'not-built' | 'recipe-changed' | 'inputs-changed' | 'output-changed' | 'up-to-date';

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

/** A receipt is reusable only with both the same inputs and the actual published outputs. */
export async function romBuildStatus(output: string, recipe: RomBuildRecipe, inputs: string): Promise<RomBuildStatus> {
	let record: RomBuildRecord;
	try { record = JSON.parse(await readFile(join(dirname(output), '.bmsx', `${basename(output)}.build.json`), 'utf8')); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'not-built'; throw error; }
	if (JSON.stringify(record.recipe) !== JSON.stringify(recipe)) return 'recipe-changed';
	if (record.inputs !== inputs) return 'inputs-changed';
	for (const entry of record.outputs) {
		const hash = createHash('sha256');
		try {
			for await (const part of createReadStream(join(dirname(output), entry.file))) hash.update(part);
		} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'output-changed'; throw error; }
		if (hash.digest('hex') !== entry.digest) return 'output-changed';
	}
	return 'up-to-date';
}

export async function recordRomBuild(output: string, record: RomBuildRecord): Promise<void> {
	const directory = join(dirname(output), '.bmsx');
	await mkdir(directory, { recursive: true });
	const staging = await mkdtemp(join(directory, '.rompack-record-'));
	try {
		const path = join(staging, basename(output));
		await writeFile(path, JSON.stringify(record));
		await rename(path, join(directory, `${basename(output)}.build.json`));
	} finally { await rm(staging, { recursive: true, force: true }); }
}
