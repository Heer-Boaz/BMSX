import type { ActionState } from "./input";

/**
 * Represents an action evaluator, which is a tuple containing:
 * - A string identifier for the action.
 * - A function that takes an `ActionState` and returns a boolean indicating
 *   whether the action is valid or applicable in the given state.
 *
 * @type ActionEvaluator
 */
type ActionEvaluator = [string, (actionState: ActionState) => boolean];

interface ParserState {
	tokens: string[];
	index: number;
}

/**
 * Represents an array of functions that take an `ActionState` as an argument
 * and return a boolean value. Each function in the array is a modifier that
 * can be applied to the action state to determine specific conditions or
 * behaviors.
 *
 * @type {Array<function(ActionState): boolean>}
 */
type CompiledModifiers = ((actionState: ActionState) => boolean)[];

/**
 * An array of standard modifiers used in the action parser.
 * @see {@link StandardModifier} for the modifier types.
 *
 * The modifiers include:
 * - `pressed`: Indicates the action is currently pressed.
 * - `justPressed`: Indicates the action was just pressed.
 * - `allJustPressed`: Indicates that all buttons in the action were just pressed.
 * - `consumed`: Indicates the action has been consumed.
 * - `ignoreConsumed`: Indicates to ignore consumed actions.
 * - `pressTime`: Represents the duration the action has been pressed.
 */
const standardModifiers = [
	'pressed',
	'justPressed',
	'allJustPressed',
	'consumed',
	'ignoreConsumed',
	'pressTime',
] as const;

/**
 * Represents the different states of a standard modifier in the action parser.
 * @see {@link standardModifiers} for the modifier types.
 */
type StandardModifier = typeof standardModifiers[number];

/**
 * Represents a negated standard modifier.
 * A negated modifier is prefixed with an exclamation mark (!).
 *
 * @example
 * // Example of a negated modifier
 * const modifier: NegatedModifier = '!exampleModifier';
 */
type NegatedModifier = `!${StandardModifier}`;

/**
 * Represents a modifier that can either be a standard modifier or a negated modifier.
 *
 * @type {Modifier}
 * @see {@link StandardModifier} for standard modifiers.
 * @see {@link NegatedModifier} for negated modifiers.
 */
type Modifier = StandardModifier | NegatedModifier;

/**
 * Represents an action node in the action parser.
 *
 * @interface ActionNode
 * @property {string} type - The type of the node, which is always 'action'.
 * @property {string} action - The specific action associated with this node.
 * @property {Array<function(ActionState): boolean>} modifierFunctions - An array of functions that modify the action state.
 */
interface ActionNode {
	type: 'action';
	action: string;
	evaluatorFunction: CompiledModifiers;
}

/**
 * Represents an operator node in the abstract syntax tree (AST).
 *
 * @type {OperatorNode}
 * @property {string} type - The type of the node, which is always 'operator'.
 * @property {('and' | 'or')} operator - The operator represented by this node, which can be either '+' or '|'.
 * @property {ASTNode[]} children - An array of child nodes that this operator applies to.
 */
type OperatorNode = {
	type: 'operator';
	operator: 'and' | 'or';
	children: ASTNode[];
	modifiers?: Modifier[];
};

/**
 * Represents a logical NOT operation in the abstract syntax tree (AST).
 *
 * @type {NotNode}
 * @property {string} type - The type of the node, which is always 'not'.
 * @property {ASTNode} child - The child node that is being negated.
 */
type NotNode = {
	type: 'not';
	child: ASTNode;
}

/**
 * Represents a node in the Abstract Syntax Tree (AST).
 * This type can be one of the following:
 * - ActionNode: Represents an action to be performed.
 * - OperatorNode: Represents an operator that manipulates other nodes.
 * - NotNode: Represents a negation of another node.
 */
type ASTNode = ActionNode | OperatorNode | NotNode;

/**
 * Helper class for parsing and evaluating input action definitions.
 * This class is used to parse action definitions and evaluate them against the current input state.
 * It also caches parsed action definitions to avoid repeated parsing.
 */
export class ActionParser {
	/**
	 * Cache for parsed action definitions to avoid repeated parsing.
	 */
	private static parsedActions: Map<string, ASTNode> = new Map();

	/**
	 * Precomputes the parsed actions for a given action definition and stores them in the cache.
	 * @param actionDefinition The action definition string to parse.
	 */
	private static precomputeParsedActions(actionDefinition: string): void {
		if (!this.parsedActions.has(actionDefinition)) {
			const actions = ActionParser.parseActionDefinition(actionDefinition);
			this.parsedActions.set(actionDefinition, actions);
		}
	}

	/**
	 * Retrieves the parsed actions for a given action definition, using the cache if available.
	 * If not cached, it parses the action definition and stores the result in the cache.
	 * @param actionDefinition The action definition string to retrieve parsed actions for.
	 * @returns The parsed ASTNode, or undefined if none are found.
	 */
	public static getParsedActions(actionDefinition: string): ASTNode | undefined {
		if (!this.parsedActions.has(actionDefinition)) {
			this.precomputeParsedActions(actionDefinition);
		}
		return this.parsedActions.get(actionDefinition);
	}

	/**
	 * Parses an action string and returns an ActionEvaluator.
	 *
	 * If the action string starts with '!', the resulting modifiers will be negated.
	 * The function ensures that the 'pressed' and '!consumed' modifiers are included
	 * unless specified otherwise.
	 *
	 * @param action - The action string to parse.
	 * @returns An array containing the action name and the corresponding evaluator function.
	 * @throws Error if the action format is invalid or if any modifier is invalid.
	 */
	static parseAction(actionName: string, modifiers: Modifier[]): ActionEvaluator {
		// Ensure 'pressed' modifier is included unless specified
		const hasPressedModifier = modifiers.some(
			(modifier) => modifier === 'pressed' || modifier === '!pressed'
		);
		if (!hasPressedModifier) {
			modifiers.push('pressed');
		}

		// Ensure '!consumed' modifier is included unless 'consumed', '!consumed', or 'ignoreConsumed' is specified
		const hasConsumedModifier = modifiers.some(
			(modifier) =>
				modifier === 'consumed' ||
				modifier === '!consumed' ||
				modifier === 'ignoreConsumed' ||
				modifier === '!ignoreConsumed'
		);
		if (!hasConsumedModifier) {
			modifiers.push('!consumed');
		}

		modifiers.forEach((modifier) => {
			if (!this.isValidModifier(modifier)) {
				throw new Error(`Invalid modifier: '${modifier}' in action '${actionName}'`);
			}
		});

		// Compile modifiers into functions
		const modifierFunctions = modifiers.map((modifier) => this.compileModifier(modifier));

		// Create the evaluator function
		const evaluatorFunction = this.createActionEvaluator(modifierFunctions);

		return [actionName, evaluatorFunction];
	}


	/**
	 * Creates an action evaluator function that checks if all modifier functions
	 * return true for a given action state.
	 *
	 * @param modifierFunctions - An array of compiled modifier functions that take
	 *                            an ActionState and return a boolean.
	 * @returns A function that takes an ActionState and returns true if all
	 *          modifier functions evaluate to true; otherwise, returns false.
	 */
	private static createActionEvaluator(modifierFunctions: CompiledModifiers): (actionState: ActionState) => boolean {
		return (actionState: ActionState) => {
			for (const modifierFunction of modifierFunctions) {
				if (!modifierFunction(actionState)) {
					return false; // Early exit if any condition is not met
				}
			}
			return true; // All conditions met
		};
	}

	private static extractModifiers(modifierToken: string): Modifier[] {
		const modifierMatch = modifierToken.match(/^\[(.*)\]$/);
		if (!modifierMatch) {
			throw new Error(`Invalid modifier format: '${modifierToken}'`);
		}
		const modifierString = modifierMatch[1];
		const modifiers = modifierString.split(',').filter(Boolean) as Modifier[];
		modifiers.forEach((modifier) => {
			if (!this.isValidModifier(modifier)) {
				throw new Error(`Invalid modifier: '${modifier}'`);
			}
		});
		return modifiers;
	}

	/**
	 * Compiles a modifier string into a function that evaluates an action state.
	 *
	 * @param modifier - The modifier string to compile.
	 * @returns A function that takes an ActionState and returns a boolean indicating if the condition is met.
	 * @throws Error if the modifier format is invalid or if an unknown modifier is provided.
	 */
	static compileModifier(modifier: string): (actionState: ActionState) => boolean {
		const isNegated = modifier.startsWith('!');
		const modifierName = isNegated ? modifier.substring(1) : modifier;

		if (modifierName.startsWith('pressTime')) {
			const timeConditionMatch = modifierName.match(/^pressTime\{(<|>)(\d+)}$/);
			if (timeConditionMatch) {
				const operator = timeConditionMatch[1];
				const timeThreshold = parseInt(timeConditionMatch[2], 10);
				return (actionState: ActionState) => {
					const pressTime = actionState.presstime || 0;
					let conditionMet = false;
					switch (operator) {
						case '>':
							conditionMet = pressTime > timeThreshold;
							break;
						case '<':
							conditionMet = pressTime < timeThreshold;
							break;
					}
					return isNegated ? !conditionMet : conditionMet;
				};
			} else {
				throw new Error(`Invalid 'pressTime' format in modifier: '${modifierName}'`);
			}
		} else {
			switch (modifierName) {
				case 'pressed':
					return (actionState: ActionState) =>
						isNegated ? !actionState.pressed : actionState.pressed;
				case 'justPressed':
					return (actionState: ActionState) =>
						isNegated ? !actionState.justpressed : actionState.justpressed;
				case 'allJustPressed':
					return (actionState: ActionState) =>
						isNegated ? !actionState.alljustpressed : actionState.alljustpressed;
				case 'consumed':
					return (actionState: ActionState) =>
						isNegated ? !actionState.consumed : actionState.consumed;
				case 'ignoreConsumed':
					return (actionState: ActionState) => isNegated ? !actionState.consumed : true; // If not negated, always returns true, effectively ignoring the consumed status
				default:
					throw new Error(`Unknown modifier: '${modifierName}'`);
			}
		}
	}

	/**
	 * Checks if the provided modifier string is valid.
	 *
	 * A valid modifier can be one of the standard modifiers:
	 * - 'pressed'
	 * - 'justPressed'
	 * - 'consumed'
	 * - 'ignoreConsumed'
	 * - 'pressTime{<|>value}'
	 *
	 * Additionally, negated versions of standard modifiers (except 'ignoreConsumed')
	 * are also considered valid. A valid negated modifier is prefixed with '!' (e.g., '!pressed').
	 *
	 * The function also supports a specific format for 'pressTime', which must match
	 * the pattern `pressTime{(<|>)(\d+)}` where `<` or `>` indicates the comparison
	 * and `\d+` represents a numeric value.
	 *
	 * @param modifier - The modifier string to validate.
	 * @returns True if the modifier is valid, false otherwise.
	 */
	static isValidModifier(modifier: string): boolean {
		const negatedModifiers: NegatedModifier[] = standardModifiers
			.filter((m) => m !== 'ignoreConsumed') // We don't allow negation of 'ignoreConsumed'
			.map((m) => `!${m}` as NegatedModifier);

		// Check if it's a standard or negated modifier
		if (
			standardModifiers.includes(modifier as StandardModifier) ||
			negatedModifiers.includes(modifier as NegatedModifier)
		) {
			return true;
		}

		// Check for valid pressTime condition
		const pressTimeMatch = modifier.match(/^pressTime\{(<|>)(\d+)}$/);
		if (pressTimeMatch) {
			return true;
		}

		// If none of the conditions are met, it's an invalid modifier
		return false;
	}

	/**
	 * Parses a string representation of an action definition into an Abstract Syntax Tree (AST).
	 *
	 * The action definition can include operators such as '|', '+', and '!' for logical operations,
	 * as well as parentheses for grouping expressions. The resulting ASTNode structure represents
	 * the hierarchy and relationships of the parsed actions and operators.
	 *
	 * @param actionDefinition - A string containing the action definition to be parsed.
	 * @returns An ASTNode representing the parsed action definition.
	 * @throws Error if there is a mismatched parenthesis in the action definition.
	 */
	static parseActionDefinition(actionDefinition: string): ASTNode {
		const tokens = this.tokenize(actionDefinition);
		const state: ParserState = { tokens, index: 0 };
		const node = this.parseExpression(state);

		if (state.index < tokens.length) {
			throw new Error(`Unexpected token '${tokens[state.index]}' at position ${state.index}`);
		}

		return node;
	}

	private static parseExpression(state: ParserState): ASTNode {
		let node = this.parseTerm(state);

		while (this.currentToken(state) === '+') {
			this.nextToken(state); // Consume '+'
			const right = this.parseTerm(state);
			node = {
				type: 'operator',
				operator: 'or',
				children: [node, right],
			};
		}

		return node;
	}

	private static parseTerm(state: ParserState): ASTNode {
		let node = this.parseFactor(state);

		while (this.currentToken(state) === '•') {
			this.nextToken(state); // Consume '•'
			const right = this.parseFactor(state);
			node = {
				type: 'operator',
				operator: 'and',
				children: [node, right],
			};
		}

		return node;
	}

	private static parseFactor(state: ParserState): ASTNode {
		const token = this.currentToken(state);

		if (token === '!') {
			this.nextToken(state); // Consume '!'
			const node = this.parseFactor(state);
			return {
				type: 'not',
				child: node,
			};
		} else if (token === '(') {
			this.nextToken(state); // Consume '('
			const node = this.parseExpression(state);

			if (this.currentToken(state) !== ')') {
				throw new Error(`Expected ')' at position ${state.index}, found '${this.currentToken(state)}'`);
			}
			this.nextToken(state); // Consume ')'

			// Check for modifiers after the group
			if (this.currentToken(state) && this.currentToken(state).startsWith('[')) {
				const modifierToken = this.currentToken(state);
				this.nextToken(state);
				const modifiers = this.extractModifiers(modifierToken);
				(node as OperatorNode).modifiers = modifiers;
			}

			return node;
		} else if (token && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) {
			// Action identifier
			this.nextToken(state); // Consume identifier
			let modifiers: Modifier[] = [];

			// Check for modifiers after the action
			if (this.currentToken(state) && this.currentToken(state).startsWith('[')) {
				const modifierToken = this.currentToken(state);
				this.nextToken(state);
				modifiers = this.extractModifiers(modifierToken);
			}

			const [actionName, evaluatorFunction] = this.parseAction(token, modifiers);
			return {
				type: 'action',
				action: actionName,
				evaluatorFunction: [evaluatorFunction],
			};
		} else {
			throw new Error(`Unexpected token '${token}' at position ${state.index}`);
		}
	}

	static tokenize(input: string): string[] {
		const tokens: string[] = [];
		let current = '';
		let i = 0;

		while (i < input.length) {
			const char = input[i];

			if (char === ' ' || char === '\t' || char === '\n') {
				i++; // Skip whitespace
				continue;
			}

			if ('+•(),!'.includes(char)) {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				tokens.push(char);
				i++;
			} else if (char === '[') {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				let modifierToken = char;
				i++;
				let bracketCount = 1;
				while (i < input.length && bracketCount > 0) {
					const c = input[i];
					modifierToken += c;
					if (c === '[') bracketCount++;
					else if (c === ']') bracketCount--;
					i++;
				}
				if (bracketCount !== 0) {
					throw new Error(`Unmatched '[' at position ${i - modifierToken.length}`);
				}
				tokens.push(modifierToken);
			} else if (char === '{') {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				let braceToken = char;
				i++;
				let braceCount = 1;
				while (i < input.length && braceCount > 0) {
					const c = input[i];
					braceToken += c;
					if (c === '{') braceCount++;
					else if (c === '}') braceCount--;
					i++;
				}
				if (braceCount !== 0) {
					throw new Error(`Unmatched '{' at position ${i - braceToken.length}`);
				}
				tokens.push(braceToken);
			} else {
				current += char;
				i++;
			}
		}

		if (current.length > 0) {
			tokens.push(current);
		}

		return tokens;
	}

	static currentToken(state: ParserState): string | undefined {
		return state.tokens[state.index];
	}

	static nextToken(state: ParserState): void {
		state.index++;
	}

	private static combineActionStates(node: OperatorNode, getActionState: (actionName: string) => ActionState): ActionState {
		const actionStates = node.children.map(child => {
			if (child.type === 'action') {
				return getActionState(child.action);
			} else {
				// For operator nodes, recursively combine their child states
				return this.combineActionStates(child as OperatorNode, getActionState);
			}
		});

		const combinedState: ActionState = {
			action: '', // Placeholder
			pressed: false,
			justpressed: false,
			alljustpressed: false,
			consumed: false,
			presstime: undefined,
			timestamp: undefined,
		};

		if (node.operator === 'and') {
			combinedState.pressed = actionStates.every(s => s.pressed);
			combinedState.justpressed = actionStates.some(s => s.justpressed);
			combinedState.alljustpressed = actionStates.every(s => s.alljustpressed);
			combinedState.consumed = actionStates.some(s => s.consumed);
		} else if (node.operator === 'or') {
			combinedState.pressed = actionStates.some(s => s.pressed);
			combinedState.justpressed = actionStates.some(s => s.justpressed);
			combinedState.alljustpressed = actionStates.every(s => s.alljustpressed);
			combinedState.consumed = actionStates.some(s => s.consumed);
		}

		return combinedState;
	}

	/**
	 * Evaluates a set of actions based on the provided AST node.
	 *
	 * @param node - The ASTNode representing the action structure to evaluate.
	 * @param getActionState - A function that retrieves the current state of an action by its name.
	 * @returns A boolean indicating the result of the evaluation:
	 *          - `true` if the action evaluation is successful based on the node type and structure,
	 *          - `false` if the evaluation fails or if the node type is 'not' and its child evaluates to false.
	 *
	 * @throws Error if an unknown operator is encountered in the node.
	 */
	static evaluateActions(node: ASTNode, getActionState: (actionName: string) => ActionState): boolean {
		switch (node.type) {
			case 'action':
				const actionState = getActionState(node.action);
				return node.evaluatorFunction.every((evaluatorFunction) => evaluatorFunction(actionState));
			case 'not':
				return !this.evaluateActions(node.child, getActionState);
			case 'operator':
				let result: boolean;
				switch (node.operator) {
					case 'and':
						result = node.children.every((child) => this.evaluateActions(child, getActionState));
						break;
					case 'or':
						result = node.children.some((child) => this.evaluateActions(child, getActionState));
						break;
					default:
						throw new Error(`Unknown operator: ${node.operator}`);
				}

				if (node.modifiers && node.modifiers.length > 0) {
					// Combine the action states of the children
					const combinedState = this.combineActionStates(node, getActionState);

					// Compile the modifier functions
					const modifierFunctions = node.modifiers.map((modifier) => this.compileModifier(modifier));

					// Apply the modifiers to the combined state
					result = result && modifierFunctions.every((evaluatorFunction) => evaluatorFunction(combinedState));
				}

				return result;
		}
	}

}
