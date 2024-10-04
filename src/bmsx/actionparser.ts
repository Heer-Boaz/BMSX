import type { ActionState } from "./input";

type ASTNode = ActionNode | FunctionNode | OperatorNode;

interface ActionNode {
	type: 'action';
	name: string;
	modifiers: string[];
	compiledModifierFunctions: ((actionState: ActionState) => boolean)[];
}

interface FunctionNode {
	type: 'function';
	functionName: string;
	arguments: ASTNode[];
}

interface OperatorNode {
	type: 'operator';
	operator: 'AND' | 'OR' | 'NOT';
	left?: ASTNode;
	right?: ASTNode;
}

export class ActionParser {
	private static parsedActions: Map<string, ASTNode> = new Map();

	private static tokens: string[] = [];
	private static index: number = 0;

	/**
	 * Retrieves the parsed AST for a given action definition.
	 * If the action has been parsed before, it returns the cached AST.
	 * Otherwise, it parses the action and caches the result.
	 *
	 * @param actionDefinition The action definition string to parse.
	 * @returns The parsed ASTNode or undefined if parsing fails.
	 */
	public static getParsedActions(actionDefinition: string): ASTNode | undefined {
		if (!this.parsedActions.has(actionDefinition)) {
			try {
				const parsedAction = this.parse(actionDefinition);
				this.parsedActions.set(actionDefinition, parsedAction);
			} catch (e: any) {
				throw new Error(`Failed to parse action definition '${actionDefinition}': ${e.message}`);
			}
		}
		return this.parsedActions.get(actionDefinition);
	}

	/**
	 * Evaluates the parsed ASTNode against the current action states.
	 *
	 * @param node The parsed ASTNode.
	 * @param getActionState A function that retrieves the ActionState for a given action name.
	 * @returns The boolean result of the evaluation.
	 */
	public static evaluateActions(
		node: ASTNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		return this.evaluate(node, getActionState);
	}

	private static evaluate(
		node: ASTNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		switch (node.type) {
			case 'action':
				return this.evaluateActionNode(node, getActionState);
			case 'function':
				return this.evaluateFunctionNode(node, getActionState);
			case 'operator':
				return this.evaluateOperatorNode(node, getActionState);
		}
	}

	private static evaluateActionNode(
		node: ActionNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		const actionState = getActionState(node.name);
		const modifierFunctions =
			node.compiledModifierFunctions.length > 0
				? node.compiledModifierFunctions
				: [this.defaultPressedModifier, this.defaultNotConsumedModifier];

		return modifierFunctions.every((func) => func(actionState));
	}

	private static defaultPressedModifier = (actionState: ActionState) => actionState.pressed;
	private static defaultNotConsumedModifier = (actionState: ActionState) => !actionState.consumed;

	private static evaluateFunctionNode(
		node: FunctionNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		const args = node.arguments.map((arg) => this.evaluate(arg, getActionState));

		switch (node.functionName) {
			case 'all':
				return args.every((arg) => arg === true);
			case 'any':
				return args.some((arg) => arg === true);
			default:
				throw new Error(`Unknown function: '${node.functionName}'`);
		}
	}

	private static evaluateOperatorNode(
		node: OperatorNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		switch (node.operator) {
			case 'AND':
				return (
					this.evaluate(node.left!, getActionState) &&
					this.evaluate(node.right!, getActionState)
				);
			case 'OR':
				return (
					this.evaluate(node.left!, getActionState) ||
					this.evaluate(node.right!, getActionState)
				);
			case 'NOT':
				return !this.evaluate(node.left!, getActionState);
			default:
				throw new Error(`Unknown operator: '${node.operator}'`);
		}
	}

	/**
	 * Parses the input action definition string and returns the ASTNode.
	 *
	 * @param input The action definition string.
	 * @returns The parsed ASTNode.
	 */
	static parse(input: string): ASTNode {
		this.tokens = this.tokenize(input);
		this.index = 0;
		const result = this.parseExpression();
		if (this.index < this.tokens.length) {
			throw new Error(`Unexpected token '${this.tokens[this.index]}' at position ${this.index}`);
		}
		return result;
	}

	private static tokenize(input: string): string[] {
		const regex = /\s*(AND|OR|NOT|![a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_]*|[()\[\],]|!|\S)\s*/g;
		const tokens: string[] = [];
		let match: RegExpExecArray | null;

		while ((match = regex.exec(input)) !== null) {
			tokens.push(match[1]);
		}

		return tokens;
	}

	private static parseExpression(): ASTNode {
		let node = this.parseTerm();

		while (this.match('OR')) {
			this.consume();
			const right = this.parseTerm();
			node = { type: 'operator', operator: 'OR', left: node, right };
		}

		return node;
	}

	private static parseTerm(): ASTNode {
		let node = this.parseFactor();

		while (this.match('AND')) {
			this.consume();
			const right = this.parseFactor();
			node = { type: 'operator', operator: 'AND', left: node, right };
		}

		return node;
	}

	private static parseFactor(): ASTNode {
		if (this.match('NOT')) {
			this.consume();
			const operand = this.parseFactor();
			return { type: 'operator', operator: 'NOT', left: operand };
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

		return { type: 'function', functionName, arguments: args };
	}

	private static parseAction(): ActionNode {
		const name = this.consume(); // Consume action name
		let modifiers: string[] = [];

		if (this.match('[')) {
			modifiers = this.parseModifiers();
		}

		const compiledModifierFunctions = modifiers.map((modifier) => this.compileModifier(modifier));

		return {
			type: 'action',
			name,
			modifiers,
			compiledModifierFunctions,
		};
	}

	private static parseModifiers(): string[] {
		this.consume(); // Consume '['
		const modifiers: string[] = [];

		while (!this.match(']')) {
			const modifier = this.consume();
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

		switch (modifierName) {
			case 'pressed':
				func = (actionState) => actionState.pressed;
				break;
			case 'justPressed':
				func = (actionState) => actionState.justpressed;
				break;
			case 'consumed':
				func = (actionState) => actionState.consumed;
				break;
			case 'ignoreConsumed':
				func = (_) => true; // Always true, ignores consumed status
				break;
			default:
				throw new Error(`Unknown modifier: '${modifierName}'`);
		}

		return isNegated ? (actionState) => !func(actionState) : func;
	}

	// Utility methods

	private static match(token: string): boolean {
		return this.tokens[this.index] === token;
	}

	private static consume(): string {
		return this.tokens[this.index++];
	}

	private static expect(token: string): void {
		if (this.tokens[this.index] !== token) {
			throw new Error(`Expected '${token}', found '${this.tokens[this.index]}'`);
		}
	}

	private static matchFunction(): boolean {
		const token = this.tokens[this.index];
		return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token) && this.tokens[this.index + 1] === '(';
	}
}
