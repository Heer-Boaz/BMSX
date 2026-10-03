import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Resolve the installed MSVC toolchain once in the build process, not in a running host. */
export async function msvcEnvironment(): Promise<NodeJS.ProcessEnv> {
	if (process.env.VSCMD_VER) return process.env;
	const vswhere = join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
	const installation = await execute(vswhere, ['-latest', '-products', '*', '-requires',
		'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { windowsHide: true });
	if (!installation.stdout.trim()) throw new Error('Building Node host tools requires Visual Studio C++ Build Tools.');
	const setup = join(installation.stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
	const result = await execute(process.env.ComSpec, ['/d', '/s', '/c',
		'""%BMSX_VSDEVCMD%" -no_logo -arch=%BMSX_TARGET_ARCH% -host_arch=x64 >nul && set"'], {
		windowsHide: true, windowsVerbatimArguments: true,
		env: { ...process.env, BMSX_VSDEVCMD: setup, BMSX_TARGET_ARCH: process.arch === 'arm64' ? 'arm64' : 'x64' },
	});
	const environment: NodeJS.ProcessEnv = {};
	// This shell only discovers the toolchain. Source paths and compiler arguments
	// go directly to execFile; cmd.exe never interprets user/workspace path text.
	for (const line of result.stdout.split(/\r?\n/)) {
		const separator = line.indexOf('=');
		if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
	}
	delete environment.BMSX_VSDEVCMD;
	delete environment.BMSX_TARGET_ARCH;
	return environment;
}
