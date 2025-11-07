import { $ } from '../core/game';
import { normalizeDecoratedClassName } from '../utils/decorators';
import { deepClone } from '../utils/utils';
import { computeBlueprintSignature, cloneBlueprint } from '../utils/blueprint';
import type { Identifiable, Identifier } from '../rompack/rompack';
import { excludeclassfromsavegame, insavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import type { WorldObject } from '../core/object/worldobject';

/** Node specification used to compose a behaviour tree. */
export type BehaviorTreeNodeSpec =
	| { type: 'selector' | 'Selector'; children: BehaviorTreeNodeSpec[]; priority?: number }
	| { type: 'sequence' | 'Sequence'; children: BehaviorTreeNodeSpec[]; priority?: number }
	| { type: 'parallel' | 'Parallel'; children: BehaviorTreeNodeSpec[]; successPolicy: 'ONE' | 'ALL'; priority?: number }
	| { type: 'decorator' | 'Decorator'; child: BehaviorTreeNodeSpec; decorator: NodeDecorator; priority?: number }
	| { type: 'condition' | 'Condition'; condition: NodeCondition; modifier?: NodeConditionModifier; parameters?: any[]; priority?: number }
	| { type: 'compositecondition' | 'CompositeCondition'; conditions: NodeCondition[]; modifier: NodeCompositeConditionModifier; parameters?: any[]; priority?: number }
	| { type: 'randomselector' | 'RandomSelector'; children: BehaviorTreeNodeSpec[]; currentchild_propname: string; priority?: number }
	| { type: 'limit' | 'Limit'; child: BehaviorTreeNodeSpec; limit: number; count_propname: string; priority?: number }
	| { type: 'priorityselector' | 'PrioritySelector'; children: BehaviorTreeNodeSpec[]; priority?: number }
	| { type: 'wait' | 'Wait'; wait_time: number; wait_propname: string; priority?: number }
	| { type: 'action' | 'Action'; action: NodeAction; parameters?: any[]; priority?: number }
	| { type: 'compositeaction' | 'CompositeAction'; actions: BehaviorTreeNodeSpec[]; parameters?: any[]; priority?: number };

/**
 * Represents the definition of a behavior tree. A tree can either be declared directly as a node spec
 * (legacy style) or wrapped inside an object with a `root` property.
 */
export type BehaviorTreeDefinition = BehaviorTreeNodeSpec | { root: BehaviorTreeNodeSpec };

/**
 * Represents the definitions of behavior trees that are stored in the library to be constructed later.
 * It allows for the definition of behavior trees in a more declarative way, similar to how state machines
 * are defined in a declarative way.
 * @type { { [key: BehaviorTreeID]: BehaviorTreeDefinition } | null }
 */
export let BehaviorTreeDefinitions: { [key: BehaviorTreeID]: BehaviorTreeDefinition } = {};
const behaviorTreeSignatures: Map<BehaviorTreeID, string> = new Map();
const behaviorTreeDiagnostics: Map<BehaviorTreeID, BehaviorTreeDiagnostic[]> = new Map();

/**
 * Sets up the behavior tree definition library.This function should be called during the game initialization.
 */
export function setup_bt_library(): void {
	behaviorTreeSignatures.clear();
	for (const bt_id of Object.keys(BehaviorTreeDefinitions)) {
		const definition = BehaviorTreeDefinitions[bt_id];
		if (!definition) {
			throw new Error(`[BehaviorTree] Definition '${bt_id}' is not registered.`);
		}
		const signature = computeBlueprintSignature(definition);
		behaviorTreeSignatures.set(bt_id, signature);
		try {
			constructBehaviorTree(bt_id);
			behaviorTreeDiagnostics.set(bt_id, []);
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			behaviorTreeDiagnostics.set(bt_id, [{ severity: 'error', message }]);
			throw error;
		}
	}
}

/**
 * Sets up the behavior tree definition library.This function should be called during the game initialization.
 */
export function setup_btdef_library(): void {
	BehaviorTreeDefinitions = {};
	for (const [bt_id, builder] of Object.entries(behaviorTreeDefinitionsBuilders)) {
		const bt_def = builder();
		if (!bt_def) {
			throw new Error(`[BehaviorTree] Builder '${bt_id}' returned an invalid definition.`);
		}
		BehaviorTreeDefinitions[bt_id] = bt_def;
	}
}

/**
 * The definitions for the behavior trees.
 *
 * @remarks
 * This object stores a collection of behavior tree definitions.
 * Each definition is a function that returns a `BehaviorTreeDefinition` object.
 *
 * @typeParam key - The key type for the definitions.
 */
let behaviorTreeDefinitionsBuilders: { [key: BehaviorTreeID]: () => BehaviorTreeDefinition } = {};

export function registerBehaviorTreeBuilder(id: BehaviorTreeID, builder: () => BehaviorTreeDefinition): void {
	const trimmed = id.trim();
	if (trimmed.length === 0) {
		throw new Error('[BehaviorTree] Builder id must be a non-empty string.');
	}
	behaviorTreeDefinitionsBuilders[trimmed] = builder;
}

export function registerBehaviorTreeDefinition(id: BehaviorTreeID, definition: BehaviorTreeDefinition): void {
	const snapshot = deepClone(definition);
	registerBehaviorTreeBuilder(id, () => deepClone(snapshot));
}

export function behaviorTreeExists(id: BehaviorTreeID): boolean {
	return Object.prototype.hasOwnProperty.call(BehaviorTreeDefinitions, id);
}

export function instantiateBehaviorTree(id: BehaviorTreeID): BTNode {
	return constructBehaviorTree(id);
}

export type BehaviorTreeDiagnostic = {
	severity: 'error' | 'warning';
	message: string;
};

export function getBehaviorTreeDiagnostics(id: BehaviorTreeID): BehaviorTreeDiagnostic[] {
	return behaviorTreeDiagnostics.get(id) ?? [];
}

export function unregisterBehaviorTreeBuilder(id: BehaviorTreeID): void {
	delete behaviorTreeDefinitionsBuilders[id];
	delete BehaviorTreeDefinitions[id];
	behaviorTreeSignatures.delete(id);
	behaviorTreeDiagnostics.delete(id);
}

export function applyPreparedBehaviorTree(id: BehaviorTreeID, definition: BehaviorTreeDefinition, options?: { force?: boolean }): { changed: boolean; previousDefinition?: BehaviorTreeDefinition } {
	const trimmed = id.trim();
	if (trimmed.length === 0) {
		throw new Error('[BehaviorTree] Definition id must be a non-empty string.');
	}
	const signature = computeBlueprintSignature(definition);
	const previousSignature = behaviorTreeSignatures.get(trimmed);
	const previousDefinition = BehaviorTreeDefinitions[trimmed];
	if (!options?.force && previousSignature === signature) {
		if (!behaviorTreeDiagnostics.has(trimmed)) {
			behaviorTreeDiagnostics.set(trimmed, []);
		}
		return { changed: false, previousDefinition };
	}
	behaviorTreeSignatures.set(trimmed, signature);
	const snapshot = cloneBlueprint(definition);
	behaviorTreeDefinitionsBuilders[trimmed] = () => cloneBlueprint(snapshot);
	BehaviorTreeDefinitions[trimmed] = cloneBlueprint(snapshot);
	try {
		constructBehaviorTree(trimmed);
		behaviorTreeDiagnostics.set(trimmed, []);
	}
	catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		behaviorTreeDiagnostics.set(trimmed, [{ severity: 'error', message }]);
		throw error;
	}
	refreshBehaviorTreeContexts([trimmed]);
	return { changed: true, previousDefinition };
}

function refreshBehaviorTreeContexts(treeIds?: readonly string[]): void {
	const world = $.world;
	const filter = treeIds ? new Set(treeIds) : null;
	for (const object of world.objects({ scope: 'all' })) {
		const contexts = object.btreecontexts;
		for (const treeId in contexts) {
			if (filter && !filter.has(treeId)) continue;
			const context = contexts[treeId];
			const updatedRoot = instantiateBehaviorTree(treeId);
			const wasEnabled = context.root.enabled;
			context.root = updatedRoot;
			if (!wasEnabled) updatedRoot.stop();
		}
	}
}

/**
 * Builds a behavior tree based on the provided configuration.
 * Note the recursive nature of this function, which allows for the construction of complex behavior trees,
 * where each node represents a tree or sub tree.
 *
 * @param config - The behavior tree definition.
 * @param id - The identifier of the behavior tree.
 * @returns The root node of the built behavior tree, which can consist of multiple nodes (sub trees).
 */
function buildBehaviorTreeNode(config: BehaviorTreeNodeSpec, id: BehaviorTreeID): BTNode {
	const ensureChildren = (children: BehaviorTreeNodeSpec[] | undefined, nodeType: string): BehaviorTreeNodeSpec[] => {
		if (!Array.isArray(children) || children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires at least one child.`);
		}
		return children;
	};
	const ensureActionNodes = (nodes: BehaviorTreeNodeSpec[], nodeType: string): ActionNode[] => {
		return ensureChildren(nodes, nodeType).map(childSpec => {
			const node = buildBehaviorTreeNode(childSpec, id);
			if (!(node instanceof ActionNode)) {
				throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' expects only ActionNode children.`);
			}
			return node;
		});
	};
	const ensureDecorator = (decorator: NodeDecorator | undefined, nodeType: string): NodeDecorator => {
		if (typeof decorator !== 'function') {
			throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires a decorator function.`);
		}
		return decorator;
	};
	const ensureCondition = (condition: NodeCondition | undefined, nodeType: string): NodeCondition => {
		if (typeof condition !== 'function') {
			throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires a condition function.`);
		}
		return condition;
	};
	const ensureConditions = (conditions: NodeCondition[] | undefined, nodeType: string): NodeCondition[] => {
		if (!Array.isArray(conditions) || conditions.length === 0) {
			throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires one or more condition functions.`);
		}
		return conditions.map((condition, index) => {
			if (typeof condition !== 'function') {
				throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires condition functions and received ${typeof condition} at index ${index}.`);
			}
			return condition;
		});
	};
	const ensureCompositeModifier = (modifier: NodeCompositeConditionModifier | undefined, nodeType: string): NodeCompositeConditionModifier => {
		if (modifier !== 'AND' && modifier !== 'OR') {
			throw new Error(`[BehaviorTree:${id}] Node '${nodeType}' requires a modifier of 'AND' or 'OR'.`);
		}
		return modifier;
	};
	const typeValue = config.type;
	switch (typeValue) {
		case 'selector':
		case 'Selector':
			return new SelectorNode(id, ensureChildren(config.children, 'selector').map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'sequence':
		case 'Sequence':
			return new SequenceNode(id, ensureChildren(config.children, 'sequence').map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'parallel':
		case 'Parallel':
			if (config.successPolicy !== 'ONE' && config.successPolicy !== 'ALL') {
				throw new Error(`[BehaviorTree:${id}] Parallel node requires successPolicy 'ONE' or 'ALL'.`);
			}
			return new ParallelNode(id, ensureChildren(config.children, 'parallel').map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.successPolicy, config.priority);
		case 'decorator':
		case 'Decorator':
			if (!config.child) {
				throw new Error(`[BehaviorTree:${id}] Decorator node requires a child.`);
			}
			return new DecoratorNode(id, buildBehaviorTreeNode(config.child, id), ensureDecorator(config.decorator, 'decorator'), config.priority);
		case 'condition':
		case 'Condition':
			return new ConditionNode(id, ensureCondition(config.condition, 'condition'), config.modifier ?? null, config.priority, config.parameters);
		case 'compositecondition':
		case 'CompositeCondition':
			return new CompositeConditionNode(id, ensureConditions(config.conditions, 'compositecondition'), ensureCompositeModifier(config.modifier, 'compositecondition'), config.priority, config.parameters);
		case 'randomselector':
		case 'RandomSelector':
			if (!config.currentchild_propname) {
				throw new Error(`[BehaviorTree:${id}] RandomSelector node requires 'currentchild_propname'.`);
			}
			return new RandomSelectorNode(id, ensureChildren(config.children, 'randomselector').map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.currentchild_propname, config.priority);
		case 'limit':
		case 'Limit':
			if (typeof config.limit !== 'number' || !Number.isFinite(config.limit)) {
				throw new Error(`[BehaviorTree:${id}] Limit node requires a finite numeric 'limit'.`);
			}
			if (!config.count_propname) {
				throw new Error(`[BehaviorTree:${id}] Limit node requires 'count_propname'.`);
			}
			if (!config.child) {
				throw new Error(`[BehaviorTree:${id}] Limit node requires a child.`);
			}
			return new LimitNode(id, config.limit, config.count_propname, buildBehaviorTreeNode(config.child, id), config.priority);
		case 'priorityselector':
		case 'PrioritySelector':
			return new PrioritySelectorNode(id, ensureChildren(config.children, 'priorityselector').map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'wait':
		case 'Wait':
			if (typeof config.wait_time !== 'number' || config.wait_time < 0) {
				throw new Error(`[BehaviorTree:${id}] Wait node requires a non-negative 'wait_time'.`);
			}
			if (!config.wait_propname) {
				throw new Error(`[BehaviorTree:${id}] Wait node requires 'wait_propname'.`);
			}
			return new WaitNode(id, config.wait_time, config.wait_propname, config.priority);
	case 'action':
	case 'Action':
		if (config.action === undefined || config.action === null) {
			throw new Error(`[BehaviorTree:${id}] Action node requires an action handler.`);
		}
			return new ActionNode(id, config.action, config.priority, config.parameters);
		case 'compositeaction':
		case 'CompositeAction':
			if (!Array.isArray(config.actions) || config.actions.length === 0) {
				throw new Error(`[BehaviorTree:${id}] CompositeAction node requires one or more actions.`);
			}
			return new CompositeActionNode(id, ensureActionNodes(config.actions, 'compositeaction'), config.priority, config.parameters);
		default:
			throw new Error(`Unsupported behavior tree node type '${typeValue}'`);
	}
}

/**
 * Represents a constructor with a behavior tree property.
 */
export type ConstructorWithBTProperty = Function & {
	/**
	 * A set of behavior tree names that are linked to this constructor.
	 */
	linkedBTs?: Set<BehaviorTreeID>;
};

/**
 * Decorator function that assigns behavior trees to a class constructor.
 * @param bts The behavior trees to assign.
 * @returns A decorator function.
 */
export function assign_bt(...bts: BehaviorTreeID[]) {
	return function (value: any, _context: ClassDecoratorContext) {
		const constructor = value as ConstructorWithBTProperty;
		if (!Object.prototype.hasOwnProperty.call(constructor, 'linkedBTs') || !constructor.linkedBTs) {
			constructor.linkedBTs = new Set<BehaviorTreeID>();
		}
		bts.forEach(bt => constructor.linkedBTs!.add(bt));
		updateAllAssignedBTs(constructor);
		// no class replacement
	};
}

/**
 * Updates all assigned behavior trees for the given constructor.
 *
 * @param constructor - The constructor function.
 */
function updateAllAssignedBTs(constructor: any) {
	const linkedBTs = new Set<BehaviorTreeID>();
	let currentClass: any = constructor;

	while (currentClass && currentClass !== Object) {
		if (currentClass.linkedBTs) {
			currentClass.linkedBTs.forEach((bt: BehaviorTreeID) => linkedBTs.add(bt));
		}
		currentClass = Object.getPrototypeOf(currentClass);
	}

	constructor.linkedBTs = linkedBTs;
}

/**
 * Builds a behavior tree definition.
 * @param bt_id - The name of the behavior tree. If not provided, the target's name will be used.
 * @returns A decorator function that defines the behavior tree.
 */
export function build_bt(bt_id?: BehaviorTreeID) {
	return function (value: any, context: ClassMethodDecoratorContext) {
		const register = (ctor: any) => {
			if (typeof ctor !== 'function') {
				throw new Error('[BehaviorTree] build_bt decorator applied to a non-class element.');
			}
			const inferred = ctor.name;
			if (!bt_id && (!inferred || inferred.length === 0)) {
				throw new Error('[BehaviorTree] Cannot infer behavior tree id from anonymous class. Provide an explicit id.');
			}
			const key = bt_id ?? normalizeDecoratedClassName(inferred);
			if (!key || key.length === 0) {
				throw new Error('[BehaviorTree] Behavior tree id resolved to an empty string.');
			}
			registerBehaviorTreeBuilder(key, value as () => BehaviorTreeDefinition);
		};
		if (context.static) {
			context.addInitializer(function () { register(this); });
		} else {
			context.addInitializer(function () { register(this.constructor); });
		}
		// no method replacement
	};
}

/**
 * Constructs a behavior tree based on the specified tree name, blackboard, and target ID.
 * @param bt_id - The name of the behavior tree.
 * @param targetId - The ID of the target world object.
 * @returns The constructed behavior tree node, or null if the tree definition is not found.
 */
export function constructBehaviorTree(bt_id: BehaviorTreeID): BTNode {
	const btdef = BehaviorTreeDefinitions[bt_id];
	if (!btdef) {
		throw new Error(`[BehaviorTree] Definition '${bt_id}' is not registered.`);
	}
	const root = (btdef as { root?: BehaviorTreeNodeSpec }).root ?? (btdef as BehaviorTreeNodeSpec);
	return buildBehaviorTreeNode(root, bt_id);
}

/**
 * Represents the status of a behavior tree node.
 * Possible values are 'RUNNING', 'SUCCESS', and 'FAILED'.
 */
export type BTStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

/**
 * Represents the feedback of a behavior tree node.
 */
export type BTNodeFeedback = {
	status: BTStatus, // The status of the node after the tick operation
	updates?: (blackboard: Blackboard) => void; // The updates to apply to the blackboard
};

/**
 * Represents a blackboard that stores key-value bindings.
 */
@insavegame
export class Blackboard implements Identifiable {
	// The identifier of the blackboard
	public id: string;
	// The data stored in the blackboard
	public data: { [key: string]: any } = {};
	// The node data stored in the blackboard (used for storing node-specific data, such as wait times))
	public nodedata: { [key: string]: any } = {};
	// The execution path of the behavior tree (used for debugging)
	public executionPath: { node: BTNode, result: BTNodeFeedback }[] = [];

	// The constructor for the blackboard, which initializes the blackboard with the specified identifier
	constructor(opts: RevivableObjectArgs & { id: string }) {
		this.id = opts.id;
	}

	// The method for setting a value in the blackboard with the specified key
	set<T>(key: string, value: T): void {
		this.data[key] = value;
	}

	// The method for getting a value from the blackboard with the specified key
	get<T>(key: string): T | undefined {
		return this.data[key] as T;
	}

	// The method for clearing all the data in the blackboard that is node-specific
	public clearAllNodeData(): void {
		delete this.nodedata;
		this.nodedata = {};
	}

	// Returns whether an action is currently in progress
	public get actionInProgress(): boolean {
		return this.nodedata['actionInProgress'] ?? false;
	}

	// Sets whether an action is currently in progress
	public set actionInProgress(inProgress: boolean) {
		this.nodedata['actionInProgress'] = inProgress;
	}

	/**
	 * Applies updates to the behaviour tree.
	 * It is used in combination with the ObjectTracker, which tracks changes of given properties in game objects.
	 * The updates are applied to the blackboard, which is used by the behaviour tree to determine the next action.
	 * This allows for easily updating the blackboard with the changes that have occurred in the game objects.
	 *
	 * @param updates - An object containing updates for the behaviour tree.
	 * @param updates.id - The ID of the update.
	 * @param updates.id[].property - The property to update.
	 * @param updates.id[].value - The new value for the property.
	 * @param updates.id[].key - The key associated with the property (optional).
	 */
	applyUpdates(updates: { [id: string]: Array<{ property: string, value: any, key?: string }> }): void {
		for (const properties of Object.values(updates)) {
			for (const { value, key, property } of properties) {
				const resolvedKey = key ?? property;
				if (!resolvedKey) {
					throw new Error(`[Blackboard:${this.id}] Update entry is missing both 'key' and 'property'.`);
				}
				this.set(resolvedKey, value);
			}
		}
	}

	/**
	 * Copies the specified properties from the given target object to the blackboard.
	 * This is useful for copying properties from a world object to the blackboard for use in the behavior tree,
	 * such as copying the position of an enemy to the blackboard for use in pathfinding.
	 *
	 * @template T - The type of the target object.
	 * @param {T} target - The target object from which to copy the properties.
	 * @param {Array<{ property: keyof T, key?: string }>} properties - The properties to copy, along with optional custom keys.
	 * @returns {void}
	 */
	public copyPropertiesToBlackboard<T extends WorldObject>(target: T, properties: Array<{ property: keyof T, key?: string }>): void {
		for (let { property, key } of properties) {
			// If no key is given, use the property name as the key
			key = key ?? (property as string);

			// Get the property value from the target
			const value = target[property];

			// Set the blackboard entry
			this.set(key as string, value);
		}
	}
}

/**
 * Represents the ID for a behavior tree.
 */
export type BehaviorTreeID = string;

// Represents the context for a behavior tree for a given world object.
export type BehaviorTreeContext = {
	treeId: BehaviorTreeID;
	running: boolean; // Indicates if the behavior tree is currently running
	root: BTNode; // The root node of the behavior tree
	blackboard: Blackboard; // The blackboard associated with the behavior tree
};

/**
 * Represents a base class for behavior tree nodes.
 * @remarks
 * This class provides common properties and methods for behavior tree nodes.
 * @typeparam T - The type of the target object.
 */
@excludeclassfromsavegame
export abstract class BTNode implements Identifiable {
	public id: BehaviorTreeID;
	public priority: number;
	private running: boolean = true;
	public get enabled() { return this.running; } // NOTE: LOGIC FOR THIS IS IMPLEMENTED IN THE GAMEOBJECT CLASS!
	public start() { this.running = true; }
	public stop() { this.running = false; }

	/**
	 * Retrieves the target object with the specified Identifier and casts it to the specified type.
	 * @param targetid The Identifier of the target object.
	 * @returns The target object casted to the specified type.
	 */
	public getTarget<T extends WorldObject>(targetid: Identifier): T {
		const target = $.world.getWorldObject(targetid) as WorldObject | null;
		if (!target) {
			throw new Error(`[BehaviorTree:${this.id}] Target '${targetid}' not found in world.`);
		}
		return target as T;
	}

	constructor(id: BehaviorTreeID, _priority = 0) {
		this.id = id;
		this.priority = _priority;
	}

	debug_tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		// Call the actual tick method
		const result = this.tick(targetid, blackboard);

		// Add this node and its result to the execution path
		blackboard.executionPath.push({ node: this, result });

		return result;
	}

	abstract tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback;
}

/**
 * Represents an abstract class for a parametrized behavior tree node.
 */
export abstract class ParametrizedBTNode extends BTNode {
	public parameters: any[];

	constructor(id: BehaviorTreeID, _priority = 0, parameters: any[] = []) {
		super(id, _priority);
		this.parameters = parameters;
	}
}


/**
 * Represents a sequence node in a behavior tree.
 */
export class SequenceNode extends BTNode {
	public children: BTNode[];

	constructor(id: BehaviorTreeID, children: BTNode[], _priority = 0) {
		super(id, _priority);
		if (children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] SequenceNode requires at least one child.`);
		}
		this.children = children;
	}

	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick(targetid, blackboard);
			switch (result.status) {
				case 'FAILED':
				case 'RUNNING':
					return { status: result.status };
			}
		}
		// Assuming success if none failed
		return { status: 'SUCCESS' };
	}
}

/**
 * Represents a selector node in a behavior tree.
 */
export class SelectorNode extends BTNode {
	public children: BTNode[];

	constructor(id: BehaviorTreeID, children: BTNode[], _priority = 0) {
		super(id, _priority);
		if (children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] SelectorNode requires at least one child.`);
		}
		this.children = children;
	}

	/**
	 * Executes the tick operation on the selector node.
	 * @returns The feedback of the tick operation.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick(targetid, blackboard);
			if (result.status !== 'FAILED') {
				return result;
			}
		}
		return { status: 'FAILED' };
	}
}

/**
 * Represents a parallel node in a behavior tree.
 */
export class ParallelNode extends BTNode {
	public children: BTNode[];
	public successPolicy: 'ONE' | 'ALL';

	constructor(id: BehaviorTreeID, children: BTNode[], successPolicy: 'ONE' | 'ALL', _priority = 0) {
		super(id, _priority);
		if (children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] ParallelNode requires at least one child.`);
		}
		this.children = children;
		this.successPolicy = successPolicy;
	}

	/**
	 * Executes the tick operation on the parallel node.
	 * @returns The feedback of the tick operation.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let successCount = 0;
		let running = false;

		for (const child of this.children) {
			const result = child.tick(targetid, blackboard);
			if (result.status === 'SUCCESS') {
				successCount++;
				if (this.successPolicy === 'ONE') {
					return { status: 'SUCCESS' };
				}
			} else if (result.status === 'RUNNING') {
				running = true;
			}
		}

		if (this.successPolicy === 'ALL' && successCount === this.children.length) {
			return { status: 'SUCCESS' };
		} else if (running) {
			return { status: 'RUNNING' };
		} else {
			return { status: 'FAILED' };
		}
	}
}

/**
 * Represents a decorator function for a behavior tree node.
 *
 * @param status - The current status of the node.
 * @param targetid - The identifier of the target node.
 * @param blackboard - The blackboard object used by the behavior tree.
 * @returns The updated status of the node.
 */
type NodeDecorator = (status: BTStatus, targetid: Identifier, blackboard: Blackboard) => BTStatus;
/**
 * Represents a decorator node in a behavior tree.
 */
export class DecoratorNode extends BTNode {
	public child: BTNode;
	public decorator: (status: BTStatus, targetid: Identifier, blackboard: Blackboard) => BTStatus;

	constructor(id: BehaviorTreeID, child: BTNode, decorator: NodeDecorator, _priority = 0) {
		super(id, _priority);
		this.child = child;
		this.decorator = decorator;
	}

	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const childResult = this.child.tick(targetid, blackboard);
		const modifiedResult = this.decorator(childResult.status, targetid, blackboard);
		return { status: modifiedResult };
	}
}

/**
 * InvertorDecorator is a decorator function that inverts the status of a node.
 *
 * @param status - The current status of the node.
 * @param _targetid - The identifier of the target node.
 * @param _blackboard - The blackboard object.
 * @returns The inverted status of the node.
 */
export const InvertorDecorator: NodeDecorator = (status: BTStatus, _targetid: Identifier, _blackboard: Blackboard) => {
	if (status === 'SUCCESS') return 'FAILED';
	if (status === 'FAILED') return 'SUCCESS';
	return status;
};

/**
 * Decorator that waits for the completion of an action.
 *
 * @param status - The current status of the action.
 * @param _targetid - The identifier of the target.
 * @param blackboard - The blackboard object.
 * @param actionName - The name of the action.
 * @returns The updated status of the action.
 */
export const WaitForActionCompletionDecorator: NodeDecorator = (status: BTStatus, _targetid: Identifier, blackboard: Blackboard, actionName?: string) => {
	if (status === 'RUNNING') {
		if (actionName) { blackboard.set(actionName, true); }
		else { blackboard.actionInProgress = true; }
	} else {
		if (actionName) { blackboard.set(actionName, false); }
		else { blackboard.actionInProgress = false; }
	}
	return status;
};

/**
 * Represents a condition function for a node in a behavior tree.
 *
 * @param blackboard - The blackboard object used for storing and retrieving data.
 * @param parameters - Additional parameters that can be passed to the condition function.
 * @returns A boolean value indicating whether the condition is met or not.
 */
type NodeCondition = (blackboard: Blackboard, ...parameters: any[]) => boolean;
/**
 * Represents a modifier for a node condition.
 *
 * The modifier can be one of the following:
 * - 'NOT': Negates the condition.
 * - null: No modifier applied.
 */
type NodeConditionModifier = 'NOT' | null;
/**
 * Represents a modifier for composite conditions in a node.
 *
 * The modifier can be either 'AND' or 'OR'.
 */
type NodeCompositeConditionModifier = 'AND' | 'OR';

/**
 * Represents a node in a behavior tree that evaluates a condition.
 */
export class ConditionNode extends ParametrizedBTNode {
	public condition: NodeCondition;
	public modifier: NodeConditionModifier;

	constructor(id: BehaviorTreeID, condition: (blackboard: Blackboard) => boolean, modifier: NodeConditionModifier, _priority = 0, parameters?: any[]) {
		super(id, _priority, parameters);
		this.condition = condition;
		this.modifier = modifier;
	}

	/**
	 * Executes the condition node and returns the feedback based on the evaluation result.
	 * @returns The feedback indicating the status of the condition node.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let conditionResult = this.condition.call(this.getTarget(targetid), blackboard, ...this.parameters);
		if (this.modifier === 'NOT') {
			conditionResult = !conditionResult;
		}
		return conditionResult ? { status: 'SUCCESS' } : { status: 'FAILED' };
	}
}

/**
 * Represents a composite condition node in a behavior tree.
 * This node evaluates a set of conditions and returns a feedback based on the operator.
 */
export class CompositeConditionNode extends ParametrizedBTNode {
	public conditions: NodeCondition[];
	public operator: NodeCompositeConditionModifier;

	constructor(id: BehaviorTreeID, conditions: NodeCondition[], operator: NodeCompositeConditionModifier, _priority = 0, parameters?: any[]) {
		super(id, _priority, parameters);
		this.conditions = conditions;
		this.operator = operator;
	}

	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const target = this.getTarget(targetid);
		let combinedResult = (this.operator === 'AND');

		for (const condition of this.conditions) {
			const result = condition.call(target, blackboard, ...this.parameters);
			if (this.operator === 'AND') {
				combinedResult = combinedResult && result;
			} else if (this.operator === 'OR') {
				combinedResult = combinedResult || result;
			}
		}

		return combinedResult ? { status: 'SUCCESS' } : { status: 'FAILED' };
	}
}

/**
 * Represents a node in a behavior tree that randomly selects and executes one of its child nodes.
 */
export class RandomSelectorNode extends BTNode {
	public children: BTNode[];
	public currentchild_propname: string;

	constructor(id: BehaviorTreeID, children: BTNode[], _currentchild_propname: string, _priority = 0) {
		super(id, _priority);
		if (children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] RandomSelectorNode requires at least one child.`);
		}
		if (typeof _currentchild_propname !== 'string' || _currentchild_propname.length === 0) {
			throw new Error(`[BehaviorTree:${id}] RandomSelectorNode requires a non-empty property name for tracking state.`);
		}
		this.children = children;
		this.currentchild_propname = _currentchild_propname;
	}

	/**
	 * Executes the random selection logic and ticks the selected child node.
	 * @returns The feedback from the selected child node.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const storedIndex = blackboard.nodedata[this.currentchild_propname];
		let currentChildIndex: number;
		if (storedIndex === undefined) {
			const nextIndex = Math.floor(Math.random() * this.children.length);
			blackboard.nodedata[this.currentchild_propname] = nextIndex;
			currentChildIndex = nextIndex;
		} else if (typeof storedIndex !== 'number' || !Number.isInteger(storedIndex)) {
			throw new Error(`[BehaviorTree:${this.id}] RandomSelectorNode stored index '${storedIndex}' is not a valid integer.`);
		} else {
			currentChildIndex = storedIndex;
		}

		if (currentChildIndex < 0 || currentChildIndex >= this.children.length) {
			throw new Error(`[BehaviorTree:${this.id}] RandomSelectorNode stored index '${currentChildIndex}' is out of range.`);
		}

		const feedback = this.children[currentChildIndex].tick(targetid, blackboard);

		// If the child has finished executing (either succeeded or failed), reset the current child index
		if (feedback.status !== 'RUNNING') {
			delete blackboard.nodedata[this.currentchild_propname];
		}
		return feedback;
	}
}

/**
 * Represents a node in a behavior tree that limits the number of times its child node can be executed.
 */
export class LimitNode extends BTNode {
	public count_propname: string;
	public limit: number;
	public child: BTNode;

	constructor(id: BehaviorTreeID, limit: number, _count_propname: string, child: BTNode, _priority = 0) {
		super(id, _priority);
		if (!Number.isFinite(limit) || limit < 0) {
			throw new Error(`[BehaviorTree:${id}] LimitNode requires a non-negative finite limit.`);
		}
		if (typeof _count_propname !== 'string' || _count_propname.length === 0) {
			throw new Error(`[BehaviorTree:${id}] LimitNode requires a non-empty property name for tracking count.`);
		}
		if (!child) {
			throw new Error(`[BehaviorTree:${id}] LimitNode requires a child node.`);
		}
		this.limit = limit;
		this.child = child;
		this.count_propname = _count_propname;
	}

	/**
	 * Executes the node's logic.
	 * @returns The feedback of the node's execution.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const storedCount = blackboard.nodedata[this.count_propname];
		let count: number;
		if (storedCount === undefined) {
			count = 0;
			blackboard.nodedata[this.count_propname] = count;
		} else if (typeof storedCount !== 'number' || !Number.isFinite(storedCount)) {
			throw new Error(`[BehaviorTree:${this.id}] LimitNode count '${storedCount}' is not a finite number.`);
		} else {
			count = storedCount;
		}

		if (count < this.limit) {
			const result = this.child.tick(targetid, blackboard);
			if (result.status !== 'RUNNING') {
				++count;
				blackboard.nodedata[this.count_propname] = count;
			}
			return result;
		}
		return { status: 'FAILED' };
	}
}

/**
 * Represents a node in a behavior tree that selects and executes the highest priority child node.
 */
export class PrioritySelectorNode extends BTNode {
	public children: BTNode[];

	constructor(id: BehaviorTreeID, children: BTNode[], _priority = 0) {
		super(id, _priority);
		if (children.length === 0) {
			throw new Error(`[BehaviorTree:${id}] PrioritySelectorNode requires at least one child.`);
		}
		this.children = children;
	}

	/**
	 * Executes the priority selection logic and ticks the highest priority child node.
	 * @returns The feedback from the highest priority child node.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		this.children.sort((a, b) => b.priority - a.priority);
		for (const child of this.children) {
			const result = child.tick(targetid, blackboard);
			if (result.status !== 'FAILED') {
				return result;
			}
		}
		return { status: 'FAILED' };
	}
}

/**
 * Represents a node in a behavior tree that waits for a specific amount of time before returning success.
 */
export class WaitNode extends BTNode {
	public wait_propname: string;
	public wait_time: number;

	constructor(id: BehaviorTreeID, waitTime: number, _wait_propname: string, _priority = 0) {
		super(id, _priority);
		if (!Number.isFinite(waitTime) || waitTime < 0) {
			throw new Error(`[BehaviorTree:${id}] WaitNode requires a non-negative finite wait time.`);
		}
		if (typeof _wait_propname !== 'string' || _wait_propname.length === 0) {
			throw new Error(`[BehaviorTree:${id}] WaitNode requires a non-empty property name for tracking state.`);
		}
		this.wait_time = waitTime;
		this.wait_propname = _wait_propname;
	}

	/**
	 * Executes the tick logic of the node.
	 * @returns The feedback of the node.
	 */
	tick(_targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const storedTick = blackboard.nodedata[this.wait_propname];
		let currentTick: number;
		if (storedTick === undefined) {
			currentTick = 0;
			blackboard.nodedata[this.wait_propname] = currentTick;
		} else if (typeof storedTick !== 'number' || !Number.isFinite(storedTick)) {
			throw new Error(`[BehaviorTree:${this.id}] WaitNode tick '${storedTick}' is not a finite number.`);
		} else {
			currentTick = storedTick;
		}

		if (currentTick < this.wait_time) {
			++currentTick;
			blackboard.nodedata[this.wait_propname] = currentTick;
			return { status: 'RUNNING' };
		} else {
			currentTick = 0;
			delete blackboard.nodedata[this.wait_propname];
			return { status: 'SUCCESS' };
		}
	}
}

/**
 * Represents a node in a behavior tree that performs an action.
 * @example
 * const changeHealthAction = (blackboard: Blackboard) => {
 *     let currentHealth = blackboard.get<number>('health');
 *     blackboard.set('health', currentHealth - 10); // Example: reduce health
 * };
 * // Usage in an ActionNode
 * const healthActionNode = new ActionNode('enemy1', blackboard, changeHealthAction);
 */

export type NodeAction = (blackboard: Blackboard, ...parameters: any[]) => BTStatus;

/**
 * Represents a node in a behavior tree that performs an action.
 */
export class ActionNode extends ParametrizedBTNode {
	private readonly action: NodeAction;

	constructor(id: BehaviorTreeID, action: NodeAction, _priority = 0, parameters?: any[]) {
		super(id, _priority, parameters);
		if (typeof action !== 'function') {
			throw new Error(`[BehaviorTree:${id}] ActionNode requires an action handler.`);
		}
		this.action = action;
	}

	/**
	 * Executes the action associated with this node.
	 * @returns The feedback of the action execution.
	 */
	tick(targetId: Identifier, blackboard: Blackboard): BTNodeFeedback {
		const result = this.action.call(this.getTarget(targetId), blackboard, ...this.parameters);
		return { status: result };
	}
}

/**
 * Represents a composite action node in a behavior tree.
 * A composite action node is a type of node that contains multiple child action nodes.
 * When ticked, it executes all the child action nodes in sequence.
 */
export class CompositeActionNode extends ParametrizedBTNode {
	public actions: ActionNode[];

	constructor(id: BehaviorTreeID, actions: ActionNode[], _priority = 0, parameters?: any[]) {
		super(id, _priority, parameters);
		if (actions.length === 0) {
			throw new Error(`[BehaviorTree:${id}] CompositeActionNode requires at least one action.`);
		}
		this.actions = actions;
	}

	/**
	 * Executes the tick logic of the node.
	 * @returns The feedback of the node.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let feedback: BTNodeFeedback = { status: 'SUCCESS' };
		for (const action of this.actions) {
			const result = action.tick(targetid, blackboard);
			if (result.status === 'FAILED') {
				return result;
			}
			if (result.status === 'RUNNING') { // If any action is running, return running
				feedback = result;
			}
		}
		return feedback;
	}
}
