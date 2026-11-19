import { valuePayload } from '../../machine/ts/machine/cpu/value';
import { asInteger, isNil, valueNil, valueThread } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';

/** Retire firmware borrows before an IDE source install or physical completion unwind. */
export function retireRuntimeFrameScopes(runtime: Runtime, sources: RuntimeSourceState, guest: SuspendedGuestSession,
	thread?: number, firstFrame = 0): void {
	const module = readRuntimeLuaModuleExport(sources, guest, -1, 'debug/frame_scopes');
	// Source installs can precede BIOS startup. No scopes exist before this module initializes.
	if (module.kind !== 'value' || isNil(module.value)) return;
	const cpu = runtime.machine.cpu, pool = cpu.stringPool;
	const active = valuePayload(cpu.gc.tables.getStringKey(valuePayload(module.value), pool.find('active')!));
	const threadKey = pool.find('thread')!, frameKey = pool.find('owner_frame')!;
	const threadValue = thread === undefined ? valueNil() : valueThread(thread);
	cpu.gc.tables.forEachStoredEntry(active, (key) => {
		const scope = valuePayload(key);
		if (thread !== undefined && (cpu.gc.tables.getStringKey(scope, threadKey) !== threadValue || asInteger(cpu.gc.tables.getStringKey(scope, frameKey)) < firstFrame)) return;
		cpu.gc.tables.setStringKey(scope, threadKey, valueNil());
		cpu.gc.tables.set(active, key, valueNil());
	});
}
