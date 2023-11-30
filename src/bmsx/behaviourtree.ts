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
export class Blackboard {
	private getBindings: Map<string, () => any> = new Map();
	private setBindings: Map<string, (value: any) => void> = new Map();

	constructor(bindings: Array<{ getProperty: () => any, setProperty: (value: any) => void, key: string }>) {
		bindings.forEach(binding => {
			this.getBindings.set(binding.key, binding.getProperty);
			this.setBindings.set(binding.key, binding.setProperty);
		});
	}

	/**
	 * Retrieves the value associated with the specified key.
	 *
	 * @param key - The key of the value to retrieve.
	 * @returns The value associated with the key, or undefined if the key does not exist.
	 * @template T - The type of the value to retrieve.
	 */
	get<T>(key: string): T | undefined {
		const propertyFunc = this.getBindings.get(key);
		return propertyFunc ? propertyFunc() as T : undefined;
	}

	/**
	 * Sets the value for the specified key.
	 *
	 * @param key - The key to set the value for.
	 * @param value - The value to set.
	 */
	set(key: string, value: any) {
		const setFunc = this.setBindings.get(key);
		setFunc && setFunc(value);
	}

	/**
	 * Binds a property to the specified key.
	 *
	 * @param getProperty A function that retrieves the property value.
	 * @param setProperty A function that sets the property value.
	 * @param key The key to bind the property to.
	 */
	bindProperty(getProperty: () => any, setProperty: (value: any) => void, key: string) {
		this.getBindings.set(key, getProperty);
		this.setBindings.set(key, setProperty);
	}

	/**
	 * Creates a binding object for a property of an object.
	 * @param object The object to bind the property to.
	 * @param property The property name to bind.
	 * @param key The key for the binding object.
	 * @returns The binding object with getter, setter, and key properties.
	 */
	public static createBinding<T>(object: T, property: keyof T, key: string) {
		return {
			getProperty: () => (object[property] as any),
			setProperty: (value: any) => { object[property] = value; },
			key: key
		};
	}

	/**
	 * Creates bindings for the specified object properties.
	 *
	 * @template T - The type of the object.
	 * @param object - The object to create bindings for.
	 * @param properties - An array of property definitions.
	 * @returns An array of binding objects.
	 */
	public static createBindings<T>(object: T, properties: Array<{ property: keyof T, key: string }>) {
		return properties.map(prop => ({
			getProperty: () => (object[prop.property] as any),
			setProperty: (value: any) => { object[prop.property] = value; },
			key: prop.key
		}));
	}
}

/**
 * Represents an abstract base class for behavior tree nodes.
 */
export abstract class BTNode {
	/**
	 * The ID of the target object.
	 */
	public targetid: string;
	/**
	 * The priority of the node.
	 */
	public priority: number;
	/**
	 * The blackboard object used for storing data in the BT.
	 */
	public blackboard: Blackboard;
	/**
	 * Constructs a new instance of the Bfsm class.
	 * @param _targetid - The target ID.
	 * @param _blackboard - The blackboard.
	 * @param _priority - The priority (optional, default value is 0).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, _priority = 0) {
		this.targetid = _targetid;
		this.blackboard = _blackboard;
		this.priority = _priority;
	}

	/**
	 * Executes the behavior tree node.
	 * @returns The feedback from the execution of the node.
	 */
	abstract tick(): BTNodeFeedback;
}

/**
 * Represents a sequence node in a behavior tree.
 */
export class SequenceNode extends BTNode {
	/**
	 * Creates an instance of the BFsm class.
	 * @param _targetid - The target ID.
	 * @param _blackboard - The blackboard.
	 * @param children - The child nodes.
	 * @param _priority - The priority (optional, default is 0).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick operation on each child node in sequence.
	 * If any child node fails, the sequence fails.
	 * If all child nodes succeed, the sequence succeeds.
	 * @returns The feedback status of the sequence node.
	 */
	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
			if (result.status === 'FAILED') {
				return { status: 'FAILED' };
			}
		}
		return { status: 'SUCCESS' };
	}
}

/**
 * Represents a selector node in a behavior tree.
 */
export class SelectorNode extends BTNode {
	/**
	 * Creates an instance of the BFsm class.
	 * @param _targetid - The target ID.
	 * @param _blackboard - The blackboard.
	 * @param children - The child nodes.
	 * @param _priority - The priority (optional).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick operation on the selector node.
	 * @returns The feedback of the tick operation.
	 */
	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
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
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], public successPolicy: 'ONE' | 'ALL', _proirity = 0) {
		super(_targetid, _blackboard, _proirity);
	}

	/**
	 * Executes the tick operation on the parallel node.
	 * @returns The feedback of the tick operation.
	 */
	tick(): BTNodeFeedback {
		let successCount = 0;
		let running = false;

		for (const child of this.children) {
			const result = child.tick();
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
		}

		return running ? { status: 'RUNNING' } : { status: 'FAILED' };
	}
}

/**
 * Represents a decorator node in a behavior tree.
 */
export class DecoratorNode extends BTNode {
	/**
	 * Constructs a new instance of the BFsm class.
	 * @param _targetid The target ID.
	 * @param _blackboard The blackboard.
	 * @param child The child node.
	 * @param decorator The decorator function.
	 * @param _priority The priority.
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public child: BTNode, public decorator: (status: BTStatus) => BTStatus, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick operation on the child node and applies the decorator function to the result.
	 * @returns The feedback of the decorator node.
	 */
	tick(): BTNodeFeedback {
		const result = this.child.tick();
		return { status: this.decorator(result.status) };
	}
}

/**
 * Represents a node in a behavior tree that evaluates a condition.
 */
export class ConditionNode extends BTNode {
	/**
	 * Constructs a new instance of the Bfsm class.
	 * @param _targetid The target ID.
	 * @param _blackboard The blackboard.
	 * @param condition The condition function.
	 * @param _priority The priority (optional, default value is 0).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public condition: () => boolean, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the condition node and returns the feedback based on the evaluation result.
	 * @returns The feedback indicating the status of the condition node.
	 */
	tick(): BTNodeFeedback {
		return this.condition() ? { status: 'SUCCESS' } : { status: 'FAILED' };
	}
}

/**
 * Represents a node in a behavior tree that randomly selects and executes one of its child nodes.
 */
export class RandomSelectorNode extends BTNode {
	/**
	 * Constructs a new instance of the BFsm class.
	 * @param _targetid The target ID.
	 * @param _blackboard The blackboard.
	 * @param children The child nodes.
	 * @param _priorirty The priority (optional, default value is 0).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priorirty = 0) {
		super(_targetid, _blackboard, _priorirty);
	}

	/**
	 * Executes the random selection logic and ticks the selected child node.
	 * @returns The feedback from the selected child node.
	 */
	tick(): BTNodeFeedback {
		const randomIndex = Math.floor(Math.random() * this.children.length);
		return this.children[randomIndex].tick();
	}
}

/**
 * Represents a node in a behavior tree that limits the number of times its child node can be executed.
 */
export class LimitNode extends BTNode {
	private count: number = 0;

	/**
	 * Creates an instance of LimitNode.
	 * @param _targetid - The target ID of the node.
	 * @param _blackboard - The blackboard object.
	 * @param limit - The maximum number of times the child node can be executed.
	 * @param child - The child node to be executed.
	 * @param _priority - The priority of the node.
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public limit: number, public child: BTNode, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the node's logic.
	 * @returns The feedback of the node's execution.
	 */
	tick(): BTNodeFeedback {
		if (this.count < this.limit) {
			const result = this.child.tick();
			if (result.status !== 'RUNNING') {
				this.count++;
			}
			return result;
		}
		return { status: 'FAILED' };
	}
}

/**
 * Represents a priority selector node in a behavior tree.
 */
export class PrioritySelectorNode extends BTNode {
	/**
	 * Constructs a new instance of the BFsm class.
	 * @param _targetid The target ID.
	 * @param _blackboard The blackboard.
	 * @param children The child nodes.
	 * @param _priority The priority.
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public children: BTNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick operation on the priority selector node.
	 * @returns The feedback of \the tick operation.
	 */
	tick(): BTNodeFeedback {
		for (const child of this.children) {
			const result = child.tick();
			if (result.status === 'SUCCESS') {
				return { status: 'SUCCESS' };
			}
		}
		return { status: 'FAILED' };
	}
}

/**
 * Represents a node in a behavior tree that waits for a specific amount of time before returning success.
 */
export class WaitNode extends BTNode {
	private startTick: number | null = null;
	private currentTick: number = 0;

	/**
	 * Creates an instance of WaitNode.
	 * @param _targetid - The target ID of the node.
	 * @param _blackboard - The blackboard object.
	 * @param waitTime - The amount of time to wait in ticks.
	 * @param _priority - The priority of the node.
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public waitTime: number, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick logic of the node.
	 * @returns The feedback of the node.
	 */
	tick(): BTNodeFeedback {
		if (!this.startTick) this.startTick = this.currentTick;

		if (this.currentTick - this.startTick < this.waitTime) {
			this.currentTick++;
			return { status: 'RUNNING' };
		}

		this.startTick = null;
		this.currentTick = 0;
		return { status: 'SUCCESS' };
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
export class ActionNode extends BTNode {
	/**
	 * Constructs a new instance of the `BFSM` class.
	 * @param _targetid The target ID.
	 * @param _blackboard The blackboard.
	 * @param action The action to be performed by the `BFSM`.
	 * @param _priority The priority of the `BFSM`. Default is 0.
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public action: (blackboard: Blackboard) => void, _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the action associated with this node.
	 * @returns The feedback of the action execution.
	 */
	tick(): BTNodeFeedback {
		this.action(this.blackboard);
		return { status: 'SUCCESS' };
	}
}

/**
 * Represents a composite action node in a behavior tree.
 * A composite action node is a type of node that contains multiple child action nodes.
 * When ticked, it executes all the child action nodes in sequence.
 */
export class CompositeActionNode extends BTNode {
	/**
	 * Constructs a new instance of the Bfsm class.
	 * @param _targetid - The target ID.
	 * @param _blackboard - The blackboard.
	 * @param actions - The action nodes.
	 * @param _priority - The priority (optional, default value is 0).
	 */
	constructor(_targetid: string, _blackboard: Blackboard, public actions: ActionNode[], _priority = 0) {
		super(_targetid, _blackboard, _priority);
	}

	/**
	 * Executes the tick operation for the BFStateMachine.
	 * @returns The feedback of the tick operation.
	 */
	tick(): BTNodeFeedback {
		for (const action of this.actions) {
			action.tick();
		}
		return { status: 'SUCCESS' };
	}
}
