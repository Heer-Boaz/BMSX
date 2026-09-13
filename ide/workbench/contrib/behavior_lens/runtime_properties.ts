import { valueIsTable } from '../../../../machine/ts/machine/cpu/value';
import { runtimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
import type { BehaviorInspectionProperty } from './inspection';

/** Loaded values have no inferred authoring target. Only a mapped closure supplies Source. */
export function inspectBehaviorRuntimeValue(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, label: string, value: SuspendedGuestValue, description: string,
): BehaviorInspectionProperty {
	const source = runtimeLuaFunctionSource(sources, guest, value);
	return { label, value: source === undefined ? formatLoadedValue(guest, value)
		: `CALL TARGET / ${source.resource.domain === -1 ? 'SYSTEM' : `CART ${source.resource.domain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`,
		description, warning: false, source };
}

/** Lists retain their stored keys, including holes. Nested values use the debugger's bounded preview. */
function formatLoadedValue(guest: SuspendedGuestSession, value: SuspendedGuestValue): string {
	if (!valueIsTable(value)) return guest.formatValue(value);
	const lines: string[] = [];
	guest.visitTableEntries(value, (key, entry) => lines.push(`${guest.formatValue(key)}: ${guest.previewValue(entry, 1, 8)}`));
	return lines.length === 0 ? '{}' : lines.join('\n');
}
