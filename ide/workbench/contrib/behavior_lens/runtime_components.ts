// Consumes the same-build cartlib layout in docs/cartlib_inspection_contract.md.
import { isNil, ValueTag, type Value, valuePayload } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

/** Cartlib's retained type index. No guest call, heap scan, or source-registration discovery. */
export function visitRuntimeComponents(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain,
	modulePath: string, visit: (component: Value) => void,
): boolean {
	const registry = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/registry');
	const type = readRuntimeLuaModuleExport(sources, guest, domain, modulePath);
	if (registry.kind === 'unavailable' || type.kind === 'unavailable' || isNil(registry.value) || isNil(type.value)) return false;
	const index = valuePayload(guest.readStringMember(registry.value, '_entries_by_key'));
	const bucket = guest.cpu.gc.tables.get(index, type.value);
	if (!isNil(bucket)) {
		const components = valuePayload(guest.readStringMember(bucket, 'items'));
		for (let i = 1, length = guest.cpu.gc.tables.length(components); i <= length; i += 1) visit(guest.cpu.gc.tables.getInteger(components, i));
	}
	return true;
}

/** Reacquire a retained table identity through its owning cartlib type bucket. */
export function findRuntimeComponent(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, modulePath: string, hashId: number,
): Value | undefined {
	let result: Value | undefined;
	visitRuntimeComponents(sources, guest, domain, modulePath, component => {
		if (guest.identityScalar(component, ValueTag.Table) === hashId) result = component;
	});
	return result;
}
