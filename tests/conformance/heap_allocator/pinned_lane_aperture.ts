import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkManagedTestSystem } from '../../helpers/managed_system';
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
const directory = mkdtempSync(join(tmpdir(), 'system-native-aperture-'));
try {
	for (const optLevel of [0, 3] as const) {
		const entrySource = `local load<const> = require('${modulePath}').load
return load()`;
		const linked = linkManagedTestSystem(entrySource, optLevel, [{ path: modulePath, source: testModule }]);
		const object = linked.object;
		const exported = object.sections.rodata.moduleExports.find(row => row.path === modulePath && row.exportPathKey === 'load');
		assert.ok(exported);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const entry = linked.layout.functions[index];
		const rom = join(directory, `system-${optLevel}.rom`), trace = join(directory, `trace-${optLevel}.txt`);
		writeFileSync(rom, writeTestBlua32Rom(linked));
		writeFileSync(trace, [
			'D 1000000',
			`W ${IO_IRQ_MASK - RAM_BASE} 3`, // Raw backing behind the visible device register.
			`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`,
			`o ${entry.address} 32768`, // Warm the ordinary native directory for this exact ROM PC.
			`o ${entry.address} 32768`, // Re-enter the same native mapping.
		].join('\n'));
		const [, ordinary, again] = execFileSync(native, [rom, trace, join(directory, 'unused')], { encoding: 'utf8' }).trim().split('\n');
		const [ordinaryWord, publicNativeReads] = ordinary.split(' ').map(Number);
		const [againWord, resumedNativeReads] = again.split(' ').map(Number);
		assert.equal(ordinaryWord, 1024 * IRQ_VBLANK);
		assert.ok(publicNativeReads > 0 && resumedNativeReads > 0, 'the ordinary calls also execute generated code');
		assert.equal(againWord, ordinaryWord);
		console.log(`SYSTEM-NATIVE-APERTURE:PASS O${optLevel} (ordinary ROM reads reach the mapped device, not its raw RAM shadow)`);
	}
} finally {
	rmSync(directory, { recursive: true });
}
