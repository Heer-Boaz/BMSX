import { GameObject, IIdentifiable } from './gameobject';
import { insavegame } from './gameserializer';
import type { GameObjectId } from './rompack';

/**
 * Represents the definition of a behavior tree.
 */
export type BehaviorTreeDefinition =
    | { type: 'Selector'; children: BehaviorTreeDefinition[] }
    | { type: 'Sequence'; children: BehaviorTreeDefinition[] }
    | { type: 'Parallel'; children: BehaviorTreeDefinition[]; successPolicy: 'ONE' | 'ALL' }
    | { type: 'Decorator'; child: BehaviorTreeDefinition; decorator: NodeDecorator }
    | { type: 'Condition'; condition: NodeCondition }
    | { type: 'RandomSelector'; children: BehaviorTreeDefinition[], currentchild_propname: string }
    | { type: 'Limit'; child: BehaviorTreeDefinition; limit: number, count_propname: string, priority?: number }
    | { type: 'PrioritySelector'; children: BehaviorTreeDefinition[] }
    | { type: 'Wait'; waitTime: number, wait_propname: string }
    | { type: 'Action'; action: NodeAction }
    | { type: 'CompositeAction'; actions: BehaviorTreeDefinition[] };

export var BehaviorTreeDefinitions: { [key: BehaviorTreeID]: BehaviorTreeDefinition } | null = null;
export var BehaviorTrees: { [key: BehaviorTreeID]: BTNode } | null = null;

/**
 * Sets up the behavior tree definition library.
 */
export function setup_bt_library(): void {
    BehaviorTrees = {};
    for (let bt_id in BehaviorTreeDefinitions) {
        let bt_def = BehaviorTreeDefinitions[bt_id];
        if (bt_def) BehaviorTrees[bt_id] = constructBehaviorTree(bt_id);
    }
}

/**
 * Sets up the behavior tree definition library.
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
 *
 * @param config - The behavior tree definition.
 * @param blackboard - The blackboard object used for storing data during the execution of the behavior tree.
 * @param targetId - The ID of the target game object.
 * @returns The root node of the built behavior tree.
 */
function buildBehaviorTree(config: BehaviorTreeDefinition, id: BehaviorTreeID): BTNode {
    switch (config.type) {
        case 'Selector':
            return new SelectorNode(id, config.children.map(childConfig => buildBehaviorTree(childConfig, id)));
        case 'Sequence':
            return new SequenceNode(id, config.children.map(childConfig => buildBehaviorTree(childConfig, id)));
        case 'Parallel':
            return new ParallelNode(id, config.children.map(childConfig => buildBehaviorTree(childConfig, id)), config.successPolicy);
        case 'Decorator':
            return new DecoratorNode(id, buildBehaviorTree(config.child, id), config.decorator);
        case 'Condition':
            return new ConditionNode(id, config.condition);
        case 'RandomSelector':
            return new RandomSelectorNode(id, config.children.map(childConfig => buildBehaviorTree(childConfig, id)), config.currentchild_propname);
        case 'Limit':
            return new LimitNode(id, config.limit, config.count_propname, buildBehaviorTree(config.child, id), config.priority);
        case 'PrioritySelector':
            return new PrioritySelectorNode(id, config.children.map(childConfig => buildBehaviorTree(childConfig, id)));
        case 'Wait':
            return new WaitNode(id, config.waitTime, config.wait_propname);
        case 'Action':
            return new ActionNode(id, config.action);
        case 'CompositeAction':
            return new CompositeActionNode(id, config.actions.map(actionConfig => buildBehaviorTree(actionConfig, id) as ActionNode));
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
    return function (constructor: ConstructorWithBTProperty) {
        if (!constructor.hasOwnProperty('linkedBTs')) {
            constructor.linkedBTs = new Set<BehaviorTreeID>();
        }
        bts.forEach(bt => constructor.linkedBTs.add(bt));
        updateAllAssignedBTs(constructor);
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
            11
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
    return function btdef_builder(target: any, name: any, descriptor: PropertyDescriptor): any {
        behaviorTreeDefinitionsBuilders ??= {};
        behaviorTreeDefinitionsBuilders[bt_id ?? target.name] = descriptor.value;
    };
}

/**
 * Constructs a behavior tree based on the specified tree name, blackboard, and target ID.
 * @param bt_id - The name of the behavior tree.
 * @param targetId - The ID of the target game object.
 * @returns The constructed behavior tree node, or null if the tree definition is not found.
 */
export function constructBehaviorTree(bt_id: BehaviorTreeID): BTNode | null {
    const btdef = BehaviorTreeDefinitions[bt_id];
    if (btdef) return buildBehaviorTree(btdef, bt_id);
    return null;
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
    status: BTStatus,
    updates?: (blackboard: Blackboard) => void;  // Detailed information about the action taken or decision made
};

/**
 * Represents a blackboard that stores key-value bindings.
 */
@insavegame
export class Blackboard implements IIdentifiable {
    public id: string;
    public data: { [key: string]: any } = {};
    public nodedata: { [key: string]: any } = {};

    constructor(_id: string) {
        this.id = _id;
    }

    set<T>(key: string, value: T): void {
        this.data[key] = value;
    }

    get<T>(key: string): T | undefined {
        return this.data[key] as T;
    }

    public clearAllNodeData(): void {
        delete this.nodedata;
        this.nodedata = {};
    }

    public get actionInProgress(): boolean {
        return this.nodedata['actionInProgress'] ?? false;
    }

    public set actionInProgress(inProgress: boolean) {
        this.nodedata['actionInProgress'] = inProgress;
    }

    applyUpdates(updates: { [id: string]: Array<{ property: string, value: any, key?: string }> }): void {
        for (let properties of Object.values(updates)) {
            for (let { value, key } of properties) {
                this.set(key, value);
            }
        }
    }
    public copyPropertiesToBlackboard<T extends GameObject>(target: T, properties: Array<{ property: keyof T, key?: string }>): void {
        for (let { property, key } of properties) {
            // If no key is given, use the property name as the key
            key = key ?? (property as string);

            // Get the property value from the target
            let value = target[property];

            // Set the blackboard entry
            this.set(key as string, value);
        }
    }
}

/**
 * Represents the ID for a behavior tree.
 */
export type BehaviorTreeID = string;

export abstract class BTNode implements IIdentifiable {
    public id: BehaviorTreeID;
    public priority: number;

    /**
     * Retrieves the target object with the specified GameObjectId and casts it to the specified type.
     * @param targetid The GameObjectId of the target object.
     * @returns The target object casted to the specified type.
     */
    public getTarget<T extends GameObject>(targetid: GameObjectId) { return global.model.get(targetid); }

    constructor(id: BehaviorTreeID, _priority = 0) {
        this.id = id;
        this.priority = _priority;
    }

    abstract tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback;
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

    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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

type NodeDecorator = (status: BTStatus, targetid: GameObjectId, blackboard: Blackboard) => BTStatus;

export class DecoratorNode extends BTNode {
    public child: BTNode;
    public decorator: (status: BTStatus, targetid: GameObjectId, blackboard: Blackboard) => BTStatus;

    constructor(id: BehaviorTreeID, child: BTNode, decorator: NodeDecorator, _priority = 0) {
        super(id, _priority);
        this.child = child;
        this.decorator = decorator;
    }

    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
        const childResult = this.child.tick(targetid, blackboard);
        const modifiedResult = this.decorator(childResult.status, targetid, blackboard);
        return { status: modifiedResult };
    }
}

export let WaitForActionCompletionDecorator: NodeDecorator = (status: BTStatus, targetid: GameObjectId, blackboard: Blackboard) => {
    if (status === 'RUNNING') {
        blackboard.actionInProgress = true;
    } else {
        blackboard.actionInProgress = false;
    }
    return status;
};

type NodeCondition = (blackboard: Blackboard) => boolean;

/**
 * Represents a node in a behavior tree that evaluates a condition.
 */
export class ConditionNode extends BTNode {
    public condition: NodeCondition;

    constructor(id: BehaviorTreeID, condition: (blackboard: Blackboard) => boolean, _priority = 0) {
        super(id, _priority);
        this.condition = condition;
    }

    /**
     * Executes the condition node and returns the feedback based on the evaluation result.
     * @returns The feedback indicating the status of the condition node.
     */
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
        // Check if an action is in progress
        if (blackboard.actionInProgress) {
            // Optionally, handle this case differently
            return { status: 'FAILED' };
        }
        return this.condition.call(this.getTarget(targetid), blackboard) ? { status: 'SUCCESS' } : { status: 'FAILED' };
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
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
    public waitTime: number;

    constructor(id: BehaviorTreeID, waitTime: number, _wait_propname: string, _priority = 0) {
        super(id, _priority);
        this.waitTime = waitTime;
        this.wait_propname = _wait_propname;
    }

    /**
     * Executes the tick logic of the node.
     * @returns The feedback of the node.
     */
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
        let currentTick = blackboard.nodedata[this.wait_propname] as number;
        if (!currentTick) {
            currentTick = 0;
            blackboard.nodedata[this.wait_propname] = currentTick;
        }

        if (currentTick < this.waitTime) {
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

export type NodeAction = (blackboard: Blackboard) => BTStatus;

/**
 * Represents a node in a behavior tree that performs an action.
 */
export class ActionNode extends BTNode {
    public action: NodeAction;

    constructor(id: BehaviorTreeID, action: NodeAction, _priority = 0) {
        super(id, _priority);
        this.action = action;
    }

    /**
     * Executes the action associated with this node.
     * @returns The feedback of the action execution.
     */
    tick(targetId: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
        // Perform the action
        const result = this.action.call(this.getTarget(targetId), blackboard);
        return { status: result };
    }
}

/**
 * Represents a composite action node in a behavior tree.
 * A composite action node is a type of node that contains multiple child action nodes.
 * When ticked, it executes all the child action nodes in sequence.
 */
export class CompositeActionNode extends BTNode {
    public actions: ActionNode[];

    constructor(id: BehaviorTreeID, actions: ActionNode[], _priority = 0) {
        super(id, _priority);
        this.actions = actions;
    }

    /**
     * Executes the tick logic of the node.
     * @returns The feedback of the node.
     */
    tick(targetid: GameObjectId, blackboard: Blackboard): BTNodeFeedback {
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
