import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildRomBlua32Tail } from '../../scripts/rompacker/rombuilder';
import { compileCart } from '../../scripts/rompacker/compile';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { decodeBlua32RomImage } from '../../toolchain/ts/rompack/blua32_image';
import { createTestBlua32PairCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues } from '../lua/cpu_test_harness';

for (const optLevel of [0, 3] as const) test(`packer debug metadata cannot change trace erasure, results or cycles (O${optLevel})`, async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-debug-release-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const entry = join(root, 'entry.lua');
	await writeFile(join(root, 'fixture.rommanifest'), 'hardware:\n  - type: rom\n');
	await writeFile(entry, `module<entry>
local count = 0
blua32.trace_sink((function() count = count + 1; return {} end)(), 'event.emit', {})
for i = 1, 100 do
  blua32.trace((function() count = count + 1; return {} end)(), 'event.emit', 'erased-payload', i)
  count = count + i
end
return count`);
	const inputs = await prepareRomInputs([root], [entry]);
	const system = linkTestSystemBlua32(compileLuaSource(`cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`));
	const builds = [];
	for (const debug of [false, true]) {
		await compileCart({ inputs, sourceFiles: [entry], librarySourceFiles: [], testLibraryFiles: [], allLibraryFiles: [], scenarioSourceFiles: [],
			recipe: { domain: 'cart', debug, optLevel, projectRoot: root, toolchain: 'execution-equivalence' },
		}, join(root, 'out'), 'fixture', system.romBytes, () => {});
		const rom = new Uint8Array(await readFile(join(root, 'out', `fixture${debug ? '.debug' : ''}.rom`)));
		const image = decodeBlua32RomImage(rom, CART_ROM_BASE)!;
		const { cpu } = createTestBlua32PairCpu({ systemRomBytes: system.romBytes, cartRomBytes: rom });
		assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [5050]);
		assert.ok(!image.constants.includes('erased-payload'));
		builds.push({ codeBytes: image.textBytes.length, constants: image.constants, cycles: 100_000 - cpu.instructionBudgetRemaining, heap: cpu.luaHeap.usedBytes() });
	}
	assert.deepEqual(builds[1], builds[0]);
});

for (const optLevel of [0, 3] as const) test(`symbol inclusion preserves executable bytes at the same link address (O${optLevel})`, () => {
	const source = `module<entry>
local value = 0
local function emit(n)
  blua32.trace({}, 'event.emit', value, n)
  value = value + n
end
for i = 1, 10 do emit(i) end
return value`;
	const assets = [{ resid: 'entry', type: 'lua' as const, buffer: Buffer.from(source), program_module: true, source_path: 'entry.lua' }];
	const images = [false, true].map(includeSymbols => buildRomBlua32Tail(assets, {
		domain: 'system', generatedLuaModules: [], biosExports: [], ramByteCount: 0x00400000,
		optLevel, includeSymbols, systemAssetEndOffset: 0x100,
	}));
	// Symbols/source packaging may relocate images. With placement held equal,
	// every executable byte (not only opcode counts or return values) must match.
	assert.deepEqual(images[1].layout.ranges[0].buffer, images[0].layout.ranges[0].buffer);
	assert.deepEqual(images[1].boot, images[0].boot);
});
