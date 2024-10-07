import type { ActionState } from "./input";

// Refactored version
const TOKEN_REGEX = /\s*(\|\||&&|[&|]|jp|![pjc]|ic|[pjc]|[a-zA-Z_][a-zA-Z0-9_]*|[!\(\)\[\],]|!|\S)\s*/g;

/**
 * Represents a node in the Abstract Syntax Tree (AST).
 * This can be one of the following types:
 * - ActionNode
 * - FunctionNode
 * - OperatorNode
 */
type ASTNode = ActionNode | FunctionNode | OperatorNode;

/**
 * Represents an action node in the action parser.
 *
 * @interface ActionNode
 * @property {string} type - The type of the node, always 'action'.
 * @property {string} name - The name of the action.
 * @property {string[]} modifiers - A list of modifiers associated with the action.
 * @property {((actionState: ActionState) => boolean)[]} compiledModifierFunctions - An array of functions that evaluate the modifiers.
 * @property {boolean} ignoreConsumed - A flag indicating whether to ignore consumed actions.
 * @property {(getActionState: (actionName: string) => ActionState) => boolean} evaluate - A function to evaluate the action state.
 */
interface ActionNode {
	type: 'action';
	name: string;
	modifiers: string[];
	compiledModifierFunctions: ((actionState: ActionState) => boolean)[];
	ignoreConsumed: boolean;
	evaluate: (getActionState: (actionName: string) => ActionState) => boolean;
}

/**
 * Represents a node in the abstract syntax tree (AST) that corresponds to a function.
 *
 * @interface FunctionNode
 * @property {string} type - The type of the node, which is always 'function' for this interface.
 * @property {string} functionName - The name of the function.
 * @property {ASTNode[]} arguments - An array of AST nodes representing the arguments passed to the function.
 */
interface FunctionNode {
	type: 'function';
	functionName: string;
	arguments: ASTNode[];
}

/**
 * Represents an operator node in the abstract syntax tree (AST).
 *
 * @interface OperatorNode
 * @property {'operator'} type - The type of the node, which is always 'operator'.
 * @property {'AND' | 'OR' | 'NOT'} operator - The operator represented by this node.
 * @property {ASTNode} [left] - The left operand of the operator. This is optional.
 * @property {ASTNode} [right] - The right operand of the operator. This is optional.
 */
interface OperatorNode {
	type: 'operator';
	operator: 'AND' | 'OR' | 'NOT';
	left?: ASTNode;
	right?: ASTNode;
}

/**
 * A class responsible for parsing and evaluating action definitions.
 * The class uses a simple parser to convert action definitions into an abstract syntax tree (AST).
 * The AST is then evaluated based on the current state of the actions.
 * The parser supports logical operators (AND, OR, NOT), functions, and action nodes.
 * The action nodes can have modifiers that define the conditions for the action to be triggered.
 * The parser supports the following modifiers:
 * - 'p': Checks if the action is pressed.
 * - 'j': Checks if the action was just pressed.
 * - 'c': Checks if the action was consumed.
 * - 'ic': Ignores the consumed state of the action.
 * - '!': Negates the result of the modifier.
 * The parser also supports functions that combine multiple actions with logical operators.
 * The parser caches the parsed actions to improve performance when evaluating multiple times.
 * The parser is stateless and can be reused to parse and evaluate different action definitions.
 * The parser is designed to work with the ActionState interface, which provides the current state of the actions.
 */
export class ActionParser {
	/**
	 * A static map that stores parsed actions.
	 * The key is a string representing the action name, and the value is an ASTNode representing the parsed action.
	 */
	private static parsedActions: Map<string, ASTNode> = new Map();

	/**
	 * @private
	 * @static
	 * An array of strings representing tokens.
	 */
	private static tokens: string[] = [];

	/**
	 * A static index used by the action parser.
	 * This index is initialized to 0 and can be used to keep track of the current character position in the action string.
	 * @private
	 * @static
	 */
	private static actionParserIndex: number = 0;

	/**
	 * Default modifier function to check if an action is pressed.
	 *
	 * @param actionState - The current state of the action.
	 * @returns A boolean indicating whether the action is pressed.
	 */
	private static defaultPressedModifier = (actionState: ActionState) => actionState.pressed;

	/**
	 * A default modifier function that checks if an action state has not been consumed.
	 *
	 * @param actionState - The current state of the action.
	 * @returns `true` if the action state has not been consumed, otherwise `false`.
	 */
	private static defaultNotConsumedModifier = (actionState: ActionState) => !actionState.consumed;

	/**
	 * Checks if an action is triggered based on the provided action definition and state.
	 *
	 * @param actionDefinition - A string representing the action definition to be checked.
	 * @param getActionState - A callback function that takes an action name as a parameter and returns the corresponding ActionState.
	 * @returns A boolean indicating whether the action is triggered.
	 */
	public static checkActionTriggered(
		actionDefinition: string,
		getActionState: (actionName: string) => ActionState
	): boolean {
		const parsedActions = this.getParsedActions(actionDefinition);
		if (!parsedActions) return false;
		return this.evaluateActions(parsedActions, getActionState);
	}

	/**
	 * Parses the given action definition string and returns the corresponding ASTNode.
	 * If the action definition has already been parsed, it retrieves the cached result.
	 *
	 * @param actionDefinition - The string representation of the action definition to be parsed.
	 * @returns The parsed ASTNode or undefined if parsing fails.
	 * @throws Will throw an error if the action definition cannot be parsed.
	 */
	private static getParsedActions(actionDefinition: string): ASTNode | undefined {
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
	 * Evaluates the actions of a given AST node.
	 *
	 * @param node - The AST node to evaluate.
	 * @param getActionState - A function that retrieves the state of an action given its name.
	 * @returns A boolean indicating the result of the evaluation.
	 */
	private static evaluateActions(
		node: ASTNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		return this.evaluate(node, getActionState);
	}

	/**
	 * Evaluates an ASTNode based on its type.
	 *
	 * @param node - The ASTNode to evaluate.
	 * @param getActionState - A function that retrieves the state of an action given its name.
	 * @returns A boolean indicating the result of the evaluation.
	 */
	private static evaluate(
		node: ASTNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		switch (node.type) {
			case 'action':
				return node.evaluate(getActionState);
			case 'function':
				return this.evaluateFunctionNode(node, getActionState);
			case 'operator':
				return this.evaluateOperatorNode(node, getActionState);
		}
	}

	/**
	 * Evaluates a function node based on its function name and arguments.
	 *
	 * @param node - The function node to evaluate.
	 * @param getActionState - A callback function that retrieves the state of an action given its name.
	 * @returns A boolean indicating the result of the function node evaluation.
	 * @throws Will throw an error if the function name is unknown.
	 */
	private static evaluateFunctionNode(
		node: FunctionNode,
		getActionState: (actionName: string) => ActionState
	): boolean {
		switch (node.functionName) {
			case '&':
				return node.arguments.every((arg) => this.evaluate(arg, getActionState));
			case '|':
				return node.arguments.some((arg) => this.evaluate(arg, getActionState));
			case 'jp':
				return this.evaluateAnyJustPressedFunction(node.arguments, getActionState);
			default:
				throw new Error(`Unknown function: '${node.functionName}'`);
		}
	}

	/**
	 * Evaluates if *all* the provided action nodes are pressed and *any* of them was just pressed.
	 *
	 * @param args - An array of ASTNode objects representing action nodes to be evaluated.
	 * @param getActionState - A function that retrieves the ActionState for a given action name.
	 * @returns A boolean indicating whether any action node was just pressed.
	 *
	 * @throws Will throw an error if any of the provided arguments are not action nodes.
	 */
	private static evaluateAnyJustPressedFunction(
		args: ASTNode[],
		getActionState: (actionName: string) => ActionState
	): boolean {
		// Evaluate each argument as an action node
		const actionResults = args.map((arg) => {
			if (arg.type !== 'action') {
				throw new Error(`'jp' function expects action nodes as arguments.`);
			}
			const actionPassed = arg.evaluate(getActionState);
			const actionState = getActionState(arg.name);
			return { actionState, actionPassed, actionNode: arg };
		});

		// Check that all actions passed their modifiers
		const allActionsPassed = actionResults.every((ar) => ar.actionPassed);

		if (!allActionsPassed) {
			return false;
		}

		// Check if any action was just pressed
		const anyJustPressed = actionResults.some((ar) => {
			// Check if the action node has 'j' or '!j' modifiers
			const hasJustPressedModifier = ar.actionNode.modifiers.some(
				(mod) => mod === 'j' || mod === '!j'
			);

			if (hasJustPressedModifier) {
				// The 'justPressed' state was already considered in evaluation
				return ar.actionPassed;
			} else {
				// Check the 'justpressed' state now
				return ar.actionState.justpressed;
			}
		});

		return anyJustPressed;
	}

	/**
	 * Evaluates an operator node within an action state context.
	 *
	 * @param node - The operator node to evaluate. It contains the operator and its operands.
	 * @param getActionState - A function that retrieves the state of a given action by its name.
	 * @returns A boolean indicating the result of the evaluation.
	 * @throws Will throw an error if the operator is unknown.
	 */
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
	 * Parses the given input string and returns an abstract syntax tree (AST) node.
	 *
	 * @param input - The input string to be parsed.
	 * @returns An ASTNode representing the parsed structure of the input.
	 * @throws Will throw an error if there are unexpected tokens in the input.
	 */
	static parse(input: string): ASTNode {
		this.tokens = this.tokenize(input);
		this.actionParserIndex = 0;
		const result = this.parseExpression();
		if (this.actionParserIndex < this.tokens.length) {
			throw new Error(`Unexpected token '${this.tokens[this.actionParserIndex]}' at position ${this.actionParserIndex}`);
		}
		return result;
	}

	/**
	 * Tokenizes the input string based on a predefined set of patterns.
	 *
	 * The function uses a regular expression to match and extract tokens from the input string.
	 * The tokens can include logical operators (||, &&), single characters (&, |, !, etc.),
	 * keywords (jp, ic, etc.), and identifiers (alphanumeric strings starting with a letter or underscore).
	 *
	 * @param input - The string to be tokenized.
	 * @returns An array of tokens extracted from the input string.
	 */
	private static tokenize(input: string): string[] {
		const tokens: string[] = [];
		let match: RegExpExecArray | null;

		while ((match = TOKEN_REGEX.exec(input)) !== null) {
			tokens.push(match[1]);
		}

		return tokens;
	}

	/**
	 * Parses an expression and returns an abstract syntax tree (AST) node.
	 * The expression can contain logical OR operators ('||' or 'OR').
	 *
	 * @returns {ASTNode} The root node of the parsed expression's AST.
	 * @private
	 */
	private static parseExpression(): ASTNode {
		let node = this.parseTerm();

		while (this.match('||') || this.match('OR')) {
			this.consume();
			const right = this.parseTerm();
			node = { type: 'operator', operator: 'OR', left: node, right };
		}

		return node;
	}

	/**
	 * Parses a term in the expression, which consists of factors combined with logical AND operators.
	 *
	 * @returns {ASTNode} The root node of the parsed term, which may be a single factor or a combination of factors with AND operators.
	 *
	 * @private
	 */
	private static parseTerm(): ASTNode {
		let node = this.parseFactor();

		while (this.match('&&') || this.match('AND')) {
			this.consume();
			const right = this.parseFactor();
			node = { type: 'operator', operator: 'AND', left: node, right };
		}

		return node;
	}

	/**
	 * Parses a factor in the expression.
	 *
	 * A factor can be:
	 * - A negation operator ('!' or 'NOT') followed by another factor.
	 * - An expression enclosed in parentheses.
	 * - A function call.
	 * - An action.
	 *
	 * @returns {ASTNode} The parsed factor as an AST node.
	 * @private
	 */
	private static parseFactor(): ASTNode {
		if (this.match('!') || this.match('NOT')) {
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

	/**
	 * Parses a function node from the input.
	 *
	 * This method expects the following structure:
	 * - A function name followed by an opening parenthesis `(`.
	 * - A list of arguments separated by commas `,`.
	 * - A closing parenthesis `)`.
	 *
	 * @returns {FunctionNode} An object representing the parsed function node, including its name and arguments.
	 * @throws {SyntaxError} If the expected tokens are not found in the input.
	 */
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

	/**
	 * Parses an action and returns an ActionNode object.
	 *
	 * This method consumes an action name and optionally parses any modifiers
	 * associated with the action. It compiles the modifiers into functions that
	 * can be used to evaluate the action state.
	 *
	 * The method ensures that if no 'pressed' modifier is present, a default
	 * pressed modifier is added. Additionally, if the 'ignore consumed' modifier
	 * is not present, a default not consumed modifier is added.
	 *
	 * @returns {ActionNode} The parsed ActionNode object containing the action
	 * name, modifiers, compiled modifier functions, ignore consumed flag, and
	 * an evaluate function.
	 */
	private static parseAction(): ActionNode {
		const name = this.consume();
		let modifiers: string[] = [];
		let ignoreConsumed = false;

		if (this.match('[')) {
			modifiers = this.parseModifiers();
		}

		const compiledModifierFunctions: ((actionState: ActionState) => boolean)[] = [];

		for (const modifier of modifiers) {
			if (modifier === 'ic') {
				ignoreConsumed = true;
			} else {
				compiledModifierFunctions.push(this.compileModifier(modifier));
			}
		}

		const hasPressedModifier = modifiers.some((mod) => mod === 'p' || mod === '!p');
		let modifierFunctions = compiledModifierFunctions;

		if (!hasPressedModifier) {
			modifierFunctions = [this.defaultPressedModifier, ...modifierFunctions];
		}

		if (!ignoreConsumed) {
			modifierFunctions.push(this.defaultNotConsumedModifier);
		}

		// Precompile the evaluation function
		const evaluate = (getActionState: (actionName: string) => ActionState): boolean => {
			const actionState = getActionState(name);
			return modifierFunctions.every((func) => func(actionState));
		};

		return {
			type: 'action',
			name,
			modifiers,
			compiledModifierFunctions,
			ignoreConsumed,
			evaluate,
		};
	}

	/**
	 * Parses a list of modifiers enclosed in square brackets.
	 *
	 * This method consumes the opening '[' character, then iterates through
	 * the content until it encounters the closing ']' character. Each modifier
	 * is separated by a comma ','.
	 *
	 * @returns {string[]} An array of modifiers as strings.
	 *
	 * @throws {Error} If the expected ']' character is not found.
	 */
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

	/**
	 * Compiles a modifier string into a function that evaluates an `ActionState`.
	 *
	 * The modifier string can optionally start with '!' to indicate negation.
	 * Supported modifiers are:
	 * - 'p': Checks if the action state is pressed.
	 * - 'j': Checks if the action state is just pressed.
	 * - 'c': Checks if the action state is consumed.
	 *
	 * @param modifier - The modifier string to compile.
	 * @returns A function that takes an `ActionState` and returns a boolean indicating the state of the action.
	 * @throws Will throw an error if the modifier is unknown.
	 */
	private static compileModifier(modifier: string): (actionState: ActionState) => boolean {
		const isNegated = modifier.startsWith('!');
		const modifierName = isNegated ? modifier.substring(1) : modifier;

		let func: (actionState: ActionState) => boolean;

		switch (modifierName) {
			case 'p':
				func = (actionState) => actionState.pressed;
				break;
			case 'j':
				func = (actionState) => actionState.justpressed;
				break;
			case 'aj':
				func = (actionState) => actionState.alljustpressed;
				break;
			case 'c':
				func = (actionState) => actionState.consumed;
				break;
			default:
				throw new Error(`Unknown modifier: '${modifierName}'`);
		}

		return isNegated ? (actionState) => !func(actionState) : func;
	}

	// Utility methods

	/**
	 * Checks if the current token matches the specified token.
	 *
	 * @param token - The token to match against the current token.
	 * @returns `true` if the current token matches the specified token, otherwise `false`.
	 */
	private static match(token: string): boolean {
		return this.tokens[this.actionParserIndex] === token;
	}

	/**
	 * Consumes the next token from the token list and increments the index.
	 *
	 * @returns {string} The next token in the list.
	 */
	private static consume(): string {
		return this.tokens[this.actionParserIndex++];
	}

	/**
	 * Ensures that the current token matches the expected token.
	 * Throws an error if the tokens do not match.
	 *
	 * @param token - The expected token to match.
	 * @throws {Error} If the current token does not match the expected token.
	 */
	private static expect(token: string): void {
		if (this.tokens[this.actionParserIndex] !== token) {
			throw new Error(`Expected '${token}', found '${this.tokens[this.actionParserIndex]}'`);
		}
	}

	/**
	 * Checks if the current token is a function operator and the next token is an opening parenthesis.
	 *
	 * @returns {boolean} - Returns `true` if the current token is '&', '|', or 'jp' and the next token is '(', otherwise `false`.
	 */
	private static matchFunction(): boolean {
		const token = this.tokens[this.actionParserIndex];
		return (token === '&' || token === '|' || token === 'jp') && this.tokens[this.actionParserIndex + 1] === '(';
	}
}
