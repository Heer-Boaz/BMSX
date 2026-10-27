import { captureInstalledLuaSources, createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createBlua32SourceImage, createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { createCartlibProgramHarness } from './cartlib_cpu';
import { createTestRuntimeSourceState, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from './runtime_sources';
import { cartridgeSlots } from './cartridge';

export function compileEventHistoryFixture(optLevel: 0 | 3 = 3) {
	return createCartlibProgramHarness(`
local events<const> = require('cartlib/event_emitter')
local port<const> = events.events_of({ id = 'fixture' })
function emit_for_viewer(count)
  local payload<const> = { value = 0, child = { x = 4 } }
  for index = 1, count do
    payload.value = index
    port:emit('probe', payload)
    for work = 1, 32 do payload.value = payload.value + work end
  end
end
return true`, { optLevel }).images;
}

/** Actual runtime and compiler media; observers are explicitly owned by each test. */
export function eventHistoryRuntime(images: ReturnType<typeof compileEventHistoryFixture>) {
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	const systemSources = createLuaSourceRegistry('', ''), cartSources = createLuaSourceRegistry('', '');
	const sources = createTestRuntimeSourceState(systemSources, [cartSources, null], 0);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(images.systemImage, images.systemSymbols, images.systemBiosImports, captureInstalledLuaSources(systemSources, images.systemSymbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID),
		cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols, captureInstalledLuaSources(cartSources, images.cartSymbols!.metadata.compiledModulePaths), TEST_CARTRIDGE_CONTEXT_IDS[0]), null] };
	runtime.machine.cpu.reset(); runtime.machine.cpu.installBootPrimitives();
	return { runtime, sources, cpu: runtime.machine.cpu };
}
