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

export type SemanticMemberQuery = {
	receiverValue?: SemanticValueSource;
	name: string;
};

type MemberValue = {
	value: SemanticValueID;
	declaration?: SymbolID;
};

type MemberDeclaration = {
	id: SymbolID;
	order: number;
};

type MaterializedFunctionValueFlow = {
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
	nestedFunctions: NestedFunctionValueFlow[];
	lexicalOwner?: MaterializedFunctionValueFlow;
};

type NestedFunctionValueFlow = {
	flow: MaterializedFunctionValueFlow;
	ownedKey: string;
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
};

type ContextualCallValue = {
	call: CallValueEntry;
	context?: FunctionValueContext;
};

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

export function appendValueMember(source: SemanticValueSource, name: string): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'member', name }),
	};
}

export function appendValueElement(source: SemanticValueSource): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'element' }),
	};
}

export function appendValueIndex(
	source: SemanticValueSource,
	key: SemanticValueSource,
): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'index', key }),
	};
}

export function appendValueInstance(source: SemanticValueSource): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'instance' }),
	};
}

export function appendValueMetatable(source: SemanticValueSource): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'metatable' }),
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

export type WorkspaceValueGraphInput = {
	declarationValues: ReadonlyMap<SymbolID, readonly SemanticValueSource[]>;
	identityDeclarations: ReadonlySet<SymbolID>;
	projectionDeclarations: ReadonlySet<SymbolID>;
	moduleValues: ReadonlyMap<string, SemanticValueSource>;
	memberValues: readonly MemberValueEntry[];
	functionReturns: readonly FunctionReturnValueEntry[];
	functionFlows: readonly FunctionValueFlowEntry[];
	calls: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
	globalValues: ReadonlyMap<string, SymbolID>;
};

export class WorkspaceValueGraph {
	private readonly declarationValues: Map<SymbolID, SemanticValueSource[]>;
	private readonly identityDeclarations: ReadonlySet<SymbolID>;
	private readonly projectionDeclarations: ReadonlySet<SymbolID>;
	private readonly moduleValues: ReadonlyMap<string, SemanticValueSource>;
	private readonly globalValues: ReadonlyMap<string, SymbolID>;
	private readonly rootCalls: readonly CallValueEntry[];
	private readonly calls: ContextualCallValue[] = [];
	private readonly declarationNodes: Map<SymbolID, SemanticValueID> = new Map();
	private readonly moduleNodes: Map<string, SemanticValueID> = new Map();
	private readonly literalNodes: Map<string, SemanticValueID> = new Map();
	private readonly ownedNodes: Map<string, SemanticValueID> = new Map();
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
	private readonly materializedFunctionFlows: MaterializedFunctionValueFlow[] = [];
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
	private readonly prototypeBases: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly instanceBases = new SemanticValueEdges();
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
	private readonly valueAlternativeStack: SemanticValueID[] = [];
	private readonly valueAlternativeNodes: SemanticValueID[] = [];
	private readonly valueAlternativeMarks: number[] = [];
	private valueAlternativeGeneration = 0;
	private readonly callArgumentValueScratch: (SemanticValueID | undefined)[] = [];
	private readonly contextOrigins: (SemanticValueID | undefined)[] = [];
	private readonly functionFlowScratch: MaterializedFunctionValueFlow[] = [];
	private readonly functionClosureScratch: (FunctionValueContext | undefined)[] = [];
	private readonly indexedSourceScratch: SemanticValueSource[] = [];
	private readonly indexedSourceDeclarations: Set<SymbolID> = new Set();
	private readonly indexedSourceOwnedValues: Set<string> = new Set();
	private readonly indexedDependencyScratch: SemanticValueSource[] = [];
	private readonly indexedDependencyDeclarations: Set<SymbolID> = new Set();
	private readonly indexedDependencyCallResults: Set<string> = new Set();
	private readonly indexedParameterMarks: boolean[] = [];
	private readonly indexedEffectParameterMarks: boolean[] = [];
	private contextAnalysisReturnsParameter = false;
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
	constructor(options: WorkspaceValueGraphInput) {
		this.declarationValues = new Map();
		for (const [declId, sources] of options.declarationValues) {
			this.declarationValues.set(declId, sources.slice());
		}
		this.moduleValues = options.moduleValues;
		this.identityDeclarations = options.identityDeclarations;
		this.projectionDeclarations = options.projectionDeclarations;
		this.globalValues = options.globalValues;
		this.rootCalls = options.calls;
		this.materializeMembers(options.memberValues);
		this.materializeFunctionReturns(options.functionReturns);
		this.materializeFunctionFlows(options.functionFlows);
		this.materializeRootValues();
		this.materializeValueAssignments(options.valueAssignments);
		this.solveCallArgumentValues();
	}

	public resolveMembers(
		source: SemanticValueSource | undefined,
		name: string,
	): readonly SymbolID[] {
		if (!source) {
			return EMPTY_MEMBER_IDS;
		}
		let owner = this.resolveSource(source, false, undefined, true);
		let members = EMPTY_MEMBER_IDS;
		if (owner) {
			members = this.findMembers(owner, name);
		}
		if (members.length > 0) {
			return members;
		}
		const flow = source.root.kind === 'declaration'
			? this.functionFlowByDeclaration.get(source.root.declId)
			: source.root.kind === 'owned'
				? this.functionFlowByOwnedValue.get(source.root.key)
				: undefined;
		if (!flow || this.defaultFunctionContextsByValue.has(flow.functionValue)) {
			return EMPTY_MEMBER_IDS;
		}
		this.defaultFunctionContext(flow);
		this.solveValueChanges();
		owner = this.resolveSource(source, false, undefined, true);
		return owner ? this.findMembers(owner, name) : EMPTY_MEMBER_IDS;
	}

	public prepareMemberQueries(queries: readonly SemanticMemberQuery[]): void {
		let pending = false;
		for (let index = 0; index < queries.length; index += 1) {
			const source = queries[index].receiverValue;
			if (!source) {
				continue;
			}
			const owner = this.resolveSource(source, false, undefined, true);
			if (owner && this.findMembers(owner, queries[index].name).length > 0) {
				continue;
			}
			const flow = source.root.kind === 'declaration'
				? this.functionFlowByDeclaration.get(source.root.declId)
				: source.root.kind === 'owned'
					? this.functionFlowByOwnedValue.get(source.root.key)
					: undefined;
			if (flow && !this.defaultFunctionContextsByValue.has(flow.functionValue)) {
				this.defaultFunctionContext(flow);
				pending = true;
			}
		}
		if (pending) {
			this.solveValueChanges();
		}
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
			)
			: undefined;
	}

	private resolveValueRoot(root: SemanticValueRoot): SemanticValueID | undefined {
		switch (root.kind) {
			case 'declaration':
				return this.nodeFor(this.declarationNodes, root.declId);
			case 'module':
				return this.nodeFor(this.moduleNodes, root.module);
			case 'global': {
				const declId = this.globalValues.get(root.symbolKey);
				return declId ? this.nodeFor(this.declarationNodes, declId) : undefined;
			}
			case 'owned':
				return this.nodeFor(this.ownedNodes, root.key);
			case 'literal':
				return this.nodeFor(this.literalNodes, root.key);
		}
	}

	private resolveValueSteps(
		value: SemanticValueID,
		steps: readonly SemanticValueStep[],
		createMembers: boolean,
		dependencies?: SemanticValueID[],
		stepCount = steps.length,
		useCallArgumentHints = false,
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
		}
		return value;
	}

	private resolveCallValue(value: SemanticValueID): SemanticValueID {
		let result = this.callResults.get(value);
		if (!result) {
			result = this.createNode();
			this.callResults.set(value, result);
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
		}
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
			const entry = entries[index];
			const owner = this.resolveSource(entry.owner, true);
			if (!owner) {
				continue;
			}
			const member = this.ensureMember(owner, entry.name);
			if (!member.declaration) {
				member.declaration = entry.declId;
				this.markTraversalChanged(owner);
			}
			this.retainMemberDeclaration(member.value, entry.declId);
			this.addIdentity(member.value, this.nodeFor(this.declarationNodes, entry.declId));
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
			const functionValue = this.materializeFunctionValue(entry.functionValue);
			let sources = this.functionReturnsByValue.get(functionValue);
			if (!sources) {
				sources = [];
				this.functionReturnsByValue.set(functionValue, sources);
			}
			sources.push(entry.source);
		}
	}

	private materializeFunctionFlows(entries: readonly FunctionValueFlowEntry[]): void {
		const ownerFlowByOwnedKey = new Map<string, MaterializedFunctionValueFlow>();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const functionValue = this.materializeFunctionValue(entry.functionValue);
			const contextParameterIndices = this.collectContextParameterIndices(entry);
			const returnsParameter = this.contextAnalysisReturnsParameter;
			const parameterIndexedEffect = this.collectParameterIndexedEffect(
				entry,
				contextParameterIndices,
			);
			// Reuse one summary for ordinary functions. A separate abstract call
			// context is required only where parameter identity changes a returned
			// lookup, a direct return, a receiver, or an indexed heap effect.
			// Effectful methods additionally retain one caller site so an inner
			// method invocation does not merge independent outer mutations.
			const flow: MaterializedFunctionValueFlow = {
				functionValue,
				parameters: entry.parameters,
				contextParameterIndices,
				requiresCallContext: contextParameterIndices.length > 0
					|| returnsParameter
					|| parameterIndexedEffect,
				requiresCallerContext: entry.implicitReceiver && parameterIndexedEffect,
				receiverProjection: entry.receiverProjection,
				implicitReceiver: entry.implicitReceiver,
				declarationIds: entry.declarationIds,
				ownedValueKeys: new Set(entry.ownedValueKeys),
				members: entry.members,
				calls: entry.calls,
				assignments: entry.assignments,
				nestedFunctions: [],
			};
			this.materializedFunctionFlows.push(flow);
			this.functionFlowsByValue.set(functionValue, flow);
			if (flow.implicitReceiver) {
				this.registerValueConstraint({
					target: {
						kind: 'value',
						value: this.materializeFunctionValue(flow.parameters[0]),
					},
					source: flow.receiverProjection,
					relation: 'projection',
				});
			}
			for (const ownedKey of flow.ownedValueKeys) {
				ownerFlowByOwnedKey.set(ownedKey, flow);
				this.functionFlowByOwnedValue.set(ownedKey, flow);
			}
			for (let parameterIndex = 0; parameterIndex < flow.parameters.length; parameterIndex += 1) {
				const parameter = flow.parameters[parameterIndex];
				if (parameter.root.kind === 'owned') {
					this.functionFlowByOwnedValue.set(parameter.root.key, flow);
				}
			}
			for (let declarationIndex = 0; declarationIndex < entry.declarationIds.length; declarationIndex += 1) {
				const declarationId = entry.declarationIds[declarationIndex];
				this.functionFlowByDeclaration.set(declarationId, flow);
			}
			const receiver = entry.parameters[0];
			if (entry.receiverProjection && receiver) {
				for (let memberIndex = 0; memberIndex < entry.members.length; memberIndex += 1) {
					const member = entry.members[memberIndex];
					if (semanticValueSourcesEqual(member.owner, receiver)) {
						this.enclosingFunctionFlowByValue.set(
							this.nodeFor(this.declarationNodes, member.declId),
							flow,
						);
					}
				}
			}
		}
		for (let index = 0; index < entries.length; index += 1) {
			const functionValue = entries[index].functionValue;
			if (functionValue.root.kind !== 'owned' || functionValue.steps.length !== 0) {
				continue;
			}
			const flow = this.materializedFunctionFlows[index];
			const owner = ownerFlowByOwnedKey.get(functionValue.root.key);
			if (!owner || owner === flow) {
				continue;
			}
			flow.lexicalOwner = owner;
			owner.nestedFunctions.push({ flow, ownedKey: functionValue.root.key });
		}
	}

	private collectContextParameterIndices(entry: FunctionValueFlowEntry): number[] {
		const sources = this.indexedSourceScratch;
		sources.length = 0;
		const functionValue = this.materializeFunctionValue(entry.functionValue);
		const returns = this.functionReturnsByValue.get(functionValue);
		if (returns) {
			for (let returnIndex = 0; returnIndex < returns.length; returnIndex += 1) {
				sources.push(returns[returnIndex]);
			}
		}

		const marks = this.indexedParameterMarks;
		marks.length = entry.parameters.length;
		marks.fill(false);
		if (entry.implicitReceiver) {
			marks[0] = true;
		}
		this.contextAnalysisReturnsParameter = false;
		this.indexedSourceDeclarations.clear();
		this.indexedSourceOwnedValues.clear();
		this.indexedDependencyDeclarations.clear();
		this.indexedDependencyCallResults.clear();
		while (sources.length > 0) {
			const source = sources.pop()!;
			if (!this.contextAnalysisReturnsParameter && source.steps.length === 0) {
				for (let parameterIndex = 0; parameterIndex < entry.parameters.length; parameterIndex += 1) {
					if (semanticValueRootsEqual(source.root, entry.parameters[parameterIndex].root)) {
						this.contextAnalysisReturnsParameter = true;
						break;
					}
				}
			}
			for (let stepIndex = 0; stepIndex < source.steps.length; stepIndex += 1) {
				const step = source.steps[stepIndex];
				if (step.kind === 'index') {
					this.collectIndexedParameterDependencies(step.key, entry, marks);
					sources.push(step.key);
				}
			}
			if (source.root.kind === 'declaration'
				&& !this.indexedSourceDeclarations.has(source.root.declId)) {
				this.indexedSourceDeclarations.add(source.root.declId);
				const declarationSources = this.declarationValues.get(source.root.declId);
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

	private collectParameterIndexedEffect(
		entry: FunctionValueFlowEntry,
		contextParameterIndices: number[],
	): boolean {
		const marks = this.indexedEffectParameterMarks;
		marks.length = entry.parameters.length;
		marks.fill(false);
		this.indexedDependencyDeclarations.clear();
		this.indexedDependencyCallResults.clear();
		for (let assignmentIndex = 0; assignmentIndex < entry.assignments.length; assignmentIndex += 1) {
			const assignment = entry.assignments[assignmentIndex];
			let indexed = false;
			for (let stepIndex = 0; stepIndex < assignment.target.steps.length; stepIndex += 1) {
				if (assignment.target.steps[stepIndex].kind === 'index') {
					indexed = true;
					break;
				}
			}
			if (!indexed) {
				continue;
			}
			this.collectIndexedParameterDependencies(assignment.target, entry, marks);
			this.collectIndexedParameterDependencies(assignment.source, entry, marks);
		}
		let found = false;
		for (let parameterIndex = 0; parameterIndex < marks.length; parameterIndex += 1) {
			if (!marks[parameterIndex]) {
				continue;
			}
			found = true;
			if (entry.implicitReceiver
				&& !contextParameterIndices.includes(parameterIndex)) {
				contextParameterIndices.push(parameterIndex);
			}
		}
		return found;
	}

	private collectIndexedParameterDependencies(
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
				const declarationSources = this.declarationValues.get(dependency.root.declId);
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

	private materializeFunctionValue(source: FunctionSemanticValueSource): SemanticValueID {
		if (source.root.kind === 'declaration') {
			return this.nodeFor(this.declarationNodes, source.root.declId);
		}
		return this.nodeFor(this.ownedNodes, source.root.key);
	}

	private materializeRootValues(): void {
		for (const [declId, sources] of this.declarationValues) {
			const target = this.nodeFor(this.declarationNodes, declId);
			const relation: DeclarationValueRelation = this.identityDeclarations.has(declId)
				? 'identity'
				: this.projectionDeclarations.has(declId)
					? 'projection'
					: 'value';
			for (let index = 0; index < sources.length; index += 1) {
				this.registerValueConstraint({
					target: { kind: 'value', value: target },
					source: sources[index],
					relation,
				});
			}
		}
		for (const [module, sourceValue] of this.moduleValues) {
			this.registerValueConstraint({
				target: { kind: 'value', value: this.nodeFor(this.moduleNodes, module) },
				source: sourceValue,
				relation: 'identity',
			});
		}
	}

	private registerValueConstraint(constraint: ValueFlowConstraint): void {
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
				this.addEdge(this.instanceBases, target, this.ensureInstance(source));
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

	private solveCallArgumentValues(): void {
		this.materializeCalls();
		this.solveValueChanges();
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

	private materializeCalls(): void {
		for (let callIndex = 0; callIndex < this.rootCalls.length; callIndex += 1) {
			this.registerCall(this.rootCalls[callIndex]);
		}
	}

	private defaultFunctionContext(flow: MaterializedFunctionValueFlow): FunctionValueContext {
		const existing = this.defaultFunctionContextsByValue.get(flow.functionValue);
		if (existing) {
			return existing;
		}
		const parameters = flow.parameters;
		const parameterValues = new Array<SemanticValueID>(parameters.length);
		for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
			parameterValues[parameterIndex] = this.materializeFunctionValue(parameters[parameterIndex]);
		}
		const closure = flow.lexicalOwner
			? this.defaultFunctionContext(flow.lexicalOwner)
			: undefined;
		const context = this.createFunctionContext(
			flow,
			parameterValues,
			closure,
			true,
			undefined,
			undefined,
			EMPTY_ARGUMENT_VALUES,
		);
		this.defaultFunctionContextsByValue.set(flow.functionValue, context);
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
		};
		const contextParameterIndices = flow.contextParameterIndices;
		for (let index = 0; index < contextParameterIndices.length; index += 1) {
			const argument = contextArguments[index];
			if (argument) {
				this.contextOrigins[parameterValues[contextParameterIndices[index]]] = argument;
			}
		}
		contexts.push(context);
		this.bindNestedFunctionFlows(context);
		for (let callIndex = 0; callIndex < flow.calls.length; callIndex += 1) {
			const call = flow.calls[callIndex];
			if (call.result) {
				const key = call.result.root.key;
				const result = defaultContext
					? this.nodeFor(this.ownedNodes, key)
					: this.createNode();
				context.callResults.set(key, result);
			}
			this.registerCall(call, context);
		}
		this.materializeFunctionContext(context);
		return context;
	}

	private bindNestedFunctionFlows(context: FunctionValueContext): void {
		const nestedFunctions = context.flow.nestedFunctions;
		for (let index = 0; index < nestedFunctions.length; index += 1) {
			const nested = nestedFunctions[index];
			const value = this.ownedValueInContext(context, nested.ownedKey);
			this.functionFlowsByValue.set(value, nested.flow);
			this.functionClosuresByValue.set(value, context);
		}
	}

	private ownedValueInContext(context: FunctionValueContext, key: string): SemanticValueID {
		if (context.defaultContext) {
			return this.nodeFor(this.ownedNodes, key);
		}
		let value = context.ownedValues.get(key);
		if (!value) {
			value = this.createNode();
			context.ownedValues.set(key, value);
		}
		return value;
	}

	private materializeFunctionContext(context: FunctionValueContext): void {
		const flow = context.flow;
		for (let memberIndex = 0; memberIndex < flow.members.length; memberIndex += 1) {
			const member = flow.members[memberIndex];
			this.registerValueConstraint({
				target: {
					kind: 'source',
					source: appendValueMember(member.owner, member.name),
					memberDeclId: member.declId,
				},
				source: declarationValueSource(member.declId),
				relation: 'identity',
				context,
			});
		}
		for (let assignmentIndex = 0; assignmentIndex < flow.assignments.length; assignmentIndex += 1) {
			const assignment = flow.assignments[assignmentIndex];
			this.registerValueConstraint({
				target: { kind: 'source', source: assignment.target },
				source: assignment.source,
				relation: assignment.relation,
				context,
			});
		}
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

	private registerCall(
		call: CallValueEntry,
		context?: FunctionValueContext,
	): void {
		const callIndex = this.calls.length;
		this.calls.push({ call, context });
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
				if (constraint.target.kind === 'source' && constraint.target.memberDeclId) {
					this.retainMemberDeclaration(target, constraint.target.memberDeclId);
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
			const callee = context
				? this.resolveContextualValueSource(call.callee, context, false, dependencies)
				: this.resolveSource(call.callee, false, dependencies);
			if (callee) {
				dependencies.push(callee);
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
				const result = call.result
					? context
						? context.callResults.get(call.result.root.key)
						: this.resolveSource(call.result, true)
					: undefined;
				this.instantiateFunctionCall(
					callee,
					argumentValues,
					result,
					call,
					context,
				);
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
		}
		return value;
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
			const result = context.callResults.get(root.key);
			if (result) {
				return result;
			}
			let activeContext: FunctionValueContext | undefined = context;
			while (activeContext) {
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

	private resolveContextualDeclaration(
		declId: SymbolID,
		context: FunctionValueContext,
		_createMembers: boolean,
		_dependencies?: SemanticValueID[],
	): SemanticValueID {
		if (context.defaultContext) {
			return this.nodeFor(this.declarationNodes, declId);
		}
		const sources = this.declarationValues.get(declId);
		let value = context.localValues.get(declId);
		if (!value) {
			value = this.createNode();
			context.localValues.set(declId, value);
		}
		if (!sources || sources.length === 0 || context.resolvedLocals.has(declId)) {
			return value;
		}
		context.resolvedLocals.add(declId);
		const relation: DeclarationValueRelation = this.identityDeclarations.has(declId)
			? 'identity'
			: this.projectionDeclarations.has(declId)
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
				const parameters = flow.parameters;
				const argumentCount = Math.min(parameters.length, argumentValues.length);
				for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
					const argument = argumentValues[argumentIndex];
					if (argument) {
						const parameter = this.materializeFunctionValue(parameters[argumentIndex]);
						if (parameter !== argument) {
							this.addEdge(this.callArgumentBases, parameter, argument);
						}
					}
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
			const flow = flows[flowIndex];
			const closure = closures[flowIndex];
			let context: FunctionValueContext;
			if (!flow.requiresCallContext && (!closure || closure.defaultContext)) {
				context = this.defaultFunctionContext(flow);
				this.bindFunctionContextArguments(context, argumentValues);
			} else {
				context = this.functionCallContext(
					flow,
					argumentValues,
					closure,
					flow.requiresCallContext ? callSite : undefined,
					flow.requiresCallerContext ? caller?.callSite : undefined,
				);
			}
			if (result && context.returnValue !== result) {
				this.addValueBase(result, context.returnValue);
			}
		}
	}

	private functionCallContext(
		flow: MaterializedFunctionValueFlow,
		argumentValues: readonly (SemanticValueID | undefined)[],
		closure: FunctionValueContext | undefined,
		callSite: CallValueEntry | undefined,
		parentCallSite: CallValueEntry | undefined,
	): FunctionValueContext {
		let contexts = this.functionContextsByValue.get(flow.functionValue);
		if (contexts) {
			for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
				const context = contexts[contextIndex];
				if (!context.defaultContext
					&& context.closure === closure
					&& context.callSite === callSite
					&& context.parentCallSite === parentCallSite
					&& this.contextArgumentsEqual(context, argumentValues, callSite)) {
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
		);
		this.bindFunctionContextArguments(context, argumentValues);
		return context;
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
			this.registerValueConstraint({
				target: { kind: 'source', source: entry.target },
				source: entry.source,
				relation: entry.relation,
			});
		}
	}

	private nodeFor<Key>(nodes: Map<Key, SemanticValueID>, key: Key): SemanticValueID {
		let value = nodes.get(key);
		if (!value) {
			value = this.createNode();
			nodes.set(key, value);
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
			this.instanceBases.resizeOwners(this.valueCapacity);
			this.traversalDependents.resizeOwners(this.valueCapacity);
			this.callWorklist.resizeValues(this.valueCapacity);
			this.valueFlowWorklist.resizeValues(this.valueCapacity);
		}
		this.identityParents[value] = value;
		this.identitySizes[value] = 1;
		this.materializedValueTargets[value] = false;
		this.unresolvedMemberHeadByOwner[value] = 0;
		return value;
	}
}
