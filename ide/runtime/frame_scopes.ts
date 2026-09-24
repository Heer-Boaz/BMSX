import type { Table } from '../../machine/ts/machine/cpu/table';
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
	if (module.kind !== 'value' || module.value === null) return;
	const pool = runtime.machine.cpu.stringPool;
	const active = (module.value as Table).getStringKey(pool.find('active')!) as Table;
	const threadKey = pool.find('thread')!, frameKey = pool.find('owner_frame')!;
	active.forEachStoredEntry((_tag, _scalar, reference) => {
		const scope = reference as Table;
		if (thread !== undefined && (scope.getStringKey(threadKey) !== thread || (scope.getStringKey(frameKey) as number) < firstFrame)) return;
		scope.setStringKey(threadKey, null);
		active.set(scope, null);
	});
}
