import type { SymbolID } from './model';

declare const semanticValueBrand: unique symbol;

export type SemanticValueID = number & { readonly [semanticValueBrand]: true };

export type SemanticValueRoot =
	| { kind: 'declaration'; declId: SymbolID }
	| { kind: 'global'; symbolKey: string }
	| { kind: 'module'; module: string }
	| { kind: 'owned'; key: string }
	| { kind: 'binding'; bindingId: string };

export type SemanticValueStep =
	| { kind: 'member'; name: string }
	| { kind: 'element' }
	| { kind: 'call' }
	| { kind: 'instance' };

export type SemanticValueSource = {
	root: SemanticValueRoot;
	steps: readonly SemanticValueStep[];
};

export type DeclarationValueEntry = {
	declId: SymbolID;
	source: SemanticValueSource;
	identity: boolean;
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
	functionDeclId: SymbolID;
	source: SemanticValueSource;
};

export type FunctionParameterValueEntry = {
	functionDeclId: SymbolID;
	parameterDeclIds: readonly SymbolID[];
};

export type CallValueEntry = {
	callee: SemanticValueSource;
	arguments: readonly (SemanticValueSource | undefined)[];
};

export type ValueAssignmentEntry = {
	target: SemanticValueSource;
	source: SemanticValueSource;
};

export type BaseValueEntry = {
	owner: SemanticValueSource;
	base: SemanticValueSource;
	origin: 'metatable' | 'prefab' | 'instance';
};

type MemberValue = {
	value: SemanticValueID;
	declaration?: SymbolID;
};

type MemberDeclaration = {
	id: SymbolID;
	order: number;
};

const EMPTY_MEMBER_DECLARATIONS: readonly MemberDeclaration[] = [];
const EMPTY_MEMBER_IDS: readonly SymbolID[] = [];

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

export function declarationValueSource(declId: SymbolID): SemanticValueSource {
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

export function ownedValueSource(key: string): SemanticValueSource {
	return {
		root: { kind: 'owned', key },
		steps: [],
	};
}

export function moduleTableValueSource(module: string): SemanticValueSource {
	return ownedValueSource(`module-table:${module}`);
}

export function tableValueSource(file: string, line: number, column: number): SemanticValueSource {
	return ownedValueSource(`table:${file}|${line}|${column}`);
}

export function expressionValueSource(file: string, line: number, column: number): SemanticValueSource {
	return ownedValueSource(`expression:${file}|${line}|${column}`);
}

export function bindingValueSource(bindingId: string): SemanticValueSource {
	return {
		root: { kind: 'binding', bindingId },
		steps: [],
	};
}

export function prefabBindingId(definitionId: string): string {
	return `prefab:${definitionId}`;
}

export function objectBindingId(objectId: string): string {
	return `object:${objectId}`;
}

export function sourceBindingId(file: string, line: number, column: number): string {
	return `source:${file}|${line}|${column}`;
}

export function semanticValueSourceKey(source: SemanticValueSource): string {
	let key: string;
	switch (source.root.kind) {
		case 'declaration':
			key = `d\0${source.root.declId}`;
			break;
		case 'global':
			key = `g\0${source.root.symbolKey}`;
			break;
		case 'module':
			key = `m\0${source.root.module}`;
			break;
		case 'owned':
			key = `o\0${source.root.key}`;
			break;
		case 'binding':
			key = `b\0${source.root.bindingId}`;
			break;
	}
	for (let index = 0; index < source.steps.length; index += 1) {
		const step = source.steps[index];
		switch (step.kind) {
			case 'member':
				key += `\0m\0${step.name}`;
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
		}
	}
	return key;
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

export function appendValueCall(source: SemanticValueSource): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'call' }),
	};
}

export function appendValueInstance(source: SemanticValueSource): SemanticValueSource {
	return {
		root: source.root,
		steps: source.steps.concat({ kind: 'instance' }),
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
		case 'binding':
			if (right.root.kind !== 'binding' || left.root.bindingId !== right.root.bindingId) {
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
	}
	return true;
}

export type WorkspaceValueGraphInput = {
	declarationValues: ReadonlyMap<SymbolID, readonly SemanticValueSource[]>;
	identityDeclarations: ReadonlySet<SymbolID>;
	moduleValues: ReadonlyMap<string, SemanticValueSource>;
	memberValues: readonly MemberValueEntry[];
	functionReturns: readonly FunctionReturnValueEntry[];
	functionParameters: readonly FunctionParameterValueEntry[];
	calls: readonly CallValueEntry[];
	valueAssignments: readonly ValueAssignmentEntry[];
	baseValues: readonly BaseValueEntry[];
	bindingValues: ReadonlyMap<string, SemanticValueSource>;
	globalValues: ReadonlyMap<string, SymbolID>;
};

export class WorkspaceValueGraph {
	private readonly declarationValues: Map<SymbolID, SemanticValueSource[]>;
	private readonly identityDeclarations: ReadonlySet<SymbolID>;
	private readonly moduleValues: ReadonlyMap<string, SemanticValueSource>;
	private readonly bindingValues: ReadonlyMap<string, SemanticValueSource>;
	private readonly globalValues: ReadonlyMap<string, SymbolID>;
	private readonly calls: readonly CallValueEntry[];
	private readonly declarationNodes: Map<SymbolID, SemanticValueID> = new Map();
	private readonly moduleNodes: Map<string, SemanticValueID> = new Map();
	private readonly bindingNodes: Map<string, SemanticValueID> = new Map();
	private readonly ownedNodes: Map<string, SemanticValueID> = new Map();
	private readonly members: Map<SemanticValueID, Map<string, MemberValue>> = new Map();
	private readonly elements: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly instances: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly callResults: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly functionReturnsByValue: Map<SemanticValueID, SemanticValueSource[]> = new Map();
	private readonly functionParametersByValue: Map<SemanticValueID, readonly SymbolID[]> = new Map();
	private readonly identityValues: Map<SemanticValueID, SemanticValueID[]> = new Map();
	private readonly identityParents: SemanticValueID[] = [];
	private readonly identitySizes: number[] = [];
	private readonly memberDeclarationsByIdentityRoot: Map<SemanticValueID, MemberDeclaration[]> = new Map();
	private readonly memberResolutionCache: Map<SemanticValueID, Map<string, readonly SymbolID[]>> = new Map();
	private readonly elementsByIdentityRoot: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly projectionBases: Map<SemanticValueID, SemanticValueID[]> = new Map();
	private readonly valueBases: Map<SemanticValueID, SemanticValueID[]> = new Map();
	private readonly prototypeBases: Map<SemanticValueID, SemanticValueID> = new Map();
	private readonly instanceBases: Map<SemanticValueID, SemanticValueID[]> = new Map();
	private readonly traversalStack: SemanticValueID[] = [];
	private readonly traversalMarks: number[] = [];
	private readonly resolvingElements: Set<SemanticValueID> = new Set();
	private readonly unresolvedMemberOwners: SemanticValueID[] = [];
	private readonly unresolvedMemberNames: string[] = [];
	private readonly unresolvedMemberValues: MemberValue[] = [];
	private readonly unresolvedMemberHeadByOwner: number[] = [];
	private readonly unresolvedMemberNext: number[] = [];
	private readonly callDependencyValues: SemanticValueID[] = [];
	private readonly callDependencyCallIndices: number[] = [];
	private readonly callDependencyNextByCall: number[] = [];
	private readonly callDependencyNextByValue: number[] = [];
	private readonly callDependencyHeadByCall: number[] = [];
	private readonly callDependencyHeadByValue: number[] = [];
	private readonly callDependencyScratch: SemanticValueID[] = [];
	private readonly pendingCalls: IndexWorklist<number> = new IndexWorklist();
	private readonly parameterDeclarationScratch: SymbolID[] = [];
	private readonly parameterArgumentIndexScratch: number[] = [];
	private readonly returnSourceScratch: SemanticValueSource[] = [];
	// Reverse traversal dependencies select dirty owners; these parallel arrays
	// retain the resolver's deterministic materialization order.
	private readonly traversalDependents: Map<SemanticValueID, SemanticValueID[]> = new Map();
	private readonly dirtyTraversalValues: IndexWorklist<SemanticValueID> = new IndexWorklist();
	private readonly dirtyPropagationStack: SemanticValueID[] = [];
	private readonly dirtyPropagationMarks: number[] = [];
	private traversalGeneration = 0;
	private dirtyPropagationGeneration = 0;
	private nextValueId = 1;
	private nextMemberDeclarationOrder = 0;
	constructor(options: WorkspaceValueGraphInput) {
		this.declarationValues = new Map();
		for (const [declId, sources] of options.declarationValues) {
			this.declarationValues.set(declId, sources.slice());
		}
		this.moduleValues = options.moduleValues;
		this.identityDeclarations = options.identityDeclarations;
		this.bindingValues = options.bindingValues;
		this.globalValues = options.globalValues;
		this.calls = options.calls;
		this.materializeMembers(options.memberValues);
		this.materializeFunctionReturns(options.functionReturns);
		this.materializeFunctionParameters(options.functionParameters);
		this.materializeRootValues();
		this.materializeBases(options.baseValues);
		this.materializeValueAssignments(options.valueAssignments);
		this.solveCallArgumentValues();
	}

	public resolve(source: SemanticValueSource | undefined): SemanticValueID | undefined {
		return source ? this.resolveSource(source, false) : undefined;
	}

	public findMembers(owner: SemanticValueID, name: string): readonly SymbolID[] {
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
			const aliases = this.identityValues.get(value);
			if (aliases) {
				for (let index = aliases.length - 1; index >= 0; index -= 1) {
					identityStack.push(aliases[index]);
				}
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

		const alternativeStart = out.length;
		for (let index = 0; index < identityValues.length; index += 1) {
			const value = identityValues[index];
			this.collectMemberDeclarationsFromBases(this.valueBases.get(value), name, visited, out);
			this.collectMemberDeclarationsFromBases(this.projectionBases.get(value), name, visited, out);
		}
		if (out.length !== alternativeStart) {
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

		for (let index = 0; index < identityValues.length; index += 1) {
			this.collectMemberDeclarationsFromBases(this.instanceBases.get(identityValues[index]), name, visited, out);
		}
	}

	private collectMemberDeclarationsFromBases(
		bases: readonly SemanticValueID[] | undefined,
		name: string,
		visited: Set<SemanticValueID>,
		out: MemberDeclaration[],
	): void {
		if (!bases) {
			return;
		}
		for (let index = 0; index < bases.length; index += 1) {
			this.collectMemberDeclarations(bases[index], name, visited, out);
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
	): SemanticValueID | undefined {
		let value: SemanticValueID | undefined;
		switch (source.root.kind) {
			case 'declaration':
				value = this.nodeFor(this.declarationNodes, source.root.declId);
				break;
			case 'module':
				value = this.nodeFor(this.moduleNodes, source.root.module);
				break;
			case 'global': {
				const declId = this.globalValues.get(source.root.symbolKey);
				value = declId ? this.nodeFor(this.declarationNodes, declId) : undefined;
				break;
			}
			case 'owned':
				value = this.nodeFor(this.ownedNodes, source.root.key);
				break;
			case 'binding': {
				value = this.nodeFor(this.bindingNodes, source.root.bindingId);
				break;
			}
		}
		for (let index = 0; value && index < source.steps.length; index += 1) {
			if (dependencies) {
				dependencies.push(value);
			}
			const step = source.steps[index];
			switch (step.kind) {
				case 'member':
					value = this.resolveMemberValue(value, step.name, createMembers);
					break;
				case 'element':
					value = this.resolveElementValue(value, createMembers);
					break;
				case 'call':
					value = this.resolveCallValue(value);
					break;
				case 'instance':
					value = this.ensureInstance(value);
					break;
			}
		}
		if (value && dependencies) {
			dependencies.push(value);
		}
		return value;
	}

	private resolveMemberValue(
		owner: SemanticValueID,
		name: string,
		create: boolean,
	): SemanticValueID | undefined {
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		stack.push(owner);
		let value: SemanticValueID | undefined;
		while (stack.length > 0) {
			const candidate = stack.pop()!;
			if (this.traversalMarks[candidate] === generation) {
				continue;
			}
			this.traversalMarks[candidate] = generation;
			const member = this.members.get(candidate)?.get(name);
			if (member) {
				if (!value) {
					value = member.value;
				} else if (value !== member.value) {
					this.addIdentity(value, member.value);
				}
				if (member.declaration) {
					return value;
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
		if (value) {
			return value;
		}
		return create ? this.ensureMember(owner, name).value : undefined;
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
		const aliases = this.identityValues.get(value);
		if (aliases) {
			for (let index = aliases.length - 1; index >= 0; index -= 1) {
				stack.push(aliases[index]);
			}
		}
		const prototypeBase = this.prototypeBases.get(value);
		if (prototypeBase) {
			stack.push(prototypeBase);
		}
		const instanceBases = this.instanceBases.get(value);
		if (instanceBases) {
			for (let index = instanceBases.length - 1; index >= 0; index -= 1) {
				stack.push(instanceBases[index]);
			}
		}
		const projectionBases = this.projectionBases.get(value);
		if (projectionBases) {
			for (let index = projectionBases.length - 1; index >= 0; index -= 1) {
				stack.push(projectionBases[index]);
			}
		}
		const valueBases = this.valueBases.get(value);
		if (valueBases) {
			for (let index = valueBases.length - 1; index >= 0; index -= 1) {
				stack.push(valueBases[index]);
			}
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
			this.projectMember(owner, name, member.value);
		}
		return member;
	}

	private processDirtyTraversalValues(): void {
		const generation = this.dirtyPropagationGeneration + 1;
		this.dirtyPropagationGeneration = generation;
		const stack = this.dirtyPropagationStack;
		while (this.dirtyTraversalValues.length > 0) {
			stack.push(this.dirtyTraversalValues.take());
		}
		while (stack.length > 0) {
			const value = stack.pop()!;
			if (this.dirtyPropagationMarks[value] === generation) {
				continue;
			}
			this.dirtyPropagationMarks[value] = generation;
			this.refreshUnresolvedMembers(value);
			this.queueCalls(value);
			const callResult = this.callResults.get(value);
			if (callResult) {
				this.refreshCallResult(value, callResult);
			}
			const dependents = this.traversalDependents.get(value);
			if (dependents) {
				for (let index = 0; index < dependents.length; index += 1) {
					stack.push(dependents[index]);
				}
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
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		this.pushTraversalBases(stack, owner);
		while (stack.length > 0) {
			const candidate = stack.pop()!;
			if (this.traversalMarks[candidate] === generation) {
				continue;
			}
			this.traversalMarks[candidate] = generation;
			const inherited = this.members.get(candidate)?.get(name);
			if (inherited) {
				this.addIdentity(member.value, inherited.value);
				if (inherited.declaration) {
					continue;
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
	}

	private resolveElementValue(owner: SemanticValueID, create: boolean): SemanticValueID | undefined {
		let element = this.elementForIdentity(owner);
		if (this.resolvingElements.has(owner)) {
			return element;
		}
		this.resolvingElements.add(owner);
		const generation = this.traversalGeneration + 1;
		this.traversalGeneration = generation;
		const stack = this.traversalStack;
		stack.length = 0;
		stack.push(owner);
		while (stack.length > 0) {
			const candidate = stack.pop()!;
			if (this.traversalMarks[candidate] === generation) {
				continue;
			}
			this.traversalMarks[candidate] = generation;
			const candidateElement = this.elementForIdentity(candidate);
			if (candidate !== owner && candidateElement) {
				if (!element) {
					element = this.ensureElement(owner);
				}
				this.addIdentity(element, candidateElement);
			}
			const candidateMembers = this.members.get(candidate);
			if (candidateMembers) {
				for (const member of candidateMembers.values()) {
					if (!element) {
						element = this.ensureElement(owner);
					}
					if (member.value !== element) {
						this.addValueBase(element, member.value);
					}
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
		if (!element && create) {
			element = this.ensureElement(owner);
		}
		if (!element) {
			this.resolvingElements.delete(owner);
			return undefined;
		}
		this.resolvingElements.delete(owner);
		return element;
	}

	private ensureElement(owner: SemanticValueID): SemanticValueID {
		const root = this.findIdentityRoot(owner);
		let element = this.elementsByIdentityRoot.get(root);
		if (!element) {
			element = this.createNode();
			this.elementsByIdentityRoot.set(root, element);
		}
		if (this.elements.get(owner) !== element) {
			this.elements.set(owner, element);
			this.projectElement(owner, element);
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
			this.setPrototypeBase(instance, classValue);
			const valueBases = this.valueBases.get(classValue);
			if (valueBases) {
				for (let index = 0; index < valueBases.length; index += 1) {
					this.addEdge(this.instanceBases, instance, this.ensureInstance(valueBases[index]));
				}
			}
			const aliases = this.identityValues.get(classValue);
			if (aliases) {
				for (let index = 0; index < aliases.length; index += 1) {
					this.addEdge(this.instanceBases, instance, this.ensureInstance(aliases[index]));
				}
			}
		}
		return instance;
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
		edges: Map<SemanticValueID, SemanticValueID[]>,
		owner: SemanticValueID,
		base: SemanticValueID,
	): boolean {
		let bases = edges.get(owner);
		if (!bases) {
			bases = [];
			edges.set(owner, bases);
		}
		if (bases.includes(base)) {
			return false;
		}
		bases.push(base);
		this.addTraversalDependency(owner, base);
		return true;
	}

	private addTraversalDependency(owner: SemanticValueID, base: SemanticValueID): void {
		let dependents = this.traversalDependents.get(base);
		if (!dependents) {
			dependents = [];
			this.traversalDependents.set(base, dependents);
		}
		if (!dependents.includes(owner)) {
			dependents.push(owner);
		}
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

	private addProjectionBase(owner: SemanticValueID, base: SemanticValueID): void {
		if (!this.addEdge(this.projectionBases, owner, base)) {
			return;
		}
		const members = this.members.get(owner);
		if (members) {
			for (const [name, member] of members) {
				this.addIdentity(member.value, this.ensureMember(base, name).value);
			}
		}
		const element = this.elements.get(owner);
		if (element) {
			this.addIdentity(element, this.ensureElement(base));
		}
	}

	private projectMember(owner: SemanticValueID, name: string, value: SemanticValueID): void {
		const bases = this.projectionBases.get(owner);
		if (!bases) {
			return;
		}
		for (let index = 0; index < bases.length; index += 1) {
			this.addIdentity(value, this.ensureMember(bases[index], name).value);
		}
	}

	private projectElement(owner: SemanticValueID, element: SemanticValueID): void {
		const bases = this.projectionBases.get(owner);
		if (!bases) {
			return;
		}
		for (let index = 0; index < bases.length; index += 1) {
			this.addIdentity(element, this.ensureElement(bases[index]));
		}
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
			const functionValue = this.nodeFor(this.declarationNodes, entry.functionDeclId);
			let sources = this.functionReturnsByValue.get(functionValue);
			if (!sources) {
				sources = [];
				this.functionReturnsByValue.set(functionValue, sources);
			}
			sources.push(entry.source);
		}
	}

	private materializeFunctionParameters(entries: readonly FunctionParameterValueEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			this.functionParametersByValue.set(
				this.nodeFor(this.declarationNodes, entry.functionDeclId),
				entry.parameterDeclIds,
			);
		}
	}

	private materializeRootValues(): void {
		for (const [declId, sources] of this.declarationValues) {
			const target = this.nodeFor(this.declarationNodes, declId);
			for (let index = 0; index < sources.length; index += 1) {
				const source = this.resolveSource(sources[index], true);
				this.attachResolvedValue(target, source, this.identityDeclarations.has(declId));
			}
		}
		for (const [module, sourceValue] of this.moduleValues) {
			const source = this.resolveSource(sourceValue, true);
			const target = this.nodeFor(this.moduleNodes, module);
			this.attachResolvedValue(target, source, true);
		}
		for (const [bindingId, sourceValue] of this.bindingValues) {
			const source = this.resolveSource(sourceValue, true);
			const target = this.nodeFor(this.bindingNodes, bindingId);
			this.attachResolvedValue(target, source, true);
		}
	}

	private attachResolvedValue(
		target: SemanticValueID,
		source: SemanticValueID | undefined,
		identity: boolean,
	): void {
		if (!source || source === target) {
			return;
		}
		if (identity) {
			this.addIdentity(target, source);
		} else {
			this.addValueBase(target, source);
		}
	}

	private solveCallArgumentValues(): void {
		this.materializeCalls();
		while (this.dirtyTraversalValues.length > 0 || this.pendingCalls.length > 0) {
			this.processDirtyTraversalValues();
			this.processPendingCalls();
		}
	}

	private materializeCalls(): void {
		for (let callIndex = 0; callIndex < this.calls.length; callIndex += 1) {
			this.callDependencyHeadByCall.push(0);
			this.pendingCalls.add(callIndex);
		}
	}

	private queueCalls(dependency: SemanticValueID): void {
		let link = this.callDependencyHeadByValue[dependency];
		while (link !== 0) {
			const entryIndex = link - 1;
			this.pendingCalls.add(this.callDependencyCallIndices[entryIndex]);
			link = this.callDependencyNextByValue[entryIndex];
		}
	}

	private processPendingCalls(): void {
		while (this.pendingCalls.length > 0) {
			const callIndex = this.pendingCalls.take();
			const call = this.calls[callIndex];
			const dependencies = this.callDependencyScratch;
			dependencies.length = 0;
			const callee = this.resolveSource(call.callee, false, dependencies);
			for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
				this.retainCallDependency(callIndex, dependencies[dependencyIndex]);
			}
			if (callee) {
				this.applyCallArguments(callee, call.arguments);
			}
		}
	}

	private retainCallDependency(callIndex: number, dependency: SemanticValueID): void {
		let link = this.callDependencyHeadByCall[callIndex];
		while (link !== 0) {
			const entryIndex = link - 1;
			if (this.callDependencyValues[entryIndex] === dependency) {
				return;
			}
			link = this.callDependencyNextByCall[entryIndex];
		}
		const entryIndex = this.callDependencyValues.length;
		this.callDependencyValues.push(dependency);
		this.callDependencyCallIndices.push(callIndex);
		this.callDependencyNextByCall.push(this.callDependencyHeadByCall[callIndex]);
		this.callDependencyNextByValue.push(this.callDependencyHeadByValue[dependency]);
		this.callDependencyHeadByCall[callIndex] = entryIndex + 1;
		this.callDependencyHeadByValue[dependency] = entryIndex + 1;
	}

	private refreshCallResult(callee: SemanticValueID, result: SemanticValueID): void {
		const sources = this.returnSourceScratch;
		sources.length = 0;
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
			const returnSources = this.functionReturnsByValue.get(candidate);
			if (returnSources) {
				for (let sourceIndex = 0; sourceIndex < returnSources.length; sourceIndex += 1) {
					sources.push(returnSources[sourceIndex]);
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
		for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
			const returned = this.resolveSource(sources[sourceIndex], true);
			if (returned && returned !== result) {
				this.addValueBase(result, returned);
			}
		}
	}

	private applyCallArguments(
		callee: SemanticValueID,
		arguments_: readonly (SemanticValueSource | undefined)[],
	): void {
		const parameterDeclarations = this.parameterDeclarationScratch;
		const argumentIndices = this.parameterArgumentIndexScratch;
		parameterDeclarations.length = 0;
		argumentIndices.length = 0;
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
			const parameters = this.functionParametersByValue.get(candidate);
			if (parameters) {
				const count = Math.min(parameters.length, arguments_.length);
				for (let argumentIndex = 0; argumentIndex < count; argumentIndex += 1) {
					if (arguments_[argumentIndex]) {
						parameterDeclarations.push(parameters[argumentIndex]);
						argumentIndices.push(argumentIndex);
					}
				}
			}
			this.pushTraversalBases(stack, candidate);
		}
		for (let index = 0; index < parameterDeclarations.length; index += 1) {
			const source = arguments_[argumentIndices[index]]!;
			this.addDeclarationSource(parameterDeclarations[index], source);
		}
	}

	private addDeclarationSource(declId: SymbolID, source: SemanticValueSource): void {
		let sources = this.declarationValues.get(declId);
		if (!sources) {
			sources = [];
			this.declarationValues.set(declId, sources);
		}
		for (let index = 0; index < sources.length; index += 1) {
			if (semanticValueSourcesEqual(sources[index], source)) {
				return;
			}
		}
		sources.push(source);
		const target = this.nodeFor(this.declarationNodes, declId);
		const sourceValue = this.resolveSource(source, true);
		if (!sourceValue || sourceValue === target) {
			return;
		}
		this.addProjectionBase(target, sourceValue);
	}

	private materializeBases(entries: readonly BaseValueEntry[]): void {
		for (let pass = 0; pass < 3; pass += 1) {
			const origin = pass === 0 ? 'prefab' : pass === 1 ? 'metatable' : 'instance';
			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index];
				if (entry.origin !== origin) {
					continue;
				}
				const owner = this.resolveSource(entry.owner, true);
				const base = this.resolveSource(entry.base, true);
				if (!owner || !base || owner === base) {
					continue;
				}
			if (origin === 'instance') {
				this.addEdge(this.instanceBases, owner, base);
			} else {
				this.setPrototypeBase(owner, base);
				this.addEdge(this.instanceBases, this.ensureInstance(owner), this.ensureInstance(base));
				}
			}
		}
	}

	private materializeValueAssignments(entries: readonly ValueAssignmentEntry[]): void {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const target = this.resolveSource(entry.target, true);
			const source = this.resolveSource(entry.source, true);
			if (target && source && target !== source) {
				this.addValueBase(target, source);
			}
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
		this.identityParents[value] = value;
		this.identitySizes[value] = 1;
		this.unresolvedMemberHeadByOwner[value] = 0;
		this.callDependencyHeadByValue[value] = 0;
		return value;
	}
}
