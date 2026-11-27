import { asClosure, isNil, valueNil, valuePayload } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { RuntimeSourceState } from './sources';
import type { SuspendedGuestSession } from './suspended_guest';

const firstScope = new ValueSlots(1);

export function resolveFrameScopeRetirement(sources: RuntimeSourceState, guest: SuspendedGuestSession) {
	const module = readRuntimeLuaModuleExport(sources, guest, -1, 'debug/frame_scopes');
	if (module.kind !== 'value' || isNil(module.value)) return undefined;
	return {
		registry: valuePayload(guest.readStringMember(module.value, 'active')),
		closure: asClosure(guest.readStringMember(module.value, 'retire'), guest.cpu.gc),
	};
}

export function hasOpenFrameScopes(guest: SuspendedGuestSession, registry: number): boolean {
	return guest.cpu.gc.tables.nextStoredEntry(registry, 0, firstScope, 0, false) !== 0;
}

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
