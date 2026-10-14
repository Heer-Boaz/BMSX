import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseCartridgePackage } from '../../machine/ts/rompack/image';
import { RomArtifactStore } from '../rompacker/artifacts';
import { createCliUi } from '../lib/cli_ui';
import { PLAYER_INPUT_TRACE_SCRIPT, PLAYER_MANIFEST, renderPlayerManifest, renderPlayerPage } from './player_page';
import { pushPagesMedia } from './pages_media';
import { javascriptProductFilename } from './targets';

const ui = createCliUi({ bannerTitle: 'BMSX PACKAGE', labelWidth: 14 });

/** Package one exact media result and an explicitly selected existing browser host product. No builds. */
async function main(): Promise<void> {
	const { values } = parseArgs({ options: {
		artifact: { type: 'string' }, 'host-dir': { type: 'string' }, 'output-dir': { type: 'string' },
		'media-base-url': { type: 'string' }, 'media-output-dir': { type: 'string' },
		'input-trace': { type: 'boolean', default: false }, 'push-media': { type: 'boolean', default: false },
		'store-dir': { type: 'string', default: './.bmsx/builds' }, help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) {
		ui.writeOut('Usage: deploy:browser --artifact <id> --host-dir <built-player-dir> --output-dir <new-export-dir> [--store-dir <dir>]\n'
			+ '  --media-base-url <https://host/path/> --media-output-dir <dir>  Export media separately and use its public URLs.\n');
		ui.writeOut('  --input-trace  Package the built native-input trace page and its early diagnostic script.\n');
		ui.writeOut('  --push-media   Commit and push only this package\'s ROMs in the media output\'s git checkout.\n');
		return;
	}
	if (values.artifact === undefined || !/^[0-9a-f]{64}$/.test(values.artifact) || values['host-dir'] === undefined || values['output-dir'] === undefined) throw new Error('Specify --artifact <id>, --host-dir and --output-dir. Packaging never builds missing inputs.');
	if ((values['media-base-url'] === undefined) !== (values['media-output-dir'] === undefined)) throw new Error('Specify --media-base-url and --media-output-dir together.');
	if (values['push-media'] && values['media-output-dir'] === undefined) throw new Error('--push-media publishes separately exported media; specify --media-output-dir.');
	const mediaBaseUrl = values['media-base-url'] === undefined ? undefined : new URL(values['media-base-url']);
	const store = new RomArtifactStore(resolve(values['store-dir'])), artifact = await store.read(values.artifact);
	if (artifact.cart === undefined) throw new Error('A browser package requires a cartridge artifact, not a system-only build.');
	const host = resolve(values['host-dir']), output = resolve(values['output-dir']), debug = artifact.cart.recipe.debug;
	const systemRom = artifact.system.outputs.find(output => output.file.endsWith('.rom'))!.file;
	const cartRom = artifact.cart.outputs.find(output => output.file.endsWith('.rom'))!.file;
	const stage = join(dirname(output), `.bmsx-package-${randomUUID()}`);
	const mediaOutput = values['media-output-dir'] === undefined ? stage : resolve(values['media-output-dir']);
	const systemRomUrl = mediaBaseUrl === undefined ? systemRom : new URL(systemRom, mediaBaseUrl).href;
	const cartRomUrl = mediaBaseUrl === undefined ? cartRom : new URL(cartRom, mediaBaseUrl).href;
	const script = javascriptProductFilename('browser-player', debug), template = `player${values['input-trace'] ? '.input-trace' : ''}${debug ? '.debug' : ''}.template.html`;
	// Retain selected host bytes before writing anything to the output. All are part of the package receipt.
	const hostFiles = await Promise.all([script, template, PLAYER_MANIFEST, 'bmsx_icon.png',
		...(values['input-trace'] ? [PLAYER_INPUT_TRACE_SCRIPT] : [])].map(async file => ({ file, bytes: await readFile(join(host, file)) })));
	await mkdir(stage, { recursive: true });
	try {
		// Browsers download only the two ROMs; build sidecars such as BLua32 symbols stay in the store.
		await store.export(artifact, mediaOutput, file => file === systemRom || file === cartRom);
		// The cartridge names its package: one title for the page, the manifest and the home-screen label.
		const title = parseCartridgePackage(await readFile(join(store.directory(artifact.id), cartRom))).manifest.title ?? artifact.target;
		const files: { file: string; digest: string }[] = [];
		for (const selected of hostFiles) {
			const file = selected.file === template ? 'index.html' : selected.file;
			const bytes = selected.file === template ? Buffer.from(renderPlayerPage(selected.bytes.toString('utf8'), title, cartRomUrl, systemRomUrl))
				: selected.file === PLAYER_MANIFEST ? Buffer.from(renderPlayerManifest(selected.bytes.toString('utf8'), title))
				: selected.bytes;
			await writeFile(join(stage, file), bytes);
			files.push({ file, digest: createHash('sha256').update(bytes).digest('hex') });
		}
		await writeFile(join(stage, 'package.json'), JSON.stringify({ artifact: artifact.id, host: files,
			media: { system: systemRomUrl, cartridge: cartRomUrl } }, null, 2));
		await rename(stage, output); // An existing nonempty export is not overwritten piecemeal.
		ui.ok(`Published package → ${output}`); ui.bullet('Artifact', artifact.id);
		if (mediaBaseUrl !== undefined) ui.bullet('Media', `${mediaOutput} → ${mediaBaseUrl.href}`);
		if (values['push-media']) ui.bullet('Pages', await pushPagesMedia(mediaOutput, [join(mediaOutput, systemRom), join(mediaOutput, cartRom)],
			`Publish ${title} media ${artifact.id}`));
	} finally { await rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { ui.writeOut(`${error instanceof Error ? error.message : String(error)}\n`, 'error'); process.exitCode = 1; });
