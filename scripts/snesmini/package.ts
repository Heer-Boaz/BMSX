import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { crc32 } from 'node:zlib';
import { createCanvas, loadImage } from 'canvas';
import type { RomArtifact } from '../../toolchain/ts/rompack/build_manifest';
import { quotePosixArgument } from '../lib/cli_arguments';
import { RomArtifactStore, romBuildKey } from '../rompacker/artifacts';

export type MiniGame = { target: string; code: string; title: string; icon: string; artifact?: string };
export type MiniProfile = { console: string; collection: string; folder: string; games: readonly MiniGame[] };
export type MiniFile = { path: string; digest: string; size: number };
export type MiniPackage = { directory: string; files: MiniFile[]; saves: string[] };

/** Hakchi's collection uses /var/games; linked sync rewrites media paths into .storage.
 * Reference: TeamShinkansen/Hakchi2-CE v3.9.3, NesApplication.CopyToSyncLinked. */
export function renderCloverDesktop(game: MiniGame, mediaRoot: string): string {
	return `[Desktop Entry]\nType=Application\n`
		+ `Exec=/bin/sh ${mediaRoot}/${game.code}/launch.sh\n`
		+ `Path=/var/saves/${game.code}\nName=${game.title}\nIcon=${mediaRoot}/${game.code}/${game.code}.png\n\n`
		+ `[X-CLOVER Game]\nCode=${game.code}\nTestID=0\nID=0\nPlayers=1\nSimultaneous=0\n`
		+ `ReleaseDate=1900-01-01\nSaveCount=0\nSortRawTitle=${game.title.toLowerCase()}\nSortRawPublisher=BOAZ\nCopyright=\n`;
}

function renderCloverLauncher(game: MiniGame, rom: string): string {
	// Clover's arguments are parsed separately from the host's own options.
	return '#!/bin/sh\n'
		+ 'directory=$(dirname "$0")\ntrap \'\' HUP\nuistop || exit "$?"\n'
		+ `/root/bmsx_libretro_host "$directory"/${quotePosixArgument(rom)} --core /root/bmsx_libretro.so --system-dir /root `
		+ `--save-dir ${quotePosixArgument(`/var/saves/${game.code}`)} --backend gles2 --rewind off --core-option bmsx_gamepad_hold_action exit --clover "$@" > ${quotePosixArgument(`/var/log/bmsx-${game.code}.log`)} 2>&1\n`
		+ 'result=$?\nuistart\nexit "$result"\n';
}

export async function prepareMiniPackage(options: {
	repository: string; directory: string; profile: MiniProfile;
	store: RomArtifactStore; coreDirectory: string; hostDirectory: string;
}): Promise<MiniPackage> {
	const { repository, directory, profile, store } = options;
	const current = await Promise.all([...new Set((await store.currentArtifacts()).values())].map(id => store.read(id)));
	const selected: RomArtifact[] = [];
	for (const game of profile.games) {
		if (game.artifact !== undefined) { selected.push(await store.read(game.artifact)); continue; }
		const artifact = current.find(artifact => artifact.target === game.target && artifact.cart !== undefined
			&& !artifact.cart.recipe.debug && artifact.cart.recipe.optLevel === 3
			&& artifact.cart.recipe.projectRoot === `carts/${game.target}`);
		if (artifact === undefined) throw new Error(`Build the Release cartridge ${game.target} first, or use --build.`);
		selected.push(artifact);
	}
	const core = await realpath(options.coreDirectory), host = await realpath(options.hostDirectory);
	const coreAcceptance = await readFile(join(core, 'acceptance.txt'), 'utf8');
	const bios = selected[0].system.outputs.find(output => output.file.endsWith('.rom'))!;
	if (selected.some(artifact => artifact.system.outputs.find(output => output.file.endsWith('.rom'))!.digest !== bios.digest)
		|| !coreAcceptance.split('\n').includes(`input_sha256=${bios.digest} system/bmsx-bios.rom`)) {
		throw new Error('The selected carts and accepted core require different BIOS builds. Rebuild them together with --build.');
	}
	const result: MiniPackage = { directory, files: [], saves: [] };
	async function stage(path: string, bytes: Buffer): Promise<void> {
		const destination = join(directory, path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, bytes);
		result.files.push({ path, digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
	}
	await stage('root/bmsx_libretro_host', await readFile(join(host, 'bmsx_libretro_host')));
	await stage('root/bmsx_snesmini_input', await readFile(join(host, 'bmsx_snesmini_input')));
	await stage('root/bmsx_libretro.so', await readFile(join(core, 'libretro_bmsx.so')));
	await stage('root/bmsx-bios.rom', await readFile(join(store.directory(selected[0].id), bios.file)));
	const storage = `/var/lib/hakchi/games/${profile.console}/.storage`;
	const receipts: { target: string; artifact: string }[] = [];
	for (let index = 0; index < profile.games.length; ++index) {
		const game = profile.games[index], artifact = selected[index];
		const output = artifact.cart!.outputs.find(output => output.file.endsWith('.rom'))!;
		const rom = basename(output.file), bytes = await readFile(join(store.directory(artifact.id), output.file));
		const metadata = Buffer.from(JSON.stringify({ System: 'BMSX', Core: '', OriginalFilename: rom,
			OriginalCrc32: crc32(bytes), CustomCoverArt: true }, null, 2) + '\n');
		const image = await loadImage(join(repository, game.icon));
		const covers: { file: string; bytes: Buffer }[] = [];
		// Clover front and thumbnail limits match Hakchi's NesMenuElementBase.SetImage.
		for (const [suffix, maxWidth, maxHeight] of [['', 228, 204], ['_small', 40, 40]] as const) {
			const scale = Math.min(maxWidth / image.width, maxHeight / image.height, suffix === '_small' ? 1 : Infinity);
			const width = Math.round(image.width * scale), height = Math.round(image.height * scale);
			const canvas = createCanvas(width, height), context = canvas.getContext('2d');
			context.imageSmoothingEnabled = false;
			context.drawImage(image, 0, 0, width, height);
			covers.push({ file: `${game.code}${suffix}.png`, bytes: canvas.toBuffer('image/png') });
		}
		const media = [{ file: rom, bytes }, { file: 'metadata.json', bytes: metadata },
			{ file: 'launch.sh', bytes: Buffer.from(renderCloverLauncher(game, rom)) }, ...covers];
		for (const file of media) {
			await stage(posix.join(storage.slice(1), game.code, file.file), file.bytes);
		}
		await stage(`var/lib/hakchi/games/${profile.console}/${profile.folder}/${game.code}/${game.code}.desktop`,
			Buffer.from(renderCloverDesktop(game, storage)));
		result.saves.push(`/var/saves/${game.code}`);
		receipts.push({ target: game.target, artifact: artifact.id });
		await store.retain(`publications/snesmini/${romBuildKey([profile.console, game.target])}`, artifact.id);
	}
	await writeFile(join(directory, 'package.json'), JSON.stringify({ games: receipts, files: result.files,
		core: coreAcceptance, host: await readFile(join(host, 'acceptance.txt'), 'utf8') }, null, 2) + '\n');
	return result;
}
