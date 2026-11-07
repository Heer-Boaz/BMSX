import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { createCliUi } from '../lib/cli_ui';
import { RomArtifactStore } from '../rompacker/artifacts';
import { deployMiniPackage } from './device';
import { prepareHakchiPackage, type HakchiProfile } from './hakchi';

const ui = createCliUi({ bannerTitle: 'BMSX SNES MINI', labelWidth: 14 });

async function main(): Promise<void> {
	const { values } = parseArgs({ options: {
		'hakchi-dir': { type: 'string' }, ssh: { type: 'string' },
		profile: { type: 'string', default: 'deploy/snesmini.json' },
		'store-dir': { type: 'string', default: '.bmsx/builds' },
		'core-dir': { type: 'string', default: 'dist/snesmini/core/current' },
		'host-dir': { type: 'string', default: 'dist/snesmini/host/current' },
		build: { type: 'boolean', default: false },
		'collection-only': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) {
		ui.writeOut('Usage: npm run deploy:snesmini -- --hakchi-dir <directory> --ssh root@<mini-address> [--build]\n'
			+ '  --build             Build Release carts, core and host with the existing build owners first.\n'
			+ '  --collection-only   Update the PC Hakchi collection without connecting to the mini.\n'
			+ '  --profile <file>    Select games, stable Clover IDs, menu folder and title artwork.\n'
			+ '  --store-dir/--core-dir/--host-dir select existing completed build products.\n');
		return;
	}
	if (values['hakchi-dir'] === undefined || (!values['collection-only'] && values.ssh === undefined)) {
		throw new Error('Specify --hakchi-dir and --ssh (or --collection-only). Close Hakchi before deploying.');
	}
	if (process.platform === 'win32' || process.env.WSL_DISTRO_NAME !== undefined) {
		await promisify(execFile)(process.platform === 'win32' ? 'powershell' : 'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', "if (Get-Process hakchi -ErrorAction SilentlyContinue) { Write-Error 'Close Hakchi before deploying; its in-memory collection would overwrite the new selection.'; exit 1 }"]);
	}
	const profile: HakchiProfile = JSON.parse(await readFile(resolve(values.profile), 'utf8'));
	if (values.build) {
		for (const args of [['run', 'build:platform:libretro-snesmini'], ['run', 'build:libretro-host-snesmini'],
			...profile.games.map(game => ['run', 'build:toolchain:cart', '--', game.target])]) {
			const result = spawnSync('npm', args, { stdio: 'inherit' });
			if (result.error !== undefined) throw result.error;
			if (result.status !== 0) throw new Error(`Build failed: npm ${args.join(' ')}`);
		}
	}
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-hakchi-'));
	const store = new RomArtifactStore(resolve(values['store-dir']));
	try {
		await store.withSharedAccess(async () => {
			const bundle = await prepareHakchiPackage({ repository: process.cwd(), hakchiDirectory: resolve(values['hakchi-dir']),
				directory, profile, store, coreDirectory: resolve(values['core-dir']), hostDirectory: resolve(values['host-dir']) });
			ui.ok(`Hakchi collection updated: ${profile.games.map(game => game.title).join(', ')}`);
			if (!values['collection-only']) ui.ok(await deployMiniPackage(values.ssh, bundle, resolve('scripts/snesmini/install_hakchi.sh')));
		});
	} finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { ui.writeOut(`${error instanceof Error ? error.message : String(error)}\n`, 'error'); process.exitCode = 1; });
