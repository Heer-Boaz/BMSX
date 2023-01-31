interface IBehavior {
    run(): "RUNNING" | "FAILED" | "SUCCESS";
}

// In this updated example, a SequenceNode class is introduced that implements the IBehavior interface and serves as a composite node in the behavior tree. The SequenceNode runs its child behaviors in order, and if any of the child behaviors returns "FAILED", it immediately returns "FAILED". The GameObject class now has a single IBehavior object, which is the root node of the behavior tree. When the update method is called, it simply evaluates the root node, which in turn evaluates its child nodes, and so on.

// A behavior tree is a tree-structured representation of a game object's behaviors, used in AI programming for video games. Each node in the tree represents a behavior or condition, and the tree is evaluated top-to-bottom, from the root to the leaves.

// In typical implementations, each node in the behavior tree returns one of the following status codes:

// "RUNNING": Indicates that the behavior is still executing and has not yet finished.
// "SUCCESS": Indicates that the behavior completed successfully and should stop executing.
// "FAILED": Indicates that the behavior failed and should stop executing.
// The status codes allow the tree to track the progress of its execution and make decisions about which behavior to execute next. For example, a behavior node may return "FAILED" if a certain condition is not met, in which case the tree can choose a different behavior to execute.

class SequenceNode implements IBehavior {
    behaviors: IBehavior[];

    constructor(behaviors: IBehavior[]) {
        this.behaviors = behaviors;
    }

    run() {
        for (const behavior of this.behaviors) {
            const status = behavior.run();
            if (status === "FAILED") {
                return "FAILED";
            }
            if (status === "RUNNING") {
                return "RUNNING";
            }
        }
        return "SUCCESS";
    }
}

class GameObject {
    state: string;
    behaviorTree: IBehavior;

    constructor(state: string) {
        this.state = state;
        this.behaviorTree = new SequenceNode([]);
    }

    updateState(newState: string) {
        this.state = newState;
    }

    addBehavior(behavior: IBehavior) {
        this.behaviorTree.behaviors.push(behavior);
    }

    update() {
        this.behaviorTree.run();
    }
}

class LogBehavior implements IBehavior {
    run() {
        console.log(`Current state: ${gameObject.state}`);
        return "SUCCESS";
    }
}

const gameObject = new GameObject("idle");
gameObject.addBehavior(new LogBehavior());
gameObject.updateState("moving");
gameObject.update(); // logs: "Current state: moving"

// This SelectorNode class is similar to the SequenceNode class, but instead of returning "FAILED" if any child behavior fails, it returns "FAILED" only if all child behaviors fail. The run method iterates through its child behaviors and returns the first non-failed status. This makes the SelectorNode useful for representing decision-making logic, where the first successful option is selected.
class SelectorNode implements IBehavior {
    behaviors: IBehavior[];

    constructor(behaviors: IBehavior[]) {
        this.behaviors = behaviors;
    }

    run() {
        for (const behavior of this.behaviors) {
            const status = behavior.run();
            if (status !== "FAILED") {
                return status;
            }
        }
        return "FAILED";
    }
}

// This ParallelNode class allows multiple behaviors to run in parallel and returns "SUCCESS" if either all or one of them succeeds, depending on the value of the successPolicy field. If successPolicy is set to "ONE", the node returns "SUCCESS" as soon as one child behavior returns "SUCCESS". If successPolicy is set to "ALL", the node returns "SUCCESS" only if all child behaviors return "SUCCESS". If all child behaviors return "FAILED", the node returns "FAILED". If any child behavior returns "RUNNING", the node returns "RUNNING".
class ParallelNode implements IBehavior {
    behaviors: IBehavior[];
    successPolicy: "ONE" | "ALL";

    constructor(behaviors: IBehavior[], successPolicy: "ONE" | "ALL") {
        this.behaviors = behaviors;
        this.successPolicy = successPolicy;
    }

    run() {
        let successCount = 0;
        for (const behavior of this.behaviors) {
            const status = behavior.run();
            if (status === "SUCCESS") {
                successCount++;
                if (this.successPolicy === "ONE" && successCount >= 1) {
                    return "SUCCESS";
                }
            }
            if (status === "FAILED") {
                if (this.successPolicy === "ALL") {
                    return "FAILED";
                }
            }
        }
        if (successCount === this.behaviors.length) {
            return "SUCCESS";
        }
        return "RUNNING";
    }
}

// This DecoratorNode class wraps a single child behavior and modifies its status using a custom function passed to the decorator field. The run method first runs the child behavior and then passes its status to the decorator function, which returns the modified status. This makes the DecoratorNode useful for implementing logic such as inverting the status of a behavior, repeating a behavior until it succeeds, etc.
class DecoratorNode implements IBehavior {
    child: IBehavior;
    decorator: (status: "RUNNING" | "SUCCESS" | "FAILED") => "RUNNING" | "SUCCESS" | "FAILED";

    constructor(child: IBehavior, decorator: (status: "RUNNING" | "SUCCESS" | "FAILED") => "RUNNING" | "SUCCESS" | "FAILED") {
        this.child = child;
        this.decorator = decorator;
    }

    run() {
        const childStatus = this.child.run();
        return this.decorator(childStatus);
    }
}

// This ConditionNode class represents a simple condition that returns "SUCCESS" if the condition is true and "FAILED" if it's false. The condition is specified as a function passed to the condition field. The run method simply calls this function and returns "SUCCESS" or "FAILED" based on its result. This makes the ConditionNode useful for implementing conditions such as checking if a game object has reached a certain position, if a timer has expired, etc.
class ConditionNode implements IBehavior {
    condition: () => boolean;

    constructor(condition: () => boolean) {
        this.condition = condition;
    }

    run() {
        if (this.condition()) {
            return "SUCCESS";
        }
        return "FAILED";
    }
}

// This ActionNode class represents a simple action that always returns "SUCCESS". The action is specified as a function passed to the action field. The run method simply calls this function and returns "SUCCESS". This makes the ActionNode useful for implementing actions such as moving a game object, playing a sound, etc.
class ActionNode implements IBehavior {
    action: () => void;

    constructor(action: () => void) {
        this.action = action;
    }

    run() {
        this.action();
        return "SUCCESS";
    }
}

// This RandomSelectorNode class represents a random selector that selects one of its children nodes randomly, runs it, and returns its result. The children nodes are specified as an array passed to the children field. The run method randomly selects one of these children, runs it, and returns its result. This makes the RandomSelectorNode useful for implementing random decision making in a behavior tree.
class RandomSelectorNode implements IBehavior {
    children: IBehavior[];

    constructor(children: IBehavior[]) {
        this.children = children;
    }

    run() {
        const randomIndex = Math.floor(Math.random() * this.children.length);
        const result = this.children[randomIndex].run();
        return result;
    }
}

// This LimitNode class represents a node that limits the number of times its child node can run. The child node and the limit are specified as arguments passed to the constructor. The run method checks if the limit has been reached, and if not, it runs the child node and returns its result. If the limit has been reached, it returns "FAILED". This makes the LimitNode useful for implementing limits on behavior such as a maximum number of jumps, shots, etc.
class LimitNode implements IBehavior {
    child: IBehavior;
    limit: number;
    currentCount: number;

    constructor(child: IBehavior, limit: number) {
        this.child = child;
        this.limit = limit;
        this.currentCount = 0;
    }

    run() {
        if (this.currentCount < this.limit) {
            this.currentCount++;
            const result = this.child.run();
            if (result === "SUCCESS") {
                this.currentCount = 0;
            }
            return result;
        } else {
            return "FAILED";
        }
    }
}

// This RepeatUntilFailNode class represents a node that repeatedly runs its child node until it returns "FAILED". The child node is specified as an argument passed to the constructor. The run method repeatedly calls the child node's run method and returns the result. If the child node returns "SUCCESS", the loop continues, otherwise, the result is returned. This makes the RepeatUntilFailNode useful for implementing behaviors such as a character repeatedly trying to reach a target until it fails.
class RepeatUntilFailNode implements IBehavior {
    child: IBehavior;

    constructor(child: IBehavior) {
        this.child = child;
    }

    run() {
        let result = "RUNNING";
        while (result === "SUCCESS") {
            result = this.child.run();
        }
        return result;
    }
}

// This PrioritySelectorNode class represents a node that runs its children nodes in order of priority, and returns "SUCCESS" if any of them return "SUCCESS". If all children return "FAILED", it returns "FAILED". The children nodes are specified as an array passed to the constructor. The run method loops through each child node and calls its run method. If a child node returns "SUCCESS", the loop is broken and "SUCCESS" is returned. If all children return "FAILED", "FAILED" is returned. This makes the PrioritySelectorNode useful for implementing behaviors where the agent has a set of preferred actions to choose from, and executes them in a specific order until it succeeds.
class PrioritySelectorNode implements IBehavior {
    children: IBehavior[];

    constructor(children: IBehavior[]) {
        this.children = children;
    }

    run() {
        for (const child of this.children) {
            const result = child.run();
            if (result === "SUCCESS") {
                return result;
            }
        }
        return "FAILED";
    }
}

// This node type is similar to the SequenceNode, but with the difference that it remembers the current child index between subsequent executions.
class MemSequenceNode implements IBehavior {
    children: IBehavior[];
    currentChildIndex = 0;

    constructor(children: IBehavior[]) {
        this.children = children;
    }

    run() {
        while (this.currentChildIndex < this.children.length) {
            const child = this.children[this.currentChildIndex];
            const status = child.run();
            if (status === 'RUNNING') {
                return status;
            }
            if (status === 'FAILED') {
                this.currentChildIndex = 0;
                return status;
            }
            this.currentChildIndex++;
        }
        this.currentChildIndex = 0;
        return 'SUCCESS';
    }
}

// This class implements a behavior tree node that evaluates its children in the order they were added until one of them returns BehaviorStatus.SUCCESS. If all children fail, it returns BehaviorStatus.FAILED. If it returns BehaviorStatus.SUCCESS, it remembers the order of children that succeeded and starts from that child next time it is executed.
class MemPrioritySelectorNode implements IBehavior {
    private children: IBehavior[];
    private currentChild: number;

    constructor(children: IBehavior[]) {
        this.children = children;
        this.currentChild = 0;
    }

    run() {
        while (this.currentChild < this.children.length) {
            let status = this.children[this.currentChild].run();
            if (status !== 'SUCCESS') {
                return status;
            }
            this.currentChild++;
        }
        this.currentChild = 0;
        return 'SUCCESS';
    }
}

// This node type can be used to embed another behavior tree within a node. The tick method delegates the behavior to the embedded tree and returns its status.
class SubTreeNode implements IBehavior {
    constructor(private subtree: IBehavior) { }

    run() {
        return this.subtree.run();
    }
}

class LeafNode implements IBehavior {
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    run() {
        // Perform a specific action here
        return "SUCCESS";
    }
}

// This RepeaterNode repeatedly runs its children a set number of times. If any child returns BehaviorStatus.Failure, the RepeaterNode will also return BehaviorStatus.Failure.
class RepeaterNode implements IBehavior {
    children: IBehavior[] = [];
    constructor(private repeatCount: number) { }
    initialize(): void { }
    update(deltaTime: number): BehaviorStatus {
        let result = BehaviorStatus.Success;
        for (let i = 0; i < this.repeatCount; i++) {
            for (const child of this.children) {
                result = child.update(deltaTime);
                if (result !== BehaviorStatus.Success) break;
            }
            if (result !== BehaviorStatus.Success) break;
        }
        return result;
    }
    terminate(status: BehaviorStatus): void { }
}

class TimeoutNode implements IBehavior {
    children: IBehavior[];
    constructor(private timeout: number) { }

    async execute(context: any): Promise<BehaviorStatus> {
        const startTime = Date.now();
        const result = await this.children[0].execute(context);
        if (result === BehaviorStatus.Success ||
            result === BehaviorStatus.Failure ||
            Date.now() - startTime > this.timeout) {
            return result;
        }
        return BehaviorStatus.Running;
    }
}

export class WaitNode implements IBehavior {
    children: IBehavior[] = [];
    type: BehaviorType = "WaitNode";

    constructor(public timeout: number) { }

    execute(context: Context): BehaviorState {
        if (Date.now() > context.startTime + this.timeout) {
            return BehaviorState.Success;
        }
        return BehaviorState.Running;
    }
}

class RepeatNode implements IBehavior {
    private children: IBehavior[] = [];
    private repeatCount: number;

    constructor(repeatCount: number) {
        this.repeatCount = repeatCount;
    }

    addChild(child: IBehavior) {
        this.children.push(child);
    }

    async execute(blackboard: Blackboard) {
        for (let i = 0; i < this.repeatCount; i++) {
            for (const child of this.children) {
                const status = await child.execute(blackboard);
                if (status !== BehaviorStatus.Success) {
                    return status;
                }
            }
        }
        return BehaviorStatus.Success;
    }
}

class CustomNode implements IBehavior {
    children: IBehavior[];
    constructor(children: IBehavior[]) {
        this.children = children;
    }

    update(context: Context): NodeStatus {
        // Custom implementation here
        return NodeStatus.Success;
    }
}

// In this example, the SelectorNodeEnemyBehavior will select the behavior of an enemy in a simple 2D game. If the ConditionNodeIsPlayerClose returns BehaviorResult.SUCCESS, then the enemy will attack the player. If the ConditionNodeIsPlayerClose returns BehaviorResult.FAILURE, then the SelectorNodeEnemyBehavior will try the next child node, which is LeafNodeEnemyRetreat. If the LeafNodeEnemyRetreat returns BehaviorResult.SUCCESS, then the enemy will retreat. If both LeafNodeEnemyAttack and LeafNodeEnemyRetreat return BehaviorResult.FAILURE, then the SelectorNodeEnemyBehavior will try the last child node, which is LeafNodeEnemyPatrol, and the enemy will patrol if LeafNodeEnemyPatrol returns BehaviorResult.SUCCESS.
class LeafNodeEnemyAttack implements IBehavior {
    execute(enemy: Enemy): BehaviorResult {
        enemy.attack();
        return BehaviorResult.SUCCESS;
    }
}

class LeafNodeEnemyRetreat implements IBehavior {
    execute(enemy: Enemy): BehaviorResult {
        enemy.retreat();
        return BehaviorResult.SUCCESS;
    }
}

class LeafNodeEnemyPatrol implements IBehavior {
    execute(enemy: Enemy): BehaviorResult {
        enemy.patrol();
        return BehaviorResult.SUCCESS;
    }
}

class ConditionNodeIsPlayerClose implements IBehavior {
    execute(enemy: Enemy): BehaviorResult {
        if (enemy.isPlayerClose()) {
            return BehaviorResult.SUCCESS;
        } else {
            return BehaviorResult.FAILURE;
        }
    }
}

class SelectorNodeEnemyBehavior implements IBehavior {
    children: IBehavior[];

    constructor() {
        this.children = [
            new ConditionNodeIsPlayerClose(),
            new LeafNodeEnemyAttack(),
            new LeafNodeEnemyRetreat(),
            new LeafNodeEnemyPatrol()
        ];
    }

    execute(enemy: Enemy): BehaviorResult {
        for (const child of this.children) {
            const result = child.execute(enemy);
            if (result === BehaviorResult.SUCCESS) {
                return result;
            }
        }
        return BehaviorResult.FAILURE;
    }
}

// This separation of concerns allows for clear definition of behavior logic and reusability of behaviors across different parts of the game. The EnemyBehaviorTree class serves as the entry point for executing the enemy's behavior, and the LeafNodeEnemyBehavior, SelectorNodeEnemyBehavior, and ConditionNodeEnemyBehavior classes define the specific behaviors and control flow.
// LeafNode.ts
class LeafNodeEnemyBehavior implements IBehavior {
    execute(context: any): BehaviorStatus {
        // Implementation of behavior logic specific to this LeafNode
        // ...
        return BehaviorStatus.Success;
    }
}

// SelectorNodeEnemyBehavior.ts
class SelectorNodeEnemyBehavior implements IBehavior {
    children: IBehavior[];

    constructor(children: IBehavior[]) {
        this.children = children;
    }

    execute(context: any): BehaviorStatus {
        for (const child of this.children) {
            const status = child.execute(context);
            if (status !== BehaviorStatus.Failure) {
                return status;
            }
        }
        return BehaviorStatus.Failure;
    }
}

// ConditionNodeEnemyBehavior.ts
class ConditionNodeEnemyBehavior implements IBehavior {
    condition: () => boolean;
    child: IBehavior;

    constructor(condition: () => boolean, child: IBehavior) {
        this.condition = condition;
        this.child = child;
    }

    execute(context: any): BehaviorStatus {
        if (this.condition()) {
            return this.child.execute(context);
        }
        return BehaviorStatus.Failure;
    }
}

// EnemyBehaviorTree.ts
class EnemyBehaviorTree {
    root: IBehavior;

    constructor() {
        const chasePlayer = new LeafNodeEnemyBehavior();
        const attackPlayer = new LeafNodeEnemyBehavior();
        const retreat = new LeafNodeEnemyBehavior();

        const isPlayerClose = new ConditionNodeEnemyBehavior(
            () => { /* Check if player is close */ },
            attackPlayer
        );

        const isHealthLow = new ConditionNodeEnemyBehavior(
            () => { /* Check if enemy health is low */ },
            retreat
        );

        this.root = new SelectorNodeEnemyBehavior([
            chasePlayer,
            isPlayerClose,
            isHealthLow
        ]);
    }

    update(context: any) {
        this.root.execute(context);
    }
}

// The logic for each LeafNodeEnemyBehavior variable would be implemented as separate classes that inherit from the LeafNodeEnemyBehavior class. Each class would have its own implementation of the tick method, which would contain the logic for the behavior represented by the variable. For example:
class MoveTowardsPlayerBehavior extends LeafNodeEnemyBehavior {
    tick(enemy: Enemy) {
        // logic for moving the enemy towards the player
    }
}

class ShootAtPlayerBehavior extends LeafNodeEnemyBehavior {
    tick(enemy: Enemy) {
        // logic for shooting at the player
    }
}

class RunAwayFromPlayerBehavior extends LeafNodeEnemyBehavior {
    tick(enemy: Enemy) {
        // logic for running away from the player
    }
}
class EnemyBehaviorTree {
    constructor() {
        this.selectorNode = new SelectorNodeEnemyBehavior([
            new ConditionNodeEnemyBehavior(() => {
                // condition for checking if the player is close by
            }, new MoveTowardsPlayerBehavior()),
            new ConditionNodeEnemyBehavior(() => {
                // condition for checking if the player is within shooting range
            }, new ShootAtPlayerBehavior()),
            new RunAwayFromPlayerBehavior(),
        ]);
    }
}

Yes, you could use anonymous objects instead of classes that inherit from LeafNodeEnemyBehavior to implement the logic for each leaf node.

// Here's an example of how you might use anonymous objects instead of classes to achieve the same logic:
class EnemyBehaviorTree {
  selectorNodeEnemyBehavior = new SelectorNodeEnemyBehavior([
    {
      execute: (gameObject) => {
        // logic for LeafNodeEnemyBehavior1
        return true;
      }
    },
    {
      execute: (gameObject) => {
        // logic for LeafNodeEnemyBehavior2
        return true;
      }
    },
    {
      execute: (gameObject) => {
        // logic for LeafNodeEnemyBehavior3
        return true;
      }
    }
  ]);

  update(gameObject) {
    this.selectorNodeEnemyBehavior.execute(gameObject);
  }
}

// Certainly! Here's an updated version of the EnemyBehaviorTree class that uses anonymous objects instead of classes:
class EnemyBehaviorTree {
  constructor(private selectorNode: IBehavior) {}

  update() {
    this.selectorNode.update();
  }
}

const selectorNode = new SelectorNode([
  {
    update: () => {
      // Check if enemy should move towards player
      if (shouldMoveTowardsPlayer()) {
        moveTowardsPlayer();
        return Status.Success;
      }
      return Status.Failure;
    }
  },
  {
    update: () => {
      // Check if enemy should attack player
      if (shouldAttackPlayer()) {
        attackPlayer();
        return Status.Success;
      }
      return Status.Failure;
    }
  },
  {
    update: () => {
      // Check if enemy should flee from player
      if (shouldFleeFromPlayer()) {
        fleeFromPlayer();
        return Status.Success;
      }
      return Status.Failure;
    }
  }
]);

const enemyBehaviorTree = new EnemyBehaviorTree(selectorNode);

// To reflect that some logic takes more than one update cycle to complete, you can add a boolean state variable in each leaf node class to track whether the logic is still in progress or not. In the update method, you can return BehaviorStatus.RUNNING if the logic is still in progress, and return BehaviorStatus.SUCCESS or BehaviorStatus.FAILURE depending on the outcome of the logic.

// Here is an example of how you can update the code to reflect that logic takes more than one update cycle to complete:
class LeafNodeEnemyBehavior {
  isLogicInProgress: boolean = false;

  update(): BehaviorStatus {
    if (!this.isLogicInProgress) {
      // start logic
      this.isLogicInProgress = true;
    } else {
      // update logic
      const outcome = this.continueLogic();
      if (outcome === LogicOutcome.SUCCESS) {
        this.isLogicInProgress = false;
        return BehaviorStatus.SUCCESS;
      } else if (outcome === LogicOutcome.FAILURE) {
        this.isLogicInProgress = false;
        return BehaviorStatus.FAILURE;
      }
    }
    return BehaviorStatus.RUNNING;
  }

  continueLogic(): LogicOutcome {
    // ...
    // return LogicOutcome.SUCCESS or LogicOutcome.FAILURE
  }
}

// Note that you may also need to add similar state variables and logic to track the progress of the logic in other node types, such as SelectorNode, SequenceNode, etc.

interface ILogic {
  (): BehaviorState;
}

class LeafNodeEnemyBehavior {
  private logic: ILogic;

  constructor(logic: ILogic) {
    this.logic = logic;
  }

  public update(): BehaviorState {
    return this.logic();
  }
}

class EnemyBehaviorTree {
  private rootNode: SelectorNodeEnemyBehavior;

  constructor() {
    this.rootNode = new SelectorNodeEnemyBehavior([
      new LeafNodeEnemyBehavior(() => {
        // move towards player logic here
        return BehaviorState.SUCCESS;
      }),
      new LeafNodeEnemyBehavior(() => {
        // attack player logic here
        return BehaviorState.SUCCESS;
      }),
      new LeafNodeEnemyBehavior(() => {
        // flee logic here
        return BehaviorState.SUCCESS;
      }),
    ]);
  }

  public update(): BehaviorState {
    return this.rootNode.update();
  }
}

// To update the SequenceNode or SelectorNode to track whether the logic in the leaf nodes is still in progress or not, you could add a status property in the LeafNodeEnemyBehavior class that indicates whether the logic is still running (RUNNING), has succeeded (SUCCESS), or has failed (FAILURE). Then, in the SequenceNode or SelectorNode, you can use this property to keep track of the state of each child node, and only advance to the next node if the current node has returned a SUCCESS status. If a node returns a RUNNING status, the SequenceNode or SelectorNode can return the same status to indicate that it's waiting for the logic to complete.

// Here's an updated version of the code to illustrate this:
enum BehaviorStatus {
  RUNNING,
  SUCCESS,
  FAILURE,
}

interface IBehavior {
  update(dt: number): BehaviorStatus;
}

class LeafNodeEnemyBehavior implements IBehavior {
  private logic: (dt: number) => BehaviorStatus;
  public status: BehaviorStatus;

  constructor(logic: (dt: number) => BehaviorStatus) {
    this.logic = logic;
    this.status = BehaviorStatus.RUNNING;
  }

  update(dt: number): BehaviorStatus {
    this.status = this.logic(dt);
    return this.status;
  }
}

class SequenceNodeEnemyBehavior implements IBehavior {
  private children: IBehavior[];
  private currentChildIndex = 0;

  constructor(children: IBehavior[]) {
    this.children = children;
  }

  update(dt: number): BehaviorStatus {
    while (this.currentChildIndex < this.children.length) {
      const currentChild = this.children[this.currentChildIndex];
      const status = currentChild.update(dt);
      if (status === BehaviorStatus.RUNNING) {
        return BehaviorStatus.RUNNING;
      } else if (status === BehaviorStatus.FAILURE) {
        return BehaviorStatus.FAILURE;
      }
      this.currentChildIndex++;
    }
    return BehaviorStatus.SUCCESS;
  }
}

class SelectorNodeEnemyBehavior implements IBehavior {
  private children: IBehavior[];
  private currentChildIndex = 0;

  constructor(children: IBehavior[]) {
    this.children = children;
  }

  update(dt: number): BehaviorStatus {
    while (this.currentChildIndex < this.children.length) {
      const currentChild = this.children[this.currentChildIndex];
      const status = currentChild.update(dt);
      if (status === BehaviorStatus.RUNNING) {
        return BehaviorStatus.RUNNING;
      } else if (status === BehaviorStatus.SUCCESS) {
        return BehaviorStatus.SUCCESS;
      }
      this.currentChildIndex++;
    }
    return BehaviorStatus.FAILURE;
  }
}

class EnemyBehaviorTree {
  rootNode: IBehavior;

  constructor() {
    const moveTowardsPlayer = (dt: number) => {
      // code to move towards player
      return BehaviorStatus.SUCCESS;
    };
  }
}
// You can update the SequenceNode and SelectorNode to keep track of the state of the child nodes by using the tick function to traverse through the child nodes, and then evaluate their states.

// The SequenceNode and SelectorNode classes traverse through the child nodes, calling their tick method, and then evaluate the returned status. If the status of any child node is not SUCCESS, the SequenceNode will immediately return FAILURE. If the status of any child node is SUCCESS, the SelectorNode will immediately return SUCCESS.
class SequenceNode implements IBehavior {
  children: IBehavior[];

  constructor(children: IBehavior[]) {
    this.children = children;
  }

  tick(state: IState) {
    for (let i = 0; i < this.children.length; i++) {
      const status = this.children[i].tick(state);
      if (status !== BehaviorStatus.SUCCESS) {
        return status;
      }
    }
    return BehaviorStatus.SUCCESS;
  }
}

class SelectorNode implements IBehavior {
  children: IBehavior[];

  constructor(children: IBehavior[]) {
    this.children = children;
  }

  tick(state: IState) {
    for (let i = 0; i < this.children.length; i++) {
      const status = this.children[i].tick(state);
      if (status === BehaviorStatus.SUCCESS) {
        return status;
      }
    }
    return BehaviorStatus.FAILURE;
  }
}

// Would a leaf node initiate animations and other things?
// If so, would it need to have an enter()-method and an exit()-method?
// Yes, a leaf node can initiate animations and other things, and it might need an "enter()" method and an "exit()" method. The "enter()" method would be called when the node becomes active, and the "exit()" method would be called when the node is no longer active. These methods can be used to initiate animations or any other logic that is required when the node starts or stops executing.

// With this code, animations and other logic can be initiated when the leaf node is entered (when the logic is started), and completed when the leaf node is exited (when the logic is finished).
class LeafNodeEnemyBehavior<T> implements IBehavior {
  private _logic: (state: T) => Status;
  private _enter: (state: T) => void;
  private _exit: (state: T) => void;
  private _state: T;

  constructor(logic: (state: T) => Status, enter?: (state: T) => void, exit?: (state: T) => void, state?: T) {
    this._logic = logic;
    this._enter = enter;
    this._exit = exit;
    this._state = state;
  }

  update(): Status {
    this._enter?.(this._state);
    const result = this._logic(this._state);
    if (result !== Status.RUNNING) {
      this._exit?.(this._state);
    }
    return result;
  }
}

// To avoid cyclic references in the serialized form of the Behavior Tree, a node's children can be represented as an array of node ids instead of objects. When deserializing, a separate object pool can be used to store all nodes based on their id, so that references can be reconstructed. For example:
interface INodeData {
  id: string;
  type: string;
  children: string[];
  // Other properties specific to each node type
}

const objectPool = new Map<string, IBehaviorNode>();

function deserializeNode(data: INodeData): IBehaviorNode {
  let node = objectPool.get(data.id);
  if (!node) {
    switch (data.type) {
      case "SequenceNode":
        node = new SequenceNode();
        break;
      case "SelectorNode":
        node = new SelectorNode();
        break;
      // Other node types
    }
    objectPool.set(data.id, node);
  }

  node.children = data.children.map(childId => objectPool.get(childId) || deserializeNode({id: childId, type: "", children: []}));
  // Reconstruct other properties

  return node;
}

function serializeTree(root: IBehaviorNode): INodeData[] {
  const nodes = [];
  const visited = new Set<IBehaviorNode>();

  function serializeNode(node: IBehaviorNode): INodeData {
    if (visited.has(node)) {
      return {
        id: node.id,
        type: "",
        children: []
      };
    }

    visited.add(node);
    const childrenIds = node.children.map(child => serializeNode(child).id);

    nodes.push({
      id: node.id,
      type: node.constructor.name,
      children: childrenIds,
      // Serialize other properties specific to each node type
    });

    return {
      id: node.id,
      type: "",
      children: []
    };
  }

  serializeNode(root);
  return nodes;
}
