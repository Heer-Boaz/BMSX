import type { SymbolID } from './model';

declare const semanticValueBrand: unique symbol;

export type SemanticValueID = number & { readonly [semanticValueBrand]: true };

export type SemanticLiteralValue =
	| { kind: 'string'; value: string }
	| { kind: 'number'; value: number }
	| { kind: 'boolean'; value: boolean };

export type SemanticValueRoot =
	| { kind: 'declaration'; declId: SymbolID }
	| { kind: 'global'; symbolKey: string }
	| { kind: 'module'; module: string }
	| { kind: 'owned'; key: string }
	| { kind: 'literal'; key: string };

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

type FunctionEffectDependencyEntry = {
	flow: FunctionValueFlowEntry;
	source: SemanticValueSource;
	target: SemanticValueSource;
};

type FunctionMemberEffectEntry =
	| { flow: FunctionValueFlowEntry; kind: 'member'; member: MemberValueEntry }
	| { flow: FunctionValueFlowEntry; kind: 'assignment'; assignment: ValueAssignmentEntry };

type FunctionAssignmentEffectEntry = {
	flow: FunctionValueFlowEntry;
	assignment: ValueAssignmentEntry;
};

type StructuralValueStepKind = 'index' | 'element';

type MemberValue = {
	value: SemanticValueID;
	declaration?: SymbolID;
};

type MemberDeclaration = {
	id: SymbolID;
	order: number;
};

type MaterializedFunctionValueFlow = {
	source: FunctionValueFlowEntry;
	functionValue: SemanticValueID;
	parameters: readonly FunctionSemanticValueSource[];
	contextParameterIndices: readonly number[];
	requiresCallContext: boolean;
	requiresCallerContext: boolean;
	receiverProjection?: SemanticValueSource;
	implicitReceiver: boolean;
	declarationIds: readonly SymbolID[];
	ownedValueKeys: ReadonlySet<string>;
	members: readonly MemberValueEntry[];
	calls: readonly CallValueEntry[];
	assignments: readonly ValueAssignmentEntry[];
	assignmentsByTarget: ReadonlyMap<string, readonly ValueAssignmentEntry[]>;
	nestedFunctions: MaterializedFunctionValueFlow[];
	lexicalOwner?: MaterializedFunctionValueFlow;
};

type FunctionValueContext = {
	flow: MaterializedFunctionValueFlow;
	parameterValues: readonly SemanticValueID[];
	closure?: FunctionValueContext;
	callSite?: CallValueEntry;
	parentCallSite?: CallValueEntry;
	contextArguments: readonly (SemanticValueID | undefined)[];
	defaultContext: boolean;
	returnValue: SemanticValueID;
	localValues: Map<SymbolID, SemanticValueID>;
	resolvedLocals: Set<SymbolID>;
	ownedValues: Map<string, SemanticValueID>;
	callResults: Map<string, SemanticValueID>;
	callModes: Map<CallValueEntry, CallInstantiationMode>;
	materializedAssignments: Set<ValueAssignmentEntry>;
	returnsMaterialized: boolean;
	effectsMaterialized: boolean;
};

type ContextualCallValue = {
	call: CallValueEntry;
	context?: FunctionValueContext;
	mode: CallInstantiationMode;
	targetFlow?: MaterializedFunctionValueFlow;
	resolvedFlow?: MaterializedFunctionValueFlow;
};

type FunctionCallDemand = {
	call: CallValueEntry;
	mode: CallInstantiationMode;
	targetFlow?: MaterializedFunctionValueFlow;
};

type CallInstantiationMode = 0 | 1 | 2 | 3;

type ValueFlowTarget =
	| { kind: 'value'; value: SemanticValueID }
	| { kind: 'source'; source: SemanticValueSource; memberDeclId?: SymbolID };

type ValueFlowRelation = DeclarationValueRelation | 'metatable' | 'prototype';

type ValueFlowConstraint = {
	target: ValueFlowTarget;
	source: SemanticValueSource;
	relation: ValueFlowRelation;
	context?: FunctionValueContext;
};

const EMPTY_MEMBER_DECLARATIONS: readonly MemberDeclaration[] = [];
const EMPTY_MEMBER_IDS: readonly SymbolID[] = [];
const EMPTY_ARGUMENT_VALUES: readonly (SemanticValueID | undefined)[] = [];
const EMPTY_VALUE_STEPS: readonly SemanticValueStep[] = [];
const CALL_BINDINGS: CallInstantiationMode = 0;
const CALL_CONTEXT: CallInstantiationMode = 1;
const CALL_RETURNS: CallInstantiationMode = 2;
const CALL_EFFECTS: CallInstantiationMode = 3;
const INITIAL_VALUE_CAPACITY = 256;
const INITIAL_EDGE_CAPACITY = 256;

class SemanticValueEdges {
	private firstByOwner = new Uint32Array(INITIAL_VALUE_CAPACITY);
	private lastByOwner = new Uint32Array(INITIAL_VALUE_CAPACITY);
	private targets = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private nextEdges = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private previousEdges = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private edgeCount = 0;

	public resizeOwners(capacity: number): void {
		const firstByOwner = new Uint32Array(capacity);
		firstByOwner.set(this.firstByOwner);
		this.firstByOwner = firstByOwner;
		const lastByOwner = new Uint32Array(capacity);
		lastByOwner.set(this.lastByOwner);
		this.lastByOwner = lastByOwner;
	}

	public add(owner: SemanticValueID, target: SemanticValueID): boolean {
		for (let edge = this.firstByOwner[owner]; edge !== 0; edge = this.nextEdges[edge]) {
			if (this.targets[edge] === target) {
				return false;
			}
		}
		const edge = this.edgeCount + 1;
		this.edgeCount = edge;
		if (edge === this.targets.length) {
			const capacity = this.targets.length * 2;
			const targets = new Uint32Array(capacity);
			targets.set(this.targets);
			this.targets = targets;
			const nextEdges = new Uint32Array(capacity);
			nextEdges.set(this.nextEdges);
			this.nextEdges = nextEdges;
			const previousEdges = new Uint32Array(capacity);
			previousEdges.set(this.previousEdges);
			this.previousEdges = previousEdges;
		}
		const previous = this.lastByOwner[owner];
		this.targets[edge] = target;
		this.previousEdges[edge] = previous;
		if (previous === 0) {
			this.firstByOwner[owner] = edge;
		} else {
			this.nextEdges[previous] = edge;
		}
		this.lastByOwner[owner] = edge;
		return true;
	}

	public first(owner: SemanticValueID): number {
		return this.firstByOwner[owner];
	}

	public last(owner: SemanticValueID): number {
		return this.lastByOwner[owner];
	}

	public next(edge: number): number {
		return this.nextEdges[edge];
	}

	public previous(edge: number): number {
		return this.previousEdges[edge];
	}

	public target(edge: number): SemanticValueID {
		return this.targets[edge] as SemanticValueID;
	}

	public has(owner: SemanticValueID, target: SemanticValueID): boolean {
		for (let edge = this.firstByOwner[owner]; edge !== 0; edge = this.nextEdges[edge]) {
			if (this.targets[edge] === target) {
				return true;
			}
		}
		return false;
	}
}

class IndexWorklist<Value extends number> {
	private readonly values: Value[] = [];
	private readonly queued: boolean[] = [];
	private head = 0;

	public get length(): number {
		return this.values.length - this.head;
	}

	public add(value: Value): void {
		if (this.queued[value]) {
			return;
		}
		this.queued[value] = true;
		this.values.push(value);
	}

	public take(): Value {
		const value = this.values[this.head];
		this.head += 1;
		this.queued[value] = false;
		if (this.head === this.values.length) {
			this.values.length = 0;
			this.head = 0;
		}
		return value;
	}
}

class DependencyWorklist extends IndexWorklist<number> {
	private dependencyValues = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private itemIndices = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private nextByItem = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private nextByValue = new Uint32Array(INITIAL_EDGE_CAPACITY);
	private headByItem = new Uint32Array(INITIAL_VALUE_CAPACITY);
	private headByValue = new Uint32Array(INITIAL_VALUE_CAPACITY);
	private entryCount = 0;

	public resizeValues(capacity: number): void {
		const heads = new Uint32Array(capacity);
		heads.set(this.headByValue);
		this.headByValue = heads;
	}

	public retain(itemIndex: number, dependency: SemanticValueID): void {
		this.ensureItemCapacity(itemIndex);
		let link = this.headByItem[itemIndex];
		while (link !== 0) {
			const entryIndex = link - 1;
			if (this.dependencyValues[entryIndex] === dependency) {
				return;
			}
			link = this.nextByItem[entryIndex];
		}
		const entryIndex = this.entryCount;
		this.entryCount += 1;
		this.ensureEntryCapacity(this.entryCount);
		this.dependencyValues[entryIndex] = dependency;
		this.itemIndices[entryIndex] = itemIndex;
		this.nextByItem[entryIndex] = this.headByItem[itemIndex];
		this.nextByValue[entryIndex] = this.headByValue[dependency];
		this.headByItem[itemIndex] = entryIndex + 1;
		this.headByValue[dependency] = entryIndex + 1;
	}

	public queue(dependency: SemanticValueID): void {
		let link = this.headByValue[dependency];
		while (link !== 0) {
			const entryIndex = link - 1;
			this.add(this.itemIndices[entryIndex]);
			link = this.nextByValue[entryIndex];
		}
	}

	private ensureEntryCapacity(count: number): void {
		if (count <= this.dependencyValues.length) {
			return;
		}
		const capacity = this.dependencyValues.length * 2;
		const dependencyValues = new Uint32Array(capacity);
		dependencyValues.set(this.dependencyValues);
		this.dependencyValues = dependencyValues;
		const itemIndices = new Uint32Array(capacity);
		itemIndices.set(this.itemIndices);
		this.itemIndices = itemIndices;
		const nextByItem = new Uint32Array(capacity);
		nextByItem.set(this.nextByItem);
		this.nextByItem = nextByItem;
		const nextByValue = new Uint32Array(capacity);
		nextByValue.set(this.nextByValue);
		this.nextByValue = nextByValue;
	}

	private ensureItemCapacity(itemIndex: number): void {
		if (itemIndex < this.headByItem.length) {
			return;
		}
		let capacity = this.headByItem.length * 2;
		while (itemIndex >= capacity) {
			capacity *= 2;
		}
		const heads = new Uint32Array(capacity);
		heads.set(this.headByItem);
		this.headByItem = heads;
	}

}

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

function semanticValueRootsEqual(left: SemanticValueRoot, right: SemanticValueRoot): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	switch (left.kind) {
		case 'declaration':
			return right.kind === 'declaration' && left.declId === right.declId;
		case 'global':
			return right.kind === 'global' && left.symbolKey === right.symbolKey;
		case 'module':
			return right.kind === 'module' && left.module === right.module;
		case 'owned':
			return right.kind === 'owned' && left.key === right.key;
		case 'literal':
			return right.kind === 'literal' && left.key === right.key;
	}
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

function valueSourcePrefix(
	source: SemanticValueSource,
	stepCount: number,
): SemanticValueSource {
	return stepCount === source.steps.length
		? source
		: { root: source.root, steps: source.steps.slice(0, stepCount) };
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

function projectValueSource(
	source: SemanticValueSource,
	from: SemanticValueSource | undefined,
	to: SemanticValueSource | undefined,
): SemanticValueSource | undefined {
	if (!from
		|| !to
		|| from.steps.length > source.steps.length
		|| !semanticValueRootsEqual(from.root, source.root)) {
		return undefined;
	}
	for (let stepIndex = 0; stepIndex < from.steps.length; stepIndex += 1) {
		const left = from.steps[stepIndex];
		const right = source.steps[stepIndex];
		if (left.kind !== right.kind
			|| (left.kind === 'member' && (right.kind !== 'member' || left.name !== right.name))
			|| (left.kind === 'index'
				&& (right.kind !== 'index' || !semanticValueSourcesEqual(left.key, right.key)))) {
			return undefined;
		}
	}
	const steps = to.steps.slice();
	for (let stepIndex = from.steps.length; stepIndex < source.steps.length; stepIndex += 1) {
		steps.push(source.steps[stepIndex]);
	}
	return { root: to.root, steps };
}

export type WorkspaceValueFileInput = {
	declarationValues: readonly DeclarationValueEntry[];
	moduleValues: readonly ModuleValueEntry[];
	memberValues: readonly MemberValueEntry[];
	functionReturnValues: readonly FunctionReturnValueEntry[];
	functionValueFlows: readonly FunctionValueFlowEntry[];
	callValues: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
};

export type WorkspaceValueGraphInput = {
	files: readonly WorkspaceValueFileInput[];
	globalValues: ReadonlyMap<string, SymbolID>;
};

export class WorkspaceValueIdentityIndex {
	private readonly identityParents: Map<string, string> = new Map();
	private readonly identityRanks: Map<string, number> = new Map();
	private readonly moduleIdentities: Set<string> = new Set();
	private readonly sourceOwnedIdentities: Set<string> = new Set();
	private readonly membersByIdentity: Map<string, Map<string, SymbolID[]>> = new Map();
	private readonly inferredMemberNamesByIdentity: Map<string, Set<string>> = new Map();

	constructor(input: WorkspaceValueGraphInput) {
		const identityDeclarations = new Set<SymbolID>();
		const moduleValues = new Map<string, SemanticValueSource>();
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const file = input.files[fileIndex];
			for (let declarationIndex = 0; declarationIndex < file.declarationValues.length; declarationIndex += 1) {
				const entry = file.declarationValues[declarationIndex];
				if (entry.relation === 'identity') {
					identityDeclarations.add(entry.declId);
				}
			}
			for (let moduleIndex = 0; moduleIndex < file.moduleValues.length; moduleIndex += 1) {
				const entry = file.moduleValues[moduleIndex];
				moduleValues.set(entry.module, entry.source);
			}
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const declarations = input.files[fileIndex].declarationValues;
			for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
				const entry = declarations[declarationIndex];
				if (identityDeclarations.has(entry.declId) && entry.source.steps.length === 0) {
					this.union({ kind: 'declaration', declId: entry.declId }, entry.source.root);
				}
			}
		}
		for (const [module, source] of moduleValues) {
			if (source.steps.length === 0) {
				this.union({ kind: 'module', module }, source.root);
			}
		}
		for (const [symbolKey, declId] of input.globalValues) {
			this.union(
				{ kind: 'global', symbolKey },
				{ kind: 'declaration', declId },
			);
		}
		for (const module of moduleValues.keys()) {
			const identity = this.find(semanticValueRootKey({ kind: 'module', module }));
			this.moduleIdentities.add(identity);
			this.sourceOwnedIdentities.add(identity);
		}
		for (const symbolKey of input.globalValues.keys()) {
			this.sourceOwnedIdentities.add(this.find(semanticValueRootKey({ kind: 'global', symbolKey })));
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const declarations = input.files[fileIndex].declarationValues;
			for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
				const entry = declarations[declarationIndex];
				if (identityDeclarations.has(entry.declId)
					&& entry.source.steps.length === 0
					&& entry.source.root.kind === 'owned') {
					this.sourceOwnedIdentities.add(this.find(semanticValueRootKey(entry.source.root)));
				}
			}
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const members = input.files[fileIndex].memberValues;
			for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
				const member = members[memberIndex];
				const ownerIdentity = this.find(semanticValueRootKey(member.owner.root));
				if (member.owner.root.kind === 'owned') {
					this.sourceOwnedIdentities.add(ownerIdentity);
				}
				if (member.owner.steps.length !== 0) {
					const firstStep = member.owner.steps[0];
					if (this.moduleIdentities.has(ownerIdentity) && firstStep.kind === 'member') {
						let inferredNames = this.inferredMemberNamesByIdentity.get(ownerIdentity);
						if (!inferredNames) {
							inferredNames = new Set();
							this.inferredMemberNamesByIdentity.set(ownerIdentity, inferredNames);
						}
						inferredNames.add(firstStep.name);
					}
					continue;
				}
				let declaredMembers = this.membersByIdentity.get(ownerIdentity);
				if (!declaredMembers) {
					declaredMembers = new Map();
					this.membersByIdentity.set(ownerIdentity, declaredMembers);
				}
				let declarations = declaredMembers.get(member.name);
				if (!declarations) {
					declarations = [];
					declaredMembers.set(member.name, declarations);
				}
				declarations.push(member.declId);
			}
		}
	}

	public sourceKey(source: SemanticValueSource, stepCount = source.steps.length): string {
		let key = this.find(semanticValueRootKey(source.root));
		for (let index = 0; index < stepCount; index += 1) {
			const step = source.steps[index];
			switch (step.kind) {
				case 'member':
					key += `\0m\0${step.name}`;
					break;
				case 'index':
					key += `\0k\0${this.sourceKey(step.key)}`;
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

	public resolveStaticMembers(source: SemanticValueSource | undefined, name: string): readonly SymbolID[] | undefined {
		if (!source || source.steps.length !== 0) {
			return undefined;
		}
		const ownerIdentity = this.find(semanticValueRootKey(source.root));
		const direct = this.membersByIdentity.get(ownerIdentity)?.get(name);
		if (direct) {
			return direct;
		}
		if (!this.moduleIdentities.has(ownerIdentity)) {
			return source.root.kind === 'global' && !this.sourceOwnedIdentities.has(ownerIdentity)
				? EMPTY_MEMBER_IDS
				: undefined;
		}
		if (this.inferredMemberNamesByIdentity.get(ownerIdentity)?.has(name)) {
			return undefined;
		}
		return undefined;
	}

	private union(left: SemanticValueRoot, right: SemanticValueRoot): void {
		let leftKey = this.find(semanticValueRootKey(left));
		let rightKey = this.find(semanticValueRootKey(right));
		if (leftKey === rightKey) {
			return;
		}
		const leftRank = this.identityRanks.get(leftKey) ?? 0;
		const rightRank = this.identityRanks.get(rightKey) ?? 0;
		if (leftRank < rightRank) {
			const swap = leftKey;
			leftKey = rightKey;
			rightKey = swap;
		}
		this.identityParents.set(rightKey, leftKey);
		if (leftRank === rightRank) {
			this.identityRanks.set(leftKey, leftRank + 1);
		}
	}

	private find(key: string): string {
		let root = key;
		let parent = this.identityParents.get(root);
		while (parent !== undefined && parent !== root) {
			root = parent;
			parent = this.identityParents.get(root);
		}
		let current = key;
		parent = this.identityParents.get(current);
		while (parent !== undefined && parent !== root) {
			this.identityParents.set(current, root);
			current = parent;
			parent = this.identityParents.get(current);
		}
		return root;
	}
}

const EMPTY_DEMAND_ENTRIES = Object.freeze(new Array<never>());
const EMPTY_MEMBER_NAMES: ReadonlySet<string> = new Set();

class WorkspaceValueDemandIndex {
	public readonly declarationValues: Map<SymbolID, SemanticValueSource[]> = new Map();
	public readonly identityDeclarations: Set<SymbolID> = new Set();
	public readonly projectionDeclarations: Set<SymbolID> = new Set();
	public readonly moduleValues: Map<string, SemanticValueSource> = new Map();
	public readonly globalValues: ReadonlyMap<string, SymbolID>;
	private readonly identities: WorkspaceValueIdentityIndex;
	private readonly membersByOwner: Map<string, Map<string, MemberValueEntry[]>> = new Map();
	private readonly projectedMembersByOwner: Map<string, Map<string, MemberValueEntry[]>> = new Map();
	public readonly membersByDeclaration: Map<SymbolID, MemberValueEntry> = new Map();
	private readonly declarationsByValueSource: Map<string, SymbolID[]> = new Map();
	private readonly returnsByFunctionRoot: Map<string, FunctionReturnValueEntry[]> = new Map();
	private readonly flowsByRoot: Map<string, FunctionValueFlowEntry[]> = new Map();
	private readonly flowsByDeclaration: Map<SymbolID, FunctionValueFlowEntry[]> = new Map();
	private readonly callsByCalleeRoot: Map<string, CallValueEntry[]> = new Map();
	private readonly callsByCalleeMember: Map<string, CallValueEntry[]> = new Map();
	private readonly callsByCalleeSource: Map<string, CallValueEntry[]> = new Map();
	private readonly callsByArgumentRoot: Map<string, CallValueEntry[]> = new Map();
	private readonly callsByArgumentSource: Map<string, CallValueEntry[]> = new Map();
	private readonly callsByResultRoot: Map<string, CallValueEntry[]> = new Map();
	private readonly callerCallsByRoot: Map<string, CallValueEntry[]> = new Map();
	private readonly callerCallsByMember: Map<string, CallValueEntry[]> = new Map();
	private readonly callerCallsByCalleeSource: Map<string, CallValueEntry[]> = new Map();
	private readonly argumentCallerCallsByRoot: Map<string, CallValueEntry[]> = new Map();
	private readonly argumentCallerCallsBySource: Map<string, CallValueEntry[]> = new Map();
	private readonly resultCallerCallsByRoot: Map<string, CallValueEntry[]> = new Map();
	public readonly ownerFlowByCall: Map<CallValueEntry, FunctionValueFlowEntry> = new Map();
	private readonly assignmentsByTargetRoot: Map<string, ValueAssignmentEntry[]> = new Map();
	private readonly assignmentsByMemberOwner: Map<string, Map<string, ValueAssignmentEntry[]>> = new Map();
	private readonly memberNamesByOwner: Map<string, Set<string>> = new Map();
	private readonly memberEffectsByOwner: Map<string, Map<string, FunctionMemberEffectEntry[]>> = new Map();
	// The name index selects candidate writes only. Function-owned values stay
	// private to their contextual flow and therefore never enter this index.
	private readonly memberEffectsByName: Map<string, FunctionMemberEffectEntry[]> = new Map();
	private readonly indexedEffectsByOwner: Map<string, FunctionAssignmentEffectEntry[]> = new Map();
	private readonly elementEffectsByOwner: Map<string, FunctionAssignmentEffectEntry[]> = new Map();
	private readonly prototypeEffectFlowsByCallee: Map<string, FunctionValueFlowEntry[]> = new Map();
	private readonly effectDependenciesBySource: Map<string, FunctionEffectDependencyEntry[]> = new Map();
	private readonly instanceAllocationFlowsByMember:
		Map<string, FunctionValueFlowEntry[]> = new Map();

	constructor(input: WorkspaceValueGraphInput, identities: WorkspaceValueIdentityIndex) {
		this.globalValues = input.globalValues;
		this.identities = identities;
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const file = input.files[fileIndex];
			for (let entryIndex = 0; entryIndex < file.declarationValues.length; entryIndex += 1) {
				const entry = file.declarationValues[entryIndex];
				if (entry.relation === 'identity') {
					this.identityDeclarations.add(entry.declId);
				} else if (entry.relation === 'projection') {
					this.projectionDeclarations.add(entry.declId);
				}
				let sources = this.declarationValues.get(entry.declId);
				if (!sources) {
					sources = [];
					this.declarationValues.set(entry.declId, sources);
				}
				sources.push(entry.source);
				if (entry.relation !== 'identity' || entry.source.steps.length > 0) {
					this.append(
						this.declarationsByValueSource,
						this.identities.sourceKey(entry.source),
						entry.declId,
					);
				}
			}
			for (let entryIndex = 0; entryIndex < file.moduleValues.length; entryIndex += 1) {
				const entry = file.moduleValues[entryIndex];
				this.moduleValues.set(entry.module, entry.source);
			}
			for (let memberIndex = 0; memberIndex < file.memberValues.length; memberIndex += 1) {
				const member = file.memberValues[memberIndex];
				this.appendMember(
					this.membersByOwner,
					this.identities.sourceKey(member.owner),
					member.name,
					member,
				);
				this.membersByDeclaration.set(member.declId, member);
			}
			for (let returnIndex = 0; returnIndex < file.functionReturnValues.length; returnIndex += 1) {
				const entry = file.functionReturnValues[returnIndex];
				this.appendRoot(this.returnsByFunctionRoot, entry.functionValue.root, entry);
			}
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const flows = input.files[fileIndex].functionValueFlows;
			for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
				const flow = flows[flowIndex];
				this.indexInstanceAllocationMembers(flow);
				if (flow.functionValue.root.kind === 'declaration') {
					this.append(this.flowsByDeclaration, flow.functionValue.root.declId, flow);
				}
				const receiver = flow.parameters[0];
				if (flow.receiverProjection && receiver) {
					const members = this.membersByOwner.get(this.identities.sourceKey(flow.receiverProjection));
					if (members) {
						const projectedOwner = this.identities.sourceKey(receiver);
						for (const [name, entries] of members) {
							for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
								this.appendMember(
									this.projectedMembersByOwner,
									projectedOwner,
									name,
									entries[entryIndex],
								);
							}
						}
					}
				}
				this.appendRoot(this.flowsByRoot, flow.functionValue.root, flow);
				for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
					this.appendRoot(this.flowsByRoot, flow.parameters[parameterIndex].root, flow);
				}
				for (let declarationIndex = 0; declarationIndex < flow.declarationIds.length; declarationIndex += 1) {
					this.append(
						this.flowsByRoot,
						semanticValueRootKey({ kind: 'declaration', declId: flow.declarationIds[declarationIndex] }),
						flow,
					);
				}
				for (let ownedIndex = 0; ownedIndex < flow.ownedValueKeys.length; ownedIndex += 1) {
					this.append(
						this.flowsByRoot,
						semanticValueRootKey({ kind: 'owned', key: flow.ownedValueKeys[ownedIndex] }),
						flow,
					);
				}
				for (let callIndex = 0; callIndex < flow.calls.length; callIndex += 1) {
					const call = flow.calls[callIndex];
					this.ownerFlowByCall.set(call, flow);
					if (call.result) {
						this.appendRoot(this.resultCallerCallsByRoot, call.result.root, call);
					}
					this.indexSource(
						this.callerCallsByRoot,
						this.callerCallsByMember,
						call.callee,
						call,
					);
					this.append(
						this.callerCallsByCalleeSource,
						this.identities.sourceKey(call.callee),
						call,
					);
					const projectedCallee = projectValueSource(
						call.callee,
						flow.parameters[0],
						flow.receiverProjection,
					);
					if (projectedCallee) {
						this.append(
							this.callerCallsByCalleeSource,
							this.identities.sourceKey(projectedCallee),
							call,
						);
					}
					for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
						const argument = call.arguments[argumentIndex];
						if (argument) {
							this.indexSourceRoot(this.argumentCallerCallsByRoot, argument, call);
							this.append(
								this.argumentCallerCallsBySource,
								this.identities.sourceKey(argument),
								call,
							);
							const projectedArgument = projectValueSource(
								argument,
								flow.parameters[0],
								flow.receiverProjection,
							);
							if (projectedArgument) {
								this.indexSourceRoot(this.argumentCallerCallsByRoot, projectedArgument, call);
								this.append(
									this.argumentCallerCallsBySource,
									this.identities.sourceKey(projectedArgument),
									call,
								);
							}
						}
					}
				}
				for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
					const member = flow.members[memberIndex];
					this.indexMemberEffect(flow, member.owner, member.name, {
						flow,
						kind: 'member',
						member,
					});
					const sources = this.declarationValues.get(member.declId);
					if (sources) {
						const target = appendValueMember(member.owner, member.name);
						for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
							this.indexEffectDependency(flow, sources[sourceIndex], target);
						}
					}
				}
				for (let assignmentIndex = 0; assignmentIndex < flow.assignments.length; assignmentIndex += 1) {
					const assignment = flow.assignments[assignmentIndex];
					this.indexAssignmentFlowEffect(flow, assignment);
					if (assignment.relation === 'value') {
						this.indexEffectDependency(flow, assignment.source, assignment.target);
					} else {
						this.indexEffectDependency(flow, assignment.target, assignment.source);
					}
				}
			}
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const calls = input.files[fileIndex].callValues;
			for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
				const call = calls[callIndex];
				this.indexSource(
					this.callsByCalleeRoot,
					this.callsByCalleeMember,
					call.callee,
					call,
				);
				this.append(
					this.callsByCalleeSource,
					this.identities.sourceKey(call.callee),
					call,
				);
				for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
					const argument = call.arguments[argumentIndex];
					if (argument) {
						this.indexSourceRoot(this.callsByArgumentRoot, argument, call);
						this.append(
							this.callsByArgumentSource,
							this.identities.sourceKey(argument),
							call,
						);
					}
				}
				if (call.result) {
					this.appendRoot(this.callsByResultRoot, call.result.root, call);
				}
			}
		}
		for (let fileIndex = 0; fileIndex < input.files.length; fileIndex += 1) {
			const assignments = input.files[fileIndex].valueAssignments;
			for (let assignmentIndex = 0; assignmentIndex < assignments.length; assignmentIndex += 1) {
				const assignment = assignments[assignmentIndex];
				this.indexSourceRoot(this.assignmentsByTargetRoot, assignment.target, assignment);
				this.indexMemberTarget(this.assignmentsByMemberOwner, assignment.target, assignment);
			}
		}
	}

	public rootKey(root: SemanticValueRoot): string | undefined {
		if (root.kind !== 'global') {
			return semanticValueRootKey(root);
		}
		const declaration = this.globalValues.get(root.symbolKey);
		return declaration === undefined
			? undefined
			: semanticValueRootKey({ kind: 'declaration', declId: declaration });
	}

	public members(
		owner: SemanticValueSource,
		stepCount: number,
		name: string,
	): readonly MemberValueEntry[] {
		return this.membersByOwner.get(this.identities.sourceKey(owner, stepCount))?.get(name)
			?? EMPTY_DEMAND_ENTRIES;
	}

	public projectedMembers(
		owner: SemanticValueSource,
		stepCount: number,
		name: string,
	): readonly MemberValueEntry[] {
		return this.projectedMembersByOwner.get(this.identities.sourceKey(owner, stepCount))?.get(name)
			?? EMPTY_DEMAND_ENTRIES;
	}

	public returns(rootKey: string): readonly FunctionReturnValueEntry[] {
		return this.returnsByFunctionRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public declarationsForValue(
		source: SemanticValueSource,
		stepCount: number,
	): readonly SymbolID[] {
		return this.declarationsByValueSource.get(this.identities.sourceKey(source, stepCount))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public flows(rootKey: string): readonly FunctionValueFlowEntry[] {
		return this.flowsByRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public functionFlows(declId: SymbolID): readonly FunctionValueFlowEntry[] {
		return this.flowsByDeclaration.get(declId) ?? EMPTY_DEMAND_ENTRIES;
	}

	public calleeCalls(rootKey: string): readonly CallValueEntry[] {
		return this.callsByCalleeRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public calleeCallsByMemberName(name: string): readonly CallValueEntry[] {
		return this.callsByCalleeMember.get(name) ?? EMPTY_DEMAND_ENTRIES;
	}

	public calleeCallsForSource(source: SemanticValueSource): readonly CallValueEntry[] {
		return this.callsByCalleeSource.get(this.identities.sourceKey(source))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public argumentCalls(rootKey: string): readonly CallValueEntry[] {
		return this.callsByArgumentRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public argumentCallsForSource(source: SemanticValueSource): readonly CallValueEntry[] {
		return this.callsByArgumentSource.get(this.identities.sourceKey(source))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public resultCalls(rootKey: string): readonly CallValueEntry[] {
		return this.callsByResultRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public callerCalls(rootKey: string): readonly CallValueEntry[] {
		return this.callerCallsByRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public callerCallsByMemberName(name: string): readonly CallValueEntry[] {
		return this.callerCallsByMember.get(name) ?? EMPTY_DEMAND_ENTRIES;
	}

	public callerCallsForSource(source: SemanticValueSource): readonly CallValueEntry[] {
		return this.callerCallsByCalleeSource.get(this.identities.sourceKey(source))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public argumentCallerCalls(rootKey: string): readonly CallValueEntry[] {
		return this.argumentCallerCallsByRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public argumentCallerCallsForSource(source: SemanticValueSource): readonly CallValueEntry[] {
		return this.argumentCallerCallsBySource.get(this.identities.sourceKey(source))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public resultCallerCalls(rootKey: string): readonly CallValueEntry[] {
		return this.resultCallerCallsByRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public rootAssignments(rootKey: string): readonly ValueAssignmentEntry[] {
		return this.assignmentsByTargetRoot.get(rootKey) ?? EMPTY_DEMAND_ENTRIES;
	}

	public memberAssignments(
		owner: SemanticValueSource,
		stepCount: number,
		name: string,
	): readonly ValueAssignmentEntry[] {
		return this.assignmentsByMemberOwner.get(this.identities.sourceKey(owner, stepCount))?.get(name)
			?? EMPTY_DEMAND_ENTRIES;
	}

	public memberNames(
		owner: SemanticValueSource,
		stepCount: number,
	): ReadonlySet<string> {
		return this.memberNamesByOwner.get(this.identities.sourceKey(owner, stepCount))
			?? EMPTY_MEMBER_NAMES;
	}

	public hasMemberDemand(owner: SemanticValueSource, stepCount: number, name: string): boolean {
		const key = this.identities.sourceKey(owner, stepCount);
		return this.membersByOwner.get(key)?.has(name) === true
			|| this.projectedMembersByOwner.get(key)?.has(name) === true
			|| this.assignmentsByMemberOwner.get(key)?.has(name) === true;
	}

	public memberEffects(
		owner: SemanticValueSource,
		stepCount: number,
		name: string,
	): readonly FunctionMemberEffectEntry[] {
		return this.memberEffectsByOwner.get(this.identities.sourceKey(owner, stepCount))?.get(name)
			?? EMPTY_DEMAND_ENTRIES;
	}

	public namedMemberEffects(name: string): readonly FunctionMemberEffectEntry[] {
		return this.memberEffectsByName.get(name) ?? EMPTY_DEMAND_ENTRIES;
	}

	public assignmentEffects(
		kind: StructuralValueStepKind,
		owner: SemanticValueSource,
		stepCount: number,
	): readonly FunctionAssignmentEffectEntry[] {
		const effects = kind === 'index'
			? this.indexedEffectsByOwner
			: this.elementEffectsByOwner;
		return effects.get(this.identities.sourceKey(owner, stepCount))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public prototypeEffects(callee: SemanticValueSource): readonly FunctionValueFlowEntry[] {
		return this.prototypeEffectFlowsByCallee.get(this.identities.sourceKey(callee))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public effectDependencies(
		source: SemanticValueSource,
		stepCount: number,
	): readonly FunctionEffectDependencyEntry[] {
		return this.effectDependenciesBySource.get(this.identities.sourceKey(source, stepCount))
			?? EMPTY_DEMAND_ENTRIES;
	}

	public instanceAllocationFlows(name: string): readonly FunctionValueFlowEntry[] {
		return this.instanceAllocationFlowsByMember.get(name) ?? EMPTY_DEMAND_ENTRIES;
	}

	private indexInstanceAllocationMembers(flow: FunctionValueFlowEntry): void {
		const functionRootKey = this.rootKey(flow.functionValue.root);
		if (functionRootKey === undefined || this.returns(functionRootKey).length === 0) {
			return;
		}
		for (let assignmentIndex = 0; assignmentIndex < flow.assignments.length; assignmentIndex += 1) {
			const assignment = flow.assignments[assignmentIndex];
			if (assignment.relation !== 'prototype' || assignment.target.steps.length !== 0) {
				continue;
			}
			const allocationKey = this.identities.sourceKey(assignment.target);
			for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
				const member = flow.members[memberIndex];
				if (member.owner.steps.length === 0
					&& this.identities.sourceKey(member.owner) === allocationKey) {
					this.append(this.instanceAllocationFlowsByMember, member.name, flow);
				}
			}
		}
	}

	private indexMemberEffect(
		flow: FunctionValueFlowEntry,
		owner: SemanticValueSource,
		name: string,
		entry: FunctionMemberEffectEntry,
	): void {
		if (this.sourceIsExternalToFlow(flow, owner)) {
			this.append(this.memberEffectsByName, name, entry);
		}
		this.appendMember(
			this.memberEffectsByOwner,
			this.identities.sourceKey(owner),
			name,
			entry,
		);
		const receiver = flow.parameters[0];
		if (!flow.receiverProjection
			|| !receiver
			|| !semanticValueRootsEqual(owner.root, receiver.root)) {
			return;
		}
		const projectedOwner = projectValueSource(owner, receiver, flow.receiverProjection);
		if (!projectedOwner) {
			return;
		}
		this.appendMember(
			this.memberEffectsByOwner,
			this.identities.sourceKey(projectedOwner),
			name,
			entry,
		);
	}

	private sourceIsExternalToFlow(
		flow: FunctionValueFlowEntry,
		source: SemanticValueSource,
	): boolean {
		const rootKey = this.identities.sourceKey(source, 0);
		for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
			if (this.identities.sourceKey(flow.parameters[parameterIndex]) === rootKey) {
				return true;
			}
		}
		if (source.root.kind === 'declaration') {
			return !flow.declarationIds.includes(source.root.declId);
		}
		if (source.root.kind === 'owned') {
			return !flow.ownedValueKeys.includes(source.root.key);
		}
		return true;
	}

	private indexAssignmentFlowEffect(
		flow: FunctionValueFlowEntry,
		assignment: ValueAssignmentEntry,
	): void {
		const target = assignment.target;
		const stepCount = target.steps.length;
		const lastStep = target.steps[stepCount - 1];
		if (assignment.relation !== 'value') {
			this.indexPrototypeEffectFlow(flow);
			return;
		}
		if (!lastStep) {
			return;
		}
		const owner = valueSourcePrefix(target, stepCount - 1);
		if (lastStep.kind === 'member') {
			this.indexMemberEffect(
				flow,
				owner,
				lastStep.name,
				{ flow, kind: 'assignment', assignment },
			);
			return;
		}
		if (lastStep.kind !== 'index' && lastStep.kind !== 'element') {
			return;
		}
		const effects = lastStep.kind === 'index'
			? this.indexedEffectsByOwner
			: this.elementEffectsByOwner;
		const entry = { flow, assignment };
		this.append(
			effects,
			this.identities.sourceKey(owner),
			entry,
		);
		const projectedOwner = projectValueSource(
			owner,
			flow.parameters[0],
			flow.receiverProjection,
		);
		if (projectedOwner) {
			this.append(
				effects,
				this.identities.sourceKey(projectedOwner),
				entry,
			);
		}
	}

	private indexPrototypeEffectFlow(flow: FunctionValueFlowEntry): void {
		this.append(
			this.prototypeEffectFlowsByCallee,
			this.identities.sourceKey(flow.functionValue),
			flow,
		);
		if (flow.functionValue.root.kind !== 'declaration') {
			return;
		}
		const member = this.membersByDeclaration.get(flow.functionValue.root.declId);
		if (member) {
			this.append(
				this.prototypeEffectFlowsByCallee,
				this.identities.sourceKey(appendValueMember(member.owner, member.name)),
				flow,
			);
		}
	}

	private indexEffectDependency(
		flow: FunctionValueFlowEntry,
		source: SemanticValueSource,
		target: SemanticValueSource,
	): void {
		const entry = { flow, source, target };
		this.append(this.effectDependenciesBySource, this.identities.sourceKey(source), entry);
		const projectedSource = projectValueSource(
			source,
			flow.parameters[0],
			flow.receiverProjection,
		);
		if (projectedSource) {
			this.append(
				this.effectDependenciesBySource,
				this.identities.sourceKey(projectedSource),
				entry,
			);
		}
	}

	private indexMemberTarget<Entry>(
		index: Map<string, Map<string, Entry[]>>,
		target: SemanticValueSource,
		entry: Entry,
	): void {
		const stepCount = target.steps.length;
		if (stepCount === 0) {
			return;
		}
		const member = target.steps[stepCount - 1];
		if (member.kind === 'member') {
			this.appendMember(
				index,
				this.identities.sourceKey(target, stepCount - 1),
				member.name,
				entry,
			);
		}
	}

	private indexSource<Entry>(
		roots: Map<string, Entry[]>,
		members: Map<string, Entry[]>,
		source: SemanticValueSource,
		entry: Entry,
	): void {
		this.indexSourceRoot(roots, source, entry);
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			if (step.kind === 'member') {
				this.append(members, step.name, entry);
			} else if (step.kind === 'index') {
				this.indexSource(roots, members, step.key, entry);
			}
		}
	}

	private indexSourceRoot<Entry>(
		index: Map<string, Entry[]>,
		source: SemanticValueSource,
		entry: Entry,
	): void {
		const key = this.rootKey(source.root);
		if (key !== undefined) {
			this.append(index, key, entry);
		}
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			if (step.kind === 'index') {
				this.indexSourceRoot(index, step.key, entry);
			}
		}
	}

	private appendRoot<Entry>(index: Map<string, Entry[]>, root: SemanticValueRoot, entry: Entry): void {
		const key = this.rootKey(root);
		if (key !== undefined) {
			this.append(index, key, entry);
		}
	}

	private appendMember<Entry>(
		index: Map<string, Map<string, Entry[]>>,
		owner: string,
		name: string,
		entry: Entry,
	): void {
		let members = index.get(owner);
		if (!members) {
			members = new Map();
			index.set(owner, members);
		}
		let entries = members.get(name);
		if (!entries) {
			entries = [];
			members.set(name, entries);
			let namesByOwner = this.memberNamesByOwner.get(owner);
			if (!namesByOwner) {
				namesByOwner = new Set();
				this.memberNamesByOwner.set(owner, namesByOwner);
			}
			// One owner/name may be indexed as a declaration, projected member,
			// function effect, and assignment target.
			namesByOwner.add(name);
		}
		if (entries[entries.length - 1] !== entry) {
			entries.push(entry);
		}
	}

	private append<Entry>(index: Map<string, Entry[]>, key: string, entry: Entry): void {
		let entries = index.get(key);
		if (!entries) {
			entries = [];
			index.set(key, entries);
		}
		if (entries[entries.length - 1] !== entry) {
			entries.push(entry);
		}
	}
}

export class WorkspaceValueGraph {
	private readonly identities: WorkspaceValueIdentityIndex;
	private readonly demandIndex: WorkspaceValueDemandIndex;
	private readonly demandedRootKeys: Set<string> = new Set();
	private readonly demandedRoots: SemanticValueRoot[] = [];
	private demandedRootHead = 0;
	private readonly demandedEffectKeys: Set<string> = new Set();
	private readonly demandedEffectSources: SemanticValueSource[] = [];
	private readonly demandedEffectStepCounts: number[] = [];
	private readonly demandedEffectNames: string[] = [];
	private demandedEffectHead = 0;
	private readonly demandedEffectValues: SemanticValueID[] = [];
	private readonly demandedEffectValueNames: string[] = [];
	private demandedEffectValueHead = 0;
	private readonly pendingEffectDependencyContexts: FunctionValueContext[] = [];
	private readonly pendingEffectDependencyEntries: FunctionEffectDependencyEntry[] = [];
	private pendingEffectDependencyHead = 0;
	private readonly demandedMemberKeys: Set<string> = new Set();
	private readonly pendingMemberOwners: SemanticValueSource[] = [];
	private readonly pendingMemberStepCounts: number[] = [];
	private readonly pendingMemberNames: string[] = [];
	private pendingMemberHead = 0;
	private readonly materializedDeclarations: Set<SymbolID> = new Set();
	private readonly materializedModules: Set<string> = new Set();
	private readonly materializedMembers: Set<MemberValueEntry> = new Set();
	private readonly materializedProjectedMembers: Set<string> = new Set();
	private readonly materializedFunctionReturns: Set<FunctionReturnValueEntry> = new Set();
	private readonly materializedFunctionFlowsByEntry:
		Map<FunctionValueFlowEntry, MaterializedFunctionValueFlow> = new Map();
	private readonly materializedRootCallModes: Map<CallValueEntry, CallInstantiationMode> = new Map();
	private readonly materializedCallerModes: Map<CallValueEntry, CallInstantiationMode> = new Map();
	private readonly materializedTargetRootCallModes:
		Map<CallValueEntry, Map<MaterializedFunctionValueFlow, CallInstantiationMode>> = new Map();
	private readonly materializedTargetCallerModes:
		Map<CallValueEntry, Map<MaterializedFunctionValueFlow, CallInstantiationMode>> = new Map();
	private readonly resolvedCallTargets:
		Map<CallValueEntry, readonly FunctionValueFlowEntry[]> = new Map();
	private readonly materializedRootAssignments: Set<ValueAssignmentEntry> = new Set();
	private readonly demandedFunctionCallerBindings: Set<FunctionValueFlowEntry> = new Set();
	private readonly demandedFunctionCallerContexts: Set<FunctionValueFlowEntry> = new Set();
	private readonly refinedFunctionCallerContexts: Set<FunctionValueFlowEntry> = new Set();
	private readonly queuedFunctionCallerRefinements: Set<FunctionValueFlowEntry> = new Set();
	private readonly functionCallerRefinementQueue: MaterializedFunctionValueFlow[] = [];
	private readonly demandedFunctionCallerAliases: Set<FunctionValueFlowEntry> = new Set();
	private readonly demandedDynamicFunctionCallers: Set<FunctionValueFlowEntry> = new Set();
	private readonly calls: ContextualCallValue[] = [];
	private readonly declarationNodes: Map<SymbolID, SemanticValueID> = new Map();
	private readonly moduleNodes: Map<string, SemanticValueID> = new Map();
	private readonly literalNodes: Map<string, SemanticValueID> = new Map();
	private readonly ownedNodes: Map<string, SemanticValueID> = new Map();
	private readonly valueSourceHeads: number[] = [];
	private readonly valueSourceSources: SemanticValueSource[] = [];
	private readonly valueSourceStepCounts: number[] = [];
	private readonly valueSourceKeys: string[] = [];
	private readonly valueSourceContexts: (FunctionValueContext | undefined)[] = [];
	private readonly valueSourceNext: number[] = [];
	private readonly valueSourceBindingsByKey: Map<string, number[]> = new Map();
	private readonly materializedContextMembers: Map<FunctionValueContext, Set<MemberValueEntry>> = new Map();
	private readonly materializedNamedEffectMembers: Set<string> = new Set();
	private readonly demandedMemberEffectsByFlow:
		Map<MaterializedFunctionValueFlow, FunctionMemberEffectEntry[]> = new Map();
	private readonly demandedAssignmentEffectsByFlow:
		Map<MaterializedFunctionValueFlow, FunctionAssignmentEffectEntry[]> = new Map();
	private readonly demandedEffectDependenciesByFlow:
		Map<MaterializedFunctionValueFlow, FunctionEffectDependencyEntry[]> = new Map();
	private readonly demandedHeapEffectFlows: Set<MaterializedFunctionValueFlow> = new Set();
	private readonly demandedCallsByFlow: Map<MaterializedFunctionValueFlow, FunctionCallDemand[]> = new Map();
	private readonly materializedContextEffectDependencies: Map<FunctionValueContext, Set<FunctionEffectDependencyEntry>> = new Map();
	private readonly members: Map<SemanticValueID, Map<string, MemberValue>> = new Map();
	private readonly memberProjections: Map<SemanticValueID, Map<string, SemanticValueID>> = new Map();
	private readonly indexedValues: Map<SemanticValueID, Map<SemanticValueID, SemanticValueID>> = new Map();
	private readonly indexedProjections: Map<SemanticValueID, Map<SemanticValueID, SemanticValueID>> = new Map();
	private readonly elements: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly instances: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly metatables: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly metatableProjections: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly callResults: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly functionReturnsByValue: Map<SemanticValueID, SemanticValueSource[]> = new Map();
	private readonly functionFlowsByValue: Map<SemanticValueID, MaterializedFunctionValueFlow> = new Map();
	private readonly functionFlowByDeclaration: Map<SymbolID, MaterializedFunctionValueFlow> = new Map();
	private readonly functionFlowByOwnedValue: Map<string, MaterializedFunctionValueFlow> = new Map();
	private readonly enclosingFunctionFlowByValue: Map<SemanticValueID, MaterializedFunctionValueFlow> = new Map();
	private readonly functionClosuresByValue: Map<SemanticValueID, FunctionValueContext> = new Map();
	private readonly functionContextsByValue: Map<SemanticValueID, FunctionValueContext[]> = new Map();
	private readonly defaultFunctionContextsByValue: Map<SemanticValueID, FunctionValueContext> = new Map();
	private readonly identityValues = new SemanticValueEdges();
	private readonly identityParents: SemanticValueID[] = [];
	private readonly identitySizes: number[] = [];
	private readonly materializedValueTargets: boolean[] = [];
	private readonly memberDeclarationsByIdentityRoot: Map<SemanticValueID, MemberDeclaration[]> = new Map();
	private readonly memberResolutionCache: Map<SemanticValueID, Map<string, readonly SymbolID[]>> = new Map();
	private readonly resolvedMemberValues: Map<SemanticValueID, Map<string, SemanticValueID>> = new Map();
	private readonly hintedResolvedMemberValues: Map<SemanticValueID, Map<string, SemanticValueID>> = new Map();
	private readonly missingResolvedMemberValues: Map<SemanticValueID, Set<string>> = new Map();
	private readonly missingHintedResolvedMemberValues: Map<SemanticValueID, Set<string>> = new Map();
	private readonly elementsByIdentityRoot: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly projectionBases = new SemanticValueEdges();
	private readonly callArgumentBases = new SemanticValueEdges();
	private readonly valueBases = new SemanticValueEdges();
	private readonly effectDependents = new SemanticValueEdges();
	private readonly prototypeBases: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly instanceBases = new SemanticValueEdges();
	// Allocation-site fields belong to constructed values, not to their shared
	// prototype. Keeping this relation separate prevents sibling classes from
	// acquiring writes performed by an unrelated factory call.
	private readonly instanceAllocations = new SemanticValueEdges();
	private readonly traversalStack: SemanticValueID[] = [];
	private readonly traversalMarks: number[] = [];
	private readonly unresolvedMemberOwners: SemanticValueID[] = [];
	private readonly unresolvedMemberNames: string[] = [];
	private readonly unresolvedMemberValues: MemberValue[] = [];
	private readonly unresolvedMemberHeadByOwner: number[] = [];
	private readonly unresolvedMemberNext: number[] = [];
	private readonly callWorklist = new DependencyWorklist();
	private readonly valueFlowConstraints: ValueFlowConstraint[] = [];
	private readonly valueFlowWorklist = new DependencyWorklist();
	private readonly dependencyScratch: SemanticValueID[] = [];
	private readonly assignmentTargetScratch: SemanticValueID[] = [];
	private readonly assignmentOwnerScratch: SemanticValueID[] = [];
	private readonly assignmentKeyScratch: SemanticValueID[] = [];
	private readonly prototypeAlternativeScratch: SemanticValueID[] = [];
	private readonly valueAlternativeStack: SemanticValueID[] = [];
	private readonly valueAlternativeNodes: SemanticValueID[] = [];
	private readonly valueAlternativeMarks: number[] = [];
	private valueAlternativeGeneration = 0;
	private readonly demandedEffectNamesByValue: Map<SemanticValueID, string[]> = new Map();
	private readonly callArgumentValueScratch: (SemanticValueID | undefined)[] = [];
	private readonly contextOrigins: (SemanticValueID | undefined)[] = [];
	private readonly functionFlowScratch: MaterializedFunctionValueFlow[] = [];
	private readonly functionClosureScratch: (FunctionValueContext | undefined)[] = [];
	private readonly functionAliasQueue: SemanticValueSource[] = [];
	private readonly visitedFunctionAliases: Set<string> = new Set();
	private readonly indexedSourceScratch: SemanticValueSource[] = [];
	private readonly indexedSourceDeclarations: Set<SymbolID> = new Set();
	private readonly indexedSourceOwnedValues: Set<string> = new Set();
	private readonly indexedDependencyScratch: SemanticValueSource[] = [];
	private readonly indexedDependencyDeclarations: Set<SymbolID> = new Set();
	private readonly indexedDependencyCallResults: Set<string> = new Set();
	private readonly indexedParameterMarks: boolean[] = [];
	private readonly effectParameterMarks: boolean[] = [];
	private contextAnalysisRequiresReturnContext = false;
	private readonly memberValueScratch: SemanticValueID[] = [];
	private readonly memberValueIdentityScratch: boolean[] = [];
	private readonly memberNodeScratch: SemanticValueID[] = [];
	private readonly memberTraversalMarks: number[] = [];
	private readonly memberTraversalIdentityMarks: number[] = [];
	private memberTraversalGeneration = 0;
	private readonly elementValueScratch: SemanticValueID[] = [];
	private readonly elementValueIdentityScratch: boolean[] = [];
	private readonly elementNodeScratch: SemanticValueID[] = [];
	private readonly elementTraversalMarks: number[] = [];
	private readonly elementTraversalIdentityMarks: number[] = [];
	private elementTraversalGeneration = 0;
	private readonly indexValueScratch: SemanticValueID[] = [];
	private readonly indexValueIdentityScratch: boolean[] = [];
	private readonly indexNodeScratch: SemanticValueID[] = [];
	private readonly indexTraversalMarks: number[] = [];
	private readonly indexTraversalIdentityMarks: number[] = [];
	private readonly indexKeyScratch: SemanticValueID[] = [];
	private readonly indexKeyIdentityScratch: boolean[] = [];
	private readonly indexKeyStack: SemanticValueID[] = [];
	private readonly indexKeyStackIdentity: boolean[] = [];
	private readonly indexKeyMarks: number[] = [];
	private readonly indexKeyIdentityMarks: number[] = [];
	private indexTraversalGeneration = 0;
	private indexKeyGeneration = 0;
	private readonly metatableValueScratch: SemanticValueID[] = [];
	private readonly metatableNodeScratch: SemanticValueID[] = [];
	private readonly metatableMarks: number[] = [];
	private readonly metatableDeclaredMarks: number[] = [];
	private metatableGeneration = 0;
	// Reverse traversal dependencies select dirty owners while preserving the
	// resolver's deterministic materialization order.
	private readonly traversalDependents = new SemanticValueEdges();
	private readonly dirtyTraversalValues: IndexWorklist<SemanticValueID> = new IndexWorklist();
	private readonly dirtyPropagationStack: SemanticValueID[] = [];
	private readonly dirtyPropagationValues: SemanticValueID[] = [];
	private readonly dirtyPropagationMarks: number[] = [];
	private traversalGeneration = 0;
	private dirtyPropagationGeneration = 0;
	private nextValueId = 1;
	private valueCapacity = INITIAL_VALUE_CAPACITY;
	private nextMemberDeclarationOrder = 0;
	constructor(
		options: WorkspaceValueGraphInput,
		identities: WorkspaceValueIdentityIndex,
	) {
		this.identities = identities;
		this.demandIndex = new WorkspaceValueDemandIndex(options, identities);
	}

	public retainCallTarget(call: CallValueEntry, declId: SymbolID): boolean {
		const entries = this.demandIndex.functionFlows(declId);
		if (entries.length === 0) {
			return false;
		}
		const targets = this.resolvedCallTargets.get(call);
		if (!targets) {
			this.resolvedCallTargets.set(call, entries);
			for (let index = 0; index < entries.length; index += 1) {
				this.replayResolvedCallTarget(call, entries[index]);
			}
			return true;
		}
		let mergedTargets: FunctionValueFlowEntry[] | undefined;
		let changed = false;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (targets.includes(entry)) {
				continue;
			}
			if (!mergedTargets) {
				mergedTargets = targets.slice();
				this.resolvedCallTargets.set(call, mergedTargets);
			}
			mergedTargets.push(entry);
			changed = true;
			this.replayResolvedCallTarget(call, entry);
		}
		return changed;
	}

	private replayResolvedCallTarget(
		call: CallValueEntry,
		targetEntry: FunctionValueFlowEntry,
	): void {
		const ownerEntry = this.demandIndex.ownerFlowByCall.get(call);
		if (!ownerEntry) {
			const mode = this.materializedRootCallModes.get(call);
			if (mode !== undefined) {
				this.registerCall(
					call,
					undefined,
					mode,
					undefined,
					this.materializeFunctionFlow(targetEntry),
				);
			}
			return;
		}
		const ownerFlow = this.materializedFunctionFlowsByEntry.get(ownerEntry);
		if (!ownerFlow) {
			return;
		}
		const contexts = this.functionContextsByValue.get(ownerFlow.functionValue);
		if (!contexts) {
			return;
		}
		for (let index = 0; index < contexts.length; index += 1) {
			const context = contexts[index];
			const mode = context.callModes.get(call);
			if (mode !== undefined) {
				this.registerCall(
					call,
					context,
					mode,
					undefined,
					this.materializeFunctionFlow(targetEntry),
				);
			}
		}
	}

	public resolveMembers(
		source: SemanticValueSource | undefined,
		name: string,
	): readonly SymbolID[] {
		let members = this.resolveRetainedMembers(source, name);
		if (members.length > 0 || !source) {
			return members;
		}
		const flow = this.functionFlowForSource(source);
		const projectedSource = flow
			? projectValueSource(source, flow.parameters[0], flow.receiverProjection)
			: source;
		if (projectedSource && this.materializeInstanceAllocationCalls(projectedSource, name)) {
			this.solveDemandedValues();
			members = this.resolveRetainedMembers(source, name);
			if (members.length > 0) {
				return members;
			}
		}
		if (flow) {
			if (this.demandFunctionCallers(flow, flow.requiresCallContext, true)) {
				this.solveDemandedValues();
				members = this.resolveRetainedMembers(source, name);
				if (members.length > 0) {
					return members;
				}
			}
			if (!this.defaultFunctionContextsByValue.has(flow.functionValue)) {
				this.defaultFunctionContext(flow, CALL_RETURNS);
				this.solveDemandedValues();
				members = this.resolveRetainedMembers(source, name);
				if (members.length > 0) {
					return members;
				}
			}
			if (this.demandDynamicFunctionCallers(flow)) {
				this.solveDemandedValues();
				members = this.resolveRetainedMembers(source, name);
				if (members.length > 0) {
					return members;
				}
			}
		}
		if (this.materializeNamedQueryEffects(source, name)) {
			this.solveDemandedValues();
			members = this.resolveRetainedMembers(source, name);
			if (members.length > 0) {
				return members;
			}
		}
		if (this.discoverDemandedHeapEffectCallers()) {
			this.solveDemandedValues();
			members = this.resolveRetainedMembers(source, name);
			if (members.length > 0) {
				return members;
			}
		}
		if (this.refineDemandedHeapEffectCallers()) {
			this.solveDemandedValues();
			members = this.resolveRetainedMembers(source, name);
			if (members.length > 0) {
				return members;
			}
		}
		return EMPTY_MEMBER_IDS;
	}

	private materializeNamedQueryEffects(
		source: SemanticValueSource,
		name: string,
	): boolean {
		let changed = false;
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			if (step.kind === 'member') {
				changed = this.materializeNamedMemberEffects(step.name) || changed;
			}
		}
		return this.materializeNamedMemberEffects(name) || changed;
	}

	private materializeInstanceAllocationCalls(
		source: SemanticValueSource,
		queriedMemberName: string,
	): boolean {
		let allocationMemberName: string | undefined;
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			if (source.steps[stepIndex].kind === 'instance') {
				const member = source.steps[stepIndex + 1];
				allocationMemberName = member?.kind === 'member'
					? member.name
					: queriedMemberName;
				break;
			}
		}
		if (allocationMemberName === undefined) {
			return false;
		}
		let changed = false;
		const entries = this.demandIndex.instanceAllocationFlows(allocationMemberName);
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const flow = this.materializeFunctionFlow(entries[entryIndex]);
			changed = this.demandFunctionCallers(flow, true) || changed;
		}
		return changed;
	}

	public resolveRetainedMembers(
		source: SemanticValueSource | undefined,
		name: string,
	): readonly SymbolID[] {
		if (!source) {
			return EMPTY_MEMBER_IDS;
		}
		this.solveDemandedValues();
		this.demandMemberQuery(source, name);
		this.solveDemandedValues();
		let members = this.resolveDemandedMembers(source, name);
		if (members.length > 0) {
			return members;
		}
		const flow = this.functionFlowForSource(source);
		const receiverSource = flow
			? projectValueSource(source, flow.parameters[0], flow.receiverProjection)
			: undefined;
		const pendingEffects = this.demandSourceEffects(receiverSource ?? source, name);
		if (pendingEffects) {
			this.solveDemandedValues();
			members = this.resolveDemandedMembers(source, name);
			if (members.length > 0) {
				return members;
			}
		}
		return EMPTY_MEMBER_IDS;
	}

	public resolveAllMembers(source: SemanticValueSource): readonly SymbolID[] {
		this.solveDemandedValues();
		this.demandSource(source);
		this.materializeArgumentCallEffects(source);
		this.solveDemandedValues();

		const names: string[] = [];
		const retainedNames = new Set<string>();
		const declarations: SymbolID[] = [];
		const retainedDeclarations = new Set<SymbolID>();
		let processedNameCount = 0;
		while (true) {
			const owner = this.resolveSource(source, false, undefined, true);
			if (!owner) {
				return declarations;
			}
			this.collectResolvedMemberNames(
				owner,
				names,
				retainedNames,
			);
			if (processedNameCount === names.length) {
				return declarations;
			}
			const batchStart = processedNameCount;
			processedNameCount = names.length;
			const flow = this.functionFlowForSource(source);
			const receiverSource = flow
				? projectValueSource(source, flow.parameters[0], flow.receiverProjection)
				: undefined;
			const effectSource = receiverSource ?? source;
			this.materializePrototypeCallEffects(effectSource);
			// Enumeration already has receiver-specific names. Demand those exact
			// writes together instead of reopening the workspace-wide name index.
			for (let nameIndex = batchStart; nameIndex < processedNameCount; nameIndex += 1) {
				const name = names[nameIndex];
				this.demandMember(source, source.steps.length, name);
				this.demandSourceMemberEffects(effectSource, name);
			}
			this.solveDemandedValues();
			this.collectDemandedMembers(
				source,
				names,
				batchStart,
				processedNameCount,
				declarations,
				retainedDeclarations,
			);
		}
	}

	private collectDemandedMembers(
		source: SemanticValueSource,
		names: readonly string[],
		start: number,
		end: number,
		declarations: SymbolID[],
		retainedDeclarations: Set<SymbolID>,
	): void {
		let owner = this.resolveSource(source, false, undefined, true)!;
		let pending = false;
		for (let nameIndex = start; nameIndex < end; nameIndex += 1) {
			pending = this.demandResolvedMemberSources(owner, names[nameIndex]) || pending;
		}
		if (pending) {
			this.solveDemandedValues();
			owner = this.resolveSource(source, false, undefined, true)!;
		}
		for (let nameIndex = start; nameIndex < end; nameIndex += 1) {
			const members = this.findMembers(owner, names[nameIndex]);
			for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
				const member = members[memberIndex];
				if (!retainedDeclarations.has(member)) {
					retainedDeclarations.add(member);
					declarations.push(member);
				}
			}
		}
	}

	private materializeArgumentCallEffects(source: SemanticValueSource): void {
		const rootKey = this.demandIndex.rootKey(source.root);
		if (rootKey === undefined) {
			return;
		}
		const calls = this.demandIndex.argumentCalls(rootKey);
		for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
			const call = calls[callIndex];
			if (this.callUsesSource(call, source)) {
				this.materializeRootCall(call, CALL_EFFECTS);
			}
		}
	}

	private collectResolvedMemberNames(
		owner: SemanticValueID,
		names: string[],
		retainedNames: Set<string>,
	): void {
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		stack.push(owner);
		while (stack.length > 0) {
			const value = stack.pop()!;
			if (this.traversalMarks[value] === generation) {
				continue;
			}
			this.traversalMarks[value] = generation;
			const materializedMembers = this.members.get(value);
			if (materializedMembers) {
				for (const name of materializedMembers.keys()) {
					if (!retainedNames.has(name)) {
						retainedNames.add(name);
						names.push(name);
					}
				}
			}
			for (let link = this.valueSourceHeads[value]; link !== 0; link = this.valueSourceNext[link - 1]) {
				const bindingIndex = link - 1;
				const source = this.valueSourceSources[bindingIndex];
				const stepCount = this.valueSourceStepCounts[bindingIndex];
				const indexedNames = this.demandIndex.memberNames(source, stepCount);
				for (const name of indexedNames) {
					if (!retainedNames.has(name)) {
						retainedNames.add(name);
						names.push(name);
					}
				}
			}
			for (let edge = this.instanceAllocations.first(value); edge !== 0; edge = this.instanceAllocations.next(edge)) {
				stack.push(this.instanceAllocations.target(edge));
			}
			for (let edge = this.traversalDependents.last(value); edge !== 0; edge = this.traversalDependents.previous(edge)) {
				const dependent = this.traversalDependents.target(edge);
				if (this.callArgumentBases.has(dependent, value)) {
					stack.push(dependent);
				}
			}
			this.pushTraversalBases(stack, value);
		}
	}

	private demandSourceEffects(source: SemanticValueSource, name: string): boolean {
		this.materializePrototypeCallEffects(source);
		return this.demandSourceMemberEffects(source, name);
	}

	private demandSourceMemberEffects(source: SemanticValueSource, name: string): boolean {
		const root = this.resolveValueRoot(source.root);
		if (!root) {
			return this.demandEffectSource(source, source.steps.length, name);
		}
		let pending = this.demandResolvedEffects(root, name);
		for (let stepCount = 1; stepCount <= source.steps.length; stepCount += 1) {
			const value = this.resolveValueSteps(
				root,
				source.steps,
				false,
				undefined,
				stepCount,
				true,
				false,
			);
			if (value) {
				pending = this.demandResolvedEffects(value, name) || pending;
			}
		}
		return pending;
	}

	private functionFlowForSource(source: SemanticValueSource): MaterializedFunctionValueFlow | undefined {
		return source.root.kind === 'declaration'
			? this.functionFlowByDeclaration.get(source.root.declId)
			: source.root.kind === 'owned'
				? this.functionFlowByOwnedValue.get(source.root.key)
				: undefined;
	}

	private demandMemberQuery(source: SemanticValueSource, name: string): void {
		this.demandSource(source);
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			if (step.kind === 'member') {
				this.demandMember(source, stepIndex, step.name);
			}
		}
		this.demandMember(source, source.steps.length, name);
	}

	private resolveDemandedMembers(
		source: SemanticValueSource,
		name: string,
	): readonly SymbolID[] {
		let owner = this.resolveSource(source, false, undefined, true);
		while (this.hasPendingDemand()) {
			this.solveDemandedValues();
			owner = this.resolveSource(source, false, undefined, true);
		}
		if (!owner) {
			return EMPTY_MEMBER_IDS;
		}
		if (this.demandResolvedMemberSources(owner, name)) {
			this.solveDemandedValues();
			owner = this.resolveSource(source, false, undefined, true);
			if (!owner) {
				return EMPTY_MEMBER_IDS;
			}
		}
		return this.findMembers(owner, name);
	}

	private demandResolvedMemberSources(owner: SemanticValueID, name: string): boolean {
		let known = false;
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		stack.push(owner);
		while (stack.length > 0) {
			const value = stack.pop()!;
			if (this.traversalMarks[value] === generation) {
				continue;
			}
			this.traversalMarks[value] = generation;
			for (let link = this.valueSourceHeads[value]; link !== 0; link = this.valueSourceNext[link - 1]) {
				const bindingIndex = link - 1;
				const source = this.valueSourceSources[bindingIndex];
				const stepCount = this.valueSourceStepCounts[bindingIndex];
				if (this.demandIndex.hasMemberDemand(source, stepCount, name)) {
					known = true;
					this.demandMember(source, stepCount, name);
					this.materializeContextMembers(this.demandIndex.members(source, stepCount, name));
				}
				const context = this.valueSourceContexts[bindingIndex];
				if (context) {
					const contextualRoot = this.resolveContextualValueRoot(source.root, context, false);
					if (contextualRoot) {
						stack.push(contextualRoot);
					}
				}
			}
			for (let edge = this.instanceAllocations.first(value); edge !== 0; edge = this.instanceAllocations.next(edge)) {
				stack.push(this.instanceAllocations.target(edge));
			}
			this.pushTraversalBases(stack, value);
		}
		return known;
	}

	private demandResolvedEffects(owner: SemanticValueID, name: string): boolean {
		let names = this.demandedEffectNamesByValue.get(owner);
		if (!names) {
			names = [];
			this.demandedEffectNamesByValue.set(owner, names);
		}
		if (names.includes(name)) {
			return false;
		}
		names.push(name);
		this.demandedEffectValues.push(owner);
		this.demandedEffectValueNames.push(name);
		return true;
	}

	private materializeDemandedValueEffects(owner: SemanticValueID, name: string): void {
		const stack = this.traversalStack;
		stack.length = 0;
		this.pushEffectBases(stack, owner);
		for (let edge = this.effectDependents.last(owner); edge !== 0; edge = this.effectDependents.previous(edge)) {
			stack.push(this.effectDependents.target(edge));
		}
		for (let index = 0; index < stack.length; index += 1) {
			this.demandResolvedEffects(stack[index], name);
		}
		for (let link = this.valueSourceHeads[owner]; link !== 0; link = this.valueSourceNext[link - 1]) {
				const bindingIndex = link - 1;
				const source = this.valueSourceSources[bindingIndex];
				this.demandEffectSource(
					source,
					this.valueSourceStepCounts[bindingIndex],
					name,
				);
				const context = this.valueSourceContexts[bindingIndex];
				if (context) {
					const contextualRoot = this.resolveContextualValueRoot(source.root, context, false);
					if (contextualRoot) {
						this.demandResolvedEffects(contextualRoot, name);
					}
				}
		}
	}

	private pushEffectBases(stack: SemanticValueID[], value: SemanticValueID): void {
		for (let edge = this.identityValues.last(value); edge !== 0; edge = this.identityValues.previous(edge)) {
			stack.push(this.identityValues.target(edge));
		}
		for (let edge = this.callArgumentBases.last(value); edge !== 0; edge = this.callArgumentBases.previous(edge)) {
			stack.push(this.callArgumentBases.target(edge));
		}
		for (let edge = this.valueBases.last(value); edge !== 0; edge = this.valueBases.previous(edge)) {
			stack.push(this.valueBases.target(edge));
		}
	}

	private demandSource(source: SemanticValueSource): void {
		this.demandRoot(source.root);
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			switch (step.kind) {
				case 'member':
					this.demandMember(source, stepIndex, step.name);
					break;
				case 'index':
					this.materializeSourceAssignmentEffects('index', source, stepIndex);
					this.demandSource(step.key);
					break;
				case 'element':
					this.materializeSourceAssignmentEffects('element', source, stepIndex);
					break;
				case 'call':
				case 'instance':
				case 'metatable':
					break;
			}
		}
	}

	private demandRoot(root: SemanticValueRoot): void {
		if (root.kind === 'global') {
			const declaration = this.demandIndex.globalValues.get(root.symbolKey);
			if (declaration === undefined) {
				return;
			}
			this.demandRoot({ kind: 'declaration', declId: declaration });
			return;
		}
		const key = semanticValueRootKey(root);
		if (this.demandedRootKeys.has(key)) {
			return;
		}
		this.demandedRootKeys.add(key);
		this.demandedRoots.push(root);
	}

	private demandEffectSource(
		source: SemanticValueSource,
		stepCount: number,
		name: string,
	): boolean {
		if (source.root.kind === 'global') {
			const declaration = this.demandIndex.globalValues.get(source.root.symbolKey);
			if (declaration === undefined) {
				return false;
			}
			return this.demandEffectSource({
				root: { kind: 'declaration', declId: declaration },
				steps: source.steps,
			}, stepCount, name);
		}
		const key = `${this.identities.sourceKey(source, stepCount)}\0${name}`;
		if (this.demandedEffectKeys.has(key)) {
			return false;
		}
		this.demandSource(valueSourcePrefix(source, stepCount));
		this.demandedEffectKeys.add(key);
		this.demandedEffectSources.push(source);
		this.demandedEffectStepCounts.push(stepCount);
		this.demandedEffectNames.push(name);
		return true;
	}

	private demandMember(source: SemanticValueSource, stepCount: number, name: string): boolean {
		if (!this.demandIndex.hasMemberDemand(source, stepCount, name)) {
			return false;
		}
		return this.queueMemberDemand(source, stepCount, name);
	}

	private queueMemberDemand(source: SemanticValueSource, stepCount: number, name: string): boolean {
		const key = `${this.identities.sourceKey(source, stepCount)}\0${name}`;
		if (this.demandedMemberKeys.has(key)) {
			return false;
		}
		this.demandedMemberKeys.add(key);
		this.pendingMemberOwners.push(source);
		this.pendingMemberStepCounts.push(stepCount);
		this.pendingMemberNames.push(name);
		return true;
	}

	private solveDemandedValues(): void {
		do {
			while (this.demandedRootHead < this.demandedRoots.length) {
				this.materializeDemandedRoot(this.demandedRoots[this.demandedRootHead]);
				this.demandedRootHead += 1;
			}
			while (this.pendingEffectDependencyHead < this.pendingEffectDependencyContexts.length) {
				this.materializeContextEffectDependency(
					this.pendingEffectDependencyContexts[this.pendingEffectDependencyHead],
					this.pendingEffectDependencyEntries[this.pendingEffectDependencyHead],
				);
				this.pendingEffectDependencyHead += 1;
			}
			while (this.demandedEffectHead < this.demandedEffectSources.length) {
				this.materializeDemandedEffects(
					this.demandedEffectSources[this.demandedEffectHead],
					this.demandedEffectStepCounts[this.demandedEffectHead],
					this.demandedEffectNames[this.demandedEffectHead],
				);
				this.demandedEffectHead += 1;
			}
			while (this.demandedEffectValueHead < this.demandedEffectValues.length) {
				this.materializeDemandedValueEffects(
					this.demandedEffectValues[this.demandedEffectValueHead],
					this.demandedEffectValueNames[this.demandedEffectValueHead],
				);
				this.demandedEffectValueHead += 1;
			}
			while (this.pendingMemberHead < this.pendingMemberOwners.length) {
				this.materializeDemandedMember(
					this.pendingMemberOwners[this.pendingMemberHead],
					this.pendingMemberStepCounts[this.pendingMemberHead],
					this.pendingMemberNames[this.pendingMemberHead],
				);
				this.pendingMemberHead += 1;
			}
			this.solveValueChanges();
		} while (this.demandedRootHead < this.demandedRoots.length
			|| this.pendingEffectDependencyHead < this.pendingEffectDependencyContexts.length
			|| this.demandedEffectHead < this.demandedEffectSources.length
			|| this.demandedEffectValueHead < this.demandedEffectValues.length
			|| this.pendingMemberHead < this.pendingMemberOwners.length);
	}

	private hasPendingDemand(): boolean {
		return this.demandedRootHead < this.demandedRoots.length
			|| this.pendingEffectDependencyHead < this.pendingEffectDependencyContexts.length
			|| this.demandedEffectHead < this.demandedEffectSources.length
			|| this.demandedEffectValueHead < this.demandedEffectValues.length
			|| this.pendingMemberHead < this.pendingMemberOwners.length;
	}

	private materializeDemandedRoot(root: SemanticValueRoot): void {
		const rootKey = semanticValueRootKey(root);
		switch (root.kind) {
			case 'declaration':
				this.materializeDeclaration(root);
				break;
			case 'module':
				this.materializeModule(root);
				break;
			case 'owned':
			case 'literal':
				break;
			case 'global':
				return;
		}
		this.materializeFunctionFlows(this.demandIndex.flows(rootKey));
		this.materializeRootCalls(this.demandIndex.resultCalls(rootKey));
		this.materializeCallerCalls(
			this.demandIndex.resultCallerCalls(rootKey),
			CALL_RETURNS,
		);
		this.materializeValueAssignments(this.demandIndex.rootAssignments(rootKey));
	}

	private materializeDemandedEffects(
		source: SemanticValueSource,
		stepCount: number,
		name: string,
	): void {
		// Open-world point queries materialize their name candidates in
		// demandQueryMember. This queue retains only source-specific effects.
		this.materializeEffectDependencies(
			this.demandIndex.effectDependencies(source, stepCount),
		);
		this.materializeMemberEffects(
			this.demandIndex.memberEffects(source, stepCount, name),
		);
	}

	private materializeNamedMemberEffects(name: string): boolean {
		if (this.materializedNamedEffectMembers.has(name)) {
			return false;
		}
		this.materializedNamedEffectMembers.add(name);
		const entries = this.demandIndex.namedMemberEffects(name);
		this.materializeMemberEffects(entries);
		return entries.length > 0;
	}

	private materializeEffectDependencies(
		entries: readonly FunctionEffectDependencyEntry[],
	): void {
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			const flow = this.materializeFunctionFlow(entry.flow);
			this.retainFlowDemand(this.demandedEffectDependenciesByFlow, flow, entry);
			this.demandedHeapEffectFlows.add(flow);
			if (!flow.requiresCallContext
				&& !this.functionContextsByValue.has(flow.functionValue)) {
				this.defaultFunctionContext(flow, CALL_CONTEXT);
			}
			const contexts = this.functionContextsByValue.get(flow.functionValue);
			if (contexts) {
				for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
					this.registerContextEffectDependency(contexts[contextIndex], entry);
				}
			}
		}
	}

	private materializeMemberEffects(
		entries: readonly FunctionMemberEffectEntry[],
	): void {
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			this.demandMemberEffectOwner(entry);
			const contexts = this.demandHeapEffectContexts(
				this.demandedMemberEffectsByFlow,
				entry,
				entry.flow,
			);
			if (contexts) {
				for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
					this.materializeContextMemberEffect(contexts[contextIndex], entry);
				}
			}
		}
	}

	private demandMemberEffectOwner(entry: FunctionMemberEffectEntry): void {
		const source = entry.kind === 'member'
			? entry.member.owner
			: valueSourcePrefix(entry.assignment.target, entry.assignment.target.steps.length - 1);
		this.demandSource(source);
		for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
			const step = source.steps[stepIndex];
			if (step.kind === 'member') {
				this.demandMember(source, stepIndex, step.name);
			}
		}
	}

	private materializeContextMemberEffect(
		context: FunctionValueContext,
		entry: FunctionMemberEffectEntry,
	): void {
		if (entry.kind === 'member') {
			this.materializeContextMember(context, entry.member);
		} else {
			this.materializeContextAssignment(context, entry.assignment);
		}
	}

	private materializeDemandedMember(
		owner: SemanticValueSource,
		stepCount: number,
		name: string,
	): void {
		const members = this.demandIndex.members(owner, stepCount, name);
		const projectedMembers = this.demandIndex.projectedMembers(owner, stepCount, name);
		const assignments = this.demandIndex.memberAssignments(owner, stepCount, name);
		this.materializeMembers(members);
		this.materializeContextMembers(members);
		this.materializeProjectedMembers(owner, stepCount, name, projectedMembers);
		this.materializeValueAssignments(assignments);
	}

	private materializeAssignmentEffects(entries: readonly FunctionAssignmentEffectEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const contexts = this.demandHeapEffectContexts(
				this.demandedAssignmentEffectsByFlow,
				entry,
				entry.flow,
			);
			if (contexts) {
				for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
					this.materializeContextAssignment(contexts[contextIndex], entry.assignment);
				}
			}
		}
	}

	private demandHeapEffectContexts<Entry>(
		demandsByFlow: Map<MaterializedFunctionValueFlow, Entry[]>,
		entry: Entry,
		entryFlow: FunctionValueFlowEntry,
	): readonly FunctionValueContext[] | undefined {
		const flow = this.materializeFunctionFlow(entryFlow);
		this.retainFlowDemand(demandsByFlow, flow, entry);
		this.demandedHeapEffectFlows.add(flow);
		let contexts = this.functionContextsByValue.get(flow.functionValue);
		if ((!contexts || contexts.length === 0) && !flow.requiresCallContext) {
			this.defaultFunctionContext(flow, CALL_CONTEXT);
			contexts = this.functionContextsByValue.get(flow.functionValue);
		}
		return contexts;
	}

	private discoverDemandedHeapEffectCallers(): boolean {
		let changed = false;
		for (const flow of this.demandedHeapEffectFlows) {
			// First instantiate the call in its owner's retained summary. Most
			// queries resolve here without replaying the owner's own callers.
			changed = this.demandFunctionCallers(flow, flow.requiresCallContext) || changed;
			changed = this.demandDynamicFunctionCallers(flow) || changed;
		}
		return changed;
	}

	private refineDemandedHeapEffectCallers(): boolean {
		const queue = this.functionCallerRefinementQueue;
		queue.length = 0;
		this.queuedFunctionCallerRefinements.clear();
		for (const flow of this.demandedHeapEffectFlows) {
			this.enqueueFunctionCallerRefinement(flow);
		}
		let changed = false;
		for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
			const flow = queue[queueIndex];
			// A remaining miss requires call-site identity for the retained heap
			// effect. The worklist visits only context-bearing caller summaries
			// reached from the demanded calls, not the workspace call graph.
			changed = this.demandFunctionCallers(
				flow,
				flow.requiresCallContext,
				false,
				true,
			) || changed;
		}
		return changed;
	}

	private enqueueFunctionCallerRefinement(flow: MaterializedFunctionValueFlow): void {
		if (this.queuedFunctionCallerRefinements.has(flow.source)) {
			return;
		}
		this.queuedFunctionCallerRefinements.add(flow.source);
		this.functionCallerRefinementQueue.push(flow);
	}

	private retainFlowDemand<Entry>(
		demandsByFlow: Map<MaterializedFunctionValueFlow, Entry[]>,
		flow: MaterializedFunctionValueFlow,
		entry: Entry,
	): void {
		let demands = demandsByFlow.get(flow);
		if (!demands) {
			demands = [];
			demandsByFlow.set(flow, demands);
		}
		if (!demands.includes(entry)) {
			demands.push(entry);
		}
	}

	private applyDemandedContextSlices(context: FunctionValueContext): void {
		// A query may discover the relevant write or nested call before any caller
		// context exists. Retained slices are applied when that context is created;
		// unrelated statements in the same function remain unmaterialized.
		const flow = context.flow;
		const calls = this.demandedCallsByFlow.get(flow);
		if (calls) {
			for (let index = 0; index < calls.length; index += 1) {
				this.materializeContextCallDemand(context, calls[index]);
			}
		}
		const memberEffects = this.demandedMemberEffectsByFlow.get(flow);
		if (memberEffects) {
			for (let index = 0; index < memberEffects.length; index += 1) {
				this.materializeContextMemberEffect(context, memberEffects[index]);
			}
		}
		const assignmentEffects = this.demandedAssignmentEffectsByFlow.get(flow);
		if (assignmentEffects) {
			for (let index = 0; index < assignmentEffects.length; index += 1) {
				this.materializeContextAssignment(context, assignmentEffects[index].assignment);
			}
		}
		const dependencies = this.demandedEffectDependenciesByFlow.get(flow);
		if (dependencies) {
			for (let index = 0; index < dependencies.length; index += 1) {
				this.registerContextEffectDependency(context, dependencies[index]);
			}
		}
	}

	private materializeSourceAssignmentEffects(
		kind: StructuralValueStepKind,
		source: SemanticValueSource,
		stepCount: number,
	): void {
		this.materializeAssignmentEffects(this.demandIndex.assignmentEffects(kind, source, stepCount));
		const rootKey = this.demandIndex.rootKey(source.root);
		if (rootKey === undefined) {
			return;
		}
		const flows = this.demandIndex.flows(rootKey);
		const prefix = valueSourcePrefix(source, stepCount);
		for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
			const flow = flows[flowIndex];
			const projected = projectValueSource(
				prefix,
				flow.parameters[0],
				flow.receiverProjection,
			);
			if (projected) {
				this.materializeAssignmentEffects(
					this.demandIndex.assignmentEffects(kind, projected, projected.steps.length),
				);
			}
		}
	}

	private materializePrototypeCallEffects(source: SemanticValueSource): void {
		const rootKey = semanticValueRootKey(source.root);
		const rootCalls = this.demandIndex.argumentCalls(rootKey);
		for (let callIndex = 0; callIndex < rootCalls.length; callIndex += 1) {
			const call = rootCalls[callIndex];
			if (this.demandIndex.prototypeEffects(call.callee).length > 0
				&& this.callUsesSource(call, source)) {
				this.materializeRootCall(call, CALL_EFFECTS);
			}
		}
		const callerCalls = this.demandIndex.argumentCallerCalls(rootKey);
		for (let callIndex = 0; callIndex < callerCalls.length; callIndex += 1) {
			const call = callerCalls[callIndex];
			const owner = this.demandIndex.ownerFlowByCall.get(call);
			if (owner
				&& this.demandIndex.prototypeEffects(call.callee).length > 0
				&& this.callUsesSource(call, source, owner)) {
				this.materializeCallerCall(call, CALL_EFFECTS);
			}
		}
	}

	private callUsesSource(
		call: CallValueEntry,
		source: SemanticValueSource,
		owner?: FunctionValueFlowEntry,
	): boolean {
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			const argument = call.arguments[argumentIndex];
			if (!argument) {
				continue;
			}
			if (argument.steps.length <= source.steps.length
				&& this.identities.sourceKey(argument)
					=== this.identities.sourceKey(source, argument.steps.length)) {
				return true;
			}
			const projectedArgument = owner
				? projectValueSource(argument, owner.parameters[0], owner.receiverProjection)
				: undefined;
			if (projectedArgument
				&& projectedArgument.steps.length <= source.steps.length
				&& this.identities.sourceKey(projectedArgument)
					=== this.identities.sourceKey(source, projectedArgument.steps.length)) {
				return true;
			}
		}
		return false;
	}

	private materializeDeclaration(root: Extract<SemanticValueRoot, { kind: 'declaration' }>): void {
		const declId = root.declId;
		if (this.materializedDeclarations.has(declId)) {
			return;
		}
		this.materializedDeclarations.add(declId);
		const sources = this.demandIndex.declarationValues.get(declId);
		if (!sources) {
			return;
		}
		const target = this.nodeForRoot(root);
		const relation: DeclarationValueRelation = this.demandIndex.identityDeclarations.has(declId)
			? 'identity'
			: this.demandIndex.projectionDeclarations.has(declId)
				? 'projection'
				: 'value';
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
			const source = sources[sourceIndex];
			this.demandSource(source);
			this.registerValueConstraint({
				target: { kind: 'value', value: target },
				source,
				relation,
			});
		}
	}

	private materializeModule(root: Extract<SemanticValueRoot, { kind: 'module' }>): void {
		const module = root.module;
		if (this.materializedModules.has(module)) {
			return;
		}
		this.materializedModules.add(module);
		const source = this.demandIndex.moduleValues.get(module);
		if (!source) {
			return;
		}
		this.demandSource(source);
		this.registerValueConstraint({
			target: { kind: 'value', value: this.nodeForRoot(root) },
			source,
			relation: 'identity',
		});
	}

	private demandFunctionCallers(
		flow: MaterializedFunctionValueFlow,
		instantiateContext = flow.requiresCallContext,
		followValueAliases = false,
		refineCallerContexts = false,
	): boolean {
		const sourceFlow = flow.source;
		let changed = false;
		if (instantiateContext) {
			if (!this.demandedFunctionCallerContexts.has(sourceFlow)) {
				this.demandedFunctionCallerBindings.add(sourceFlow);
				this.demandedFunctionCallerContexts.add(sourceFlow);
				changed = true;
			}
		} else if (!this.demandedFunctionCallerBindings.has(sourceFlow)) {
			this.demandedFunctionCallerBindings.add(sourceFlow);
			changed = true;
		}
		if (followValueAliases && !this.demandedFunctionCallerAliases.has(sourceFlow)) {
			this.demandedFunctionCallerAliases.add(sourceFlow);
			changed = true;
		}
		if (refineCallerContexts && !this.refinedFunctionCallerContexts.has(sourceFlow)) {
			this.refinedFunctionCallerContexts.add(sourceFlow);
			changed = true;
		}
		if (!changed) {
			return false;
		}
		// Caller discovery needs return flow because a later call target can be a
		// factory result. It does not execute unrelated effects in that caller.
		const mode = instantiateContext ? CALL_RETURNS : CALL_BINDINGS;
		const aliases = this.functionAliasQueue;
		aliases.length = 0;
		this.visitedFunctionAliases.clear();
		this.enqueueFunctionAlias(sourceFlow.functionValue);
		for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
			const source = aliases[aliasIndex];
			if (source.steps.length === 0) {
				const rootKey = semanticValueRootKey(source.root);
				this.materializeRootCalls(this.demandIndex.calleeCalls(rootKey), mode);
				const callerCalls = this.demandIndex.callerCalls(rootKey);
				if (refineCallerContexts) {
					this.materializeContextualCallerCalls(callerCalls, mode, flow);
				} else {
					this.materializeCallerCalls(callerCalls, mode);
				}
			} else {
				this.materializeRootCalls(this.demandIndex.calleeCallsForSource(source), mode);
				const callerCalls = this.demandIndex.callerCallsForSource(source);
				if (refineCallerContexts) {
					this.materializeContextualCallerCalls(callerCalls, mode, flow);
				} else {
					this.materializeCallerCalls(callerCalls, mode);
				}
			}
			if (followValueAliases) {
				this.enqueueFunctionAliases(source);
			}
			if (source.steps.length === 0 && source.root.kind === 'declaration') {
				const member = this.demandIndex.membersByDeclaration.get(source.root.declId);
				if (member) {
					this.enqueueFunctionAlias(appendValueMember(member.owner, member.name));
				}
			}
		}
		if (flow.implicitReceiver && sourceFlow.functionValue.root.kind === 'declaration') {
			const member = this.demandIndex.membersByDeclaration.get(sourceFlow.functionValue.root.declId);
			if (member) {
				this.materializeRootCalls(
					this.demandIndex.calleeCallsByMemberName(member.name),
					mode,
					flow,
				);
				const callerCalls = this.demandIndex.callerCallsByMemberName(member.name);
				if (refineCallerContexts) {
					this.materializeContextualCallerCalls(callerCalls, mode, flow);
				} else {
					this.materializeCallerCalls(callerCalls, mode, flow);
				}
			}
		}
		return true;
	}

	private enqueueFunctionAlias(source: SemanticValueSource): void {
		const key = this.identities.sourceKey(source);
		if (this.visitedFunctionAliases.has(key)) {
			return;
		}
		this.visitedFunctionAliases.add(key);
		this.functionAliasQueue.push(source);
	}

	private enqueueFunctionAliases(source: SemanticValueSource): void {
		const declarations = this.demandIndex.declarationsForValue(source, source.steps.length);
		for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
			this.enqueueFunctionAlias(declarationValueSource(declarations[declarationIndex]));
		}
		if (source.steps.length > 0) {
			const ownerDeclarations = this.demandIndex.declarationsForValue(source, 0);
			for (let declarationIndex = 0; declarationIndex < ownerDeclarations.length; declarationIndex += 1) {
				const declaration = ownerDeclarations[declarationIndex];
				if (!this.demandIndex.membersByDeclaration.has(declaration)) {
					this.enqueueFunctionAlias({
						root: { kind: 'declaration', declId: declaration },
						steps: source.steps,
					});
				}
			}
		}
	}

	private demandDynamicFunctionCallers(flow: MaterializedFunctionValueFlow): boolean {
		const sourceFlow = flow.source;
		if (this.demandedDynamicFunctionCallers.has(sourceFlow)) {
			return false;
		}
		this.demandedDynamicFunctionCallers.add(sourceFlow);
		this.materializeRootCalls(
			this.demandIndex.argumentCallsForSource(sourceFlow.functionValue),
		);
		this.materializeCallerCalls(
			this.demandIndex.argumentCallerCallsForSource(sourceFlow.functionValue),
			CALL_EFFECTS,
		);
		if (sourceFlow.functionValue.root.kind !== 'declaration') {
			return true;
		}
		const member = this.demandIndex.membersByDeclaration.get(sourceFlow.functionValue.root.declId);
		if (!member) {
			return true;
		}
		const memberSource = appendValueMember(member.owner, member.name);
		this.materializeRootCalls(this.demandIndex.argumentCallsForSource(memberSource));
		this.materializeCallerCalls(
			this.demandIndex.argumentCallerCallsForSource(memberSource),
			CALL_EFFECTS,
		);
		return true;
	}

	private materializeCallerCalls(
		entries: readonly CallValueEntry[],
		mode: CallInstantiationMode,
		targetFlow?: MaterializedFunctionValueFlow,
	): void {
		for (let index = 0; index < entries.length; index += 1) {
			this.materializeCallerCall(entries[index], mode, targetFlow);
		}
	}

	private materializeContextualCallerCalls(
		entries: readonly CallValueEntry[],
		mode: CallInstantiationMode,
		targetFlow: MaterializedFunctionValueFlow,
	): void {
		for (let index = 0; index < entries.length; index += 1) {
			const call = entries[index];
			this.materializeCallerCall(call, mode, targetFlow);
			const ownerEntry = this.demandIndex.ownerFlowByCall.get(call);
			if (ownerEntry) {
				const ownerFlow = this.materializeFunctionFlow(ownerEntry);
				if (ownerFlow.requiresCallContext) {
					this.enqueueFunctionCallerRefinement(ownerFlow);
				}
			}
		}
	}

	private materializeCallerCall(
		call: CallValueEntry,
		mode: CallInstantiationMode,
		targetFlow?: MaterializedFunctionValueFlow,
	): void {
		if (targetFlow) {
			if (!this.upgradeTargetCallMode(this.materializedTargetCallerModes, call, targetFlow, mode)) {
				return;
			}
		} else {
			const previousMode = this.materializedCallerModes.get(call);
			if (previousMode !== undefined && previousMode >= mode) {
				return;
			}
			this.materializedCallerModes.set(call, mode);
		}
		const ownerEntry = this.demandIndex.ownerFlowByCall.get(call);
		if (!ownerEntry) {
			return;
		}
		const ownerFlow = this.materializeFunctionFlow(ownerEntry);
		const demand = this.retainCallDemand(ownerFlow, call, mode, targetFlow);
		const context = this.defaultFunctionContext(ownerFlow, CALL_CONTEXT);
		this.materializeContextCallDemand(context, demand);
		const contexts = this.functionContextsByValue.get(ownerFlow.functionValue)!;
		for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
			const retainedContext = contexts[contextIndex];
			if (retainedContext !== context) {
				this.materializeContextCallDemand(retainedContext, demand);
			}
		}
	}

	private retainCallDemand(
		flow: MaterializedFunctionValueFlow,
		call: CallValueEntry,
		mode: CallInstantiationMode,
		targetFlow: MaterializedFunctionValueFlow | undefined,
	): FunctionCallDemand {
		let demands = this.demandedCallsByFlow.get(flow);
		if (!demands) {
			demands = [];
			this.demandedCallsByFlow.set(flow, demands);
		}
		for (let index = 0; index < demands.length; index += 1) {
			const demand = demands[index];
			if (demand.call === call && demand.targetFlow === targetFlow) {
				if (demand.mode < mode) {
					demand.mode = mode;
				}
				return demand;
			}
		}
		const demand: FunctionCallDemand = { call, mode, targetFlow };
		demands.push(demand);
		return demand;
	}

	private findMembers(owner: SemanticValueID, name: string): readonly SymbolID[] {
		let ownerCache = this.memberResolutionCache.get(owner);
		if (!ownerCache) {
			ownerCache = new Map();
			this.memberResolutionCache.set(owner, ownerCache);
		}
		const cached = ownerCache.get(name);
		if (cached) {
			return cached;
		}

		const declarations: MemberDeclaration[] = [];
		this.collectMemberDeclarations(owner, name, new Set(), declarations);
		if (declarations.length === 0) {
			ownerCache.set(name, EMPTY_MEMBER_IDS);
			return EMPTY_MEMBER_IDS;
		}
		declarations.sort((left, right) => left.order - right.order);
		const ids = new Array<SymbolID>(declarations.length);
		for (let index = 0; index < declarations.length; index += 1) {
			ids[index] = declarations[index].id;
		}
		ownerCache.set(name, ids);
		return ids;
	}

	// A semantic value can denote several runtime alternatives. Direct members
	// shadow inherited members on each alternative, while value-flow and
	// parameter projections retain every valid definition. This mirrors Lua's
	// table lookup instead of selecting whichever declaration was materialized
	// first by the workspace.
	private collectMemberDeclarations(
		owner: SemanticValueID,
		name: string,
		visited: Set<SemanticValueID>,
		out: MemberDeclaration[],
	): void {
		const identityValues: SemanticValueID[] = [];
		const identityStack: SemanticValueID[] = [owner];
		while (identityStack.length > 0) {
			const value = identityStack.pop()!;
			if (visited.has(value)) {
				continue;
			}
			visited.add(value);
			identityValues.push(value);
			for (let edge = this.identityValues.last(value); edge !== 0; edge = this.identityValues.previous(edge)) {
				identityStack.push(this.identityValues.target(edge));
			}
		}

		const directStart = out.length;
		for (let index = 0; index < identityValues.length; index += 1) {
			const member = this.members.get(identityValues[index])?.get(name);
			if (member) {
				this.appendMemberDeclarations(member.value, out);
			}
		}
		if (out.length !== directStart) {
			return;
		}

		const allocationStart = out.length;
		for (let index = 0; index < identityValues.length; index += 1) {
			const value = identityValues[index];
			for (let edge = this.instanceAllocations.first(value); edge !== 0; edge = this.instanceAllocations.next(edge)) {
				const member = this.members.get(this.instanceAllocations.target(edge))?.get(name);
				if (member) {
					this.appendMemberDeclarations(member.value, out);
				}
			}
		}
		if (out.length !== allocationStart) {
			return;
		}

		const prototypeStart = out.length;
		for (let index = 0; index < identityValues.length; index += 1) {
			const prototype = this.prototypeBases.get(identityValues[index]);
			if (prototype) {
				this.collectMemberDeclarations(prototype, name, visited, out);
			}
		}
		if (out.length !== prototypeStart) {
			return;
		}

		const alternativeStart = out.length;
		for (let index = 0; index < identityValues.length; index += 1) {
			const value = identityValues[index];
			this.collectMemberDeclarationsFromBases(this.valueBases, value, name, visited, out);
			this.collectMemberDeclarationsFromBases(this.projectionBases, value, name, visited, out);
			this.collectMemberDeclarationsFromBases(this.callArgumentBases, value, name, visited, out);
		}
		if (out.length !== alternativeStart) {
			return;
		}

		for (let index = 0; index < identityValues.length; index += 1) {
			const value = identityValues[index];
			this.collectMemberDeclarationsFromBases(this.instanceBases, value, name, visited, out);
		}
	}

	private collectMemberDeclarationsFromBases(
		bases: SemanticValueEdges,
		owner: SemanticValueID,
		name: string,
		visited: Set<SemanticValueID>,
		out: MemberDeclaration[],
	): void {
		for (let edge = bases.first(owner); edge !== 0; edge = bases.next(edge)) {
			this.collectMemberDeclarations(bases.target(edge), name, visited, out);
		}
	}

	private appendMemberDeclarations(value: SemanticValueID, out: MemberDeclaration[]): void {
		const declarations = this.memberDeclarationsByIdentityRoot.get(this.findIdentityRoot(value))
			?? EMPTY_MEMBER_DECLARATIONS;
		for (let index = 0; index < declarations.length; index += 1) {
			const declaration = declarations[index];
			let duplicate = false;
			for (let resultIndex = 0; resultIndex < out.length; resultIndex += 1) {
				if (out[resultIndex].id === declaration.id) {
					duplicate = true;
					break;
				}
			}
			if (!duplicate) {
				out.push(declaration);
			}
		}
	}

	private resolveSource(
		source: SemanticValueSource,
		createMembers: boolean,
		dependencies?: SemanticValueID[],
		useCallArgumentHints = false,
		demandEffects = true,
	): SemanticValueID | undefined {
		const value = this.resolveValueRoot(source.root);
		return value
			? this.resolveValueSteps(
				value,
				source.steps,
				createMembers,
				dependencies,
					source.steps.length,
					useCallArgumentHints,
					demandEffects,
			)
			: undefined;
	}

	private resolveValueRoot(root: SemanticValueRoot): SemanticValueID | undefined {
		this.demandRoot(root);
		return this.nodeForRoot(root);
	}

	private resolveValueSteps(
		value: SemanticValueID,
		steps: readonly SemanticValueStep[],
		createMembers: boolean,
		dependencies?: SemanticValueID[],
		stepCount = steps.length,
		useCallArgumentHints = false,
		demandEffects = true,
	): SemanticValueID | undefined {
		let resolved: SemanticValueID | undefined = value;
		for (let index = 0; resolved && index < stepCount; index += 1) {
			if (dependencies) {
				dependencies.push(resolved);
			}
			const step = steps[index];
			switch (step.kind) {
				case 'member':
					resolved = this.resolveMemberValue(
						resolved,
						step.name,
						createMembers,
						useCallArgumentHints,
					);
					break;
				case 'index': {
					const key = this.resolveSource(
						step.key,
						createMembers,
							dependencies,
							useCallArgumentHints,
							demandEffects,
					);
					if (key && dependencies) {
						dependencies.push(key);
					}
					resolved = key
						? this.resolveIndexedValue(resolved, key, createMembers, useCallArgumentHints)
						: undefined;
					break;
				}
				case 'element':
					resolved = this.resolveElementValue(resolved, createMembers, useCallArgumentHints);
					break;
				case 'call':
					resolved = this.resolveCallValue(resolved);
					break;
				case 'instance':
					resolved = this.ensureInstance(resolved);
					break;
				case 'metatable':
					resolved = this.resolveMetatableValue(resolved, useCallArgumentHints);
					break;
			}
		}
		return resolved;
	}

	private resolveMemberValue(
		owner: SemanticValueID,
		name: string,
		create: boolean,
		useCallArgumentHints: boolean,
	): SemanticValueID | undefined {
		const cache = useCallArgumentHints
			? this.hintedResolvedMemberValues
			: this.resolvedMemberValues;
		const cached = cache.get(owner)?.get(name);
		if (cached !== undefined) {
			return cached;
		}
		const missing = useCallArgumentHints
			? this.missingHintedResolvedMemberValues
			: this.missingResolvedMemberValues;
		if (!create && missing.get(owner)?.has(name)) {
			return undefined;
		}
		const values = this.memberValueScratch;
		const identityValues = this.memberValueIdentityScratch;
		values.length = 0;
		identityValues.length = 0;
		if (!create) {
			this.demandResolvedMemberSources(owner, name);
		}
		const generation = this.memberTraversalGeneration + 1;
		this.memberTraversalGeneration = generation;
		this.collectMemberValues(owner, name, generation, true, useCallArgumentHints);
		let resolved: SemanticValueID | undefined;
		if (values.length > 0) {
			resolved = this.mergeResolvedValues(
				values,
				identityValues,
				this.memberProjections,
				owner,
				name,
			);
		} else if (create) {
			resolved = this.ensureMember(owner, name).value;
		}
		if (resolved !== undefined) {
			let ownerCache = cache.get(owner);
			if (!ownerCache) {
				ownerCache = new Map();
				cache.set(owner, ownerCache);
			}
			ownerCache.set(name, resolved);
			missing.get(owner)?.delete(name);
		} else {
			let ownerMissing = missing.get(owner);
			if (!ownerMissing) {
				ownerMissing = new Set();
				missing.set(owner, ownerMissing);
			}
			ownerMissing.add(name);
		}
		return resolved;
	}

	// Alias paths denote the same value and retain identity. Runtime alternatives
	// feed one projection instead; unifying them would publish union members back
	// onto every alternative.
	private mergeResolvedValues<Key>(
		values: readonly SemanticValueID[],
		identityValues: readonly boolean[],
		projectionsByOwner: Map<SemanticValueID, Map<Key, SemanticValueID>>,
		owner: SemanticValueID,
		key: Key,
	): SemanticValueID | undefined {
		let first: SemanticValueID | undefined;
		for (let index = 0; index < values.length; index += 1) {
			if (!identityValues[index]) {
				continue;
			}
			if (!first) {
				first = values[index];
			} else if (values[index] !== first) {
				this.addIdentity(first, values[index]);
			}
		}
		let projection: SemanticValueID | undefined;
		for (let index = 0; index < values.length; index += 1) {
			if (identityValues[index]) {
				continue;
			}
			const value = values[index];
			if (!first) {
				first = value;
				continue;
			}
			if (value === first) {
				continue;
			}
			if (!projection) {
				let projections = projectionsByOwner.get(owner);
				if (!projections) {
					projections = new Map();
					projectionsByOwner.set(owner, projections);
				}
				projection = projections.get(key);
				if (!projection) {
					projection = this.createNode();
					projections.set(key, projection);
				}
				this.addValueBase(projection, first);
			}
			this.addValueBase(projection, value);
		}
		return projection ?? first;
	}

	private collectMemberValues(
		owner: SemanticValueID,
		name: string,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		if (this.memberTraversalMarks[owner] === generation
			&& (!identityPath || this.memberTraversalIdentityMarks[owner] === generation)) {
			return false;
		}
		const nodes = this.memberNodeScratch;
		const nodeStart = nodes.length;
		this.memberTraversalMarks[owner] = generation;
		if (identityPath) {
			this.memberTraversalIdentityMarks[owner] = generation;
		}
		nodes.push(owner);
		for (let nodeIndex = nodeStart; nodeIndex < nodes.length; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			for (let edge = this.identityValues.first(node); edge !== 0; edge = this.identityValues.next(edge)) {
				const identity = this.identityValues.target(edge);
				if (this.memberTraversalMarks[identity] === generation
					&& (!identityPath || this.memberTraversalIdentityMarks[identity] === generation)) {
					continue;
				}
				this.memberTraversalMarks[identity] = generation;
				if (identityPath) {
					this.memberTraversalIdentityMarks[identity] = generation;
				}
				nodes.push(identity);
			}
		}
		const nodeEnd = nodes.length;
		let declared = false;
		for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
			const member = this.members.get(nodes[nodeIndex])?.get(name);
			if (member) {
				this.memberValueScratch.push(member.value);
				this.memberValueIdentityScratch.push(identityPath);
				declared = declared || member.declaration !== undefined;
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const flow = this.enclosingFunctionFlowByValue.get(nodes[nodeIndex]);
				if (flow) {
					this.defaultFunctionContext(flow);
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				for (let edge = this.instanceAllocations.first(node); edge !== 0; edge = this.instanceAllocations.next(edge)) {
					const member = this.members.get(this.instanceAllocations.target(edge))?.get(name);
					if (member) {
						this.memberValueScratch.push(member.value);
						this.memberValueIdentityScratch.push(false);
						declared = declared || member.declaration !== undefined;
					}
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const prototype = this.prototypeBases.get(nodes[nodeIndex]);
				if (prototype) {
					declared = this.collectMemberValues(
						prototype,
						name,
						generation,
						identityPath,
						useCallArgumentHints,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				declared = this.collectMemberValuesFromBases(
					this.valueBases,
					node,
					name,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				declared = this.collectMemberValuesFromBases(
					this.projectionBases,
					node,
					name,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				if (useCallArgumentHints) {
					declared = this.collectMemberValuesFromBases(
						this.callArgumentBases,
						node,
						name,
						generation,
						false,
						true,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				declared = this.collectMemberValuesFromBases(
					this.instanceBases,
					nodes[nodeIndex],
					name,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
			}
		}
		nodes.length = nodeStart;
		return declared;
	}

	private collectMemberValuesFromBases(
		bases: SemanticValueEdges,
		owner: SemanticValueID,
		name: string,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		let declared = false;
		for (let edge = bases.first(owner); edge !== 0; edge = bases.next(edge)) {
			declared = this.collectMemberValues(
				bases.target(edge),
				name,
				generation,
				identityPath,
				useCallArgumentHints,
			) || declared;
		}
		return declared;
	}

	private resolveIndexedValue(
		owner: SemanticValueID,
		key: SemanticValueID,
		create: boolean,
		useCallArgumentHints: boolean,
	): SemanticValueID | undefined {
		this.collectIndexKeyValues(key, useCallArgumentHints);
		const values = this.indexValueScratch;
		const identityValues = this.indexValueIdentityScratch;
		values.length = 0;
		identityValues.length = 0;
		const generation = this.indexTraversalGeneration + 1;
		this.indexTraversalGeneration = generation;
		this.collectIndexedValues(owner, generation, true, useCallArgumentHints);
		if (values.length === 0) {
			return create ? this.ensureIndexedValue(owner, key) : undefined;
		}

		return this.mergeResolvedValues(
			values,
			identityValues,
			this.indexedProjections,
			owner,
			key,
		);
	}

	private collectIndexKeyValues(key: SemanticValueID, useCallArgumentHints: boolean): void {
		const values = this.indexKeyScratch;
		const identityValues = this.indexKeyIdentityScratch;
		const stack = this.indexKeyStack;
		const identityStack = this.indexKeyStackIdentity;
		values.length = 0;
		identityValues.length = 0;
		stack.length = 0;
		identityStack.length = 0;
		const generation = this.indexKeyGeneration + 1;
		this.indexKeyGeneration = generation;
		stack.push(key);
		identityStack.push(true);
		while (stack.length > 0) {
			const value = stack.pop()!;
			const identityPath = identityStack.pop()!;
			if (this.indexKeyMarks[value] === generation
				&& (!identityPath || this.indexKeyIdentityMarks[value] === generation)) {
				continue;
			}
			this.indexKeyMarks[value] = generation;
			if (identityPath) {
				this.indexKeyIdentityMarks[value] = generation;
			}
			values.push(value);
			identityValues.push(identityPath);
			for (let edge = this.identityValues.last(value); edge !== 0; edge = this.identityValues.previous(edge)) {
				stack.push(this.identityValues.target(edge));
				identityStack.push(identityPath);
			}
			for (let edge = this.projectionBases.last(value); edge !== 0; edge = this.projectionBases.previous(edge)) {
				stack.push(this.projectionBases.target(edge));
				identityStack.push(false);
			}
			for (let edge = this.valueBases.last(value); edge !== 0; edge = this.valueBases.previous(edge)) {
				stack.push(this.valueBases.target(edge));
				identityStack.push(false);
			}
			if (useCallArgumentHints) {
				for (let edge = this.callArgumentBases.last(value); edge !== 0; edge = this.callArgumentBases.previous(edge)) {
					stack.push(this.callArgumentBases.target(edge));
					identityStack.push(false);
				}
			}
		}
	}

	private collectIndexedValues(
		owner: SemanticValueID,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		if (this.indexTraversalMarks[owner] === generation
			&& (!identityPath || this.indexTraversalIdentityMarks[owner] === generation)) {
			return false;
		}
		const nodes = this.indexNodeScratch;
		const nodeStart = nodes.length;
		this.indexTraversalMarks[owner] = generation;
		if (identityPath) {
			this.indexTraversalIdentityMarks[owner] = generation;
		}
		nodes.push(owner);
		for (let nodeIndex = nodeStart; nodeIndex < nodes.length; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			for (let edge = this.identityValues.first(node); edge !== 0; edge = this.identityValues.next(edge)) {
				const identity = this.identityValues.target(edge);
				if (this.indexTraversalMarks[identity] === generation
					&& (!identityPath || this.indexTraversalIdentityMarks[identity] === generation)) {
					continue;
				}
				this.indexTraversalMarks[identity] = generation;
				if (identityPath) {
					this.indexTraversalIdentityMarks[identity] = generation;
				}
				nodes.push(identity);
			}
		}
		const nodeEnd = nodes.length;
		let declared = false;
		for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			const indexed = this.indexedValues.get(node);
			if (indexed) {
				for (let keyIndex = 0; keyIndex < this.indexKeyScratch.length; keyIndex += 1) {
					const value = indexed.get(this.indexKeyScratch[keyIndex]);
					if (value && this.materializedValueTargets[value]) {
						this.indexValueScratch.push(value);
						this.indexValueIdentityScratch.push(
							identityPath && this.indexKeyIdentityScratch[keyIndex],
						);
						declared = true;
					}
				}
			}
			const element = this.elementForIdentity(node);
			if (element) {
				this.indexValueScratch.push(element);
				this.indexValueIdentityScratch.push(false);
				declared = true;
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const prototype = this.prototypeBases.get(nodes[nodeIndex]);
				if (prototype) {
					declared = this.collectIndexedValues(
						prototype,
						generation,
						identityPath,
						useCallArgumentHints,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				declared = this.collectIndexedValuesFromBases(
					this.valueBases,
					node,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				declared = this.collectIndexedValuesFromBases(
					this.projectionBases,
					node,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				if (useCallArgumentHints) {
					declared = this.collectIndexedValuesFromBases(
						this.callArgumentBases,
						node,
						generation,
						false,
						true,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				declared = this.collectIndexedValuesFromBases(
					this.instanceBases,
					nodes[nodeIndex],
					generation,
					false,
					useCallArgumentHints,
				) || declared;
			}
		}
		nodes.length = nodeStart;
		return declared;
	}

	// start normalized-body-acceptable -- Indexed and element traversals keep specialized recursion so value lookup has no per-edge kind dispatch.
	private collectIndexedValuesFromBases(
		bases: SemanticValueEdges,
		owner: SemanticValueID,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		let declared = false;
		for (let edge = bases.first(owner); edge !== 0; edge = bases.next(edge)) {
			declared = this.collectIndexedValues(
				bases.target(edge),
				generation,
				identityPath,
				useCallArgumentHints,
			) || declared;
		}
		return declared;
	}
	// end normalized-body-acceptable

	private ensureIndexedValue(owner: SemanticValueID, key: SemanticValueID): SemanticValueID {
		let values = this.indexedValues.get(owner);
		if (!values) {
			values = new Map();
			this.indexedValues.set(owner, values);
		}
		let value = values.get(key);
		if (!value) {
			value = this.createNode();
			values.set(key, value);
			this.markTraversalChanged(owner);
		}
		this.registerIndexedValueSources(owner, key, value);
		return value;
	}

	private resolveCallValue(value: SemanticValueID): SemanticValueID {
		let result = this.callResults.get(value);
		if (!result) {
			result = this.createNode();
			this.callResults.set(value, result);
			this.registerDerivedValueSources(value, result, { kind: 'call' });
			this.markTraversalChanged(value);
		}
		return result;
	}

	private pushTraversalBases(stack: SemanticValueID[], value: SemanticValueID): void {
		for (let edge = this.identityValues.last(value); edge !== 0; edge = this.identityValues.previous(edge)) {
			stack.push(this.identityValues.target(edge));
		}
		const prototypeBase = this.prototypeBases.get(value);
		if (prototypeBase) {
			stack.push(prototypeBase);
		}
		for (let edge = this.instanceBases.last(value); edge !== 0; edge = this.instanceBases.previous(edge)) {
			stack.push(this.instanceBases.target(edge));
		}
		for (let edge = this.projectionBases.last(value); edge !== 0; edge = this.projectionBases.previous(edge)) {
			stack.push(this.projectionBases.target(edge));
		}
		for (let edge = this.callArgumentBases.last(value); edge !== 0; edge = this.callArgumentBases.previous(edge)) {
			stack.push(this.callArgumentBases.target(edge));
		}
		for (let edge = this.valueBases.last(value); edge !== 0; edge = this.valueBases.previous(edge)) {
			stack.push(this.valueBases.target(edge));
		}
	}

	private ensureMember(owner: SemanticValueID, name: string): MemberValue {
		let ownerMembers = this.members.get(owner);
		if (!ownerMembers) {
			ownerMembers = new Map<string, MemberValue>();
			this.members.set(owner, ownerMembers);
		}
		let member = ownerMembers.get(name);
		if (!member) {
			member = { value: this.createNode() };
			ownerMembers.set(name, member);
			this.registerDerivedValueSources(owner, member.value, { kind: 'member', name });
			const unresolvedIndex = this.unresolvedMemberValues.length;
			this.unresolvedMemberOwners.push(owner);
			this.unresolvedMemberNames.push(name);
			this.unresolvedMemberValues.push(member);
			this.unresolvedMemberNext.push(this.unresolvedMemberHeadByOwner[owner]);
			this.unresolvedMemberHeadByOwner[owner] = unresolvedIndex + 1;
			this.markTraversalChanged(owner);
		}
		return member;
	}

	private registerDerivedValueSources(
		owner: SemanticValueID,
		value: SemanticValueID,
		step: SemanticValueStep,
	): void {
		for (let link = this.valueSourceHeads[owner]; link !== 0; link = this.valueSourceNext[link - 1]) {
			const bindingIndex = link - 1;
			this.registerValueSource(
				value,
				appendValueStep(
					this.valueSourceSources[bindingIndex],
					step,
					this.valueSourceStepCounts[bindingIndex],
				),
				this.valueSourceContexts[bindingIndex],
			);
		}
	}

	private processDirtyTraversalValues(): void {
		const generation = this.dirtyPropagationGeneration + 1;
		this.dirtyPropagationGeneration = generation;
		const stack = this.dirtyPropagationStack;
		const values = this.dirtyPropagationValues;
		values.length = 0;
		while (this.dirtyTraversalValues.length > 0) {
			stack.push(this.dirtyTraversalValues.take());
		}
		while (stack.length > 0) {
			const value = stack.pop()!;
			if (this.dirtyPropagationMarks[value] === generation) {
				continue;
			}
			this.dirtyPropagationMarks[value] = generation;
			values.push(value);
			for (let edge = this.traversalDependents.first(value); edge !== 0; edge = this.traversalDependents.next(edge)) {
				stack.push(this.traversalDependents.target(edge));
			}
		}
		for (let index = 0; index < values.length; index += 1) {
			const value = values[index];
			this.resolvedMemberValues.delete(value);
			this.hintedResolvedMemberValues.delete(value);
			this.missingResolvedMemberValues.delete(value);
			this.missingHintedResolvedMemberValues.delete(value);
			this.memberResolutionCache.delete(value);
			this.refreshUnresolvedMembers(value);
			this.valueFlowWorklist.queue(value);
			this.callWorklist.queue(value);
			const callResult = this.callResults.get(value);
			if (callResult) {
				this.instantiateFunctionCall(value, EMPTY_ARGUMENT_VALUES, callResult);
			}
		}
	}

	private refreshUnresolvedMembers(owner: SemanticValueID): void {
		let link = this.unresolvedMemberHeadByOwner[owner];
		while (link !== 0) {
			const index = link - 1;
			const member = this.unresolvedMemberValues[index];
			if (!member.declaration) {
				this.refreshUnresolvedMember(
					this.unresolvedMemberOwners[index],
					this.unresolvedMemberNames[index],
					member,
				);
			}
			link = this.unresolvedMemberNext[index];
		}
	}

	private refreshUnresolvedMember(owner: SemanticValueID, name: string, member: MemberValue): void {
		const target = member.value;
		for (let edge = this.identityValues.first(owner); edge !== 0; edge = this.identityValues.next(edge)) {
			this.inheritMemberValue(target, this.identityValues.target(edge), name, 'identity');
		}
		const prototype = this.prototypeBases.get(owner);
		if (prototype) {
			this.inheritMemberValue(target, prototype, name, 'identity');
		}
		for (let edge = this.valueBases.first(owner); edge !== 0; edge = this.valueBases.next(edge)) {
			this.inheritMemberValue(target, this.valueBases.target(edge), name, 'value');
		}
		for (let edge = this.projectionBases.first(owner); edge !== 0; edge = this.projectionBases.next(edge)) {
			this.inheritMemberValue(target, this.projectionBases.target(edge), name, 'value');
		}
		for (let edge = this.instanceAllocations.first(owner); edge !== 0; edge = this.instanceAllocations.next(edge)) {
			const member = this.members.get(this.instanceAllocations.target(edge))?.get(name);
			if (member) {
				this.addValueBase(target, member.value);
			}
		}
		for (let edge = this.instanceBases.first(owner); edge !== 0; edge = this.instanceBases.next(edge)) {
			this.inheritMemberValue(target, this.instanceBases.target(edge), name, 'value');
		}
	}

	private inheritMemberValue(
		target: SemanticValueID,
		owner: SemanticValueID,
		name: string,
		relation: 'identity' | 'value',
	): void {
		const source = this.resolveMemberValue(owner, name, false, false);
		if (!source || source === target) {
			return;
		}
		if (relation === 'identity') {
			this.addIdentity(target, source);
		} else {
			this.addValueBase(target, source);
		}
	}

	private resolveElementValue(
		owner: SemanticValueID,
		create: boolean,
		useCallArgumentHints: boolean,
	): SemanticValueID | undefined {
		const values = this.elementValueScratch;
		const identityValues = this.elementValueIdentityScratch;
		values.length = 0;
		identityValues.length = 0;
		const generation = this.elementTraversalGeneration + 1;
		this.elementTraversalGeneration = generation;
		this.collectElementValues(owner, generation, true, useCallArgumentHints);
		if (values.length === 0) {
			return create ? this.ensureElement(owner) : undefined;
		}
		const element = this.ensureElement(owner);
		for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
			const value = values[valueIndex];
			if (value === element) {
				continue;
			}
			if (identityValues[valueIndex]) {
				this.addIdentity(element, value);
			} else {
				this.addValueBase(element, value);
			}
		}
		return element;
	}

	private collectElementValues(
		owner: SemanticValueID,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		if (this.elementTraversalMarks[owner] === generation
			&& (!identityPath || this.elementTraversalIdentityMarks[owner] === generation)) {
			return false;
		}
		const nodes = this.elementNodeScratch;
		const nodeStart = nodes.length;
		this.elementTraversalMarks[owner] = generation;
		if (identityPath) {
			this.elementTraversalIdentityMarks[owner] = generation;
		}
		nodes.push(owner);
		for (let nodeIndex = nodeStart; nodeIndex < nodes.length; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			for (let edge = this.identityValues.first(node); edge !== 0; edge = this.identityValues.next(edge)) {
				const identity = this.identityValues.target(edge);
				if (this.elementTraversalMarks[identity] === generation
					&& (!identityPath || this.elementTraversalIdentityMarks[identity] === generation)) {
					continue;
				}
				this.elementTraversalMarks[identity] = generation;
				if (identityPath) {
					this.elementTraversalIdentityMarks[identity] = generation;
				}
				nodes.push(identity);
			}
		}
		const nodeEnd = nodes.length;
		let declared = false;
		for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			const element = this.elementForIdentity(node);
			if (element && this.materializedValueTargets[element]) {
				this.elementValueScratch.push(element);
				this.elementValueIdentityScratch.push(identityPath);
				declared = true;
			}
			const members = this.members.get(node);
			if (members) {
				for (const member of members.values()) {
					if (member.declaration === undefined && !this.materializedValueTargets[member.value]) {
						continue;
					}
					this.elementValueScratch.push(member.value);
					this.elementValueIdentityScratch.push(false);
					declared = true;
				}
			}
			const indexed = this.indexedValues.get(node);
			if (indexed) {
				for (const value of indexed.values()) {
					if (!this.materializedValueTargets[value]) {
						continue;
					}
					this.elementValueScratch.push(value);
					this.elementValueIdentityScratch.push(false);
					declared = true;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const prototype = this.prototypeBases.get(nodes[nodeIndex]);
				if (prototype) {
					declared = this.collectElementValues(
						prototype,
						generation,
						identityPath,
						useCallArgumentHints,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				declared = this.collectElementValuesFromBases(
					this.valueBases,
					node,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				declared = this.collectElementValuesFromBases(
					this.projectionBases,
					node,
					generation,
					false,
					useCallArgumentHints,
				) || declared;
				if (useCallArgumentHints) {
					declared = this.collectElementValuesFromBases(
						this.callArgumentBases,
						node,
						generation,
						false,
						true,
					) || declared;
				}
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				declared = this.collectElementValuesFromBases(
					this.instanceBases,
					nodes[nodeIndex],
					generation,
					false,
					useCallArgumentHints,
				) || declared;
			}
		}
		nodes.length = nodeStart;
		return declared;
	}

	// start normalized-body-acceptable -- Indexed and element traversals keep specialized recursion so value lookup has no per-edge kind dispatch.
	private collectElementValuesFromBases(
		bases: SemanticValueEdges,
		owner: SemanticValueID,
		generation: number,
		identityPath: boolean,
		useCallArgumentHints: boolean,
	): boolean {
		let declared = false;
		for (let edge = bases.first(owner); edge !== 0; edge = bases.next(edge)) {
			declared = this.collectElementValues(
				bases.target(edge),
				generation,
				identityPath,
				useCallArgumentHints,
			) || declared;
		}
		return declared;
	}
	// end normalized-body-acceptable

	private ensureElement(owner: SemanticValueID): SemanticValueID {
		const root = this.findIdentityRoot(owner);
		let element = this.elementsByIdentityRoot.get(root);
		if (!element) {
			element = this.createNode();
			this.elementsByIdentityRoot.set(root, element);
			this.markTraversalChanged(owner);
		}
		this.registerDerivedValueSources(owner, element, { kind: 'element' });
		if (this.elements.get(owner) !== element) {
			this.elements.set(owner, element);
		}
		return element;
	}

	private elementForIdentity(owner: SemanticValueID): SemanticValueID | undefined {
		const element = this.elementsByIdentityRoot.get(this.findIdentityRoot(owner));
		if (element) {
			this.elements.set(owner, element);
		}
		return element;
	}

	private ensureInstance(classValue: SemanticValueID): SemanticValueID {
		let instance = this.instances.get(classValue);
		if (!instance) {
			instance = this.createNode();
			this.instances.set(classValue, instance);
			this.registerDerivedValueSources(classValue, instance, { kind: 'instance' });
			this.metatables.set(instance, classValue);
			this.setPrototypeBase(instance, classValue);
			for (let edge = this.valueBases.first(classValue); edge !== 0; edge = this.valueBases.next(edge)) {
				this.addEdge(this.instanceBases, instance, this.ensureInstance(this.valueBases.target(edge)));
			}
			for (let edge = this.identityValues.first(classValue); edge !== 0; edge = this.identityValues.next(edge)) {
				this.addEdge(this.instanceBases, instance, this.ensureInstance(this.identityValues.target(edge)));
			}
		}
		return instance;
	}

	private resolveMetatableValue(
		owner: SemanticValueID,
		useCallArgumentHints: boolean,
	): SemanticValueID | undefined {
		const values = this.metatableValueScratch;
		values.length = 0;
		const generation = this.metatableGeneration + 1;
		this.metatableGeneration = generation;
		this.collectMetatableValues(owner, generation, useCallArgumentHints);
		if (values.length === 0) {
			return undefined;
		}
		if (values.length === 1) {
			return values[0];
		}
		let projection = this.metatableProjections.get(owner);
		if (!projection) {
			projection = this.createNode();
			this.metatableProjections.set(owner, projection);
		}
		for (let index = 0; index < values.length; index += 1) {
			this.addValueBase(projection, values[index]);
		}
		return projection;
	}

	private collectMetatableValues(
		owner: SemanticValueID,
		generation: number,
		useCallArgumentHints: boolean,
	): boolean {
		if (this.metatableMarks[owner] === generation) {
			return this.metatableDeclaredMarks[owner] === generation;
		}
		const nodes = this.metatableNodeScratch;
		const nodeStart = nodes.length;
		this.metatableMarks[owner] = generation;
		nodes.push(owner);
		for (let nodeIndex = nodeStart; nodeIndex < nodes.length; nodeIndex += 1) {
			const node = nodes[nodeIndex];
			for (let edge = this.identityValues.first(node); edge !== 0; edge = this.identityValues.next(edge)) {
				const identity = this.identityValues.target(edge);
				if (this.metatableMarks[identity] !== generation) {
					this.metatableMarks[identity] = generation;
					nodes.push(identity);
				}
			}
		}
		const nodeEnd = nodes.length;
		let declared = false;
		for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
			const metatable = this.metatables.get(nodes[nodeIndex]);
			if (metatable) {
				this.metatableValueScratch.push(metatable);
				declared = true;
			}
		}
		if (!declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				for (let edge = this.projectionBases.first(node); edge !== 0; edge = this.projectionBases.next(edge)) {
					declared = this.collectMetatableValues(
						this.projectionBases.target(edge),
						generation,
						useCallArgumentHints,
					) || declared;
				}
				if (useCallArgumentHints) {
					for (let edge = this.callArgumentBases.first(node); edge !== 0; edge = this.callArgumentBases.next(edge)) {
						declared = this.collectMetatableValues(
							this.callArgumentBases.target(edge),
							generation,
							true,
						) || declared;
					}
				}
				for (let edge = this.valueBases.first(node); edge !== 0; edge = this.valueBases.next(edge)) {
					declared = this.collectMetatableValues(
						this.valueBases.target(edge),
						generation,
						useCallArgumentHints,
					) || declared;
				}
			}
		}
		if (declared) {
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				this.metatableDeclaredMarks[nodes[nodeIndex]] = generation;
			}
		}
		nodes.length = nodeStart;
		return declared;
	}

	private addIdentity(left: SemanticValueID, right: SemanticValueID): boolean {
		if (left === right) {
			return false;
		}
		const leftChanged = this.addEdge(this.identityValues, left, right);
		const rightChanged = this.addEdge(this.identityValues, right, left);
		const componentsChanged = this.unionIdentityComponents(left, right);
		const leftInstance = this.instances.get(left);
		if (leftInstance) {
			this.addEdge(this.instanceBases, leftInstance, this.ensureInstance(right));
		}
		const rightInstance = this.instances.get(right);
		if (rightInstance) {
			this.addEdge(this.instanceBases, rightInstance, this.ensureInstance(left));
		}
		return leftChanged || rightChanged || componentsChanged;
	}

	private unionIdentityComponents(left: SemanticValueID, right: SemanticValueID): boolean {
		let leftRoot = this.findIdentityRoot(left);
		let rightRoot = this.findIdentityRoot(right);
		if (leftRoot === rightRoot) {
			return false;
		}
		if (this.identitySizes[leftRoot] < this.identitySizes[rightRoot]) {
			const swap = leftRoot;
			leftRoot = rightRoot;
			rightRoot = swap;
		}
		this.identityParents[rightRoot] = leftRoot;
		this.identitySizes[leftRoot] += this.identitySizes[rightRoot];
		const leftElement = this.elementsByIdentityRoot.get(leftRoot);
		const rightElement = this.elementsByIdentityRoot.get(rightRoot);
		const leftMemberDeclarations = this.memberDeclarationsByIdentityRoot.get(leftRoot);
		const rightMemberDeclarations = this.memberDeclarationsByIdentityRoot.get(rightRoot);
		this.elementsByIdentityRoot.delete(rightRoot);
		this.memberDeclarationsByIdentityRoot.delete(rightRoot);
		if (!leftMemberDeclarations) {
			if (rightMemberDeclarations) {
				this.memberDeclarationsByIdentityRoot.set(leftRoot, rightMemberDeclarations);
			}
		} else if (rightMemberDeclarations) {
			this.memberDeclarationsByIdentityRoot.set(
				leftRoot,
				this.mergeMemberDeclarations(leftMemberDeclarations, rightMemberDeclarations),
			);
		}
		if (!leftElement && rightElement) {
			this.elementsByIdentityRoot.set(leftRoot, rightElement);
		} else if (leftElement && rightElement && leftElement !== rightElement) {
			this.addIdentity(leftElement, rightElement);
		}
		return true;
	}

	private findIdentityRoot(value: SemanticValueID): SemanticValueID {
		let root = value;
		while (this.identityParents[root] !== root) {
			root = this.identityParents[root];
		}
		let current = value;
		while (this.identityParents[current] !== root) {
			const parent = this.identityParents[current];
			this.identityParents[current] = root;
			current = parent;
		}
		return root;
	}

	private addEdge(
		edges: SemanticValueEdges,
		owner: SemanticValueID,
		base: SemanticValueID,
	): boolean {
		if (!edges.add(owner, base)) {
			return false;
		}
		this.addTraversalDependency(owner, base);
		return true;
	}

	private addTraversalDependency(owner: SemanticValueID, base: SemanticValueID): void {
		this.traversalDependents.add(base, owner);
		this.markTraversalChanged(owner);
	}

	private markTraversalChanged(value: SemanticValueID): void {
		this.dirtyTraversalValues.add(value);
	}

	private setPrototypeBase(owner: SemanticValueID, base: SemanticValueID): void {
		if (this.prototypeBases.get(owner) === base) {
			return;
		}
		this.prototypeBases.set(owner, base);
		this.addTraversalDependency(owner, base);
	}

	private addValueBase(owner: SemanticValueID, base: SemanticValueID): boolean {
		if (!this.addEdge(this.valueBases, owner, base)) {
			return false;
		}
		const instance = this.instances.get(owner);
		if (instance) {
			this.addEdge(this.instanceBases, instance, this.ensureInstance(base));
		}
		return true;
	}

	private materializeMembers(entries: readonly MemberValueEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			this.materializeMember(entries[index]);
		}
	}

	private materializeMember(entry: MemberValueEntry): void {
		if (this.materializedMembers.has(entry)) {
			return;
		}
		this.materializedMembers.add(entry);
		this.demandSource(entry.owner);
		this.demandRoot({ kind: 'declaration', declId: entry.declId });
		const owner = this.resolveSource(entry.owner, true);
		if (!owner) {
			return;
		}
		const member = this.ensureMember(owner, entry.name);
		if (!member.declaration) {
			member.declaration = entry.declId;
			this.markTraversalChanged(owner);
		}
		this.retainMemberDeclaration(member.value, entry.declId);
		this.registerValueSource(member.value, appendValueMember(entry.owner, entry.name));
		this.addIdentity(member.value, this.nodeForRoot({ kind: 'declaration', declId: entry.declId }));
	}

	private materializeContextMembers(entries: readonly MemberValueEntry[]): void {
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			const bindings = this.valueSourceBindingsByKey.get(this.identities.sourceKey(entry.owner));
			if (!bindings) {
				continue;
			}
			for (let bindingListIndex = 0; bindingListIndex < bindings.length; bindingListIndex += 1) {
				const context = this.valueSourceContexts[bindings[bindingListIndex]];
				if (!context) {
					continue;
				}
				this.materializeContextMember(context, entry);
			}
		}
	}

	private materializeContextMember(
		context: FunctionValueContext,
		entry: MemberValueEntry,
	): void {
		let materialized = this.materializedContextMembers.get(context);
		if (!materialized) {
			materialized = new Set();
			this.materializedContextMembers.set(context, materialized);
		}
		const target = appendValueMember(entry.owner, entry.name);
		const source = declarationValueSource(entry.declId);
		if (!materialized.has(entry)) {
			materialized.add(entry);
			this.registerValueConstraint({
				target: {
					kind: 'source',
					source: target,
					memberDeclId: entry.declId,
				},
				source,
				relation: 'identity',
				context,
			});
		}
	}

	private materializeProjectedMembers(
		source: SemanticValueSource,
		stepCount: number,
		name: string,
		entries: readonly MemberValueEntry[],
	): void {
		const root = this.resolveValueRoot(source.root);
		const owner = root
			? this.resolveValueSteps(root, source.steps, true, undefined, stepCount, false, false)
			: undefined;
		if (!owner) {
			return;
		}
		const projectionKey = `${this.identities.sourceKey(source, stepCount)}\0${name}`;
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const key = `${projectionKey}\0${entry.declId}`;
			if (this.materializedProjectedMembers.has(key)) {
				continue;
			}
			this.materializedProjectedMembers.add(key);
			this.demandRoot({ kind: 'declaration', declId: entry.declId });
			const member = this.ensureMember(owner, name);
			if (!member.declaration) {
				member.declaration = entry.declId;
				this.markTraversalChanged(owner);
			}
			this.retainMemberDeclaration(member.value, entry.declId);
			this.registerValueSource(
				member.value,
				appendValueMember(source, name, stepCount),
			);
			this.addIdentity(
				member.value,
				this.nodeForRoot({ kind: 'declaration', declId: entry.declId }),
			);
		}
	}

	private retainMemberDeclaration(value: SemanticValueID, id: SymbolID): void {
		const root = this.findIdentityRoot(value);
		let declarations = this.memberDeclarationsByIdentityRoot.get(root);
		if (!declarations) {
			declarations = [];
			this.memberDeclarationsByIdentityRoot.set(root, declarations);
		}
		for (let index = 0; index < declarations.length; index += 1) {
			if (declarations[index].id === id) {
				return;
			}
		}
		declarations.push({ id, order: this.nextMemberDeclarationOrder });
		this.nextMemberDeclarationOrder += 1;
	}

	private mergeMemberDeclarations(
		left: readonly MemberDeclaration[],
		right: readonly MemberDeclaration[],
	): MemberDeclaration[] {
		const merged = left.slice();
		for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
			const candidate = right[rightIndex];
			let duplicate = false;
			for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
				if (merged[leftIndex].id === candidate.id) {
					duplicate = true;
					break;
				}
			}
			if (!duplicate) {
				merged.push(candidate);
			}
		}
		merged.sort((a, b) => a.order - b.order);
		return merged;
	}

	private materializeFunctionReturns(entries: readonly FunctionReturnValueEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (this.materializedFunctionReturns.has(entry)) {
				continue;
			}
			this.materializedFunctionReturns.add(entry);
			this.demandSource(entry.functionValue);
			this.demandSource(entry.source);
			const functionValue = this.nodeForRoot(entry.functionValue.root);
			let sources = this.functionReturnsByValue.get(functionValue);
			if (!sources) {
				sources = [];
				this.functionReturnsByValue.set(functionValue, sources);
			}
			sources.push(entry.source);
		}
	}

	private materializeFunctionFlows(entries: readonly FunctionValueFlowEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			this.materializeFunctionFlow(entries[index]);
		}
	}

	private materializeFunctionFlow(entry: FunctionValueFlowEntry): MaterializedFunctionValueFlow {
		const materialized = this.materializedFunctionFlowsByEntry.get(entry);
		if (materialized) {
			return materialized;
		}
		const functionValue = this.nodeForRoot(entry.functionValue.root);
		const lexicalOwnerEntry = entry.lexicalOwner;
		const lexicalOwner = lexicalOwnerEntry
			? this.materializeFunctionFlow(lexicalOwnerEntry)
			: undefined;
		const contextParameterIndices = this.collectContextParameterIndices(entry);
		const requiresReturnContext = this.contextAnalysisRequiresReturnContext;
		const parameterEffect = this.collectParameterEffects(
			entry,
			contextParameterIndices,
		);
		const assignmentsByTarget = new Map<string, ValueAssignmentEntry[]>();
		for (let assignmentIndex = 0; assignmentIndex < entry.assignments.length; assignmentIndex += 1) {
			const assignment = entry.assignments[assignmentIndex];
			const key = this.identities.sourceKey(assignment.target);
			let assignments = assignmentsByTarget.get(key);
			if (!assignments) {
				assignments = [];
				assignmentsByTarget.set(key, assignments);
			}
			assignments.push(assignment);
		}
		// Reuse one summary for ordinary functions. A separate abstract call
		// context is required only where parameter identity changes a returned
		// lookup, a direct return, a receiver, or a heap effect.
		// Effectful methods additionally retain one caller site so an inner
		// method invocation does not merge independent outer mutations.
		const flow: MaterializedFunctionValueFlow = {
			source: entry,
			functionValue,
			parameters: entry.parameters,
			contextParameterIndices,
			requiresCallContext: contextParameterIndices.length > 0
				|| requiresReturnContext
				|| parameterEffect,
			requiresCallerContext: entry.implicitReceiver && parameterEffect,
			receiverProjection: entry.receiverProjection,
			implicitReceiver: entry.implicitReceiver,
			declarationIds: entry.declarationIds,
			ownedValueKeys: new Set(entry.ownedValueKeys),
			members: entry.members,
			calls: entry.calls,
			assignments: entry.assignments,
			assignmentsByTarget,
			nestedFunctions: [],
			lexicalOwner,
		};
		this.materializedFunctionFlowsByEntry.set(entry, flow);
		this.functionFlowsByValue.set(functionValue, flow);
		this.markTraversalChanged(functionValue);
		if (flow.implicitReceiver) {
			this.registerValueConstraint({
				target: {
					kind: 'value',
					value: this.nodeForRoot(flow.parameters[0].root),
				},
				source: flow.receiverProjection,
				relation: 'projection',
			});
		}
		for (const ownedKey of flow.ownedValueKeys) {
			this.functionFlowByOwnedValue.set(ownedKey, flow);
		}
		for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
			const parameter = flow.parameters[parameterIndex];
			if (parameter.root.kind === 'owned') {
				this.functionFlowByOwnedValue.set(parameter.root.key, flow);
			}
		}
		for (let declarationIndex = 0; declarationIndex < entry.declarationIds.length; declarationIndex += 1) {
			this.functionFlowByDeclaration.set(entry.declarationIds[declarationIndex], flow);
		}
		const receiver = entry.parameters[0];
		if (entry.receiverProjection && receiver) {
			for (let memberIndex = 0; memberIndex < entry.members.length; memberIndex += 1) {
				const member = entry.members[memberIndex];
				if (semanticValueSourcesEqual(member.owner, receiver)) {
					this.enclosingFunctionFlowByValue.set(
						this.nodeForRoot({ kind: 'declaration', declId: member.declId }),
						flow,
					);
				}
			}
		}
		if (lexicalOwner) {
			lexicalOwner.nestedFunctions.push(flow);
			const contexts = this.functionContextsByValue.get(lexicalOwner.functionValue);
			if (contexts) {
				for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
					this.bindNestedFunctionFlow(contexts[contextIndex], flow);
				}
			}
		}
		return flow;
	}

	private collectContextParameterIndices(entry: FunctionValueFlowEntry): number[] {
		const sources = this.indexedSourceScratch;
		sources.length = 0;
		const rootKey = this.demandIndex.rootKey(entry.functionValue.root);
		if (rootKey !== undefined) {
			const returns = this.demandIndex.returns(rootKey);
			for (let returnIndex = 0; returnIndex < returns.length; returnIndex += 1) {
				sources.push(returns[returnIndex].source);
			}
		}

		const marks = this.indexedParameterMarks;
		marks.length = entry.parameters.length;
		marks.fill(false);
		if (entry.implicitReceiver) {
			marks[0] = true;
		}
		this.contextAnalysisRequiresReturnContext = false;
		this.indexedSourceDeclarations.clear();
		this.indexedSourceOwnedValues.clear();
		this.indexedDependencyDeclarations.clear();
		this.indexedDependencyCallResults.clear();
		while (sources.length > 0) {
			const source = sources.pop()!;
			let parameterRoot = false;
			for (let parameterIndex = 0; parameterIndex < entry.parameters.length; parameterIndex += 1) {
				if (semanticValueRootsEqual(source.root, entry.parameters[parameterIndex].root)) {
					parameterRoot = true;
					if (source.steps.length === 0) {
						this.contextAnalysisRequiresReturnContext = true;
					}
					break;
				}
			}
			if (!this.contextAnalysisRequiresReturnContext && !parameterRoot) {
				if (source.root.kind === 'owned'
					&& entry.ownedValueKeys.includes(source.root.key)) {
					this.contextAnalysisRequiresReturnContext = true;
				} else if (source.root.kind === 'declaration'
					&& entry.declarationIds.includes(source.root.declId)
					&& this.demandIndex.functionFlows(source.root.declId).length > 0) {
					this.contextAnalysisRequiresReturnContext = true;
				}
			}
			for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
				const step = source.steps[stepIndex];
				if (step.kind === 'index') {
					this.collectParameterDependencies(step.key, entry, marks);
					sources.push(step.key);
				}
			}
			if (source.root.kind === 'declaration'
				&& !this.indexedSourceDeclarations.has(source.root.declId)) {
				this.indexedSourceDeclarations.add(source.root.declId);
				const declarationSources = this.demandIndex.declarationValues.get(source.root.declId);
				if (declarationSources) {
					for (let sourceIndex = 0; sourceIndex < declarationSources.length; sourceIndex += 1) {
						sources.push(declarationSources[sourceIndex]);
					}
				}
			} else if (source.root.kind === 'owned'
				&& !this.indexedSourceOwnedValues.has(source.root.key)) {
				this.indexedSourceOwnedValues.add(source.root.key);
				for (let assignmentIndex = 0; assignmentIndex < entry.assignments.length; assignmentIndex += 1) {
					const assignment = entry.assignments[assignmentIndex];
					if (assignment.target.steps.length === 0
						&& semanticValueRootsEqual(assignment.target.root, source.root)) {
						sources.push(assignment.source);
					}
				}
			}
		}
		const indices: number[] = [];
		for (let parameterIndex = 0; parameterIndex < marks.length; parameterIndex += 1) {
			if (marks[parameterIndex]) {
				indices.push(parameterIndex);
			}
		}
		return indices;
	}

	private collectParameterEffects(
		entry: FunctionValueFlowEntry,
		contextParameterIndices: number[],
	): boolean {
		const marks = this.effectParameterMarks;
		marks.length = entry.parameters.length;
		marks.fill(false);
		this.indexedDependencyDeclarations.clear();
		this.indexedDependencyCallResults.clear();
		for (let memberIndex = 0; memberIndex < entry.members.length; memberIndex += 1) {
			const member = entry.members[memberIndex];
			this.collectParameterDependencies(member.owner, entry, marks);
			const sources = this.demandIndex.declarationValues.get(member.declId);
			if (sources) {
				for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
					this.collectParameterDependencies(sources[sourceIndex], entry, marks);
				}
			}
		}
		for (let assignmentIndex = 0; assignmentIndex < entry.assignments.length; assignmentIndex += 1) {
			const assignment = entry.assignments[assignmentIndex];
			if (assignment.target.steps.length === 0 && assignment.relation === 'value') {
				continue;
			}
			this.collectParameterDependencies(assignment.target, entry, marks);
			this.collectParameterDependencies(assignment.source, entry, marks);
		}
		for (let callIndex = 0; callIndex < entry.calls.length; callIndex += 1) {
			const call = entry.calls[callIndex];
			for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
				const argument = call.arguments[argumentIndex];
				if (argument) {
					this.collectParameterDependencies(argument, entry, marks);
				}
			}
		}
		let found = false;
		for (let parameterIndex = 0; parameterIndex < marks.length; parameterIndex += 1) {
			if (!marks[parameterIndex]) {
				continue;
			}
			found = true;
			if (!contextParameterIndices.includes(parameterIndex)) {
				contextParameterIndices.push(parameterIndex);
			}
		}
		return found;
	}

	private collectParameterDependencies(
		source: SemanticValueSource,
		entry: FunctionValueFlowEntry,
		marks: boolean[],
	): void {
		const pending = this.indexedDependencyScratch;
		pending.length = 0;
		pending.push(source);
		while (pending.length > 0) {
			const dependency = pending.pop()!;
			for (let parameterIndex = 0; parameterIndex < entry.parameters.length; parameterIndex += 1) {
				if (semanticValueRootsEqual(dependency.root, entry.parameters[parameterIndex].root)) {
					marks[parameterIndex] = true;
				}
			}
			if (dependency.root.kind === 'declaration'
				&& !this.indexedDependencyDeclarations.has(dependency.root.declId)) {
				this.indexedDependencyDeclarations.add(dependency.root.declId);
				const declarationSources = this.demandIndex.declarationValues.get(dependency.root.declId);
				if (declarationSources) {
					for (let sourceIndex = 0; sourceIndex < declarationSources.length; sourceIndex += 1) {
						pending.push(declarationSources[sourceIndex]);
					}
				}
			} else if (dependency.root.kind === 'owned'
				&& !this.indexedDependencyCallResults.has(dependency.root.key)) {
				this.indexedDependencyCallResults.add(dependency.root.key);
				for (let callIndex = 0; callIndex < entry.calls.length; callIndex += 1) {
					const call = entry.calls[callIndex];
					if (!call.result || call.result.root.key !== dependency.root.key) {
						continue;
					}
					for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
						const argument = call.arguments[argumentIndex];
						if (argument) {
							pending.push(argument);
						}
					}
					break;
				}
			}
			for (let stepIndex = 0; stepIndex < dependency.steps.length; stepIndex += 1) {
				const step = dependency.steps[stepIndex];
				if (step.kind === 'index') {
					pending.push(step.key);
				}
			}
		}
	}

	private registerValueConstraint(constraint: ValueFlowConstraint): void {
		this.demandSource(constraint.source);
		if (constraint.target.kind === 'source') {
			this.demandSource(constraint.target.source);
		}
		const constraintIndex = this.valueFlowConstraints.length;
		this.valueFlowConstraints.push(constraint);
		this.valueFlowWorklist.add(constraintIndex);
	}

	private attachResolvedValue(
		target: SemanticValueID,
		source: SemanticValueID | undefined,
		relation: ValueFlowRelation,
	): void {
		if (!source || source === target) {
			return;
		}
		this.materializedValueTargets[target] = true;
		switch (relation) {
			case 'metatable':
				if (this.metatables.get(target) !== source) {
					this.metatables.set(target, source);
					this.markTraversalChanged(target);
				}
				return;
			case 'prototype':
				this.setPrototypeBase(target, source);
				const instance = this.ensureInstance(source);
				this.addEdge(this.instanceBases, target, instance);
				const alternatives = this.prototypeAlternativeScratch;
				this.collectValueAlternatives(source, alternatives);
				for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex += 1) {
					this.addEdge(
						this.instanceAllocations,
						this.ensureInstance(alternatives[alternativeIndex]),
						target,
					);
				}
				this.addEdge(
					this.instanceBases,
					this.ensureInstance(target),
					this.ensureInstance(source),
				);
				return;
			case 'identity':
				this.addIdentity(target, source);
				return;
			case 'projection':
				this.addEdge(this.projectionBases, target, source);
				return;
			case 'value':
				this.addValueBase(target, source);
				return;
		}
	}

	private solveValueChanges(): void {
		while (this.dirtyTraversalValues.length > 0
			|| this.valueFlowWorklist.length > 0
			|| this.callWorklist.length > 0) {
			while (this.valueFlowWorklist.length > 0 || this.callWorklist.length > 0) {
				this.processPendingValueConstraints();
				this.processPendingCalls();
			}
			if (this.dirtyTraversalValues.length > 0) {
				this.processDirtyTraversalValues();
			}
		}
	}

	private defaultFunctionContext(
		flow: MaterializedFunctionValueFlow,
		mode: CallInstantiationMode = CALL_EFFECTS,
	): FunctionValueContext {
		const existing = this.defaultFunctionContextsByValue.get(flow.functionValue);
		if (existing) {
			this.materializeFunctionContext(existing, mode);
			return existing;
		}
		this.materializeFunctionFlowReturns(flow);
		const parameters = flow.parameters;
		const parameterValues = new Array<SemanticValueID>(parameters.length);
		for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
			parameterValues[parameterIndex] = this.nodeForRoot(parameters[parameterIndex].root);
		}
		const closure = flow.lexicalOwner
			? this.defaultFunctionContext(flow.lexicalOwner, mode)
			: undefined;
		const context = this.createFunctionContext(
			flow,
			parameterValues,
			closure,
			true,
			undefined,
			undefined,
			EMPTY_ARGUMENT_VALUES,
			mode,
		);
		return context;
	}

	private createFunctionContext(
		flow: MaterializedFunctionValueFlow,
		parameterValues: readonly SemanticValueID[],
		closure: FunctionValueContext | undefined,
		defaultContext: boolean,
		callSite: CallValueEntry | undefined,
		parentCallSite: CallValueEntry | undefined,
		contextArguments: readonly (SemanticValueID | undefined)[],
		mode: CallInstantiationMode,
	): FunctionValueContext {
		let contexts = this.functionContextsByValue.get(flow.functionValue);
		if (!contexts) {
			contexts = [];
			this.functionContextsByValue.set(flow.functionValue, contexts);
		}
		const context: FunctionValueContext = {
			flow,
			parameterValues,
			closure,
			callSite,
			parentCallSite,
			contextArguments,
			defaultContext,
			returnValue: this.createNode(),
			localValues: new Map(),
			resolvedLocals: new Set(),
			ownedValues: new Map(),
			callResults: new Map(),
			callModes: new Map(),
			materializedAssignments: new Set(),
			returnsMaterialized: false,
			effectsMaterialized: false,
		};
		const contextParameterIndices = flow.contextParameterIndices;
		for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
			this.registerValueSource(
				parameterValues[parameterIndex],
				flow.parameters[parameterIndex],
				context,
			);
		}
		for (let index = 0; index < contextParameterIndices.length; index += 1) {
			const argument = contextArguments[index];
			if (argument) {
				this.contextOrigins[parameterValues[contextParameterIndices[index]]] = argument;
			}
		}
		contexts.push(context);
		this.bindNestedFunctionFlows(context);
		if (defaultContext) {
			// Retained slices can demand this same summary while they are applied.
			this.defaultFunctionContextsByValue.set(flow.functionValue, context);
		}
		this.applyDemandedContextSlices(context);
		this.materializeFunctionContext(context, mode);
		return context;
	}

	private bindNestedFunctionFlows(context: FunctionValueContext): void {
		const nestedFunctions = context.flow.nestedFunctions;
		for (let index = 0; index < nestedFunctions.length; index += 1) {
			this.bindNestedFunctionFlow(context, nestedFunctions[index]);
		}
	}

	private bindNestedFunctionFlow(
		context: FunctionValueContext,
		flow: MaterializedFunctionValueFlow,
	): void {
		const root = flow.source.functionValue.root;
		const value = root.kind === 'declaration'
			? this.resolveContextualDeclaration(root.declId, context, false)
			: this.ownedValueInContext(context, root.key);
		this.functionFlowsByValue.set(value, flow);
		this.functionClosuresByValue.set(value, context);
		this.markTraversalChanged(value);
	}

	private ownedValueInContext(context: FunctionValueContext, key: string): SemanticValueID {
		if (context.defaultContext) {
			const value = this.nodeForRoot({ kind: 'owned', key });
			this.registerValueSource(
				value,
				{ root: { kind: 'owned', key }, steps: EMPTY_VALUE_STEPS },
				context,
			);
			return value;
		}
		let value = context.ownedValues.get(key);
		if (!value) {
			value = this.createNode();
			context.ownedValues.set(key, value);
			this.registerValueSource(value, { root: { kind: 'owned', key }, steps: EMPTY_VALUE_STEPS }, context);
		}
		return value;
	}

	private registerValueSource(
		value: SemanticValueID,
		source: SemanticValueSource,
		context?: FunctionValueContext,
		stepCount = source.steps.length,
	): void {
		const key = this.identities.sourceKey(source, stepCount);
		for (let link = this.valueSourceHeads[value]; link !== 0; link = this.valueSourceNext[link - 1]) {
			const bindingIndex = link - 1;
			if (this.valueSourceKeys[bindingIndex] === key
				&& this.valueSourceContexts[bindingIndex] === context) {
				return;
			}
		}
		const bindingIndex = this.valueSourceSources.length;
		this.valueSourceSources.push(source);
		this.valueSourceStepCounts.push(stepCount);
		this.valueSourceKeys.push(key);
		this.valueSourceContexts.push(context);
		this.valueSourceNext.push(this.valueSourceHeads[value]);
		this.valueSourceHeads[value] = bindingIndex + 1;
		let bindings = this.valueSourceBindingsByKey.get(key);
		if (!bindings) {
			bindings = [];
			this.valueSourceBindingsByKey.set(key, bindings);
		}
		bindings.push(bindingIndex);
		const effectNames = this.demandedEffectNamesByValue.get(value);
		if (effectNames) {
			for (let nameIndex = 0; nameIndex < effectNames.length; nameIndex += 1) {
				this.demandEffectSource(source, stepCount, effectNames[nameIndex]);
			}
		}
		this.publishValueSourceDerivations(value, source, stepCount, context);
	}

	private publishValueSourceDerivations(
		value: SemanticValueID,
		source: SemanticValueSource,
		stepCount: number,
		context: FunctionValueContext | undefined,
	): void {
		const members = this.members.get(value);
		if (members) {
			for (const [name, member] of members) {
				this.registerValueSource(
					member.value,
					appendValueMember(source, name, stepCount),
					context,
				);
			}
		}
		const element = this.elements.get(value);
		if (element) {
			this.registerValueSource(element, appendValueElement(source, stepCount), context);
		}
		const indexed = this.indexedValues.get(value);
		if (indexed) {
			for (const [key, indexedValue] of indexed) {
				this.registerIndexedValueSources(value, key, indexedValue);
			}
		}
		const instance = this.instances.get(value);
		if (instance) {
			this.registerValueSource(instance, appendValueInstance(source, stepCount), context);
		}
		const callResult = this.callResults.get(value);
		if (callResult) {
			this.registerValueSource(
				callResult,
				appendValueStep(source, { kind: 'call' }, stepCount),
				context,
			);
		}
	}

	private registerIndexedValueSources(
		owner: SemanticValueID,
		key: SemanticValueID,
		value: SemanticValueID,
	): void {
		for (let ownerLink = this.valueSourceHeads[owner]; ownerLink !== 0; ownerLink = this.valueSourceNext[ownerLink - 1]) {
			const ownerBinding = ownerLink - 1;
			const ownerContext = this.valueSourceContexts[ownerBinding];
			for (let keyLink = this.valueSourceHeads[key]; keyLink !== 0; keyLink = this.valueSourceNext[keyLink - 1]) {
				const keyBinding = keyLink - 1;
				const keyContext = this.valueSourceContexts[keyBinding];
				if (ownerContext && keyContext && ownerContext !== keyContext) {
					continue;
				}
				this.registerValueSource(
					value,
					appendValueIndex(
						this.valueSourceSources[ownerBinding],
						valueSourcePrefix(
							this.valueSourceSources[keyBinding],
							this.valueSourceStepCounts[keyBinding],
						),
						this.valueSourceStepCounts[ownerBinding],
					),
					ownerContext ?? keyContext,
				);
			}
		}
	}

	private materializeFunctionContext(
		context: FunctionValueContext,
		mode: CallInstantiationMode,
	): void {
		if (mode === CALL_EFFECTS && !context.effectsMaterialized) {
			context.effectsMaterialized = true;
			this.materializeFunctionContextEffects(context);
		}
		if (mode >= CALL_RETURNS && !context.returnsMaterialized) {
			context.returnsMaterialized = true;
			this.materializeFunctionContextReturns(context);
		}
	}

	private materializeFunctionContextEffects(context: FunctionValueContext): void {
		const flow = context.flow;
		for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
			this.materializeContextMember(context, flow.members[memberIndex]);
		}
		for (let callIndex = 0; callIndex < flow.calls.length; callIndex += 1) {
			this.materializeContextCall(context, flow.calls[callIndex], CALL_EFFECTS);
		}
		for (let assignmentIndex = 0; assignmentIndex < flow.assignments.length; assignmentIndex += 1) {
			this.materializeContextAssignment(context, flow.assignments[assignmentIndex]);
		}
	}

	private materializeContextAssignments(
		context: FunctionValueContext,
		source: SemanticValueSource,
		stepCount = source.steps.length,
	): void {
		const assignments = context.flow.assignmentsByTarget.get(
			this.identities.sourceKey(source, stepCount),
		);
		if (!assignments) {
			return;
		}
		for (let assignmentIndex = 0; assignmentIndex < assignments.length; assignmentIndex += 1) {
			this.materializeContextAssignment(context, assignments[assignmentIndex]);
		}
	}

	private materializeContextAssignment(
		context: FunctionValueContext,
		assignment: ValueAssignmentEntry,
	): void {
		if (!context.materializedAssignments.has(assignment)) {
			context.materializedAssignments.add(assignment);
			this.registerValueConstraint({
				target: { kind: 'source', source: assignment.target },
				source: assignment.source,
				relation: assignment.relation,
				context,
			});
		}
	}

	private registerContextEffectDependency(
		context: FunctionValueContext,
		entry: FunctionEffectDependencyEntry,
	): void {
		let materialized = this.materializedContextEffectDependencies.get(context);
		if (!materialized) {
			materialized = new Set();
			this.materializedContextEffectDependencies.set(context, materialized);
		}
		if (materialized.has(entry)) {
			return;
		}
		materialized.add(entry);
		this.pendingEffectDependencyContexts.push(context);
		this.pendingEffectDependencyEntries.push(entry);
	}

	private materializeContextEffectDependency(
		context: FunctionValueContext,
		entry: FunctionEffectDependencyEntry,
	): void {
		const sourceValue = this.resolveContextualValueSource(entry.source, context, true);
		const targetValue = this.resolveContextualValueSource(entry.target, context, true);
		if (!sourceValue || !targetValue) {
			return;
		}
		this.addEffectDependency(sourceValue, targetValue);
	}

	private addEffectDependency(source: SemanticValueID, target: SemanticValueID): void {
		if (!this.effectDependents.add(source, target)) {
			return;
		}
		const names = this.demandedEffectNamesByValue.get(source);
		if (!names) {
			return;
		}
		for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
			this.demandResolvedEffects(target, names[nameIndex]);
		}
	}

	private materializeFunctionContextReturns(context: FunctionValueContext): void {
		const flow = context.flow;
		const returns = this.functionReturnsByValue.get(flow.functionValue);
		if (!returns) {
			return;
		}
		for (let returnIndex = 0; returnIndex < returns.length; returnIndex += 1) {
			this.registerValueConstraint({
				target: { kind: 'value', value: context.returnValue },
				source: returns[returnIndex],
				relation: 'value',
				context,
			});
		}
	}

	private materializeContextCall(
		context: FunctionValueContext,
		call: CallValueEntry,
		mode: CallInstantiationMode,
	): SemanticValueID | undefined {
		let result: SemanticValueID | undefined;
		if (call.result) {
			const key = call.result.root.key;
			result = context.callResults.get(key);
			if (!result) {
				result = context.defaultContext
					? this.nodeForRoot(call.result.root)
					: this.createNode();
				context.callResults.set(key, result);
				this.registerValueSource(result, call.result, context);
			}
		}
		const previousMode = context.callModes.get(call);
		if (previousMode === undefined || previousMode < mode) {
			context.callModes.set(call, mode);
			this.registerCall(call, context, mode);
		}
		return result;
	}

	private materializeContextCallDemand(
		context: FunctionValueContext,
		demand: FunctionCallDemand,
	): void {
		const call = demand.call;
		if (!call.result) {
			this.registerCall(call, context, demand.mode, demand.targetFlow);
			return;
		}
		const key = call.result.root.key;
		let result = context.callResults.get(key);
		if (!result) {
			result = context.defaultContext
				? this.nodeForRoot(call.result.root)
				: this.createNode();
			context.callResults.set(key, result);
			this.registerValueSource(result, call.result, context);
		}
		this.registerCall(call, context, demand.mode, demand.targetFlow);
	}

	private registerCall(
		call: CallValueEntry,
		context?: FunctionValueContext,
		mode: CallInstantiationMode = CALL_EFFECTS,
		targetFlow?: MaterializedFunctionValueFlow,
		resolvedFlow?: MaterializedFunctionValueFlow,
	): void {
		if (resolvedFlow?.lexicalOwner) {
			targetFlow = resolvedFlow;
			resolvedFlow = undefined;
		}
		const resolvedTargets = resolvedFlow || targetFlow
			? undefined
			: this.resolvedCallTargets.get(call);
		if (!resolvedFlow && !resolvedTargets) {
			this.demandSource(call.callee);
		}
		for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
			const argument = call.arguments[argumentIndex];
			if (argument) {
				this.demandSource(argument);
			}
		}
		if (mode >= CALL_RETURNS && call.result) {
			this.demandSource(call.result);
		}
		if (resolvedFlow) {
			const callIndex = this.calls.length;
			this.calls.push({ call, context, mode, resolvedFlow });
			this.callWorklist.add(callIndex);
			return;
		}
		if (resolvedTargets) {
			for (let index = 0; index < resolvedTargets.length; index += 1) {
				const flow = this.materializeFunctionFlow(resolvedTargets[index]);
				if (flow.lexicalOwner) {
					this.demandSource(call.callee);
				}
				const callIndex = this.calls.length;
				this.calls.push(flow.lexicalOwner
					? { call, context, mode, targetFlow: flow }
					: { call, context, mode, resolvedFlow: flow });
				this.callWorklist.add(callIndex);
			}
			return;
		}
		const callIndex = this.calls.length;
		this.calls.push({ call, context, mode, targetFlow });
		this.callWorklist.add(callIndex);
	}

	private processPendingValueConstraints(): void {
		while (this.valueFlowWorklist.length > 0) {
			const constraintIndex = this.valueFlowWorklist.take();
			const constraint = this.valueFlowConstraints[constraintIndex];
			const dependencies = this.dependencyScratch;
			dependencies.length = 0;
			const context = constraint.context;
			const targets = this.assignmentTargetScratch;
			targets.length = 0;
			if (constraint.target.kind === 'value') {
				targets.push(constraint.target.value);
			} else {
				this.resolveAssignmentTargets(
					constraint.target.source,
					constraint.relation,
					context,
					dependencies,
					targets,
				);
			}
			const source = context
				? this.resolveContextualValueSource(constraint.source, context, true, dependencies)
				: this.resolveSource(constraint.source, true, dependencies);
			for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
				this.valueFlowWorklist.retain(constraintIndex, dependencies[dependencyIndex]);
			}
			for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
				const target = targets[targetIndex];
				if (constraint.target.kind === 'source') {
					this.registerValueSource(target, constraint.target.source, context);
					if (constraint.target.memberDeclId) {
						this.retainMemberDeclaration(target, constraint.target.memberDeclId);
					}
				}
				this.attachResolvedValue(target, source, constraint.relation);
			}
		}
	}

	private resolveAssignmentTargets(
		target: SemanticValueSource,
		relation: ValueFlowRelation,
		context: FunctionValueContext | undefined,
		dependencies: SemanticValueID[],
		out: SemanticValueID[],
	): void {
		const stepCount = target.steps.length;
		if (stepCount === 0) {
			const value = context
				? this.resolveContextualValueSource(target, context, true, dependencies)
				: this.resolveSource(target, true, dependencies);
			if (value) {
				if (relation === 'metatable' || relation === 'prototype') {
					this.collectValueAlternatives(value, out);
					if (!out.includes(value)) {
						out.push(value);
					}
				} else {
					out.push(value);
				}
			}
			return;
		}
		const owner = context
			? this.resolveContextualValueSource(target, context, true, dependencies, stepCount - 1)
			: this.resolveValuePrefix(target, stepCount - 1, dependencies);
		if (!owner) {
			return;
		}
		dependencies.push(owner);
		const owners = this.assignmentOwnerScratch;
		owners.length = 0;
		this.collectValueAlternatives(owner, owners);
		const step = target.steps[stepCount - 1];
		switch (step.kind) {
			case 'member':
				for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
					out.push(this.ensureMember(owners[ownerIndex], step.name).value);
				}
				return;
			case 'index': {
				const key = context
					? this.resolveContextualValueSource(step.key, context, true, dependencies)
					: this.resolveSource(step.key, true, dependencies);
				if (!key) {
					return;
				}
				dependencies.push(key);
				const keys = this.assignmentKeyScratch;
				keys.length = 0;
				this.collectValueAlternatives(key, keys);
				for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
					for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
						out.push(this.ensureIndexedValue(owners[ownerIndex], keys[keyIndex]));
					}
				}
				return;
			}
			case 'element':
				for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex += 1) {
					out.push(this.ensureElement(owners[ownerIndex]));
				}
				return;
			case 'call':
			case 'instance':
			case 'metatable': {
				const value = context
					? this.resolveContextualValueSource(target, context, true, dependencies)
					: this.resolveSource(target, true, dependencies);
				if (value) {
					out.push(value);
				}
			}
		}
	}

	private resolveValuePrefix(
		source: SemanticValueSource,
		stepCount: number,
		dependencies: SemanticValueID[],
	): SemanticValueID | undefined {
		const value = this.resolveValueRoot(source.root);
		return value
			? this.resolveValueSteps(value, source.steps, true, dependencies, stepCount)
			: undefined;
	}

	private collectValueAlternatives(
		value: SemanticValueID,
		out: SemanticValueID[],
	): void {
		out.length = 0;
		const stack = this.valueAlternativeStack;
		const nodes = this.valueAlternativeNodes;
		stack.length = 0;
		nodes.length = 0;
		const generation = this.valueAlternativeGeneration + 1;
		this.valueAlternativeGeneration = generation;
		stack.push(value);
		while (stack.length > 0) {
			const candidate = stack.pop()!;
			if (this.valueAlternativeMarks[candidate] === generation) {
				continue;
			}
			const nodeStart = nodes.length;
			this.valueAlternativeMarks[candidate] = generation;
			nodes.push(candidate);
			for (let nodeIndex = nodeStart; nodeIndex < nodes.length; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				for (let edge = this.identityValues.first(node); edge !== 0; edge = this.identityValues.next(edge)) {
					const identity = this.identityValues.target(edge);
					if (this.valueAlternativeMarks[identity] !== generation) {
						this.valueAlternativeMarks[identity] = generation;
						nodes.push(identity);
					}
				}
			}
			const nodeEnd = nodes.length;
			let expanded = false;
			for (let nodeIndex = nodeStart; nodeIndex < nodeEnd; nodeIndex += 1) {
				const node = nodes[nodeIndex];
				for (let edge = this.projectionBases.first(node); edge !== 0; edge = this.projectionBases.next(edge)) {
					stack.push(this.projectionBases.target(edge));
					expanded = true;
				}
				for (let edge = this.valueBases.first(node); edge !== 0; edge = this.valueBases.next(edge)) {
					stack.push(this.valueBases.target(edge));
					expanded = true;
				}
			}
			if (!expanded) {
				out.push(this.findIdentityRoot(candidate));
			}
		}
	}

	private processPendingCalls(): void {
		while (this.callWorklist.length > 0) {
			const callIndex = this.callWorklist.take();
			const contextualCall = this.calls[callIndex];
			const call = contextualCall.call;
			const context = contextualCall.context;
			const dependencies = this.dependencyScratch;
			dependencies.length = 0;
			const resolvedFlow = contextualCall.resolvedFlow;
			const callee = resolvedFlow
				? undefined
				: context
					? this.resolveContextualValueSource(call.callee, context, false, dependencies)
					: this.resolveSource(call.callee, false, dependencies);
			if (resolvedFlow || callee) {
				if (callee) {
					dependencies.push(callee);
				}
				const argumentValues = this.callArgumentValueScratch;
				argumentValues.length = call.arguments.length;
				for (let argumentIndex = 0; argumentIndex < call.arguments.length; argumentIndex += 1) {
					const argument = call.arguments[argumentIndex];
					const argumentValue = argument
						? context
							? this.resolveContextualValueSource(argument, context, true, dependencies)
							: this.resolveSource(argument, true, dependencies)
						: undefined;
					argumentValues[argumentIndex] = argumentValue;
					if (argumentValue) {
						dependencies.push(argumentValue);
					}
				}
				const result = contextualCall.mode !== CALL_BINDINGS && call.result
					? context
						? context.callResults.get(call.result.root.key)
						: this.resolveSource(call.result, true)
					: undefined;
				if (resolvedFlow) {
					this.instantiateMaterializedFunctionCall(
						resolvedFlow,
						undefined,
						argumentValues,
						result,
						call,
						context,
						contextualCall.mode,
					);
				} else {
					this.instantiateFunctionCall(
						callee,
						argumentValues,
						result,
						call,
						context,
						contextualCall.mode,
						contextualCall.targetFlow,
					);
				}
			}
			for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
				this.callWorklist.retain(callIndex, dependencies[dependencyIndex]);
			}
		}
	}

	private resolveContextualValueSource(
		source: SemanticValueSource,
		context: FunctionValueContext,
		createMembers: boolean,
		dependencies?: SemanticValueID[],
		stepCount = source.steps.length,
	): SemanticValueID | undefined {
		this.materializeEnclosingContextAssignments(context, source, 0);
		let value = this.resolveContextualValueRoot(source.root, context, createMembers, dependencies);
		for (let stepIndex = 0; value && stepIndex < stepCount; stepIndex += 1) {
			if (dependencies) {
				dependencies.push(value);
			}
			const step = source.steps[stepIndex];
			switch (step.kind) {
				case 'member':
					value = this.resolveMemberValue(value, step.name, createMembers, false);
					break;
				case 'index': {
					const key = this.resolveContextualValueSource(step.key, context, createMembers, dependencies);
					if (key && dependencies) {
						dependencies.push(key);
					}
					value = key ? this.resolveIndexedValue(value, key, createMembers, false) : undefined;
					break;
				}
				case 'element':
					value = this.resolveElementValue(value, createMembers, false);
					break;
				case 'call':
					value = this.resolveCallValue(value);
					break;
				case 'instance':
					value = this.ensureInstance(value);
					break;
				case 'metatable':
					value = this.resolveMetatableValue(value, false);
					break;
			}
			this.materializeEnclosingContextAssignments(context, source, stepIndex + 1);
		}
		return value;
	}

	private materializeEnclosingContextAssignments(
		context: FunctionValueContext,
		source: SemanticValueSource,
		stepCount: number,
	): void {
		let activeContext: FunctionValueContext | undefined = context;
		while (activeContext) {
			this.materializeContextAssignments(activeContext, source, stepCount);
			activeContext = activeContext.closure;
		}
	}

	private resolveContextualValueRoot(
		root: SemanticValueRoot,
		context: FunctionValueContext,
		createMembers: boolean,
		dependencies?: SemanticValueID[],
	): SemanticValueID | undefined {
		if (root.kind === 'declaration') {
			let activeContext: FunctionValueContext | undefined = context;
			while (activeContext) {
				if (this.functionFlowByDeclaration.get(root.declId) === activeContext.flow) {
					const parameterIndex = this.parameterIndexForRoot(root, activeContext.flow);
					if (parameterIndex !== -1) {
						return activeContext.parameterValues[parameterIndex];
					}
					return this.resolveContextualDeclaration(root.declId, activeContext, createMembers, dependencies);
				}
				activeContext = activeContext.closure;
			}
		}
		if (root.kind === 'owned') {
			let activeContext: FunctionValueContext | undefined = context;
			while (activeContext) {
				const result = activeContext.callResults.get(root.key)
					?? this.materializeContextCallResult(activeContext, root.key);
				if (result) {
					return result;
				}
				const parameterIndex = this.parameterIndexForRoot(root, activeContext.flow);
				if (parameterIndex !== -1) {
					return activeContext.parameterValues[parameterIndex];
				}
				if (activeContext.flow.ownedValueKeys.has(root.key)) {
					return this.ownedValueInContext(activeContext, root.key);
				}
				activeContext = activeContext.closure;
			}
		}
		return this.resolveValueRoot(root);
	}

	private materializeContextCallResult(
		context: FunctionValueContext,
		key: string,
	): SemanticValueID | undefined {
		const calls = context.flow.calls;
		for (let index = 0; index < calls.length; index += 1) {
			const call = calls[index];
			if (call.result?.root.key === key) {
				return this.materializeContextCall(context, call, CALL_RETURNS);
			}
		}
		return undefined;
	}

	private resolveContextualDeclaration(
		declId: SymbolID,
		context: FunctionValueContext,
		_createMembers: boolean,
		_dependencies?: SemanticValueID[],
	): SemanticValueID {
		if (context.defaultContext) {
			return this.nodeForRoot({ kind: 'declaration', declId });
		}
		const sources = this.demandIndex.declarationValues.get(declId);
		let value = context.localValues.get(declId);
		if (!value) {
			value = this.createNode();
			context.localValues.set(declId, value);
			this.registerValueSource(value, declarationValueSource(declId), context);
		}
		if (!sources || sources.length === 0 || context.resolvedLocals.has(declId)) {
			return value;
		}
		context.resolvedLocals.add(declId);
		const relation: DeclarationValueRelation = this.demandIndex.identityDeclarations.has(declId)
			? 'identity'
			: this.demandIndex.projectionDeclarations.has(declId)
				? 'projection'
				: 'value';
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
			this.registerValueConstraint({
				target: { kind: 'value', value },
				source: sources[sourceIndex],
				relation,
				context,
			});
		}
		return value;
	}

	private parameterIndexForRoot(
		root: SemanticValueRoot,
		flow: MaterializedFunctionValueFlow,
	): number {
		const parameters = flow.parameters;
		for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
			const parameterRoot = parameters[parameterIndex].root;
			if (root.kind === 'declaration'
				? parameterRoot.kind === 'declaration' && parameterRoot.declId === root.declId
				: root.kind === 'owned'
					&& parameterRoot.kind === 'owned'
					&& parameterRoot.key === root.key) {
				return parameterIndex;
			}
		}
		return -1;
	}

	private instantiateFunctionCall(
		callee: SemanticValueID,
		argumentValues: readonly (SemanticValueID | undefined)[],
		result: SemanticValueID | undefined,
		callSite?: CallValueEntry,
		caller?: FunctionValueContext,
		mode: CallInstantiationMode = CALL_EFFECTS,
		targetFlow?: MaterializedFunctionValueFlow,
	): void {
		const flows = this.functionFlowScratch;
		const closures = this.functionClosureScratch;
		flows.length = 0;
		closures.length = 0;
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		stack.push(callee);
		while (stack.length > 0) {
			const candidate = stack.pop()!;
			if (this.traversalMarks[candidate] === generation) {
				continue;
			}
			this.traversalMarks[candidate] = generation;
			const flow = this.functionFlowsByValue.get(candidate);
			if (flow) {
				if (targetFlow && flow !== targetFlow) {
					this.pushTraversalBases(stack, candidate);
					continue;
				}
				const closure = this.functionClosuresByValue.get(candidate);
				let duplicate = false;
				for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
					if (flows[flowIndex] === flow && closures[flowIndex] === closure) {
						duplicate = true;
						break;
					}
				}
				if (!duplicate) {
					flows.push(flow);
					closures.push(closure);
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
		for (let flowIndex = 0; flowIndex < flows.length; flowIndex += 1) {
			this.instantiateMaterializedFunctionCall(
				flows[flowIndex],
				closures[flowIndex],
				argumentValues,
				result,
				callSite,
				caller,
				mode,
			);
		}
	}

	private instantiateMaterializedFunctionCall(
		flow: MaterializedFunctionValueFlow,
		closure: FunctionValueContext | undefined,
		argumentValues: readonly (SemanticValueID | undefined)[],
		result: SemanticValueID | undefined,
		callSite: CallValueEntry | undefined,
		caller: FunctionValueContext | undefined,
		mode: CallInstantiationMode,
	): void {
		const parameters = flow.parameters;
		const argumentCount = Math.min(parameters.length, argumentValues.length);
		for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
			const argument = argumentValues[argumentIndex];
			if (argument) {
				const parameter = this.nodeForRoot(parameters[argumentIndex].root);
				if (parameter !== argument) {
					this.addEdge(this.callArgumentBases, parameter, argument);
				}
			}
		}
		if (mode === CALL_BINDINGS) {
			return;
		}
		let context: FunctionValueContext;
		if (!flow.requiresCallContext && (!closure || closure.defaultContext)) {
			context = this.defaultFunctionContext(flow, mode);
			this.bindFunctionContextArguments(context, argumentValues);
		} else {
			context = this.functionCallContext(
				flow,
				argumentValues,
				closure,
				flow.requiresCallContext ? callSite : undefined,
				flow.requiresCallerContext ? caller?.callSite : undefined,
				mode,
			);
		}
		if (result && context.returnValue !== result) {
			this.addValueBase(result, context.returnValue);
		}
	}

	private functionCallContext(
		flow: MaterializedFunctionValueFlow,
		argumentValues: readonly (SemanticValueID | undefined)[],
		closure: FunctionValueContext | undefined,
		callSite: CallValueEntry | undefined,
		parentCallSite: CallValueEntry | undefined,
		mode: CallInstantiationMode,
	): FunctionValueContext {
		this.materializeFunctionFlowReturns(flow);
		let contexts = this.functionContextsByValue.get(flow.functionValue);
		if (contexts) {
			for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
				const context = contexts[contextIndex];
				if (!context.defaultContext
					&& context.closure === closure
					&& context.callSite === callSite
					&& context.parentCallSite === parentCallSite
					&& this.contextArgumentsEqual(context, argumentValues, callSite)) {
					this.materializeFunctionContext(context, mode);
					this.bindFunctionContextArguments(context, argumentValues);
					return context;
				}
			}
		}
		const parameterValues = new Array<SemanticValueID>(flow.parameters.length);
		for (let parameterIndex = 0; parameterIndex < parameterValues.length; parameterIndex += 1) {
			parameterValues[parameterIndex] = this.createNode();
		}
		const contextParameterIndices = flow.contextParameterIndices;
		const contextArguments = new Array<SemanticValueID | undefined>(contextParameterIndices.length);
		for (let index = 0; index < contextParameterIndices.length; index += 1) {
			const parameterIndex = contextParameterIndices[index];
			contextArguments[index] = this.contextArgument(argumentValues, callSite, parameterIndex);
		}
		const context = this.createFunctionContext(
			flow,
			parameterValues,
			closure,
			false,
			callSite,
			parentCallSite,
			contextArguments,
			mode,
		);
		this.bindFunctionContextArguments(context, argumentValues);
		return context;
	}

	private materializeFunctionFlowReturns(flow: MaterializedFunctionValueFlow): void {
		const entry = flow.source;
		this.materializeFunctionReturns(
			this.demandIndex.returns(semanticValueRootKey(entry.functionValue.root)),
		);
	}

	private contextArgumentsEqual(
		context: FunctionValueContext,
		argumentValues: readonly (SemanticValueID | undefined)[],
		callSite: CallValueEntry | undefined,
	): boolean {
		const indices = context.flow.contextParameterIndices;
		const contextArguments = context.contextArguments;
		for (let index = 0; index < indices.length; index += 1) {
			if (contextArguments[index] !== this.contextArgument(argumentValues, callSite, indices[index])) {
				return false;
			}
		}
		return true;
	}

	private contextArgument(
		argumentValues: readonly (SemanticValueID | undefined)[],
		callSite: CallValueEntry | undefined,
		parameterIndex: number,
	): SemanticValueID | undefined {
		const source = callSite?.arguments[parameterIndex];
		// Derived expressions already belong to this syntactic call site. Using
		// their transient graph nodes as context keys would recursively clone
		// contexts for ordinary scalar/dataflow transformations. Direct values
		// retain identity sensitivity; derived values widen into the call-site
		// summary while their value flow remains attached to the parameter.
		if (source && source.steps.length > 0) {
			return undefined;
		}
		const argument = argumentValues[parameterIndex];
		return argument ? this.contextOrigin(argument) : undefined;
	}

	private contextOrigin(value: SemanticValueID): SemanticValueID {
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		while (this.traversalMarks[value] !== generation) {
			this.traversalMarks[value] = generation;
			const origin = this.contextOrigins[value];
			if (origin) {
				value = origin;
				continue;
			}
			let base: SemanticValueID | undefined;
			for (let edge = this.projectionBases.first(value); edge !== 0; edge = this.projectionBases.next(edge)) {
				const candidate = this.projectionBases.target(edge);
				if (base && base !== candidate) {
					return this.findIdentityRoot(value);
				}
				base = candidate;
			}
			for (let edge = this.valueBases.first(value); edge !== 0; edge = this.valueBases.next(edge)) {
				const candidate = this.valueBases.target(edge);
				if (base && base !== candidate) {
					return this.findIdentityRoot(value);
				}
				base = candidate;
			}
			if (!base) {
				return this.findIdentityRoot(value);
			}
			value = base;
		}
		return this.findIdentityRoot(value);
	}

	private bindFunctionContextArguments(
		context: FunctionValueContext,
		argumentValues: readonly (SemanticValueID | undefined)[],
	): void {
		const count = Math.min(context.parameterValues.length, argumentValues.length);
		for (let argumentIndex = 0; argumentIndex < count; argumentIndex += 1) {
			const argument = argumentValues[argumentIndex];
			if (argument) {
				this.addValueBase(context.parameterValues[argumentIndex], argument);
			}
		}
	}

	private materializeValueAssignments(entries: readonly ValueAssignmentEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (this.materializedRootAssignments.has(entry)) {
				continue;
			}
			this.materializedRootAssignments.add(entry);
			this.demandSource(entry.target);
			this.demandSource(entry.source);
			this.registerValueConstraint({
				target: { kind: 'source', source: entry.target },
				source: entry.source,
				relation: entry.relation,
			});
		}
	}

	private materializeRootCalls(
		entries: readonly CallValueEntry[],
		mode: CallInstantiationMode = CALL_EFFECTS,
		targetFlow?: MaterializedFunctionValueFlow,
	): void {
		for (let index = 0; index < entries.length; index += 1) {
			this.materializeRootCall(entries[index], mode, targetFlow);
		}
	}

	private materializeRootCall(
		call: CallValueEntry,
		mode: CallInstantiationMode,
		targetFlow?: MaterializedFunctionValueFlow,
	): void {
		if (targetFlow) {
			if (!this.upgradeTargetCallMode(this.materializedTargetRootCallModes, call, targetFlow, mode)) {
				return;
			}
		} else {
			const previousMode = this.materializedRootCallModes.get(call);
			if (previousMode !== undefined && previousMode >= mode) {
				return;
			}
			this.materializedRootCallModes.set(call, mode);
		}
		this.registerCall(call, undefined, mode, targetFlow);
	}

	private upgradeTargetCallMode(
		modesByCall: Map<CallValueEntry, Map<MaterializedFunctionValueFlow, CallInstantiationMode>>,
		call: CallValueEntry,
		targetFlow: MaterializedFunctionValueFlow,
		mode: CallInstantiationMode,
	): boolean {
		let modes = modesByCall.get(call);
		if (!modes) {
			modes = new Map();
			modesByCall.set(call, modes);
		}
		const previousMode = modes.get(targetFlow);
		if (previousMode !== undefined && previousMode >= mode) {
			return false;
		}
		modes.set(targetFlow, mode);
		return true;
	}

	private nodeForRoot(
		root: Exclude<SemanticValueRoot, { kind: 'global' }>,
	): SemanticValueID;
	private nodeForRoot(root: SemanticValueRoot): SemanticValueID | undefined;
	private nodeForRoot(root: SemanticValueRoot): SemanticValueID | undefined {
		if (root.kind === 'global') {
			const declId = this.demandIndex.globalValues.get(root.symbolKey);
			return declId === undefined
				? undefined
				: this.nodeForRoot({ kind: 'declaration', declId });
		}
		let nodes: Map<SymbolID | string, SemanticValueID>;
		let key: SymbolID | string;
		switch (root.kind) {
			case 'declaration':
				nodes = this.declarationNodes;
				key = root.declId;
				break;
			case 'module':
				nodes = this.moduleNodes;
				key = root.module;
				break;
			case 'owned':
				nodes = this.ownedNodes;
				key = root.key;
				break;
			case 'literal':
				nodes = this.literalNodes;
				key = root.key;
				break;
		}
		let value = nodes.get(key);
		if (!value) {
			value = this.createNode();
			nodes.set(key, value);
			this.registerValueSource(value, { root, steps: EMPTY_VALUE_STEPS });
		}
		return value;
	}

	private createNode(): SemanticValueID {
		const value = this.nextValueId as SemanticValueID;
		this.nextValueId += 1;
		if (value === this.valueCapacity) {
			this.valueCapacity *= 2;
			this.identityValues.resizeOwners(this.valueCapacity);
			this.projectionBases.resizeOwners(this.valueCapacity);
			this.callArgumentBases.resizeOwners(this.valueCapacity);
			this.valueBases.resizeOwners(this.valueCapacity);
			this.effectDependents.resizeOwners(this.valueCapacity);
			this.instanceBases.resizeOwners(this.valueCapacity);
			this.instanceAllocations.resizeOwners(this.valueCapacity);
			this.traversalDependents.resizeOwners(this.valueCapacity);
			this.callWorklist.resizeValues(this.valueCapacity);
			this.valueFlowWorklist.resizeValues(this.valueCapacity);
		}
		this.identityParents[value] = value;
		this.identitySizes[value] = 1;
		this.materializedValueTargets[value] = false;
		this.valueSourceHeads[value] = 0;
		this.unresolvedMemberHeadByOwner[value] = 0;
		return value;
	}
}
