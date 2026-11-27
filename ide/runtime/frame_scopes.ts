import { asClosure, isNil, valuePayload } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
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
