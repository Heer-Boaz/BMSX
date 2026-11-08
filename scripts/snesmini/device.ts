import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { quotePosixArgument as quote } from '../lib/cli_arguments';
import type { MiniPackage, MiniFile } from './package';

const execute = promisify(execFile);
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--'];
const saveReserve = 30 * 1024 * 1024;

export function planMiniDeployment(files: readonly MiniFile[], current: ReadonlyMap<string, { digest: string; size: number }>, blockBytes: number) {
	const changed = files.filter(file => current.get(file.path)?.digest !== file.digest);
	let growth = 0, peak = 0;
	for (const file of changed) {
		// Each replacement is copied beside the old file, then renamed over it.
		const allocated = Math.trunc((file.size + blockBytes - 1) / blockBytes) * blockBytes;
		const previous = Math.trunc(((current.get(file.path)?.size ?? 0) + blockBytes - 1) / blockBytes) * blockBytes;
		peak = Math.max(peak, growth + allocated);
		growth += allocated - previous;
	}
	return { changed, requiredBytes: peak + saveReserve };
}

export async function deployMiniPackage(target: string, bundle: MiniPackage, installer: string): Promise<string> {
	const probe = `set -e
if pidof bmsx_libretro_host >/dev/null; then echo 'Exit the BMSX game before deploying.' >&2; exit 1; fi
printf 'FREE %s %s\\n' "$(df -Pk /var/lib | awk 'NR==2 {print $4}')" "$(stat -f -c %S /var/lib)"
for path in "$@"; do
 if [ -f "/$path" ]; then
  printf 'FILE %s %s %s\\n' "$(sha256sum "/$path" | cut -d' ' -f1)" "$(stat -c %s "/$path")" "$path"
 fi
done`;
	const response = await execute('ssh', [...sshOptions, target,
		`sh -c ${quote(probe)} -- ${bundle.files.map(file => quote(file.path)).join(' ')}`]);
	const lines = response.stdout.trim().split('\n');
	const [, freeKib, blockBytes] = lines[0].split(' ');
	const freeBytes = Number(freeKib) * 1024;
	const current = new Map<string, { digest: string; size: number }>();
	for (const line of lines.slice(1)) {
		const [, digest, size, path] = line.split(' ');
		current.set(path, { digest, size: Number(size) });
	}
	const plan = planMiniDeployment(bundle.files, current, Number(blockBytes));
	if (plan.changed.length === 0) return 'Already installed; no transfer or menu restart.';
	if (freeBytes < plan.requiredBytes) throw new Error(`Deployment needs ${plan.requiredBytes} free bytes including the 30 MiB save reserve; mini has ${freeBytes}.`);
	await copyFile(installer, join(bundle.directory, 'install_hakchi.sh'));
	await writeFile(join(bundle.directory, 'checksums.sha256'), plan.changed.map(file => `${file.digest}  ${file.path}\n`).join(''));
	await writeFile(join(bundle.directory, 'files.list'), plan.changed.map(file => `${file.path}\n`).join(''));
	await writeFile(join(bundle.directory, 'saves.list'), bundle.saves.join('\n') + '\n');
	const archive = join(bundle.directory, 'upload.tar');
	await execute('tar', ['-C', bundle.directory, '-cf', archive, '--', ...plan.changed.map(file => file.path),
		'checksums.sha256', 'files.list', 'saves.list', 'install_hakchi.sh']);
	const remoteStage = `/tmp/bmsx-deploy-${randomUUID()}`;
	const installation = execute('ssh', [...sshOptions, target,
		`set -e; mkdir ${quote(remoteStage)}; trap ${quote(`rm -rf ${quote(remoteStage)}`)} EXIT; `
		+ `tar -xf - -C ${quote(remoteStage)} && sh ${quote(`${remoteStage}/install_hakchi.sh`)} ${quote(remoteStage)}`]);
	installation.child.stderr.pipe(process.stderr);
	const [, result] = await Promise.all([pipeline(createReadStream(archive), installation.child.stdin), installation]);
	return result.stdout.trim();
}
