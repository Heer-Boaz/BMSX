import { isNil, valueNil, valuePayload } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';

/** Retire firmware borrows before an IDE source install. */
export function retireRuntimeFrameScopes(runtime: Runtime, sources: RuntimeSourceState, guest: SuspendedGuestSession): void {
	const module = readRuntimeLuaModuleExport(sources, guest, -1, 'debug/frame_scopes');
	// Source installs can precede BIOS startup. No scopes exist before this module initializes.
	if (module.kind !== 'value' || isNil(module.value)) return;
	const cpu = runtime.machine.cpu, pool = cpu.stringPool;
	const active = valuePayload(cpu.gc.tables.getStringKey(valuePayload(module.value), pool.find('active')!));
	const threadKey = pool.find('thread')!;
	cpu.gc.tables.forEachStoredEntry(active, (key) => {
		const scope = valuePayload(key);
		cpu.gc.tables.setStringKey(scope, threadKey, valueNil());
		cpu.gc.tables.set(active, key, valueNil());
	});
}
