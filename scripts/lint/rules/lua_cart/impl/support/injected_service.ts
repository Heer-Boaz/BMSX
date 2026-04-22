import { type LuaExpression as Expression, LuaSyntaxKind as SyntaxKind } from '../../../../../../src/bmsx/lua/syntax/ast';
import { getExpressionKeyName } from './expression_signatures';

export function isInjectedServiceIdPropertyName(propertyName: string): boolean {
	return propertyName.toLowerCase().endsWith('_service_id');
}

export function getInjectedServiceIdPropertyNameFromTarget(target: Expression): string | undefined {
	if (target.kind === SyntaxKind.MemberExpression) {
		return target.identifier;
	}
	if (target.kind === SyntaxKind.IndexExpression) {
		return getExpressionKeyName(target.index);
	}
	return undefined;
}
