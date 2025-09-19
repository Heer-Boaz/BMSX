import { $ } from '../core/game';
import { normalizeDecoratedClassName } from '../utils/decorators';
import { WorldObject } from '../core/object/worldobject';
import type { Identifiable, Identifier } from '../rompack/rompack';
import { excludeclassfromsavegame, insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';

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
export var BehaviorTreeDefinitions: { [key: BehaviorTreeID]: BehaviorTreeDefinition } | null = null;

/**
 * Represents the collection of behavior trees that are constructed based on the definitions.
 * This happens when the game is initialized and is similar to how the state machines are constructed
 * from their definitions that are defined in a declarative way.
 * @type {Object.<BehaviorTreeID, BTNode> | null}
 */
export var BehaviorTrees: { [key: BehaviorTreeID]: BTNode } | null = null;

/**
 * Sets up the behavior tree definition library.This function should be called during the game initialization.
 */
export function setup_bt_library(): void {
	BehaviorTrees = {};
	for (let bt_id in BehaviorTreeDefinitions) {
		let bt_def = BehaviorTreeDefinitions[bt_id];
		if (bt_def) BehaviorTrees[bt_id] = constructBehaviorTree(bt_id);
	}
}

/**
 * Sets up the behavior tree definition library.This function should be called during the game initialization.
 */
export function setup_btdef_library(): void {
	BehaviorTreeDefinitions = {};
	for (let bt_id in behaviorTreeDefinitionsBuilders) {
		let bt_def = behaviorTreeDefinitionsBuilders[bt_id]();
		if (bt_def) BehaviorTreeDefinitions[bt_id] = bt_def;
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
let behaviorTreeDefinitionsBuilders: { [key: BehaviorTreeID]: () => BehaviorTreeDefinition } | null = null;

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
	const typeValue = config.type;
	switch (typeValue) {
		case 'selector':
		case 'Selector':
			return new SelectorNode(id, config.children.map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'sequence':
		case 'Sequence':
			return new SequenceNode(id, config.children.map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'parallel':
		case 'Parallel':
			return new ParallelNode(id, config.children.map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.successPolicy, config.priority);
		case 'decorator':
		case 'Decorator':
			return new DecoratorNode(id, buildBehaviorTreeNode(config.child, id), config.decorator, config.priority);
		case 'condition':
		case 'Condition':
			return new ConditionNode(id, config.condition, config.modifier ?? null, config.priority, config.parameters);
		case 'compositecondition':
		case 'CompositeCondition':
			return new CompositeConditionNode(id, config.conditions, config.modifier, config.priority, config.parameters);
		case 'randomselector':
		case 'RandomSelector':
			return new RandomSelectorNode(id, config.children.map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.currentchild_propname, config.priority);
		case 'limit':
		case 'Limit':
			return new LimitNode(id, config.limit, config.count_propname, buildBehaviorTreeNode(config.child, id), config.priority);
		case 'priorityselector':
		case 'PrioritySelector':
			return new PrioritySelectorNode(id, config.children.map(childConfig => buildBehaviorTreeNode(childConfig, id)), config.priority);
		case 'wait':
		case 'Wait':
			return new WaitNode(id, config.wait_time, config.wait_propname, config.priority);
		case 'action':
		case 'Action':
			return new ActionNode(id, config.action, config.priority, config.parameters);
		case 'compositeaction':
		case 'CompositeAction':
			return new CompositeActionNode(id, config.actions.map(actionConfig => buildBehaviorTreeNode(actionConfig, id) as ActionNode), config.priority, config.parameters);
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
		if (!Object.prototype.hasOwnProperty.call(constructor, 'linkedBTs')) {
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
			behaviorTreeDefinitionsBuilders ??= {};
			// If no explicit bt_id supplied, normalize inferred class name for public key.
			const inferred = ctor?.name;
			const key = bt_id ? bt_id : normalizeDecoratedClassName(inferred);
			behaviorTreeDefinitionsBuilders[key] = value as () => BehaviorTreeDefinition;
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
export function constructBehaviorTree(bt_id: BehaviorTreeID): BTNode | null {
	const btdef = BehaviorTreeDefinitions[bt_id];
	if (!btdef) return null;
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
		for (let properties of Object.values(updates)) {
			for (let { value, key } of properties) {
				this.set(key, value);
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
	public getTarget<T extends WorldObject>(targetid: Identifier) { return $.world.getWorldObject<T>(targetid); }

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
		this.children = children;
		this.currentchild_propname = _currentchild_propname;
	}

	/**
	 * Executes the random selection logic and ticks the selected child node.
	 * @returns The feedback from the selected child node.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let currentChildIndex = blackboard.nodedata[this.currentchild_propname] as number;

		// If there is no currently executing child, select a random child
		if (!currentChildIndex) {
			currentChildIndex = Math.floor(Math.random() * this.children.length);
			blackboard.nodedata[this.currentchild_propname] = currentChildIndex;
		}

		// Tick the currently executing child
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
		this.limit = limit;
		this.child = child;
		this.count_propname = _count_propname;
	}

	/**
	 * Executes the node's logic.
	 * @returns The feedback of the node's execution.
	 */
	tick(targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let count = blackboard.nodedata[this.count_propname] as number;
		if (!count) {
			count = 0;
			blackboard.nodedata[this.count_propname] = count;
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
		this.wait_time = waitTime;
		this.wait_propname = _wait_propname;
	}

	/**
	 * Executes the tick logic of the node.
	 * @returns The feedback of the node.
	 */
	tick(_targetid: Identifier, blackboard: Blackboard): BTNodeFeedback {
		let currentTick = blackboard.nodedata[this.wait_propname] as number;
		if (!currentTick) {
			currentTick = 0;
			blackboard.nodedata[this.wait_propname] = currentTick;
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
	public action: NodeAction;

	constructor(id: BehaviorTreeID, action: NodeAction, _priority = 0, parameters?: any[]) {
		super(id, _priority, parameters);
		this.action = action;
	}

	/**
	 * Executes the action associated with this node.
	 * @returns The feedback of the action execution.
	 */
	tick(targetId: Identifier, blackboard: Blackboard): BTNodeFeedback {
		// Perform the action
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
		return feedback
	}
}
