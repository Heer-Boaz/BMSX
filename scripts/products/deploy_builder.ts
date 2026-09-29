import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RomArtifactStore } from '../rompacker/artifacts';
import { createCliUi } from '../lib/cli_ui';
import { javascriptProductFilename } from './targets';

const ui = createCliUi({ bannerTitle: 'BMSX PACKAGE', labelWidth: 14 });

/** Package one exact media result and an explicitly selected existing browser host product. No builds. */
async function main(): Promise<void> {
	const { values } = parseArgs({ options: {
		artifact: { type: 'string' }, 'host-dir': { type: 'string' }, 'output-dir': { type: 'string' },
		'store-dir': { type: 'string', default: './.bmsx/builds' }, help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) { ui.writeOut('Usage: deploy:browser --artifact <id> --host-dir <built-player-dir> --output-dir <new-export-dir> [--store-dir <dir>]\n'); return; }
	if (values.artifact === undefined || !/^[0-9a-f]{64}$/.test(values.artifact) || values['host-dir'] === undefined || values['output-dir'] === undefined) throw new Error('Specify --artifact <id>, --host-dir and --output-dir. Packaging never builds missing inputs.');
	const store = new RomArtifactStore(resolve(values['store-dir'])), artifact = await store.read(values.artifact);
	if (artifact.cart === undefined) throw new Error('A browser package requires a cartridge artifact, not a system-only build.');
	const host = resolve(values['host-dir']), output = resolve(values['output-dir']), debug = artifact.cart.recipe.debug;
	const stage = join(dirname(output), `.bmsx-package-${randomUUID()}`);
	const script = javascriptProductFilename('browser-player', debug), template = `player${debug ? '.debug' : ''}.template.html`;
	// Retain selected host bytes before writing anything to the output. All are part of the package receipt.
	const hostFiles = await Promise.all([script, template, 'manifest.webmanifest', 'bmsx_icon.png'].map(async file => ({ file, bytes: await readFile(join(host, file)) })));
	await mkdir(stage, { recursive: true });
	try {
		await store.export(artifact, stage);
		const files: { file: string; digest: string }[] = [];
		for (const selected of hostFiles) {
			const file = selected.file === template ? 'index.html' : selected.file;
			const bytes = selected.file === template ? Buffer.from(selected.bytes.toString('utf8').replace('{{BMSX_CARTRIDGE}}', `${artifact.cart.name}${debug ? '.debug' : ''}.rom`)) : selected.bytes;
			await writeFile(join(stage, file), bytes);
			files.push({ file, digest: createHash('sha256').update(bytes).digest('hex') });
		}
		await writeFile(join(stage, 'package.json'), JSON.stringify({ artifact: artifact.id, host: files }, null, 2));
		await rename(stage, output); // An existing nonempty export is not overwritten piecemeal.
		ui.ok(`Published package → ${output}`); ui.bullet('Artifact', artifact.id);
	} finally { await rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { ui.writeOut(`${error instanceof Error ? error.message : String(error)}\n`, 'error'); process.exitCode = 1; });
