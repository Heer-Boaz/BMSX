import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { HEAP_SERVICE_GC_PROJECTION_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { hashBytes } from '../../../machine/ts/common/hash';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const modulePath = 'test/native_firmware_aperture';
const testModule = `module<const>
local load<const> = function()
	local port<const>: *word = ${IO_IRQ_MASK}
	local count = 0
	for i = 1, 1024 do count = count + *port end
	return count
end
return { load = load }`;
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { configure: ['-DBMSX_NATIVE_GATE_PROFILE=ON'] });
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'pinned-lane-aperture-'));
try {
	for (const optLevel of [0, 3] as const) {
		const bios = compileHeapServiceSystem('return 0', optLevel, [{ path: modulePath, source: testModule }]);
		const object = encodeCompiledProgramObject(bios), linked = linkTestSystemBlua32(bios);
		const exported = object.sections.rodata.moduleExports.find(row => row.path === modulePath && row.exportPathKey === 'load');
		assert.ok(exported);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const entry = linked.image.functions[index];
		const rom = join(directory, `system-${optLevel}.rom`), trace = join(directory, `trace-${optLevel}.txt`);
		writeFileSync(rom, linked.romBytes);
		writeFileSync(trace, [
			'D 32768',
			`W ${IO_IRQ_MASK - RAM_BASE} 3`, // Raw backing behind the visible device register.
			`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`,
			`o ${entry.address} 32768`, // Warm the ordinary native directory for this exact ROM PC.
			`B ${entry.address} 0`, 'L 32768', 'n',
			`o ${entry.address} 32768`, // The private JIT entry must not supersede ordinary code.
		].join('\n'));
		const [, ordinary, admitted, , profile, again] = execFileSync(native, [rom, trace, join(directory, 'unused')], { encoding: 'utf8' }).trim().split('\n');
		const [ordinaryWord, publicNativeReads] = ordinary.split(' ').map(Number);
		const [againWord, resumedNativeReads] = again.split(' ').map(Number);
		assert.equal(ordinaryWord, 1024 * IRQ_VBLANK);
		assert.ok(publicNativeReads > 0 && resumedNativeReads > 0, 'the ordinary calls also execute generated code');
		assert.equal(admitted, '1');
		const [, entries, cycles, pc, result] = profile.split(' ').map(Number);
		assert.ok(entries > 0 && cycles > 0 && pc >= entry.codeAddress && pc < entry.codeAddress + entry.codeByteCount);
		assert.equal(result, 1024 * 3);
		assert.equal(againWord, ordinaryWord);
		console.log(`PINNED-NATIVE-APERTURE:PASS O${optLevel} (one ROM PC, independent public and private datapaths)`);
	}
} finally {
	rmSync(directory, { recursive: true });
}

const iterations = 8192;
const storeModule = `module<const>
local mutate<const> = function(address, command_address)
	local words<const>: *u32 = address
	local bytes<const>: *u8 = address + 4
	local command<const>: *word = command_address
	for i = 1, ${iterations} do
		*words = i
		*bytes = i ~ 0xb7
		if i & 63 == 0 then *command = 0 end
	end
	return *words
end
return { mutate = mutate }`;
const storeDirectory = mkdtempSync(join('tmp', 'pinned-native-store-'));
try {
	for (const optLevel of [0, 3] as const) {
		const bios = compileHeapServiceSystem('return 0', optLevel, [{ path: modulePath, source: storeModule }]);
		const object = encodeCompiledProgramObject(bios), linked = linkTestSystemBlua32(bios);
		const exported = object.sections.rodata.moduleExports.find(row => row.path === modulePath && row.exportPathKey === 'mutate');
		assert.ok(exported);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const entry = linked.image.functions[index], rom = join(storeDirectory, `system-${optLevel}.rom`);
		writeFileSync(rom, linked.romBytes);
		const run = (name: string, commands: string[]) => {
			const trace = join(storeDirectory, `trace-${optLevel}-${name}.txt`);
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [rom, trace, join(storeDirectory, 'unused')], { encoding: 'utf8' }).trim().split('\n');
		};
		const seed = ['D 32768', 'A 16'];
		const [, block] = run('address', seed);
		const arena = Number(block) - RAM_BASE;
		const management = PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE;
		const projection = management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
		const activeRoot = management + HEAP_SERVICE_ROOT_BANKS_OFFSET + 4;
		const sentinel = 0x71da8afd;
		const raw = new Uint8Array(8);
		writeLE32(raw, 0, sentinel);
		writeLE32(raw, 4, sentinel);
		const projectionHash = hashBytes(raw, 0, 4);
		writeLE32(raw, 0, iterations);
		raw[4] = (iterations ^ 0xb7) & 255;
		const finalHash = hashBytes(raw, 0, 8);
		const results = run('store-rewind', [...seed,
			`W ${projection} ${sentinel}`, `W ${arena + 4} ${sentinel}`,
			`W ${activeRoot} 0`, `H ${activeRoot} ${activeRoot + 4}`,
			`B ${entry.address} 2 ${RAM_BASE + arena} ${RAM_BASE + projection}`, 'L 12000', 'n',
			`H ${arena} ${arena + 8}`, 'l', 's',
			'L 500000', 'n', `H ${arena} ${arena + 8}`, `H ${projection} ${projection + 4}`, `H ${activeRoot} ${activeRoot + 4}`,
			'u', `H ${arena} ${arena + 8}`, 'L 500000', 'n',
			`H ${arena} ${arena + 8}`, `H ${projection} ${projection + 4}`, `H ${activeRoot} ${activeRoot + 4}`,
		]);
		const [, , beforeRoot, began, midGrant, midProfile, partial, endGrant, endProfile, final, savedProjection, publishedRoot,
			rewound, replayGrant, , replayed, replayedProjection, replayedRoot] = results;
		const [, midEntries, midNativeCycles, midNativePc, , midWriteExits] = midProfile.split(' ').map(Number);
		const [, , nativeCycles, , result, writeExits] = endProfile.split(' ').map(Number);
		const [, tailCycles, active] = endGrant.split(' ').map(Number);
		assert.equal(began, '1');
		assert.equal(midGrant.split(' ')[2], '1');
		assert.ok(midEntries > 0 && midNativeCycles > 0 && midNativePc >= entry.codeAddress && midNativePc < entry.codeAddress + entry.codeByteCount);
		// Writes are most of this loop's cycles, and unsupported or cold stores
		// would leave native execution on every store instead of this hot tail.
		assert.ok(nativeCycles - midNativeCycles > tailCycles * 0.8);
		assert.ok(writeExits > midWriteExits && writeExits - midWriteExits < iterations / 32,
			'the hot RAM writes are generated, while projection/history writes take bounded exits');
		assert.equal(active, 0);
		assert.equal(result, iterations);
		assert.equal(final, String(finalHash));
		assert.equal(savedProjection, String(projectionHash), 'the command is a notification, not a RAM write');
		assert.notEqual(publishedRoot, beforeRoot, 'the command publishes roots through the private owner');
		assert.notEqual(partial, final);
		assert.equal(rewound, partial, 'arming history in the hot fixed service preserves its older store page');
		assert.equal(replayGrant, endGrant);
		assert.deepEqual([replayed, replayedProjection, replayedRoot], [final, savedProjection, publishedRoot]);
		console.log(`PINNED-NATIVE-STORE:PASS O${optLevel} (byte/word, watched history, projection and exact replay)`);
	}
} finally {
	rmSync(storeDirectory, { recursive: true });
}
