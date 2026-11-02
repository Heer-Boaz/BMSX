import type { LuaExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import type { ResourceIdentity } from '../../../common/resource';
import { computeSourceLabel } from '../../../common/paths';

/** A literal ID is a name; an expression identifies only its authored source occurrence. */
export function sceneSourceName(resource: ResourceIdentity, id: LuaExpression | undefined, line: number, column: number): string {
	if (id === undefined) return `Scene unavailable (${computeSourceLabel(resource.path)}:${line}:${column})`;
	const literal = stringLiteralValue(id);
	return literal === undefined ? `${computeSourceLabel(resource.path)}:${line}:${column}` : literal;
}
