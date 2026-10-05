import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { createBlua32SourceImage, createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createCartlibProgramHarness } from './cartlib_cpu';
import { createTestRuntimeSourceState } from './runtime_sources';
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
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestRuntimeSourceState(registry, [registry, null], 0);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(images.systemImage, images.systemSymbols, images.systemBiosImports),
		cartridgeSlots: [createBlua32SourceImage(images.cartImage, images.cartSymbols), null] };
	runtime.machine.cpu.reset(); runtime.machine.cpu.installBootPrimitives();
	return { runtime, sources, cpu: runtime.machine.cpu };
}
