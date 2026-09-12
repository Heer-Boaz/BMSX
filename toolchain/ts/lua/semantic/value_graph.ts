import type { FileSemanticData, SymbolID } from './model';
import {
	LuaBinaryOperator,
	LuaSyntaxKind,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaBooleanLiteralExpression,
	type LuaCallExpression,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaForNumericStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaNilLiteralExpression,
	type LuaNumericLiteralExpression,
	type LuaReturnStatement,
	type LuaStringLiteralExpression,
	type LuaTableConstructorExpression,
} from '../syntax/ast';
import type { LuaCompletion } from '../analysis/completion';

declare const ownedValueBrand: unique symbol;
export type OwnedValueID = number & { readonly [ownedValueBrand]: true };

export type OwnedValueRoot = {
	readonly kind: 'owned';
	readonly id: OwnedValueID;
	readonly syntax: LuaExpression;
	readonly role: 'expression' | 'receiver';
};

let nextOwnedValueId = 1;

export type SemanticLiteralValue =
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: number }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'nil'; value: null };

export type SemanticValueRoot =
	| { kind: 'declaration'; declId: SymbolID }
	| { kind: 'global'; symbolKey: string }
	| { kind: 'module'; module: string }
	| OwnedValueRoot
	| { kind: 'literal'; literal: SemanticLiteralValue }
	| { kind: 'unknown' };

export type SemanticValueStep =
	| { kind: 'member'; name: string }
	| { kind: 'index'; key: SemanticValueSource }
	| { kind: 'element' }
	| { kind: 'call' }
	| { kind: 'instance' }
	| { kind: 'metatable' };

export type SemanticValueSource = {
	root: SemanticValueRoot;
	steps: readonly SemanticValueStep[];
};

export type DeclarationSemanticValueSource = {
	root: { kind: 'declaration'; declId: SymbolID };
	steps: readonly [];
};

export type OwnedSemanticValueSource = {
	root: OwnedValueRoot;
	steps: readonly [];
};

export type FunctionSemanticValueSource = DeclarationSemanticValueSource | OwnedSemanticValueSource;

export type DeclarationValueRelation = 'value' | 'identity' | 'projection';

export type DeclarationValueEntry = {
	readonly declId: SymbolID;
	readonly source: SemanticValueSource;
	readonly relation: DeclarationValueRelation;
	readonly syntax: LuaLocalAssignmentStatement | LuaAssignmentStatement | LuaLocalFunctionStatement
		| LuaFunctionDeclarationStatement | LuaTableConstructorExpression | LuaForGenericStatement | LuaForNumericStatement;
	/** Target/field/iteration-variable index in the actual syntax, including implicit result lanes. */
	readonly index: number;
	/** Body containing the write; undefined means module evaluation, not declaration scope. */
	readonly flow: FunctionValueFlowEntry | undefined;
};

export type ModuleValueEntry = {
	readonly module: string;
	readonly source: SemanticValueSource;
	readonly statement: LuaReturnStatement;
	/** Written module returns that bypass this export site, not additional exports. */
	readonly bypassingReturns: readonly LuaReturnStatement[];
};

export type MemberValueEntry = {
	declId: SymbolID;
	name: string;
	owner: SemanticValueSource;
};

export type FunctionReturnValueEntry = {
	readonly statement: LuaReturnStatement;
	/** The value solver currently models the first return lane only. */
	readonly firstValue: SemanticValueSource;
};

export type FunctionValueFlowEntry = {
	readonly expression: LuaFunctionExpression;
	/** Named destination for hierarchy, not the identity of this function body. */
	readonly declaration: SymbolID | undefined;
	readonly functionValue: OwnedSemanticValueSource;
	readonly lexicalOwner?: FunctionValueFlowEntry;
	readonly parameters: readonly FunctionSemanticValueSource[];
	readonly receiverProjection?: SemanticValueSource;
	readonly implicitReceiver: boolean;
	readonly completion: LuaCompletion;
	readonly declarationIds: readonly SymbolID[];
	readonly ownedValues: readonly OwnedSemanticValueSource[];
	readonly members: readonly MemberValueEntry[];
	readonly calls: readonly CallValueEntry[];
	readonly assignments: readonly ValueAssignmentEntry[];
	readonly returns: readonly FunctionReturnValueEntry[];
};

export type CallValueEntry = {
	readonly expression: LuaCallExpression;
	callee: SemanticValueSource;
	arguments: readonly SemanticValueSource[];
	result?: OwnedSemanticValueSource;
};

export type ValueAssignmentEntry = {
	readonly target: SemanticValueSource;
	readonly source: SemanticValueSource;
	readonly relation: 'value' | 'metatable' | 'prototype';
	/** Actual source of the transfer; expression transfers are not storage writes. */
	readonly syntax: LuaAssignmentStatement | LuaFunctionDeclarationStatement | LuaTableConstructorExpression
		| LuaBinaryExpression | LuaCallExpression;
	/** Assignment target, constructor field, logical operand or builtin argument index. */
	readonly index: number;
};

export function declarationValueSource(declId: SymbolID): DeclarationSemanticValueSource {
	return {
		root: { kind: 'declaration', declId },
		steps: [],
	};
}

export function moduleValueSource(module: string): SemanticValueSource {
	return {
		root: { kind: 'module', module },
		steps: [],
	};
}

export function globalValueSource(symbolKey: string): SemanticValueSource {
	return {
		root: { kind: 'global', symbolKey },
		steps: [],
	};
}

export function literalValueSource(literal: SemanticLiteralValue): SemanticValueSource {
	return {
		root: { kind: 'literal', literal },
		steps: [],
	};
}

export const NIL_VALUE_SOURCE: SemanticValueSource = literalValueSource({ kind: 'nil', value: null });

/** Context-free AST literal conversion shared by binding and demand-only source reads. */
export function literalExpressionValueSource(expression: LuaNumericLiteralExpression | LuaStringLiteralExpression
	| LuaBooleanLiteralExpression | LuaNilLiteralExpression): SemanticValueSource {
	switch (expression.kind) {
		case LuaSyntaxKind.NumericLiteralExpression: return literalValueSource({ kind: 'number', value: expression.value });
		case LuaSyntaxKind.StringLiteralExpression: return literalValueSource({ kind: 'string', value: expression.value });
		case LuaSyntaxKind.BooleanLiteralExpression: return literalValueSource({ kind: 'boolean', value: expression.value });
		case LuaSyntaxKind.NilLiteralExpression: return NIL_VALUE_SOURCE;
	}
}

/** Written read identity, before may-value simplification; never rebind a name or evaluate a call. */
export function readLuaExpressionSource(file: FileSemanticData, expression: LuaExpression): SemanticValueSource {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression: {
			const reference = file.referencesBySyntax.get(expression)!;
			if (reference.referenceKind === 'member' || reference.referenceKind === 'method') {
				return appendValueMember(reference.receiverValue!, reference.name);
			}
			return reference.binding === undefined ? globalValueSource(reference.symbolKey) : reference.binding;
		}
		case LuaSyntaxKind.MemberExpression: {
			if (expression.member.kind === LuaSyntaxKind.MissingIdentifier) return unknownValueSource();
			const reference = file.referencesBySyntax.get(expression.member)!;
			return appendValueMember(reference.receiverValue!, reference.name);
		}
		case LuaSyntaxKind.IndexExpression:
		case LuaSyntaxKind.CallExpression:
			return file.readValuesBySyntax.get(expression)!;
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.TableConstructorExpression:
			return file.ownedValuesBySyntax.get(expression)!;
		case LuaSyntaxKind.BinaryExpression:
			return expression.operator === LuaBinaryOperator.And || expression.operator === LuaBinaryOperator.Or
				? file.ownedValuesBySyntax.get(expression)! : unknownValueSource();
		case LuaSyntaxKind.NilLiteralExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
			return literalExpressionValueSource(expression);
		case LuaSyntaxKind.UnaryExpression:
		case LuaSyntaxKind.VarargExpression:
		case LuaSyntaxKind.SizeOfExpression:
		case LuaSyntaxKind.OffsetOfExpression:
			return unknownValueSource();
	}
}

const UNKNOWN_VALUE_SOURCE: SemanticValueSource = { root: { kind: 'unknown' }, steps: [] };

export function unknownValueSource(): SemanticValueSource {
	return UNKNOWN_VALUE_SOURCE;
}

function semanticLiteralValueKey(literal: SemanticLiteralValue): string {
	switch (literal.kind) {
		case 'string':
			return `s\0${literal.value.length}\0${literal.value}`;
		case 'number':
			return `n\0${literal.value}`;
		case 'boolean':
			return literal.value ? 'b:true' : 'b:false';
		case 'nil':
			return 'nil';
	}
}

/** Bound once by the file producer; this is neither a value union nor a persistent editor id. */
export function ownedValueSource(syntax: LuaExpression, role: OwnedValueRoot['role']): OwnedSemanticValueSource {
	return {
		root: { kind: 'owned', id: nextOwnedValueId++ as OwnedValueID, syntax, role },
		steps: [],
	};
}

export function semanticValueRootKey(root: SemanticValueRoot): string {
	let key: string;
	switch (root.kind) {
		case 'declaration':
			key = `d\0${root.declId}`;
			break;
		case 'global':
			key = `g\0${root.symbolKey}`;
			break;
		case 'module':
			key = `m\0${root.module}`;
			break;
		case 'owned':
			key = `o\0${root.id}`;
			break;
		case 'literal':
			key = semanticLiteralValueKey(root.literal);
			break;
		case 'unknown':
			key = 'u';
			break;
	}
	return key;
}

export function semanticValueSourceKey(source: SemanticValueSource): string {
	let key = semanticValueRootKey(source.root);
	for (let index = 0; index < source.steps.length; index += 1) {
		const step = source.steps[index];
		switch (step.kind) {
			case 'member':
				key += `\0m\0${step.name}`;
				break;
			case 'index':
				key += `\0k\0${semanticValueSourceKey(step.key)}`;
				break;
			case 'element':
				key += '\0e';
				break;
			case 'call':
				key += '\0c';
				break;
			case 'instance':
				key += '\0i';
				break;
			case 'metatable':
				key += '\0t';
				break;
		}
	}
	return key;
}
export function appendValueMember(
	source: SemanticValueSource,
	name: string,
	stepCount = source.steps.length,
): SemanticValueSource {
	return appendValueStep(source, { kind: 'member', name }, stepCount);
}

export function appendValueElement(
	source: SemanticValueSource,
	stepCount = source.steps.length,
): SemanticValueSource {
	return appendValueStep(source, { kind: 'element' }, stepCount);
}

export function appendValueIndex(
	source: SemanticValueSource,
	key: SemanticValueSource,
	stepCount = source.steps.length,
): SemanticValueSource {
	return appendValueStep(source, { kind: 'index', key }, stepCount);
}

export function appendValueInstance(
	source: SemanticValueSource,
	stepCount = source.steps.length,
): SemanticValueSource {
	return appendValueStep(source, { kind: 'instance' }, stepCount);
}

export function appendValueMetatable(
	source: SemanticValueSource,
	stepCount = source.steps.length,
): SemanticValueSource {
	return appendValueStep(source, { kind: 'metatable' }, stepCount);
}

function appendValueStep(
	source: SemanticValueSource,
	step: SemanticValueStep,
	stepCount: number,
): SemanticValueSource {
	const steps = source.steps.slice(0, stepCount);
	steps.push(step);
	return {
		root: source.root,
		steps,
	};
}
export function semanticValueSourcesEqual(
	left: SemanticValueSource | undefined,
	right: SemanticValueSource | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right || left.root.kind !== right.root.kind || left.steps.length !== right.steps.length) {
		return false;
	}
	switch (left.root.kind) {
		case 'declaration':
			if (right.root.kind !== 'declaration' || left.root.declId !== right.root.declId) {
				return false;
			}
			break;
		case 'module':
			if (right.root.kind !== 'module' || left.root.module !== right.root.module) {
				return false;
			}
			break;
		case 'global':
			if (right.root.kind !== 'global' || left.root.symbolKey !== right.root.symbolKey) {
				return false;
			}
			break;
		case 'owned':
			if (right.root.kind !== 'owned' || left.root.id !== right.root.id) {
				return false;
			}
			break;
		case 'literal':
			if (right.root.kind !== 'literal'
				|| left.root.literal.kind !== right.root.literal.kind
				|| (left.root.literal.value !== right.root.literal.value
					&& !Object.is(left.root.literal.value, right.root.literal.value))) {
				return false;
			}
			break;
		case 'unknown':
			if (right.root.kind !== 'unknown') {
				return false;
			}
			break;
	}
	for (let index = 0; index < left.steps.length; index += 1) {
		const leftStep = left.steps[index];
		const rightStep = right.steps[index];
		if (leftStep.kind !== rightStep.kind) {
			return false;
		}
		if (leftStep.kind === 'member'
			&& (rightStep.kind !== 'member' || leftStep.name !== rightStep.name)) {
			return false;
		}
		if (leftStep.kind === 'index'
			&& (rightStep.kind !== 'index' || !semanticValueSourcesEqual(leftStep.key, rightStep.key))) {
			return false;
		}
	}
	return true;
}
export type WorkspaceValueFileFacts = {
	declarationValues: readonly DeclarationValueEntry[];
	moduleValues: readonly ModuleValueEntry[];
	/** Module writes; function writes stay in their function flows. */
	memberValues: readonly MemberValueEntry[];
	functionValueFlows: readonly FunctionValueFlowEntry[];
	callValues: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
};

export type WorkspaceValueFactsInput = {
	files: readonly WorkspaceValueFileFacts[];
	globalValues: ReadonlyMap<string, SymbolID>;
};
