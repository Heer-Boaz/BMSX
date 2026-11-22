// Consumes the same-build cartlib layout in docs/cartlib_inspection_contract.md.
import { isNil, ValueTag, type Value, valuePayload } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

/** Visit actual World membership at suspension; the guest maintains no inspection index. */
export function visitRuntimeComponents(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain,
	modulePath: string, visit: (component: Value) => void,
): boolean {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	const registry = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/registry');
	const type = readRuntimeLuaModuleExport(sources, guest, domain, modulePath);
	if (world.kind === 'unavailable' || registry.kind === 'unavailable' || type.kind === 'unavailable' || isNil(world.value) || isNil(type.value)) return false;
	const tables = guest.cpu.gc.tables;
	const admitted = valuePayload(guest.readStringMember(registry.value, '_entries_by_id'));
	const objects = valuePayload(guest.readStringMember(world.value, '_objects'));
	for (let i = 1, count = tables.length(objects); i <= count; i++) {
		const object = tables.getInteger(objects, i);
		const classes = valuePayload(guest.readStringMember(object, '_components_by_class'));
		const bucket = tables.get(classes, type.value);
		if (isNil(bucket)) continue;
		const components = valuePayload(bucket);
		for (let j = 1, length = tables.length(components); j <= length; j++) {
			const component = tables.getInteger(components, j);
			if (tables.get(admitted, guest.readStringMember(component, 'id')) === component) visit(component);
		}
	}
	return true;
}

/** Reacquire a retained table identity through its World membership. */
export function findRuntimeComponent(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, modulePath: string, hashId: number,
): Value | undefined {
	let result: Value | undefined;
	visitRuntimeComponents(sources, guest, domain, modulePath, component => {
		if (guest.identityScalar(component, ValueTag.Table) === hashId) result = component;
	});
	return result;
}
