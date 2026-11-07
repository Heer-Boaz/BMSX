import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { crc32 } from 'node:zlib';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import type { RomArtifact } from '../../toolchain/ts/rompack/build_manifest';
import { RomArtifactStore } from '../../scripts/rompacker/artifacts';
import { prepareHakchiPackage, type HakchiProfile, type MiniFile } from '../../scripts/snesmini/hakchi';
import { planMiniDeployment } from '../../scripts/snesmini/device';
import { quotePosixArgument } from '../../scripts/lib/cli_arguments';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('remote shell arguments survive spaces, apostrophes and shell operators without execution', async () => {
	for (const argument of ['', 'plain', "Hakchi's collection", 'one\ntwo', "$(exit 9); * ' \" $HOME"]) {
		const result = await promisify(execFile)('sh', ['-c', `printf '%s' ${quotePosixArgument(argument)}`]);
		assert.equal(result.stdout, argument);
	}
});

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "bmsx-hakchi's collection-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const hakchiDirectory = join(root, 'Hakchi PC'), directory = join(root, 'package');
	const coreDirectory = join(root, 'core'), hostDirectory = join(root, 'host');
	for (const path of [join(hakchiDirectory, 'config'), directory, coreDirectory, hostDirectory]) await mkdir(path, { recursive: true });
	const config = { consoleType: 2, SeparateGameLocalStorage: false, gamesCollectionSettings: {
		SNES_EUR: { SelectedGames: ['OTHER', 'CLV-S-TESTA'], OriginalGames: ['ORIGINAL'], FoldersMode: 3, Presets: { keep: true } },
		NES: { SelectedGames: ['NES-ONLY'], OriginalGames: ['NES-ORIGINAL'] },
	}, opaqueSetting: { preserve: 'unchanged' } };
	await writeFile(join(hakchiDirectory, 'config/config.json'), JSON.stringify(config));
	const image = new PNG({ width: 64, height: 32 });
	for (let at = 0; at < image.data.length; at += 4) { image.data[at] = 255; image.data[at + 3] = 255; }
	await writeFile(join(root, 'cover.png'), PNG.sync.write(image));
	const profile: HakchiProfile = { console: 'snes-eur', collection: 'SNES_EUR', folder: '001', games: [
		{ target: 'one', code: 'CLV-S-TESTA', title: 'First cart', icon: 'cover.png' },
		{ target: 'two', code: 'CLV-S-TESTB', title: 'Second cart', icon: 'cover.png' },
	] };
	const store = new RomArtifactStore(join(root, 'store')), bios = Buffer.from('paired BIOS');
	await writeFile(join(coreDirectory, 'acceptance.txt'), `build_type=Release\ninput_sha256=${digest(bios)} system/bmsx-bios.rom\n`);
	await writeFile(join(hostDirectory, 'acceptance.txt'), 'build_type=Release\n');
	await writeFile(join(coreDirectory, 'libretro_bmsx.so'), 'selected core');
	await writeFile(join(hostDirectory, 'bmsx_libretro_host'), 'selected host');
	const artifacts: RomArtifact[] = [];
	for (let index = 0; index < profile.games.length; ++index) {
		const target = profile.games[index].target, bytes = Buffer.from(`Release ROM ${target}`);
		const artifact: RomArtifact = { id: String(index + 1).repeat(64), target,
			system: { key: 'bios', name: 'bios', inputs: 'bios', recipe: {
				domain: 'system', debug: false, optLevel: 3, projectRoot: 'machine/bios', toolchain: 'test',
			}, outputs: [{ file: 'system/bmsx-bios.rom', digest: digest(bios) }] },
			cart: { key: target, name: target, inputs: target, recipe: {
				domain: 'cart', debug: false, optLevel: 3, projectRoot: `carts/${target}`, toolchain: 'test',
			}, outputs: [{ file: `${target}.rom`, digest: digest(bytes) }] } };
		await mkdir(join(store.directory(artifact.id), 'system'), { recursive: true });
		await writeFile(join(store.directory(artifact.id), 'artifact.json'), JSON.stringify(artifact));
		await writeFile(join(store.directory(artifact.id), 'system/bmsx-bios.rom'), bios);
		await writeFile(join(store.directory(artifact.id), `${target}.rom`), bytes);
		await store.retainCurrent(artifact);
		artifacts.push(artifact);
	}
	const options = { repository: root, hakchiDirectory, directory, profile, store, coreDirectory, hostDirectory };
	return { root, options, config, artifacts };
}

test('Hakchi package keeps exact published media, linked launch paths and existing collection ownership', async t => {
	const { options, config, artifacts } = await fixture(t);
	const bundle = await prepareHakchiPackage(options);
	const updated = JSON.parse(await readFile(join(options.hakchiDirectory, 'config/config.json'), 'utf8'));
	assert.deepEqual(updated, { ...config, gamesCollectionSettings: { ...config.gamesCollectionSettings,
		SNES_EUR: { ...config.gamesCollectionSettings.SNES_EUR, SelectedGames: ['OTHER', 'CLV-S-TESTA', 'CLV-S-TESTB'] } } });
	for (let index = 0; index < options.profile.games.length; ++index) {
		const game = options.profile.games[index], pc = join(options.hakchiDirectory, 'games', game.code);
		const bytes = await readFile(join(options.store.directory(artifacts[index].id), `${game.target}.rom`));
		assert.deepEqual(await readFile(join(pc, `${game.target}.rom`)), bytes);
		const storage = `var/lib/hakchi/games/snes-eur/.storage/${game.code}`;
		assert.deepEqual(await readFile(join(bundle.directory, storage, `${game.target}.rom`)), bytes);
		const metadata = JSON.parse(await readFile(join(pc, 'metadata.json'), 'utf8'));
		assert.equal(metadata.OriginalCrc32, crc32(bytes));
		assert.equal(metadata.System, 'BMSX');
		// Exec is serialized launcher data, not incidental UI wording. The
		// launch adapter isolates this host from Clover's Nintendo-emulator ABI.
		const pcDesktop = await readFile(join(pc, `${game.code}.desktop`), 'utf8');
		const miniDesktop = await readFile(join(bundle.directory, `var/lib/hakchi/games/snes-eur/001/${game.code}/${game.code}.desktop`), 'utf8');
		assert.equal(miniDesktop, pcDesktop.replaceAll('/var/games/', '/var/lib/hakchi/games/snes-eur/.storage/'));
		assert.ok(pcDesktop.includes(`Exec=/bin/sh /var/games/${game.code}/launch.sh\n`));
		const front = PNG.sync.read(await readFile(join(pc, `${game.code}.png`)));
		const small = PNG.sync.read(await readFile(join(pc, `${game.code}_small.png`)));
		// Focused Clover image-format contract: preserve aspect ratio within
		// front 228x204 and thumbnail 40x40 limits, without changing the ink.
		assert.deepEqual([front.width, front.height, small.width, small.height], [228, 114, 40, 20]);
		assert.deepEqual([...small.data.subarray(0, 4)], [255, 0, 0, 255]);
	}
	for (const file of bundle.files) {
		const bytes = await readFile(join(bundle.directory, file.path));
		assert.equal(file.digest, digest(bytes));
		assert.equal(file.size, bytes.length);
	}
	assert.deepEqual(bundle.saves, options.profile.games.map(game => `/var/saves/${game.code}`));
	assert.equal((await readFile(join(bundle.directory, 'root/bmsx_libretro.so'))).toString(), 'selected core');
});

test('separate local SNES collections use Hakchi games_snes without moving unrelated games', async t => {
	const { options, config } = await fixture(t);
	config.SeparateGameLocalStorage = true;
	await writeFile(join(options.hakchiDirectory, 'config/config.json'), JSON.stringify(config));
	await prepareHakchiPackage(options);
	for (const game of options.profile.games) {
		assert.ok((await stat(join(options.hakchiDirectory, 'games_snes', game.code, 'launch.sh'))).isFile());
	}
	await assert.rejects(stat(join(options.hakchiDirectory, 'games')), { code: 'ENOENT' });
});

test('Clover state/transition arguments never reach the strict custom host or enable its rewind', async t => {
	const { root, options } = await fixture(t);
	await prepareHakchiPackage(options);
	const game = options.profile.games[0], pc = join(options.hakchiDirectory, 'games', game.code);
	const fakeHost = join(root, 'observed host.sh'), argumentsPath = join(root, 'host-arguments');
	await writeFile(fakeHost, `#!/bin/sh\nprintf '%s\\n' "$@" > ${quotePosixArgument(argumentsPath)}\n`, { mode: 0o755 });
	const launcher = (await readFile(join(pc, 'launch.sh'), 'utf8'))
		.replace('/root/bmsx_libretro_host', quotePosixArgument(fakeHost))
		.replace(quotePosixArgument(`/var/log/bmsx-${game.code}.log`), quotePosixArgument(join(root, 'launch.log')));
	await writeFile(join(pc, 'probe.sh'), launcher);
	await promisify(execFile)('sh', [join(pc, 'probe.sh'), '--save-data-backing-file', 'cartridge.sram',
		'--title-code', game.code, '--video-mode', 'keep-aspect-ratio', '--start-transition-fd', '13',
		'--rollback-mode', 'record', '--rollback-output-dir', '/clover/rollback']);
	assert.deepEqual((await readFile(argumentsPath, 'utf8')).trimEnd().split('\n'), [
		join(pc, `${game.target}.rom`), '--core', '/root/bmsx_libretro.so', '--system-dir', '/root',
		'--save-dir', `/var/saves/${game.code}`, '--backend', 'gles2',
	]);
});

test('identical redeployment leaves the PC selection and game files untouched', async t => {
	const { options } = await fixture(t);
	await prepareHakchiPackage(options);
	const paths = [join(options.hakchiDirectory, 'config/config.json')];
	for (const game of options.profile.games) {
		const directory = join(options.hakchiDirectory, 'games', game.code);
		for (const name of await readdir(directory)) paths.push(join(directory, name));
	}
	const timestamp = new Date('2001-02-03T04:05:06Z');
	for (const path of paths) await utimes(path, timestamp, timestamp);
	await prepareHakchiPackage(options);
	for (const path of paths) assert.equal((await stat(path)).mtimeMs, timestamp.getTime());
});

test('missing completed media and incompatible paired BIOS fail before changing the PC collection', async t => {
	const { options } = await fixture(t);
	const configPath = join(options.hakchiDirectory, 'config/config.json'), before = await readFile(configPath);
	await assert.rejects(prepareHakchiPackage({ ...options, profile: { ...options.profile, games: [
		{ ...options.profile.games[0], target: 'unbuilt' },
	] } }), /Build the Release cartridge unbuilt/);
	assert.deepEqual(await readFile(configPath), before);
	await writeFile(join(options.coreDirectory, 'acceptance.txt'), 'input_sha256=another-system system/bmsx-bios.rom\n');
	await assert.rejects(prepareHakchiPackage(options), /different BIOS builds/);
	assert.deepEqual(await readFile(configPath), before);
	await assert.rejects(stat(join(options.hakchiDirectory, 'games')), { code: 'ENOENT' });
});

test('deployment transfers only changed files and budgets peak NAND replacement space, not a second entire install', () => {
	const mib = 1024 * 1024;
	const files: MiniFile[] = [
		{ path: 'same', digest: 'same', size: 10 * mib },
		{ path: 'first', digest: 'new-1', size: 20 * mib },
		{ path: 'second', digest: 'new-2', size: 22 * mib },
	];
	const current = new Map([
		['same', { digest: 'same', size: 10 * mib }],
		['first', { digest: 'old-1', size: 19 * mib }],
		['second', { digest: 'old-2', size: 23 * mib }],
	]);
	const plan = planMiniDeployment(files, current, 4096);
	assert.deepEqual(plan.changed.map(file => file.path), ['first', 'second']);
	assert.equal(plan.requiredBytes, (30 + 23) * mib);
	assert.equal(planMiniDeployment(files, new Map(), 4096).requiredBytes, (30 + 10 + 20 + 22) * mib);
	assert.deepEqual(planMiniDeployment(files.slice(0, 1), current, 4096).changed, []);
	assert.equal(planMiniDeployment([{ path: 'small', digest: 'new', size: 1 }], new Map(), 4096).requiredBytes, 30 * mib + 4096);
});
