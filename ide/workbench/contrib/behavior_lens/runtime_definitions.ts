import { isNil, type Value } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleCapture, readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';

export type BehaviorDefinitionChoice = QuickPickItem & { readonly definition: Value };

/** Cartlib's existing registry, retained by its setter. This does not call that setter. */
export function readBehaviorDefinitions(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, modulePath: string) {
	const items: BehaviorDefinitionChoice[] = [];
	const owner = readRuntimeLuaModuleExport(sources, guest, domain, modulePath);
	if (owner.kind === 'unavailable' || isNil(owner.value)) return { available: false, items };
	const registry = readRuntimeLuaModuleCapture(sources, guest, domain, modulePath,
		guest.readStringMember(owner.value, 'set_definition'), 'definitions_by_id');
	if (registry.kind === 'unavailable') return { available: false, items };
	guest.visitTableEntries(registry.value, (key, definition) => {
		items.push({ label: guest.formatValue(key), description: '', detail: '', definition });
	});
	return { available: true, items };
}
