import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCliUi } from '../lib/cli_ui';
import { RomArtifactStore } from './artifacts';
import { prepareMediaBuild } from './build';

const ui = createCliUi({ bannerTitle: 'BMSX BUILDER', labelWidth: 14 });

async function main(): Promise<void> {
	// Preserve the repository's -romname/-respath/-O conventions at the CLI boundary.
	const args = process.argv.slice(2).map(arg => /^-(romname|respath|title)$/.test(arg) ? `-${arg}` : /^-O[0-3]$/.test(arg) ? `--opt=${arg[2]}` : arg);
	const { values } = parseArgs({ args, options: {
		romname: { type: 'string' }, respath: { type: 'string' }, title: { type: 'string' },
		mode: { type: 'string', default: process.env.ROM_MODE ?? 'rompack' },
		opt: { type: 'string', default: '3' }, debug: { type: 'boolean', default: false }, force: { type: 'boolean', default: false },
		'output-dir': { type: 'string', default: process.env.ROM_OUTPUT_DIR ?? './dist' },
		'store-dir': { type: 'string', default: './.bmsx/builds' },
		skiptypecheck: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
	} });
	if (values.help) {
		ui.writeOut('Usage: rompacker --mode bios|rompack -romname <cart> [--debug] [-O0..-O3] [--force]\n'
			+ '  --output-dir <dir>  Export the exact published files (default: dist)\n'
			+ '  --store-dir <dir>   Immutable artifact store (default: .bmsx/builds)\n'
			+ '  -respath <dir>      Resource root override\n'
			+ 'Cart builds resolve and build their BIOS dependency automatically. No server is required.\n');
		return;
	}
	if (values.mode !== 'bios' && values.mode !== 'rompack') throw new Error('Expected --mode bios or rompack');
	if (!['0', '1', '2', '3'].includes(values.opt)) throw new Error('Expected optimizer level 0..3');
	const selection = values.mode === 'bios' ? { domain: 'system' as const }
		: { domain: 'cart' as const, target: (values.romname ?? process.env.ROM_NAME ?? '').replace(/^\.\/carts\/|^carts\//, '').toLowerCase() };
	if (selection.domain === 'cart' && !/^[a-z0-9_-]+$/.test(selection.target)) throw new Error('Specify -romname <cart-folder> (letters, digits, underscore or hyphen).');
	const store = new RomArtifactStore(resolve(values['store-dir'])), stage = store.staging(randomUUID());
	ui.printBanner(); ui.bullet('Target', selection.domain === 'cart' ? selection.target : 'system'); ui.bullet('Recipe', `${values.debug ? 'debug' : 'release'} -O${values.opt}`);
	try {
		const result = await prepareMediaBuild({ ...selection, debug: values.debug, optLevel: Number(values.opt) as 0 | 1 | 2 | 3, force: values.force,
			respath: values.respath ?? process.env.RES_PATH }, store, stage, phase => ui.info(phase));
		if (!result.reused) await store.publish(stage, result.artifact);
		await store.export(result.artifact, resolve(values['output-dir']));
		ui.bullet('Artifact', result.artifact.id); ui.ok(result.reused ? 'Up to date; exact artifact exported' : 'Build published and exported');
	} finally { await rm(stage, { recursive: true, force: true }); }
}

main().catch(error => { ui.writeOut(`${error instanceof Error ? error.message : String(error)}\n`, 'error'); process.exitCode = 1; });
