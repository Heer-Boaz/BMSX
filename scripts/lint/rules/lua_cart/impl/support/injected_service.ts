import { type LuaExpression, LuaSyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getExpressionKeyName } from './expression_signatures';

export function isInjectedServiceIdPropertyName(propertyName: string): boolean {
	return propertyName.toLowerCase().endsWith('_service_id');
}

export function getInjectedServiceIdPropertyNameFromTarget(target: LuaExpression): string | undefined {
	if (target.kind === LuaSyntaxKind.MemberExpression) {
		return target.identifier;
	}
	if (target.kind === LuaSyntaxKind.IndexExpression) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}
