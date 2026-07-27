import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

export type LibretroTarget = 'libretro-wsl' | 'libretro-win';

const LIBRETRO_CORE_BASENAME = 'libretro_bmsx';
const LIBRETRO_ENTRY_PATH = join(process.cwd(), 'hosts', 'libretro', 'entry.cpp');

function runCommand(command: string, args: string[]): void {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(' ')}`);
	}
}

function libretroBuildDirectory(target: LibretroTarget): string {
	return target === 'libretro-win' ? 'build-libretro-win' : 'build-libretro-wsl';
}

function libretroCoreFilename(target: LibretroTarget): string {
	return `${LIBRETRO_CORE_BASENAME}${target === 'libretro-win' ? '.dll' : '.so'}`;
}

function libretroBuildOutputPath(target: LibretroTarget): string {
	const buildDirectory = libretroBuildDirectory(target);
	const filename = libretroCoreFilename(target);
	return join(process.cwd(), buildDirectory, filename);
}

function findCMake(): string {
	const commandResult = spawnSync('cmake', ['--version']);
	if (commandResult.status === 0) {
		return 'cmake';
	}
	if (process.platform !== 'win32') {
		throw new Error('CMake is not available on PATH.');
	}

	const programFiles = process.env['ProgramFiles(x86)'];
	if (!programFiles) {
		throw new Error('ProgramFiles(x86) is not defined; Visual Studio CMake cannot be located.');
	}
	const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	const result = spawnSync(vswhere, [
		'-latest',
		'-products',
		'*',
		'-requires',
		'Microsoft.VisualStudio.Component.VC.CMake.Project',
		'-property',
		'installationPath',
	], { encoding: 'utf8' });
	if (result.status !== 0 || !result.stdout) {
		throw new Error('Visual Studio CMake could not be located.');
	}

	const installPath = result.stdout.trim();
	if (!existsSync(installPath)) {
		throw new Error(`Visual Studio installation path does not exist: ${installPath}`);
	}
	const search = spawnSync(
		'cmd.exe',
		['/c', 'dir', '/S', '/B', 'cmake.exe'],
		{ cwd: installPath, encoding: 'utf8' },
	);
	if (search.status !== 0 || !search.stdout) {
		throw new Error(`CMake was not found below ${installPath}.`);
	}
	// disable-next-line newline_normalization_pattern -- Windows command output is a line-oriented tool boundary.
	const executable = search.stdout.split(/\r?\n/)
		.find(line => line.trim().toLowerCase().endsWith('bin\\cmake.exe'));
	if (!executable) {
		throw new Error(`CMake was not found below ${installPath}.`);
	}
	return executable.trim();
}

function buildLibretroCore(
	target: LibretroTarget,
	debug: boolean,
): void {
	const cmake = findCMake();
	const buildType = debug ? 'Debug' : 'Release';
	const buildDirectory = libretroBuildDirectory(target);
	const configureArguments = [
		'-S', 'machine/cpp',
		'-B', buildDirectory,
		'-G', 'Ninja',
		`-DCMAKE_BUILD_TYPE=${buildType}`,
		'-DBMSX_BUILD_LIBRETRO=ON',
		'-DBMSX_BUILD_LIBRETRO_HOST=OFF',
		'-DCMAKE_C_COMPILER_LAUNCHER=ccache',
		'-DCMAKE_CXX_COMPILER_LAUNCHER=ccache',
	];
	if (target === 'libretro-wsl') {
		configureArguments.push('-DCMAKE_CXX_STANDARD=20');
	} else {
		if (process.platform !== 'win32') {
			throw new Error('libretro-win requires Windows with MSVC build tools.');
		}
	}
	runCommand(cmake, configureArguments);
	runCommand(cmake, [
		'--build',
		buildDirectory,
		'--config',
		buildType,
		'--parallel',
		String(os.cpus().length),
	]);
}

function extractLibretroConstant(source: string, constantName: string): string {
	const match = source.match(new RegExp(`\\b${constantName}\\b\\s*=\\s*"([^"]+)"`));
	if (!match) {
		throw new Error(`Libretro constant "${constantName}" was not found in ${LIBRETRO_ENTRY_PATH}.`);
	}
	return match[1];
}

async function stageLibretroArtifacts(target: LibretroTarget): Promise<string> {
	const entrySource = await readFile(LIBRETRO_ENTRY_PATH, 'utf8');
	const coreName = extractLibretroConstant(entrySource, 'CORE_NAME');
	const coreVersion = extractLibretroConstant(entrySource, 'CORE_VERSION');
	const supportedExtensions = extractLibretroConstant(entrySource, 'VALID_EXTENSIONS');
	const distDirectory = join(process.cwd(), 'dist');
	const filename = libretroCoreFilename(target);

	await mkdir(distDirectory, { recursive: true });
	await copyFile(
		libretroBuildOutputPath(target),
		join(distDirectory, filename),
	);
	await writeFile(
		join(distDirectory, `${LIBRETRO_CORE_BASENAME}.info`),
		[
			`display_name = "${coreName}"`,
			`display_version = "${coreVersion}"`,
			`corename = "${coreName}"`,
			`supported_extensions = "${supportedExtensions}"`,
			'supports_no_game = "true"',
			'',
		].join('\n'),
		'utf8',
	);
	return filename;
}

export async function buildLibretroProduct(
	target: LibretroTarget,
	debug: boolean,
): Promise<string> {
	buildLibretroCore(target, debug);
	return stageLibretroArtifacts(target);
}
