import { asInteger, asTable, isNil, valueNil, valueThread } from '../../machine/ts/machine/cpu/value';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';

/** Retire firmware borrows before an IDE source install or physical completion unwind. */
export function retireRuntimeFrameScopes(runtime: Runtime, sources: RuntimeSourceState, guest: SuspendedGuestSession,
	thread?: Thread, firstFrame = 0): void {
	const module = readRuntimeLuaModuleExport(sources, guest, -1, 'debug/frame_scopes');
	// Source installs can precede BIOS startup. No scopes exist before this module initializes.
	if (module.kind !== 'value' || isNil(module.value)) return;
	const cpu = runtime.machine.cpu, pool = cpu.stringPool;
	const active = asTable(asTable(module.value, cpu.gc).getStringKey(pool.find('active')!), cpu.gc);
	const threadKey = pool.find('thread')!, frameKey = pool.find('owner_frame')!;
	const threadValue = thread === undefined ? valueNil() : valueThread(cpu.gc.reference(thread));
	active.forEachStoredEntry((key) => {
		const scope = asTable(key, cpu.gc);
		if (thread !== undefined && (scope.getStringKey(threadKey) !== threadValue || asInteger(scope.getStringKey(frameKey)) < firstFrame)) return;
		scope.setStringKey(threadKey, valueNil());
		active.set(key, valueNil());
	});
}
