import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import { runtimeLuaFunctionSource, type RuntimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';

export type ActorMethod = { readonly name: string; readonly source: RuntimeLuaFunctionSource | undefined };

/** Stored Lua functions resolved through ordinary table inheritance, without calling __index. */
export function readActorMethods(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, receiver: Table): ActorMethod[] {
	const methods: ActorMethod[] = [];
	guest.visitTableStringMembers(receiver, (name, value) => {
		if (valueTag(value) !== ValueTag.Closure) return;
		const source = runtimeLuaFunctionSource(sources, guest, value);
		methods.push({ name, source });
	});
	methods.sort((left, right) => left.name.localeCompare(right.name));
	return methods;
}
