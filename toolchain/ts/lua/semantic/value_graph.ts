import type { SymbolID } from './model';

export type SemanticLiteralValue =
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: number }
	| { kind: 'boolean'; value: boolean };

export type SemanticValueRoot =
	| { kind: 'declaration'; declId: SymbolID }
	| { kind: 'global'; symbolKey: string }
	| { kind: 'module'; module: string }
	| { kind: 'owned'; key: string }
	| { kind: 'literal'; key: string }
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
	root: { kind: 'owned'; key: string };
	steps: readonly [];
};

export type FunctionSemanticValueSource = DeclarationSemanticValueSource | OwnedSemanticValueSource;

export type DeclarationValueRelation = 'value' | 'identity' | 'projection';

export type DeclarationValueEntry = {
	declId: SymbolID;
	source: SemanticValueSource;
	relation: DeclarationValueRelation;
};

export type ModuleValueEntry = {
	module: string;
	source: SemanticValueSource;
};

export type MemberValueEntry = {
	declId: SymbolID;
	name: string;
	owner: SemanticValueSource;
};

export type FunctionReturnValueEntry = {
	functionValue: FunctionSemanticValueSource;
	source: SemanticValueSource;
};

export type FunctionValueFlowEntry = {
	functionValue: FunctionSemanticValueSource;
	lexicalOwner?: FunctionValueFlowEntry;
	parameters: readonly FunctionSemanticValueSource[];
	receiverProjection?: SemanticValueSource;
	implicitReceiver: boolean;
	declarationIds: readonly SymbolID[];
	ownedValueKeys: readonly string[];
	members: readonly MemberValueEntry[];
	calls: readonly CallValueEntry[];
	assignments: readonly ValueAssignmentEntry[];
};

export type CallValueEntry = {
	callee: SemanticValueSource;
	arguments: readonly (SemanticValueSource | undefined)[];
	result?: OwnedSemanticValueSource;
};

export type ValueAssignmentEntry = {
	target: SemanticValueSource;
	source: SemanticValueSource;
	relation: 'value' | 'metatable' | 'prototype';
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
		root: { kind: 'literal', key: semanticLiteralValueKey(literal) },
		steps: [],
	};
}

export function unknownValueSource(): SemanticValueSource {
	return {
		root: { kind: 'unknown' },
		steps: [],
	};
}

function semanticLiteralValueKey(literal: SemanticLiteralValue): string {
	switch (literal.kind) {
		case 'string':
			return `s\0${literal.value.length}\0${literal.value}`;
		case 'number':
			return `n\0${literal.value}`;
		case 'boolean':
			return literal.value ? 'b:true' : 'b:false';
	}
}

export function ownedValueSource(key: string): OwnedSemanticValueSource {
	return {
		root: { kind: 'owned', key },
		steps: [],
	};
}

export function moduleTableValueSource(module: string): OwnedSemanticValueSource {
	return ownedValueSource(`module-table:${module}`);
}

export function tableValueSource(file: string, line: number, column: number): OwnedSemanticValueSource {
	return ownedValueSource(`table:${file}|${line}|${column}`);
}

export function expressionValueSource(file: string, line: number, column: number): OwnedSemanticValueSource {
	return ownedValueSource(`expression:${file}|${line}|${column}`);
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
			key = `o\0${root.key}`;
			break;
		case 'literal':
			key = root.key;
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
			if (right.root.kind !== 'owned' || left.root.key !== right.root.key) {
				return false;
			}
			break;
		case 'literal':
			if (right.root.kind !== 'literal' || left.root.key !== right.root.key) {
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
	memberValues: readonly MemberValueEntry[];
	functionReturnValues: readonly FunctionReturnValueEntry[];
	functionValueFlows: readonly FunctionValueFlowEntry[];
	callValues: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
};

export type WorkspaceValueFactsInput = {
	files: readonly WorkspaceValueFileFacts[];
	globalValues: ReadonlyMap<string, SymbolID>;
};
