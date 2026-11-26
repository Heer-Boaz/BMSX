import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
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
