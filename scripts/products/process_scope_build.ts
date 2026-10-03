import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PROCESS_SCOPE_PRODUCT_DIRECTORY, PROCESS_SCOPE_PRODUCT_FILE, type ProcessScopeProduct } from '../../hosts/node/process_scope/product';
import { msvcEnvironment } from '../lib/msvc';

const execute = promisify(execFile);

/** Build/install owner. Connecting to Codex only consumes this published product. */
export async function buildProcessScope(options: { debug: boolean; force: boolean }): Promise<string> {
	const native = fileURLToPath(new URL('../../hosts/node/process_scope/native/', import.meta.url));
	const source = join(native, process.platform === 'win32' ? 'scope_windows.cpp' : 'scope_linux.cpp');
	const hash = createHash('sha256');
	hash.update(JSON.stringify([process.platform, process.arch, options.debug, process.env.CXX]));
	for (const file of [fileURLToPath(import.meta.url), fileURLToPath(new URL('../lib/msvc.ts', import.meta.url)), source, join(native, 'protocol.hpp')]) {
		hash.update(await readFile(file));
	}
	const fingerprint = hash.digest('hex');
	let previous: ProcessScopeProduct | undefined;
	try { previous = JSON.parse(await readFile(PROCESS_SCOPE_PRODUCT_FILE, 'utf8')); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	if (!options.force && previous?.fingerprint === fingerprint) return join(PROCESS_SCOPE_PRODUCT_DIRECTORY, previous.executable);

	await mkdir(PROCESS_SCOPE_PRODUCT_DIRECTORY, { recursive: true });
	const output = await mkdtemp(join(PROCESS_SCOPE_PRODUCT_DIRECTORY, `${process.platform}-${process.arch}-`));
	const name = process.platform === 'win32' ? 'process-scope.exe' : 'process-scope';
	const binary = join(output, name);
	try {
		if (process.platform === 'win32') {
			await execute('cl.exe', ['/nologo', '/std:c++17', options.debug ? '/Od' : '/O2', '/EHsc', '/W4', '/WX', '/MT', source,
				`/Fe:${binary}`, `/Fo:${join(output, 'scope.obj')}`], { env: await msvcEnvironment(), windowsHide: true });
		} else {
			await execute(process.env.CXX ?? 'c++', ['-std=c++17', options.debug ? '-O0' : '-O2', '-g', '-Wall', '-Wextra', '-Werror', source, '-o', binary]);
		}
		const product: ProcessScopeProduct = { fingerprint, executable: join(basename(output), name) };
		const publication = join(output, 'product.json');
		await writeFile(publication, JSON.stringify(product));
		// An immutable executable generation is visible only after a successful build.
		// Never overwrite an executable used by another running server (Windows too).
		await rename(publication, PROCESS_SCOPE_PRODUCT_FILE);
		return binary;
	} catch (error) {
		await rm(output, { recursive: true, force: true });
		throw error;
	}
}
