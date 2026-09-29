import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { parseCartManifest, type CartManifest } from '../../machine/ts/rompack/manifest';
import { prepareGLTFDocument, type GLTFDocument } from './gltfloader';

export const biosResPath = './machine/bios/res';
export const biosSourcePath = './machine/bios';
export const cartlibLuaPath = './cartlib';
export const testlibLuaPath = './testlib';

const RESOURCE_SCAN_EXCLUDE = new Set(['.rom', '.js', '.ts', '.map', '.tsbuildinfo']);

/** One captured file. Consumers borrow these bytes; they never reopen its path. */
export class RomInputFile {
	private decodedText: string | undefined;
	public readonly digest: string;
	public constructor(public readonly path: string, public readonly bytes: Buffer, public readonly modifiedMs: number) {
		this.digest = createHash('sha256').update(bytes).digest('hex');
	}
	public get text(): string { return this.decodedText ??= this.bytes.toString('utf8'); }
}

export type RomBuildInputs = {
	readonly resourceRoots: readonly string[];
	readonly resourceFiles: readonly string[];
	readonly files: ReadonlyMap<string, RomInputFile>;
	readonly models: ReadonlyMap<string, GLTFDocument>;
	readonly modelBufferFiles: ReadonlySet<string>;
	readonly identity: string;
};

export function getRomManifest(inputs: RomBuildInputs): CartManifest | null {
	const files = inputs.resourceFiles.filter(file => extname(file).toLowerCase() === '.rommanifest');
	if (files.length > 1) throw new Error(`More than one rommanifest found in ${inputs.resourceRoots.join(', ')}.`);
	if (files.length === 0) return null;
	return parseCartManifest(parseYaml(inputs.files.get(files[0])!.text), `ROM manifest "${files[0]}"`);
}

async function collectResources(directory: string, files: string[]): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.includes('_ignore') || entry.name.toLowerCase() === '.bmsx') continue;
		const path = join(directory, entry.name);
		const directoryEntry = entry.isSymbolicLink() ? (await stat(path)).isDirectory() : entry.isDirectory();
		if (directoryEntry) await collectResources(path, files);
		else if (!RESOURCE_SCAN_EXCLUDE.has(extname(entry.name).toLowerCase())) files.push(resolve(path));
	}
}

/** Preparation owns all disk access, including model dependencies outside resource roots. */
export async function prepareRomInputs(resourceRoots: readonly string[], sourceFiles: readonly string[]): Promise<RomBuildInputs> {
	const files = new Map<string, RomInputFile>();
	const capture = (path: string): RomInputFile => {
		path = resolve(path);
		let file = files.get(path);
		if (file === undefined) {
			const descriptor = openSync(path, 'r');
			try {
				const metadata = fstatSync(descriptor);
				file = new RomInputFile(path, readFileSync(descriptor), metadata.mtimeMs);
				files.set(path, file);
			} finally { closeSync(descriptor); }
		}
		return file;
	};
	const discovered: string[] = [];
	for (const root of resourceRoots) await collectResources(root, discovered);
	const resourceFiles = [...new Set(discovered)].sort();
	for (const path of resourceFiles) capture(path);
	for (const path of sourceFiles) capture(path);
	const models = new Map<string, GLTFDocument>();
	const modelBufferFiles = new Set<string>();
	for (const path of resourceFiles) {
		const extension = extname(path).toLowerCase();
		if (extension !== '.gltf' && extension !== '.glb') continue;
		const document = prepareGLTFDocument(files.get(path)!.bytes, path, dependency => capture(dependency).bytes);
		models.set(path, document);
		for (const dependency of document.bufferFiles) modelBufferFiles.add(dependency);
	}
	const identity = createHash('sha256');
	identity.update(JSON.stringify(resourceRoots.map(path => relative(process.cwd(), resolve(path)).replace(/\\/g, '/'))));
	identity.update(JSON.stringify(resourceFiles.map(path => relative(process.cwd(), path).replace(/\\/g, '/'))));
	for (const path of [...files.keys()].sort()) {
		const file = files.get(path)!;
		// Lua timestamps are emitted into source records and affect workspace reconciliation.
		identity.update(JSON.stringify([relative(process.cwd(), path).replace(/\\/g, '/'), file.digest,
			extname(path).toLowerCase() === '.lua' ? file.modifiedMs : undefined]));
	}
	return { resourceRoots, resourceFiles, files, models, modelBufferFiles, identity: identity.digest('hex') };
}
