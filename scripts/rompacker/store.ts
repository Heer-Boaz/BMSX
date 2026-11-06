import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collectOfflineBuilds } from '../../hosts/node/builds/maintenance';
import { RomArtifactStore, romBuildKey } from './artifacts';

/** Explicit maintenance never scans or removes authored workspaces, exports or recovery data. */
async function main(): Promise<void> {
	const { values, positionals } = parseArgs({ allowPositionals: true, options: {
		'store-dir': { type: 'string', default: '.bmsx/builds' },
		'publication-root': { type: 'string', multiple: true }, apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
		'export-root': { type: 'string', multiple: true },
	} });
	const command = positionals[0];
	if (values.help || command === undefined) {
		process.stdout.write('Usage: npm run build:store -- deduplicate|collect [--store-dir <dir>] [--apply]\n'
			+ '  Without --apply, inspect only. Collection requires the workspace server to be stopped.\n'
			+ '  --publication-root <dir>  Retain artifact references in existing browser-package receipts. Repeatable.\n');
		process.stdout.write('  --export-root <dir>       Retain existing exported ROMs by content. Repeatable.\n');
		return;
	}
	if (command !== 'deduplicate' && command !== 'collect') throw new Error('Expected deduplicate or collect');
	const store = new RomArtifactStore(resolve(values['store-dir']));
	let publications = 0, exports = 0;
	const roots: string[] = [];
	await store.withSharedAccess(async () => {
		for (const root of values['publication-root'] ?? []) for (const entry of await readdir(resolve(root), { recursive: true, withFileTypes: true })) {
			if (entry.name !== 'package.json' || !entry.isFile()) continue;
			const receipt: { artifact?: string } = JSON.parse(await readFile(join(entry.parentPath, entry.name), 'utf8'));
			if (receipt.artifact === undefined) continue; // Not a BMSX browser-package receipt.
			await store.read(receipt.artifact);
			roots.push(receipt.artifact);
			if (values.apply) await store.retain(`publications/${romBuildKey(resolve(entry.parentPath))}`, receipt.artifact);
			publications++;
		}
		for (const root of values['export-root'] ?? []) {
			const retained = await store.retainExistingExports(resolve(root), values.apply);
			roots.push(...retained); exports += retained.length;
		}
	});
	const result = command === 'deduplicate' ? await store.deduplicate(values.apply) : await collectOfflineBuilds(store, values.apply, roots);
	process.stdout.write(`${JSON.stringify({ command, applied: values.apply, publications, exports, ...result }, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
