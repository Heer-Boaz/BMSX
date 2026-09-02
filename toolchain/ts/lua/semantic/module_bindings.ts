import {
	LuaSyntaxKind,
	type LuaCallExpression,
	type LuaExpression,
	type LuaIndexExpression,
	type LuaStringLiteralExpression,
} from '../syntax/ast';
import type { SemanticValueSource } from './value_graph';

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

type ModuleAliasLookup = (name: string) => ModuleAliasTarget | null;

const EMPTY_MEMBER_PATH: readonly string[] = [];

export function resolveBuiltinRequireArgument(
	expression: LuaCallExpression,
	requireIsBuiltin: boolean,
): LuaStringLiteralExpression | null {
	if (!requireIsBuiltin
		|| expression.method
		|| expression.callee.kind !== LuaSyntaxKind.IdentifierExpression
		|| expression.callee.name !== 'require'
		|| expression.arguments.length === 0) {
		return null;
	}
	const moduleName = expression.arguments[0];
	return moduleName.kind === LuaSyntaxKind.StringLiteralExpression
		? moduleName
		: null;
}

export function resolveModuleAliasInitializer(
	expression: LuaExpression,
	resolveIdentifier: ModuleAliasLookup,
	requireIsBuiltin: boolean,
): ModuleAliasTarget | null {
	let root = expression;
	let memberCount = 0;
	while (root.kind === LuaSyntaxKind.MemberExpression
		|| (root.kind === LuaSyntaxKind.IndexExpression
			&& root.index.kind === LuaSyntaxKind.StringLiteralExpression)) {
		memberCount += 1;
		root = root.base;
	}
	let target: ModuleAliasTarget;
	if (root.kind === LuaSyntaxKind.CallExpression) {
		const moduleName = resolveBuiltinRequireArgument(root, requireIsBuiltin);
		if (!moduleName) {
			return null;
		}
		target = {
			module: moduleName.value,
			memberPath: EMPTY_MEMBER_PATH,
		};
	} else if (root.kind === LuaSyntaxKind.IdentifierExpression) {
		target = resolveIdentifier(root.name);
		if (!target) {
			return null;
		}
	} else {
		return null;
	}
	if (memberCount === 0) {
		return target;
	}
	const basePath = target.memberPath;
	const memberPath = new Array<string>(basePath.length + memberCount);
	for (let index = 0; index < basePath.length; index += 1) {
		memberPath[index] = basePath[index];
	}
	let memberIndex = memberPath.length - 1;
	let member = expression;
	while (member !== root) {
		if (member.kind === LuaSyntaxKind.MemberExpression) {
			memberPath[memberIndex] = member.member.name;
			member = member.base;
		} else {
			const indexMember = member as LuaIndexExpression;
			memberPath[memberIndex] = (indexMember.index as LuaStringLiteralExpression).value;
			member = indexMember.base;
		}
		memberIndex -= 1;
	}
	return { module: target.module, memberPath };
}

export function resolveModuleAliasValueSource(
	source: SemanticValueSource | undefined,
	aliasesByDeclaration: ReadonlyMap<string, ModuleAliasTarget>,
): ModuleAliasTarget | null {
	if (!source) {
		return null;
	}
	const steps = source.steps;
	let module: string;
	let basePath: readonly string[];
	if (source.root.kind === 'module') {
		module = source.root.module;
		basePath = EMPTY_MEMBER_PATH;
	} else if (source.root.kind === 'declaration') {
		const base = aliasesByDeclaration.get(source.root.declId);
		if (!base) {
			return null;
		}
		if (steps.length === 0) {
			return base;
		}
		module = base.module;
		basePath = base.memberPath;
	} else {
		return null;
	}
	if (steps.length === 0) {
		return { module, memberPath: EMPTY_MEMBER_PATH };
	}
	const memberPath = new Array<string>(basePath.length + steps.length);
	for (let index = 0; index < basePath.length; index += 1) {
		memberPath[index] = basePath[index];
	}
	for (let index = 0; index < steps.length; index += 1) {
		const step = steps[index];
		if (step.kind !== 'member') {
			return null;
		}
		memberPath[basePath.length + index] = step.name;
	}
	return { module, memberPath };
}
