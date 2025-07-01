import type { ActionState } from "./input";

// Updated TOKEN_REGEX to ensure action names like 'punch' and 'kick' are not split into single-letter tokens
const TOKEN_REGEX = /\s*(\|\||&&|\?j|\?w\{\d+\}|aw\{\d+\}|(?:t|wp|pr)\{[^}]*\}|[a-zA-Z_][a-zA-Z0-9_]*|[&?]|!?(aj|ic|p|j|c)|[<>=!]=?|[!\(\)\[\]\{\},]|!|\S)\s*/g;
const PRESSTIME_REGEX = /^t\{([^}]+)\}$/;
const NUMERIC_CONDITION_REGEX = /^(<|>|<=|>=|==|!=)\s*(\d+(\.\d+)?)$/;

interface ASTNode {
	type: string;
	evaluate: (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean;
}

interface ActionNode extends ASTNode {
	type: 'action';
	name: string;
	modifiers?: string[];
	priority?: number;
}

interface FunctionNode extends ASTNode {
	type: 'function';
	functionName: string;
	arguments: ASTNode[];
}

interface OperatorNode extends ASTNode {
	type: 'operator';
	operator: 'AND' | 'OR' | 'NOT';
	left?: ASTNode;
	right?: ASTNode;
}

/**
 * Parser and evaluator for action definitions.
 * Supports logical operators, functions, and modifiers.
 */
export class ActionParser {
	private static parsedActions: Map<string, ASTNode> = new Map();

	private static tokens: string[] = [];
	private static actionParserIndex: number = 0;

	private static defaultPressedModifier = (actionState: ActionState) => actionState.pressed;
	private static defaultNotConsumedModifier = (actionState: ActionState) => !actionState.consumed;

	/**
	 * Map of modifier handlers for extensibility.
	 */
	private static modifierHandlers: Record<string, (actionState: ActionState) => boolean> = {
		p: (a) => a.pressed,
		j: (a) => a.justpressed,
		aj: (a) => a.alljustpressed,
		c: (a) => a.consumed,
	};

	/**
	 * Map of function handlers for extensibility.
	 */
	private static functionHandlers: Record<string, (args: ASTNode[]) => (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean> = {
		'&': (args) => (getActionState) => args.every((arg) => arg.evaluate(getActionState)),
		'?': (args) => (getActionState) => args.some((arg) => arg.evaluate(getActionState)),
		'?j': (args) => this.compileAnyJustPressedFunction(args),
	};

	private static readonly FUNCTION_TOKENS = [...Object.keys(this.functionHandlers), '?w', 'aw'];
	private static readonly MODIFIER_TOKENS = [
		...Object.keys(this.modifierHandlers),
		...Object.keys(this.modifierHandlers).map(m => '!' + m),
		'ic', '!ic'
	];

	/**
	 * Checks if an action definition is triggered.
	 * @param actionDefinition The action definition string.
	 * @param getActionState Function to get the state of an action.
	 */
	public static checkActionTriggered(
		actionDefinition: string,
		getActionState: (actionName: string, framewindow?: number) => ActionState
	): boolean {
		const parsedAction = this.getParsedAction(actionDefinition);
		if (!parsedAction) return false;
		return parsedAction.evaluate(getActionState);
	}

	/**
	 * Clears the parsed action cache.
	 */
	public static clearCache(): void {
		this.parsedActions.clear();
	}

	private static getParsedAction(actionDefinition: string): ASTNode | undefined {
		if (!this.parsedActions.has(actionDefinition)) {
			try {
				const parsedAction = this.parse(actionDefinition);
				this.parsedActions.set(actionDefinition, parsedAction);
			} catch (e: any) {
				throw new Error(
					`Failed to parse action definition '${actionDefinition}': ${e.message}`
				);
			}
		}
		return this.parsedActions.get(actionDefinition);
	}

	static parse(input: string): ASTNode {
		this.tokens = this.tokenize(input);
		this.actionParserIndex = 0;
		const result = this.parseExpression();
		if (this.actionParserIndex < this.tokens.length) {
			throw new Error(
				`Unexpected token '${this.tokens[this.actionParserIndex]}' at position ${this.actionParserIndex} in input '${input}'`
			);
		}
		return result;
	}

	private static tokenize(input: string): string[] {
		const tokens: string[] = [];
		let match: RegExpExecArray | null;

		while ((match = TOKEN_REGEX.exec(input)) !== null) {
			tokens.push(match[1]);
		}

		return tokens;
	}

	private static parseExpression(): OperatorNode {
		let node = this.parseTerm() as OperatorNode;

		while (this.match('||') || this.match('OR')) {
			this.consume();
			const right = this.parseTerm();

			const leftNode = node;
			const rightNode = right;

			const evaluate = (getActionState: (actionName: string, framewindow?: number) => ActionState): boolean => {
				return leftNode.evaluate(getActionState) || rightNode.evaluate(getActionState);
			};

			node = {
				type: 'operator',
				operator: 'OR',
				left: leftNode,
				right: rightNode,
				evaluate,
			};
		}

		return node;
	}

	private static parseTerm(): OperatorNode {
		let node = this.parseFactor() as OperatorNode;

		while (this.match('&&') || this.match('AND')) {
			this.consume();
			const right = this.parseFactor();

			const leftNode = node;
			const rightNode = right;

			const evaluate = (getActionState: (actionName: string, framewindow?: number) => ActionState): boolean => {
				return leftNode.evaluate(getActionState) && rightNode.evaluate(getActionState);
			};

			node = {
				type: 'operator',
				operator: 'AND',
				left: leftNode,
				right: rightNode,
				evaluate,
			};
		}

		return node;
	}

	private static parseFactor(): ASTNode | OperatorNode {
		if (this.match('!') || this.match('NOT')) {
			this.consume();
			const operand = this.parseFactor();

			const evaluate = (getActionState: (actionName: string, framewindow?: number) => ActionState): boolean => {
				return !operand.evaluate(getActionState);
			};

			return {
				type: 'operator',
				operator: 'NOT',
				left: operand,
				evaluate,
			};
		}

		if (this.match('(')) {
			this.consume();
			const expression = this.parseExpression();
			this.expect(')');
			this.consume();
			return expression;
		}

		if (this.matchFunction()) {
			return this.parseFunction();
		}

		return this.parseAction();
	}

	private static parseFunction(): FunctionNode {
		const rawName = this.consume();
		let baseName = rawName;
		let windowFrames: number | undefined;

		let match = rawName.match(/^\?w\{(\d+)\}$/);
		if (match) {
			baseName = '?w';
			windowFrames = parseInt(match[1], 10);
		} else if (rawName === '?w') {
			throw new Error("'?w' requires a window parameter, e.g. '?w{5}'.");
		}

		if (!windowFrames) {
			match = rawName.match(/^aw\{(\d+)\}$/);
			if (match) {
				baseName = 'aw';
				windowFrames = parseInt(match[1], 10);
			} else if (rawName === 'aw') {
				throw new Error("'aw' requires a window parameter, e.g. 'aw{5}'.");
			}
		}

		this.expect('(');
		this.consume();
		const args: ASTNode[] = [];

		if (!this.match(')')) {
			do {
				const arg = this.parseExpression();
				args.push(arg);
			} while (this.match(',') && this.consume());
		}

		this.expect(')');
		this.consume();

		let evaluate: (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean;
		if (baseName === '?w') {
			if (windowFrames === undefined) {
				throw new Error("'?w' requires a window parameter.");
			}
			evaluate = this.compileAnyWasPressedFunction(args, windowFrames);
		} else if (baseName === 'aw') {
			if (windowFrames === undefined) {
				throw new Error("'aw' requires a window parameter.");
			}
			evaluate = this.compileAllWasPressedFunction(args, windowFrames);
		} else {
			const handler = this.functionHandlers[baseName];
			if (!handler) {
				throw new Error(`Unknown function: '${rawName}'`);
			}
			evaluate = handler.call(this, args);
		}

		return {
			type: 'function',
			functionName: rawName,
			arguments: args,
			evaluate,
		};
	}

	private static compileAnyJustPressedFunction(
		args: ASTNode[]
	): (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean {
		return (getActionState) => {
			const actionResults = args.map((arg, idx) => {
				const actionPassed = arg.evaluate(getActionState);
				const actionState = getActionState((arg as ActionNode).name);
				return { actionState, actionPassed, actionNode: arg as ActionNode };
			});

			const allActionsPassed = actionResults.every((ar) => ar.actionPassed);

			if (!allActionsPassed) {
				return false;
			}

			const anyJustPressed = actionResults.some((ar) => {
				const hasJustPressedModifier = ar.actionNode.modifiers?.some(
					(mod) => mod === 'j' || mod === '!j' || mod === 'aj' || mod === '!aj'
				);

				if (hasJustPressedModifier) {
					return ar.actionPassed;
				} else {
					return ar.actionState.justpressed;
				}
			});

			return anyJustPressed;
		};
	}

	private static compileAnyWasPressedFunction(args: ASTNode[], windowFrames: number): (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean {
		return (getActionState) => {
			const actionResults = args.map((arg, idx) => {
				// Pass windowFrames to arg.evaluate so that nested actions/modifiers get the correct window
				const actionPassed = arg.evaluate((name, framewindow) => getActionState(name, windowFrames));
				const actionState = getActionState((arg as ActionNode).name, windowFrames);
				return { actionState, actionPassed };
			});

			const allActionsPassed = actionResults.every((ar) => ar.actionPassed);
			if (!allActionsPassed) {
				return false;
			}

			return actionResults.some((ar) => ar.actionState.waspressed);
		};
	}

	private static compileAllWasPressedFunction(args: ASTNode[], windowFrames: number): (getActionState: (actionName: string, framewindow?: number) => ActionState) => boolean {
		return (getActionState) => {
			const actionResults = args.map((arg, idx) => {
				// Pass windowFrames to arg.evaluate so that nested actions/modifiers get the correct window
				const actionPassed = arg.evaluate((name, framewindow) => getActionState(name, windowFrames));
				const actionState = getActionState((arg as ActionNode).name, windowFrames);
				return { actionState, actionPassed };
			});

			const allActionsPassed = actionResults.every((ar) => ar.actionPassed);
			if (!allActionsPassed) {
				return false;
			}

			return actionResults.every((ar) => ar.actionState.waspressed);
		};
	}

	private static parseAction(): ActionNode {
		const name = this.consume();
		let modifiers: string[] = [];
		let ignoreConsumed = false;
		let priority: number | undefined;

		if (this.match('[')) {
			modifiers = this.parseModifiers();
		}

		// Check whether there are any modifiers that are not supported
		for (const modifier of modifiers) {
			if (!this.MODIFIER_TOKENS.includes(modifier)) {
				throw new Error(`Unknown modifier: '${modifier}' in action '${name}'.`);
			}
		}

		const compiledModifierFunctions: ((actionState: ActionState) => boolean)[] = [];

		for (const modifier of modifiers) {
			if (modifier === 'ic') {
				ignoreConsumed = true;
			} else if (modifier.startsWith('pr{')) {
				const num = parseInt(modifier.slice(3, -1), 10);
				if (!Number.isNaN(num)) priority = num;
			} else {
				compiledModifierFunctions.push(this.compileModifier(modifier));
			}
		}

		const hasPressedModifier = modifiers.some(
			(mod) => mod === 'p' || mod === '!p'
		);
		let modifierFunctions = compiledModifierFunctions;

		if (!hasPressedModifier) {
			modifierFunctions = [this.defaultPressedModifier, ...modifierFunctions];
		}

		if (!ignoreConsumed) {
			modifierFunctions.push(this.defaultNotConsumedModifier);
		}

		const evaluate = (getActionState: (actionName: string, framewindow?: number) => ActionState): boolean => {
			const actionState = getActionState(name);
			return modifierFunctions.every((func) => func(actionState));
		};

		return {
			type: 'action',
			name,
			modifiers,
			priority,
			evaluate,
		};
	}

	private static parseModifiers(): string[] {
		this.consume(); // Consume '['
		const modifiers: string[] = [];

		while (!this.match(']')) {
			let modifier = this.consume();

			if (modifier.startsWith('t') && this.match('{')) {
				while (!modifier.endsWith('}')) {
					modifier += this.consume();
				}
			}

			modifiers.push(modifier);

			if (this.match(',')) {
				this.consume(); // Consume ','
			}
		}

		this.expect(']');
		this.consume(); // Consume ']'

		return modifiers;
	}

	private static compileModifier(modifier: string): (actionState: ActionState) => boolean {
		const isNegated = modifier.startsWith('!');
		const modifierName = isNegated ? modifier.substring(1) : modifier;

		let func: (actionState: ActionState) => boolean;

		if (modifierName.startsWith('t')) {
			// Handle 't' modifier with parameters
			const match = modifierName.match(PRESSTIME_REGEX);
			if (!match) {
				throw new Error(`Invalid 't' modifier syntax: '${modifierName}'`);
			}

			const condition = match[1]; // e.g., '<50' or '>2'

			// Compile the condition into a function
			func = this.compilePressTimeCondition(condition);
		} else if (modifierName.startsWith('w')) {
			const ms = parseInt(modifierName.slice(2, -1), 10);
			if (Number.isNaN(ms)) {
				throw new Error(`Invalid 'w' modifier syntax: '${modifierName}'`);
			}
			func = (a) => a.timestamp !== undefined && performance.now() - a.timestamp <= ms;
		} else if (this.modifierHandlers[modifierName]) {
			func = this.modifierHandlers[modifierName];
		} else {
			throw new Error(`Unknown modifier: '${modifierName}'`);
		}
		return isNegated ? (actionState) => !func(actionState) : func;
	}

	private static compilePressTimeCondition(
		condition: string
	): (actionState: ActionState) => boolean {
		const match = condition.match(NUMERIC_CONDITION_REGEX);
		if (!match) {
			throw new Error(`Invalid pressTime condition: '${condition}'`);
		}

		const operator = match[1];
		const value = parseFloat(match[2]);

		if (isNaN(value)) {
			throw new Error(`Invalid numeric value in pressTime condition: '${value}'`);
		}

		return this.compileNumericCondition(operator, value, 'presstime');
	}

	private static compileNumericCondition(
		operator: string,
		testValue: number,
		actionStateProperty: {
			[K in keyof ActionState]: ActionState[K] extends number | null ? K : never
		}[keyof ActionState]
	): (actionState: ActionState) => boolean {
		switch (operator) {
			case '<':
				return (actionState) => actionState[actionStateProperty] < testValue;
			case '>':
				return (actionState) => actionState[actionStateProperty] > testValue;
			case '<=':
				return (actionState) => actionState[actionStateProperty] <= testValue;
			case '>=':
				return (actionState) => actionState[actionStateProperty] >= testValue;
			case '==':
				return (actionState) => actionState[actionStateProperty] === testValue;
			case '!=':
				return (actionState) => actionState[actionStateProperty] !== testValue;
			default:
				throw new Error(`Unsupported operator in numeric condition: '${operator}'`);
		}
	}

	// Utility methods
	private static match(token: string): boolean {
		return this.tokens[this.actionParserIndex] === token;
	}

	private static consume(): string {
		return this.tokens[this.actionParserIndex++];
	}

	private static expect(token: string): void {
		if (this.tokens[this.actionParserIndex] !== token) {
			throw new Error(`Expected '${token}', found '${this.tokens[this.actionParserIndex]}' at position ${this.actionParserIndex}`);
		}
	}

	private static matchFunction(): boolean {
		const token = this.tokens[this.actionParserIndex];
		if (/^(\?w|aw)\{\d+\}$/.test(token)) {
			return this.tokens[this.actionParserIndex + 1] === '(';
		}
		return (
			this.FUNCTION_TOKENS.includes(token) &&
			this.tokens[this.actionParserIndex + 1] === '('
		);
	}

	private static isActionNode(node: ASTNode): node is ActionNode {
		return node.type === 'action';
	}
}
