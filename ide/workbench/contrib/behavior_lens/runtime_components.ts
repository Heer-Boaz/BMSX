import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

/** Cartlib's retained type index. No guest call, heap scan, or source-registration discovery. */
export function visitRuntimeComponents(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain,
	modulePath: string, visit: (component: Table) => void,
): boolean {
	const registry = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/registry');
	const type = readRuntimeLuaModuleExport(sources, guest, domain, modulePath);
	if (registry.kind === 'unavailable' || type.kind === 'unavailable' || registry.value === null || type.value === null) return false;
	const index = guest.readStringMember(registry.value, '_entries_by_key') as Table;
	const bucket = index.get(type.value);
	if (bucket !== null) {
		const components = guest.readStringMember(bucket, 'items') as Table;
		for (let i = 1; i <= components.arrayLength; i += 1) visit(components.getInteger(i) as Table);
	}
	return true;
}
