import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSourceCartridgeFixture } from '../../helpers/source_cartridge';
import { PRELOAD_SOURCE_MODULES, PRELOAD_TRACE_CHANNELS } from '../../helpers/preload_source_fixture';

async function main() {
	const [directory, bios, hostRewindSource] = process.argv.slice(2);
	const system = new Uint8Array(await readFile(bios));
	if (hostRewindSource === undefined) {
		const cartridge = await buildSourceCartridgeFixture(directory, 'carts/preload_fixture',
			system, PRELOAD_SOURCE_MODULES,
			{ traceStatements: PRELOAD_TRACE_CHANNELS, preloadModules: ['observation'] });
		await writeFile(join(directory, 'cart.rom'), cartridge);
	} else {
		const cartridge = await buildSourceCartridgeFixture(directory, 'carts/rewind_fixture', system,
			[{ path: 'entry', source: await readFile(hostRewindSource, 'utf8') }],
			{ traceStatements: 'erase', preloadModules: [] });
		await writeFile(join(directory, 'cart.rom'), cartridge);
	}
}
void main();
