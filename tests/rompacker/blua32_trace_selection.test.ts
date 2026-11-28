import { nativeHeapReference } from '../helpers/native_heap/reference';
import { MANAGED_CART_LAUNCH } from '../helpers/managed_cart_launch';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { traceSinkFieldName } from '../../toolchain/ts/lua/compiler/trace_statement';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { SYSTEM_KERNEL_MODULES } from '../../toolchain/ts/rompack/system';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';
import { createTestBlua32PairCpu, writeTestBlua32Rom } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runGuestToHalt } from '../helpers/cpu_test_harness';
import { loadHeapServiceTestModules, loadTestBiosUtilityModules } from '../helpers/heap_service_system';

test('image builders select channels independently per image and across module boundaries', () => {
	const systemSource = `module<entry>
local sink<const> = { count = 0 }
function sink:record(value) self.count = self.count + value end
blua32.trace_sink(sink, 'boot', sink)
blua32.trace_sink(sink, 'compile', sink)
blua32.trace(sink, 'boot', 3)
blua32.trace(sink, 'compile', 100)
system_observed = sink.count
${MANAGED_CART_LAUNCH}
`;
	const system = buildBlua32Image({
		luaModules: [{ path: 'entry', displayPath: 'entry.lua', source: systemSource, chunk: parseLuaChunk(systemSource, 'entry') },
			...[...loadHeapServiceTestModules(), ...loadTestBiosUtilityModules()].map(module => ({ ...module, displayPath: `${module.path}.lua` }))],
		preloadModules: SYSTEM_KERNEL_MODULES,
		generatedLuaModules: [],
		loadAddress: SYSTEM_ROM_BASE + 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel: 3,
		traceStatements: ['boot'],
		domain: 'system',
		biosExports: BIOS_FUNCTION_EXPORTS,
	});
	const cartSource = `module<entry>
local producer<const> = require('fixture/producer')
local sink<const> = { count = 0 }
function sink:record(value) self.count = self.count + value end
blua32.trace_sink(producer, 'boot', sink)
blua32.trace_sink(producer, 'compile', sink)
producer.run()
return sink.count
`;
	const producerSource = `
local producer<const> = {}
function producer.run()
	blua32.trace(producer, 'boot', 100)
	blua32.trace(producer, 'compile', 7)
end
return producer
`;
	const cart = buildBlua32Image({
		luaModules: [
			{ path: 'entry', displayPath: 'entry.lua', source: cartSource, chunk: parseLuaChunk(cartSource, 'entry') },
			{ path: 'fixture/producer', displayPath: 'fixture/producer.lua', source: producerSource, chunk: parseLuaChunk(producerSource, 'fixture/producer') },
		],
		generatedLuaModules: [],
		loadAddress: CART_ROM_BASE + 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes,
		optLevel: 3,
		traceStatements: ['compile'],
		domain: 'cart',
		biosImports: system.linked.biosImports,
	});
	assert.ok(system.linked.layout.constants.includes(traceSinkFieldName('boot')));
	assert.ok(!system.linked.layout.constants.includes(traceSinkFieldName('compile')));
	assert.ok(cart.linked.layout.constants.includes(traceSinkFieldName('compile')));
	assert.ok(!cart.linked.layout.constants.includes(traceSinkFieldName('boot')));
	const { cpu } = createTestBlua32PairCpu({
		systemRomBytes: writeTestBlua32Rom(system.linked),
		cartRomBytes: writeTestBlua32Rom(cart.linked),
	});
	runGuestToHalt(cpu, 100_000);
	assert.equal(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('system_observed')!), valueInteger(3));
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(7)]);
});
