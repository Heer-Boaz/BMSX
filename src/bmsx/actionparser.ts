import type { ActionState } from "./input";

// Updated TOKEN_REGEX to include 'aj' modifier
const TOKEN_REGEX = /\s*(\|\||&&|\?j|[&?]|!?(aj|ic|p|j|c)|t\{[^}]*\}|[a-zA-Z_][a-zA-Z0-9_]*|[<>=!]=?|[!\(\)\[\]\{\},]|!|\S)\s*/g;
const PRESSTIME_REGEX = /^t\{([^}]+)\}$/;
const NUMERIC_CONDITION_REGEX = /^(<|>|<=|>=|==|!=)\s*(\d+(\.\d+)?)$/;

interface ASTNode {
	type: string;
	evaluate: (getActionState: (actionName: string) => ActionState) => boolean;
}

interface ActionNode extends ASTNode {
	type: 'action';
	name: string;
	modifiers?: string[];
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
	private static functionHandlers: Record<string, (args: ASTNode[]) => (getActionState: (actionName: string) => ActionState) => boolean> = {
		'&': (args) => (getActionState) => args.every((arg) => arg.evaluate(getActionState)),
		'?': (args) => (getActionState) => args.some((arg) => arg.evaluate(getActionState)),
		'?j': (args) => this.compileAnyJustPressedFunction(args),
	};

	private static readonly FUNCTION_TOKENS = Object.keys(this.functionHandlers);
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
		getActionState: (actionName: string) => ActionState
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

			const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
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

			const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
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

			const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
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
		const functionName = this.consume();

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

		const handler = this.functionHandlers[functionName];
		if (!handler) {
			throw new Error(`Unknown function: '${functionName}'`);
		}
		const evaluate = handler.call(this, args);

		return {
			type: 'function',
			functionName,
			arguments: args,
			evaluate,
		};
	}

	private static compileAnyJustPressedFunction(
		args: ASTNode[]
	): (getActionState: (actionName: string) => ActionState) => boolean {
		return (getActionState) => {
			const actionResults = args.map((arg, idx) => {
				if (!this.isActionNode(arg)) {
					throw new Error(`'?j' function expects action nodes as arguments (argument #${idx + 1}).`);
				}
				const actionPassed = arg.evaluate(getActionState);
				const actionState = getActionState(arg.name);
				return { actionState, actionPassed, actionNode: arg };
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

	private static parseAction(): ActionNode {
		const name = this.consume();
		let modifiers: string[] = [];
		let ignoreConsumed = false;

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

		const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
			const actionState = getActionState(name);
			return modifierFunctions.every((func) => func(actionState));
		};

		return {
			type: 'action',
			name,
			modifiers,
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
		return (
			this.FUNCTION_TOKENS.includes(token) &&
			this.tokens[this.actionParserIndex + 1] === '('
		);
	}

	private static isActionNode(node: ASTNode): node is ActionNode {
		return node.type === 'action';
	}
}
