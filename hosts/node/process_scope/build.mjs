import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const cacheRoot = fileURLToPath(new URL('../../../.bmsx/host-process-scope/', import.meta.url));
let build;

/** Optional Node host product, independent of the emulator's CMake/toolchain. */
export function buildProcessScope() {
	return build ??= compile();
}

async function compile() {
	if (process.platform !== 'linux' && process.platform !== 'win32') {
		throw new Error(`Studio's owned Codex process scope is not implemented on ${process.platform}.`);
	}
	const source = join(sourceRoot, 'native', process.platform === 'win32' ? 'scope_windows.cpp' : 'scope_linux.cpp');
	const hash = createHash('sha256');
	for (const file of [fileURLToPath(import.meta.url), source, join(sourceRoot, 'native', 'protocol.hpp')]) {
		hash.update(await readFile(file));
	}
	const output = join(cacheRoot, `${process.platform}-${process.arch}-${hash.digest('hex').slice(0, 24)}`);
	const name = process.platform === 'win32' ? 'process-scope.exe' : 'process-scope';
	const binary = join(output, name);
	try { await access(binary); return binary; }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	await mkdir(cacheRoot, { recursive: true });
	const staging = await mkdtemp(join(cacheRoot, 'compile-'));
	try {
		if (process.platform === 'win32') {
			const args = ['/nologo', '/std:c++17', '/O2', '/EHsc', '/W4', '/WX', '/MT', source,
				`/Fe:${join(staging, name)}`, `/Fo:${join(staging, 'scope.obj')}`];
			if (process.env.VSCMD_VER) await execute('cl.exe', args, { windowsHide: true });
			else {
				const vswhere = join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
				const { stdout } = await execute(vswhere, ['-latest', '-products', '*', '-requires',
					'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true });
				if (!stdout.trim()) throw new Error('Studio process scope requires Visual Studio C++ Build Tools.');
				const setup = join(stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
				const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
				const command = `"${setup}" -no_logo -arch=${arch} -host_arch=x64 && cl.exe ${args.map(arg => `"${arg}"`).join(' ')}`;
				await execute(process.env.ComSpec, ['/d', '/s', '/c', `"${command}"`], {
					windowsHide: true, windowsVerbatimArguments: true,
				});
			}
		} else {
			await execute(process.env.CXX ?? 'c++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', join(staging, name)]);
		}
		try { await rename(staging, output); }
		catch (error) {
			// Concurrent first launches may publish the identical content-addressed
			// product. Never overwrite an executable held by an existing supervisor.
			if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
			await access(binary);
			await rm(staging, { recursive: true });
		}
		return binary;
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
}
