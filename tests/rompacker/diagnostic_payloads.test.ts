import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRomBlua32Tail, finalizeRompack } from '../../scripts/rompacker/rombuilder';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { parseSystemRomImage } from '../../machine/ts/rompack/image';
import { CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET } from '../../machine/ts/spec/bmsx/rom_package';
import { readLE32 } from '../../machine/ts/common/endian';
import { loadBlua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { SYSTEM_ROM_ASSET_OFFSET } from '../../toolchain/ts/rompack/system';
import { createTestSystemCpu } from '../helpers/blua32';
import { materializeCpuCompletionValues } from '../lua/cpu_test_harness';

// Real installed BIOS consumers; neither reads the host symbol graph.
const source = `module<entry>
local locations<const> = require('shell/source_location')
local scopes<const> = require('debug/scopes')
bss stored: word
bss location_row: u16[128]
bss source_row: u16[128]
function inspect_location(pc)
	locations.resolve(0xffffffff, pc)
	if not locations.begin_output() then return false end
	locations.next_row(location_row, 128, 1, 2)
	local complete<const> = locations.next_row(source_row, 128, 1, 2)
	return complete, location_row, source_row
end
function inspect_scope(address, pc)
	local names<const>, label<const> = scopes.resolve(0, address, pc, 0)
	if names == nil then return nil, label end
	return label, names.value ~= nil, names.stored.is_address
end
local probe_target = function(value, ...)
	local retained = value + 1
	return retained
end
return probe_target(41)`;
const assets = [
	{ path: 'diagnostic_probe', source },
	...['base', 'table', 'string/base', 'string/utf8', 'debug/scopes', 'shell/source_location'].map(path => ({
		path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
	})),
	{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
].map(module => ({ resid: module.path, type: 'lua' as const, source_path: `${module.path}.lua`,
	program_module: true, buffer: Buffer.from(module.source) }));

test('public BIOS diagnostics and embedded host symbols are independently selectable', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-diagnostic-payloads-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const executables: Uint8Array[] = [];
	for (const includeDiagnostics of [false, true]) for (const includeSymbols of [false, true]) {
		const prefix = layoutRomPrefix(assets, true, null, SYSTEM_ROM_ASSET_OFFSET);
		const tail = buildRomBlua32Tail(assets, { domain: 'system', generatedLuaModules: [], biosExports: [],
			ramByteCount: 0x00400000, optLevel: 0, includeDiagnostics, includeSymbols, systemAssetEndOffset: prefix.nextOffset });
		const name = `diagnostics-${+includeDiagnostics}-symbols-${+includeSymbols}`;
		const outputs = await finalizeRompack(name, { debug: false, layout: prefix, blua32: tail, outputDirectory: directory });
		assert.deepEqual(outputs.map(output => output.file), [`${name}.rom`], 'no standalone symbol sidecar is published');
		const bytes = new Uint8Array(await readFile(join(directory, `${name}.rom`)));
		const image = loadBlua32ToolingImage(parseSystemRomImage(bytes), 0)!;
		assert.equal(image.symbols !== null, includeSymbols);
		assert.equal(readLE32(bytes, CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET) !== 0, includeDiagnostics);
		executables.push(image.layout.bytes);
		const { cpu, memory } = createTestSystemCpu({ romBytes: bytes });
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [42]);
		if (!includeDiagnostics || includeSymbols) continue;
		assert.equal(image.symbols, null, 'the BIOS proof has no embedded host symbol graph');
		const metadata = tail.diagnostics!.symbols.metadata;
		const target = image.layout.functions[metadata.functionDisplayNames.indexOf('probe_target')];
		assert.ok(target, 'the fixture contains the named diagnostic target');
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('inspect_scope')) as Closure,
			[target.address, target.codeAddress]);
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueString(cpu.stringPool.intern('probe_target')), true, true]);
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.intern('inspect_location')) as Closure, [target.codeAddress]);
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		const [complete, locationAddress, sourceAddress] = materializeCpuCompletionValues(cpu) as [boolean, number, number];
		assert.equal(complete, true);
		const rows = [locationAddress, sourceAddress].map(address => String.fromCharCode(...Array.from({ length: 128 },
			(_, index) => memory.readU8(address + index * 2))).replace(/\0+$/, ''));
		assert.match(rows[0], /^diagnostic_probe\.lua:\d+:\d+$/);
		assert.equal(rows[1], ' local retained = value + 1');
	}
	for (const executable of executables) assert.deepEqual(executable, executables[0], 'metadata choices preserve executable bytes');
});
