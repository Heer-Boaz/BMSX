import {
	LuaSyntaxKind,
	type LuaExpression,
} from '../syntax/ast';

export type ModuleAliasEntry = {
	readonly declId: string;
	readonly alias: string;
	readonly module: string;
	readonly memberPath: readonly string[];
};

export type ModuleAliasTarget = {
	readonly module: string;
	readonly memberPath: readonly string[];
};

type ModuleAliasLookup = (name: string) => ModuleAliasTarget;

export function resolveModuleAliasInitializer(
	expression: LuaExpression,
	resolveIdentifier: ModuleAliasLookup,
	requireIsBuiltin: boolean,
): ModuleAliasTarget {
	if (expression.kind === LuaSyntaxKind.CallExpression) {
		if (!requireIsBuiltin
			|| expression.method
			|| expression.callee.kind !== LuaSyntaxKind.IdentifierExpression
			|| expression.callee.name !== 'require') {
			return null;
		}
		const moduleName = expression.arguments[0];
		if (!moduleName || moduleName.kind !== LuaSyntaxKind.StringLiteralExpression) {
			return null;
		}
		return {
			module: moduleName.value,
			memberPath: [],
		};
	}
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		return resolveIdentifier(expression.name);
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const base = resolveModuleAliasInitializer(expression.base, resolveIdentifier, requireIsBuiltin);
		if (!base) {
			return null;
		}
		return {
			module: base.module,
			memberPath: [...base.memberPath, expression.member.name],
		};
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression
		&& expression.index.kind === LuaSyntaxKind.StringLiteralExpression) {
		const base = resolveModuleAliasInitializer(expression.base, resolveIdentifier, requireIsBuiltin);
		if (!base) {
			return null;
		}
		return {
			module: base.module,
			memberPath: [...base.memberPath, expression.index.value],
		};
	}
	return null;
}
