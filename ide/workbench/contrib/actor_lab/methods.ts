import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import { runtimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';

/** Stored Lua functions resolved through ordinary table inheritance, without calling __index. */
export function readActorMethods(sources: RuntimeSourceState, guest: SuspendedGuestSession, receiver: Table): QuickPickItem[] {
	const methods: QuickPickItem[] = [];
	guest.visitTableStringMembers(receiver, (name, value) => {
		if (valueTag(value) !== ValueTag.Closure) return;
		const source = runtimeLuaFunctionSource(sources, guest, value);
		methods.push({ label: name, description: '', detail: source === undefined ? ''
			: `${source.resource.path}:${source.range.start.line}` });
	});
	methods.sort((left, right) => left.label.localeCompare(right.label));
	return methods;
}
