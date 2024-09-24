import type { ActionState } from "./input";

type ActionEvaluator = [string, (actionState: ActionState) => boolean];

type CompiledModifiers = ((actionState: ActionState) => boolean)[];

/**
 * An array of standard modifiers used in the action parser.
 * @see {@link StandardModifier} for the modifier types.
 *
 * The modifiers include:
 * - `pressed`: Indicates the action is currently pressed.
 * - `justPressed`: Indicates the action was just pressed.
 * - `consumed`: Indicates the action has been consumed.
 * - `ignoreConsumed`: Indicates to ignore consumed actions.
 * - `pressTime`: Represents the duration the action has been pressed.
 */
const standardModifiers = [
	'pressed',
	'justPressed',
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
 * @property {('+' | '|')} operator - The operator represented by this node, which can be either '+' or '|'.
 * @property {ASTNode[]} children - An array of child nodes that this operator applies to.
 */
type OperatorNode = {
	type: 'operator';
	operator: '+' | '|';
	children: ASTNode[];
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
 * @see ActionState for the structure of the input state.
 * @see ActionParser.getParsedActions for how to retrieve parsed actions.
 * @see ActionParser.evaluateActions for how to evaluate parsed actions.
 * @see ActionParser.parseActionDefinition for how to parse action definitions.
 * @see ActionParser.parseAction for how to parse a single action.
 * @see ActionParser.compileModifier for how to compile a modifier into a function.
 * @see ActionParser.isValidModifier for how to check if a modifier is valid.
 * @see ActionParser.tokenize for how to tokenize an action definition.
 * @see ActionParser.precomputeParsedActions for how to precompute parsed actions.
 * @see ActionParser.parsedActions for the cache of parsed actions.
 * @see ASTNode for the abstract syntax tree structure.
 * @see ActionNode for the action node structure.
 * @see OperatorNode for the operator node structure.
 * @see NotNode for the not node structure.
 * @see StandardModifier for the standard modifier type.
 * @see NegatedModifier for the negated modifier type.
 * @see Modifier for the modifier type.
 * @see KeyboardButton for the keyboard button type.
 * @see GamepadButton for the gamepad button type.
 * @see KeyboardInputMapping for the keyboard input mapping type.
 * @see GamepadInputMapping for the gamepad input mapping type.
 * @see InputMap for the input map type.
 * @see ButtonState for the button state type.
 * @see ActionState for the action state type.
 *
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
	 * Parses an action string into its name and associated modifiers.
	 *
	 * The action string can be negated by prefixing it with '!', and it may include
	 * modifiers enclosed in square brackets, separated by commas. The function ensures
	 * that certain default modifiers are included unless explicitly specified.
	 *
	 * @param action - The action string to parse, which may include modifiers.
	 * @returns A tuple containing the action name and an array of compiled modifier functions.
	 * @throws Error if the action format is invalid or if any modifiers are invalid.
	 *
	 * @example
	 * // Returns: ['jump', [modifierFunction1, modifierFunction2]]
	 * parseAction('jump[pressed,consumed]');
	 *
	 * @example
	 * // Returns: ['jump', [modifierFunction1, modifierFunction2]]
	 * parseAction('!jump[!pressed]');
	 */
	static parseAction(action: string): ActionEvaluator {
		let isNegated = false;

		if (action.startsWith('!')) {
			isNegated = true;
			action = action.substring(1);
		}

		const actionMatch = action.match(/^([a-zA-Z_]+)(?:\[(.*?)\])?$/);
		if (!actionMatch) {
			throw new Error(`Invalid action format: '${action}'`);
		}

		const actionName = actionMatch[1];
		const modifierString = actionMatch[2] || '';

		const modifiers = modifierString.split(',').filter(Boolean) as Modifier[];

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

		// If the action was negated, adjust the 'pressed' and 'consumed' modifiers
		if (isNegated) {
			modifiers.forEach((modifier, index) => {
				if (modifier === 'pressed') {
					modifiers[index] = '!pressed';
				} else if (modifier === '!pressed') {
					modifiers[index] = 'pressed';
				} else if (modifier === 'consumed') {
					modifiers[index] = '!consumed';
				} else if (modifier === '!consumed') {
					modifiers[index] = 'consumed';
				}
				// Other modifiers remain unchanged
			});
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

	/**
	 * Compiles a modifier string into a function that evaluates an action state.
	 *
	 * The modifier can be negated (prefixed with '!') and can represent various conditions:
	 * - `pressTime{<|>value}`: Checks if the press time is less than or greater than the specified value.
	 * - `pressed`: Evaluates if the action has been pressed.
	 * - `justPressed`: Evaluates if the action was just pressed.
	 * - `consumed`: Evaluates if the action has been consumed.
	 * - `ignoreConsumed`: Always returns true unless negated, effectively ignoring the consumed status.
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
	 * - 'pressTime'
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
		let index = 0;

		/**
		 * Tokenizes the provided action definition string into an array of tokens.
		 *
		 * @param actionDefinition - The string representation of the action definition to be tokenized.
		 * @returns An array of tokens extracted from the action definition.
		 */
		const tokens = this.tokenize(actionDefinition);

		/**
		 * Parses an expression from the current token stream.
		 *
		 * This function processes terms and combines them using the '|' operator.
		 * It constructs an Abstract Syntax Tree (AST) node representing the
		 * expression, where each node can be an operator or a term.
		 *
		 * @returns {ASTNode} The root node of the parsed expression.
		 */
		const parseExpression = (): ASTNode => {
			let node = parseTerm();

			while (index < tokens.length && tokens[index] === '|') {
				index++; // Consume '|'
				const right = parseTerm();
				node = {
					type: 'operator',
					operator: '|',
					children: [node, right],
				};
			}

			return node;
		};

		/**
		 * Parses a term in the expression.
		 *
		 * A term consists of one or more factors connected by the '+' operator.
		 * This function processes the current token and constructs an Abstract Syntax Tree (AST)
		 * node representing the term.
		 *
		 * @returns {ASTNode} The AST node representing the parsed term.
		 */
		const parseTerm = (): ASTNode => {
			let node = parseFactor();

			while (index < tokens.length && tokens[index] === '+') {
				index++; // Consume '+'
				const right = parseFactor();
				node = {
					type: 'operator',
					operator: '+',
					children: [node, right],
				};
			}

			return node;
		};

		/**
		 * Parses a factor in the expression.
		 * A factor can be a negation (indicated by '!'), a parenthesized expression,
		 * or an action token. The function recursively processes nested factors
		 * and returns an ASTNode representing the parsed factor.
		 *
		 * @returns {ASTNode} The parsed factor as an Abstract Syntax Tree (AST) node.
		 * @throws {Error} Throws an error if a closing parenthesis is expected but not found.
		 */
        const parseFactor = (): ASTNode => {
            if (tokens[index] === '!') {
                index++;
                const node = parseFactor();
                return {
                    type: 'not',
                    child: node,
                };
            } else if (tokens[index] === '(') {
                index++;
                const node = parseExpression();
                if (tokens[index] !== ')') {
                    throw new Error(`Expected ')' at position ${index}`);
                }
                index++;
                return node;
            } else {
                const actionToken = tokens[index++];
                const [actionName, evaluatorFunction] = this.parseAction(actionToken);
                return {
                    type: 'action',
                    action: actionName,
                    evaluatorFunction: [evaluatorFunction],
                };
            }
        };

		return parseExpression();
	}

	/**
	 * Tokenizes the input string into an array of tokens.
	 *
	 * This function processes the input string character by character,
	 * skipping whitespace and identifying specific characters and patterns
	 * such as operators ('+', '|', '(', ')'), negation ('!'),
	 * action modifiers (enclosed in brackets '[...]'), and press time
	 * (enclosed in curly braces '{...}').
	 *
	 * If an unmatched opening bracket or brace is found, an error is thrown.
	 *
	 * @param input - The string to be tokenized.
	 * @returns An array of tokens extracted from the input string.
	 * @throws Error if there is an unmatched '[' or '{' in the input.
	 */
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

			if (char === '+' || char === '|' || char === '(' || char === ')') {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				tokens.push(char);
				i++;
			} else if (char === '!') {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				tokens.push('!');
				i++;
			} else if (char === '[') {
				// Handle action with modifiers
				current += char;
				i++;
				while (i < input.length && input[i] !== ']') {
					current += input[i];
					i++;
				}
				if (i < input.length) {
					current += ']';
					i++; // Consume ']'
				} else {
					throw new Error(`Unmatched '[' at position ${i}`);
				}
			} else if (char === '{') {
				// Handle pressTime with curly braces
				current += char;
				i++;
				while (i < input.length && input[i] !== '}') {
					current += input[i];
					i++;
				}
				if (i < input.length) {
					current += '}';
					i++; // Consume '}'
				} else {
					throw new Error(`Unmatched '{' at position ${i}`);
				}
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

	/**
	 * Evaluates a set of actions based on the provided AST node.
	 *
	 * @param node - The ASTNode representing the action structure to evaluate.
	 * @param getActionState - A function that retrieves the current state of an action by its name.
	 * @returns A boolean indicating whether the actions defined in the node are triggered based on the evaluation.
	 *
	 * @throws Error if an unknown operator is encountered in the node.
	 *
	 * The function supports the following node types:
	 * - 'action': Evaluates if the specified action is triggered.
	 * - 'not': Negates the result of evaluating its child node.
	 * - '+': Represents a logical AND operation, requiring all child nodes to return true.
	 * - '|': Represents a logical OR operation, requiring at least one child node to return true.
	 */
	static evaluateActions(node: ASTNode, getActionState: (actionName: string) => ActionState): boolean {
		if (node.type === 'action') {
			const [actionName, evaluatorFunction] = this.parseAction(node.action);
			return evaluatorFunction(getActionState(actionName));
		}

		if (node.type === 'not') {
			return !this.evaluateActions(node.child, getActionState);
		}

		if (node.operator === '+') {
			// AND operator: All children must return true
			return node.children.every(child => this.evaluateActions(child, getActionState));
		} else if (node.operator === '|') {
			// OR operator: At least one child must return true
			return node.children.some(child => this.evaluateActions(child, getActionState));
		}

		throw new Error(`Unknown operator: ${node.operator}`);
	}

	/**
	 * Determines if an action is triggered based on the provided action name,
	 * a list of modifier functions, and a method to retrieve the current action state.
	 *
	 * @param actionName - The name of the action to check.
	 * @param modifierFunctions - An array of functions that take the action state
	 *                            and return a boolean indicating if the condition is met.
	 * @param getActionState - A function that retrieves the current state of the action
	 *                         based on the action name.
	 * @returns True if all modifier functions return true for the current action state,
	 *          otherwise false.
	 */
	static isActionTriggered(actionEvaluator: ActionEvaluator, getActionState: (actionName: string) => ActionState): boolean {
		const [actionName, evaluatorFunction] = actionEvaluator;
		return evaluatorFunction(getActionState(actionName));
	}
}
