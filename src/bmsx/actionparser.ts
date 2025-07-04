import type { ActionState } from './input';

/**
 * Represents the different types of tokens that can be identified
 * during the lexical analysis of an action definition string.
 */
const enum Tokens {
	/** Represents symbols such as `&&`, `||`, `!`, `(`, `)`, `[`, `]`, and `,`. */
	Sym,
	/** Represents action identifiers, e.g., `actionName`. */
	Ident,
	/** Represents windowed function tokens, e.g., `?wp{6}`, `&wp{12}`. */
	FuncWin,
	/** Represents function tokens, e.g., `&`, `?`, `?jp`, `&jp`. */
	Func,
	/** Represents raw tokens inside `[ ... ]`, e.g., `t{…}`, `wp{…}`, `pr{…}`. */
	ModTok,
	/** Represents comparison operators, e.g., `<`, `>`, `<=`, `>=`, `==`, `!=`. */
	Cmp,
}

/**
 * Represents a token in the action definition string.
 */
interface Token { kind: Tokens; value: string; }

/**
 * Tokenizes the input source string into a list of tokens.
 *
 * This function uses a regular expression to identify and classify
 * various components of the input string, such as symbols, identifiers,
 * functions, and comparison operators.
 *
 * @param src - The source string to tokenize.
 * @returns An array of tokens representing the parsed components of the input string.
 */
function lex(src: string): Token[] {
	// Regular expression to match various tokens in the input string
	const R = /\s*(\|\||&&|!|\(|\)|\[|]|,|\?jp|&jp|\?wp\{\d+}|&wp\{\d+}|\?jr|&jr|\?wr\{\d+}|&wr\{\d+}|[&?]|(?:t|wp|wr|pr)\{[^}]*}|[a-zA-Z_][a-zA-Z0-9_]*|[<>!=]=?)/gy;
	const out: Token[] = []; // Array to hold the parsed tokens
	let m: RegExpExecArray | null; // Regular expression to match tokens in the input string
	while ((m = R.exec(src)) !== null) {
		const v = m[1]; // Extract the matched token value
		// If the token value is undefined, skip to the next iteration
		if (v === undefined) continue;
		// Classify the token based on its value and add it to the output array
		if (v === '||' || v === '&&' || v === '!' || v === '(' || v === ')' || v === '[' || v === ']' || v === ',') {
			// These are symbols used in logical expressions and function calls
			out.push({ kind: Tokens.Sym, value: v });
		} else if (/^[?&]wp\{\d+}$/.test(v) || /^[?&]wr\{\d+}$/.test(v)) {
			// Windowed function tokens, e.g., `?wp{6}`, `&wp{12}`, `?wr{6}`, `&wr{12}`
			out.push({ kind: Tokens.FuncWin, value: v });
		} else if (v === '&' || v === '?' || v === '?jp' || v === '&jp' || v === '?jr' || v === '&jr') {
			// Function tokens, e.g., `&`, `?`, `?jp`, `&jp`, `?jr`, `&jr`
			out.push({ kind: Tokens.Func, value: v });
		} else if (/^[<>!=]=?$/.test(v)) {
			// Comparison operators, e.g., `<`, `>`, `<=`, `>=`, `==`, `!=`
			out.push({ kind: Tokens.Cmp, value: v });
		} else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) {
			// Action identifiers, e.g., `actionName`
			out.push({ kind: Tokens.Ident, value: v });
		} else {
			// Raw tokens inside `[ ... ]`, e.g., `t{…}`, `wp{…}`, `wr{…}`, `pr{…}`
			out.push({ kind: Tokens.ModTok, value: v });
		}
	}
	// Return the array of tokens representing the parsed components of the input string
	return out;
}

/**
 * A function type that retrieves the state of an action by its name and optional window.
 *
 * @param name - The name of the action to retrieve.
 * @param win - An optional window parameter for time-based evaluation.
 * @returns The state of the action as an `ActionState` object.
 */
type GetterFn = (name: string, win?: number) => ActionState;

/**
 * A function type that evaluates a modifier for a given action state.
 *
 * @param get - A function to retrieve the state of an action.
 * @param name - The name of the action to evaluate.
 * @param win - An optional window parameter for time-based evaluation.
 * @returns A boolean indicating whether the modifier condition is satisfied.
 */
type ModFn = (get: GetterFn, name: string, win?: number) => boolean;

/**
 * A function type that evaluates an expression node in the AST.
 *
 * @param get - A function to retrieve the state of an action.
 * @returns A boolean indicating whether the expression evaluates to true.
 */
type EvalFn = (get: GetterFn) => boolean;

/**
 * The base interface for all AST nodes.
 *
 * @property eval - A function to evaluate the node's expression.
 */
interface NodeBase { eval: EvalFn; }

/**
 * Represents a logical operation node in the AST.
 *
 * @property op - The logical operator ('AND', 'OR' | 'NOT').
 * @property left - The left operand node (optional for 'NOT').
 * @property right - The right operand node (optional for 'NOT').
 */
interface OpNode extends NodeBase { op: 'AND' | 'OR' | 'NOT'; left?: Node; right?: Node; }

/**
 * Represents an action node in the AST.
 *
 * @property name - The name of the action.
 * @property mods - A list of modifiers associated with the action.
 */
interface ActNode extends NodeBase { name: string; mods: string[]; }

/**
 * Represents a function node in the AST.
 *
 * @property fname - The name of the function.
 * @property args - A list of argument nodes for the function.
 * @property window - An optional window parameter for time-based functions.
 */
interface FunNode extends NodeBase { fname: string; args: Node[]; window?: number; }

/**
 * A union type representing all possible AST node types.
 */
type Node = OpNode | ActNode | FunNode;

/**
 * A recursive descent parser for action definitions.
 * Converts a tokenized input string into an abstract syntax tree (AST).
 */
class Parser {
	/**
	 * The current index in the token stream.
	 * Used to track the position of the parser in the input tokens.
	 */
	private currentIndex = 0;

	/**
	 * Constructs a new `Parser` instance.
	 * @param tokens - The list of tokens to parse.
	 */
	constructor(private readonly tokens: Token[]) { }

	/**
	 * Parses a source string into an AST.
	 * @param src - The source string to parse.
	 * @returns The root node of the parsed AST.
	 * @throws If the input contains unexpected tokens or is invalid.
	 */
	static parse(src: string): Node {
		const parser = new Parser(lex(src));
		const ast = parser.expr();
		if (parser.current()) throw new Error(`Unexpected token '${parser.current()!.value}'`);
		enforceRootModifiers(ast);
		return ast;
	}

	/**
	 * Retrieves the current token in the token stream without advancing the cursor.
	 *
	 * @returns The current token, or `undefined` if the end of the stream is reached.
	 */
	private current() { return this.tokens[this.currentIndex]; }

	/**
	 * Advances the cursor in the token stream and returns the current token.
	 *
	 * @returns The token at the current cursor position before advancing.
	 */
	private eat() { return this.tokens[this.currentIndex++]; }

	/**
	 * Consumes the current token if it matches the specified kind and optional value.
	 *
	 * @param kind - The expected kind of the token.
	 * @param v - An optional expected value of the token.
	 * @returns The consumed token.
	 * @throws If the current token does not match the expected kind or value.
	 */
	private take(kind: Tokens, v?: string) {
		const c = this.current();
		if (!c || c.kind !== kind || (v && c.value !== v)) throw new Error(`Unexpected token ${c?.value ?? '<eos>'}`);
		return this.eat();
	}

	/**
	 * Parses an expression node from the token stream.
	 *
	 * This method processes logical OR (`||`) operations and constructs
	 * an `OpNode` representing the parsed expression.
	 *
	 * @returns A `Node` representing the parsed expression.
	 */
	private expr(): Node {
		let n = this.term(); // Start parsing a term node
		while (this.current()?.value === '||') {
			this.eat();
			const r = this.term(); // Parse the right-hand side of the OR operation
			const l = n; // Store the left-hand side of the OR operation
			// Create a new OpNode for the OR operation
			n = { op: 'OR', left: l, right: r, eval: g => l.eval(g) || r.eval(g) };
		}
		return n; // Return the constructed expression node
	}

	/**
	 * Parses a term node from the token stream.
	 *
	 * This method processes logical AND (`&&`) operations and constructs
	 * an `OpNode` representing the parsed term.
	 *
	 * @returns A `Node` representing the parsed term.
	 */
	private term(): Node {
		let n = this.factor(); // Start parsing a factor node
		while (this.current()?.value === '&&') {
			this.eat();
			const r = this.factor(); // Parse the right-hand side of the AND operation
			const l = n; // Store the left-hand side of the AND operation
			// Create a new OpNode for the AND operation
			n = { op: 'AND', left: l, right: r, eval: g => l.eval(g) && r.eval(g) };
		}
		return n; // Return the constructed term node
	}

	/**
	 * Parses a factor node from the token stream.
	 *
	 * This method identifies and processes individual components of an expression,
	 * such as negations (`!`), grouped expressions (`(...)`), functions, or actions.
	 * It constructs and returns the corresponding AST node for the parsed factor.
	 *
	 * @returns A `Node` representing the parsed factor.
	 * @throws If the token stream is invalid or unexpected tokens are encountered.
	 */
	private factor(): Node {
		const c = this.current(); // Get the current token without advancing the cursor
		if (!c) throw new Error('Unexpected end of input');
		if (c.value === '!') { // Handle negation
			this.eat();
			const o = this.factor(); // Parse the operand of the negation
			// Create a new OpNode for the NOT operation
			return { op: 'NOT', left: o, eval: g => !o.eval(g) };
		}
		if (c.value === '(') { // Handle grouped expressions
			this.eat();
			// Parse the expression inside the parentheses
			const e = this.expr();
			// Ensure the closing parenthesis is present
			this.take(Tokens.Sym, ')');
			// Return the parsed expression node
			return e;
		}
		// Check if the current token is a function or action
		if (c.kind === Tokens.Func || c.kind === Tokens.FuncWin) return this.func();
		// If it's not a function, it must be an action
		return this.action();
	}

	/**
	 * Parses a function node from the token stream.
	 *
	 * This method identifies function tokens (e.g., `&`, `?`, `?wp{6}`) and their
	 * arguments, constructing a `FunNode` that represents the parsed function.
	 * For windowed functions (e.g., `?wp{6}`), it extracts the window parameter.
	 *
	 * @returns A `FunNode` representing the parsed function.
	 * @throws If the token stream is invalid or unexpected tokens are encountered.
	 */
	private func(): Node {
		// Extract the function token and its base name
		const tok = this.eat();
		let base = tok.value;
		// If the token is a windowed function, extract the base name and window size
		let win: number | undefined;

		// Check if the token is a windowed function
		if (tok.kind === Tokens.FuncWin) {
			// Extract the windowed function base and size
			const m = tok.value.match(/^([?&]wp)\{(\d+)}/)!;
			base = m[1]; // Set the base name to the function type (e.g., `?wp`, `&wp`)
			win = +m[2]; // Set the window size to the parsed number
		}

		this.take(Tokens.Sym, '('); // Ensure the opening parenthesis is present
		const args: Node[] = []; // Array to hold the function arguments
		if (this.current()?.value !== ')') { // Check if there are arguments
			args.push(this.expr()); // Parse the first argument
			while (this.current()?.value === ',') { this.eat(); args.push(this.expr()); } // Parse subsequent arguments
		}
		this.take(Tokens.Sym, ')'); // Ensure the closing parenthesis is present

		// Return a FunNode representing the parsed function
		return { fname: base, args, window: win, eval: compileFunction(base as any, args, win) };
	}

	/**
	 * Parses an action node from the token stream.
	 *
	 * This method identifies action identifiers and their associated modifiers
	 * (if any) and constructs an `ActNode` representing the parsed action.
	 * Modifiers are enclosed in square brackets (`[ ... ]`) and can include
	 * negations (e.g., `!modifier`).
	 *
	 * @returns An `ActNode` representing the parsed action.
	 * @throws If the token stream is invalid or unexpected tokens are encountered.
	 */
	private action(): Node {
		// Ensure the current token is an identifier
		const name = this.take(Tokens.Ident).value;
		const mods: string[] = []; // Array to hold the action modifiers
		if (this.current()?.value === '[') { // Check if there are modifiers
			this.eat(); // Consume the opening square bracket
			while (this.current() && this.current()!.value !== ']') { // Parse modifiers until the closing bracket
				const t = this.eat(); // Get the current token
				if (t.value === '!') mods.push('!' + this.take(this.current()!.kind).value); // Handle negation
				else mods.push(t.value); // Add the modifier token to the list
			}
			this.take(Tokens.Sym, ']'); // Ensure the closing square bracket is present
		}
		// Return an ActNode representing the parsed action
		return { name, mods, eval: compileAction(name, mods) };
	}
}

/**
 * Validates that root-level actions in the AST have at least one modifier.
 *
 * This function traverses the AST and ensures that any root-level action
 * (i.e., an action not nested within a function) specifies at least one
 * modifier, such as `[p]`. If no modifier is found, an error is thrown.
 *
 * @param n - The root node of the AST to validate.
 * @throws If a root-level action lacks a modifier.
 */
function enforceRootModifiers(n: Node) {
	// Recursive function to walk through the AST nodes
	const walk = (node: Node, inFun: boolean) => {
		// If the node is a function, recursively walk through its arguments
		if ((node as FunNode).fname) { (node as FunNode).args.forEach(a => walk(a, true)); return; }
		// If the node is an operation, recursively walk through its left and right operands
		if ((node as OpNode).op) {
			const o = node as OpNode; // Cast the node to OpNode to access its properties
			if (o.left) walk(o.left, inFun); // Recursively walk the left operand
			if (o.right) walk(o.right, inFun); // Recursively walk the right operand
			return; // Exit after processing both operands
		}
		const a = node as ActNode; // Cast the node to ActNode to access its properties
		if (!inFun && a.mods.length === 0) // If this is a root-level action with no modifiers
			// throw an error indicating the missing modifier
			throw new Error(`Root‑level action '${a.name}' must specify a modifier like '[p]'`);
	};
	// Start walking the AST from the root node
	walk(n, false);
}

/**
 * A mapping of static modifiers to their corresponding evaluation functions.
 *
 * This object defines the behavior of static modifiers used in action definitions,
 * such as `p` (pressed), `j` (just-pressed), `jr` (just-released),
 * `&j` (all-just-pressed), `&jr` (all-just-released), and `c` (consumed).
 * Each modifier is associated with a function that evaluates the modifier condition
 * for a given action state.
 *
 * @property p - Evaluates to true if the action is currently pressed.
 * @property j - Evaluates to true if the action was just pressed.
 * @property &j - Evaluates to true if all actions are just pressed.
 * @property jr - Evaluates to true if the action was just released.
 * @property &jr - Evaluates to true if all actions are just released.
 * @property c - Evaluates to true if the action is consumed.
 */
const STATIC: Record<string, ModFn> = {
        'p': (get, n, win) => get(n, win).pressed,
        'j': (get, n, win) => get(n, win).justpressed,
        '&j': (get, n, win) => get(n, win).alljustpressed,
        'jr': (get, n, win) => get(n, win).justreleased,
        '&jr': (get, n, win) => get(n, win).alljustreleased,
        'c': (get, n, win) => get(n, win).consumed,
};

/**
 * A regular expression to match comparison operators followed by a numeric value.
 *
 * Examples:
 * - `< 10`
 * - `>= 5.5`
 * - `== 42`
 */
const NUM_RE = /^(<|>|<=|>=|==|!=)\s*(\d+(?:\.\d+)?)/;

/**
 * A regular expression to match windowed press tokens in the format `wp{number}`.
 *
 * Examples:
 * - `wp{6}`
 * - `wp{12}`
 */
const R_WP = /^wp\{(\d+)}/;

/**
 * A regular expression to match windowed release tokens in the format `wr{number}`.
 *
 * Examples:
 * - `wr{6}`
 * - `wr{12}`
 */
const R_WR = /^wr\{(\d+)}/;

/**
 * A regular expression to match time-based comparison tokens in the format `t{comparator}`.
 *
 * Examples:
 * - `t{<10}`
 * - `t{>=5}`
 */
const R_T = /^t\{([^}]+)}/;

/**
* Creates a modifier predicate function based on the given token.
*
* This function interprets the token to determine the type of modifier
* (e.g., static, windowed, or comparison-based) and returns a function
* that evaluates the modifier against the action state.
*
* @param tok - The token representing the modifier.
* @returns A function that evaluates the modifier for a given action state.
* @throws If the token is invalid or represents an unknown modifier.
*/
function makeModPred(tok: string): ModFn {
	const neg = tok.startsWith('!'); // Check if the token is negated (starts with `!`)
	const raw = neg ? tok.slice(1) : tok; // Remove the negation prefix if present
	let fn: ModFn; // Function to evaluate the modifier condition

	if (STATIC[raw]) fn = STATIC[raw]; // Check if the token is a static modifier
        else if (R_WP.test(raw)) { // Check if the token is a windowed press modifier
                const ms = +raw.match(R_WP)![1]; // Extract the window size from the token
                fn = (get, n, _) => get(n, ms).waspressed; // Return a function that checks if the action was pressed within the window
        }
        else if (R_WR.test(raw)) { // Check if the token is a windowed release modifier
                const ms = +raw.match(R_WR)![1]; // Extract the window size from the token
                fn = (get, n, _) => get(n, ms).wasreleased; // Return a function that checks if the action was released within the window
        }
        else if (R_T.test(raw)) { // Check if the token is a time-based comparison modifier
		const cmp = raw.match(R_T)![1]; // Extract the comparator from the token
		const m = cmp.match(NUM_RE); // Match the comparator against the numeric regular expression
		if (!m) throw new Error(`Invalid t{…} comparator '${cmp}'`); // Throw an error for invalid comparators
		const op = m[1]; // Extract the operator from the match
		const val = +m[2]; // Extract the numeric value from the match
		// Return a function that evaluates the time-based comparison
		fn = (get, n, win) => {
			const pt = get(n, win).presstime ?? 0;
			switch (op) {
				case '<': return pt < val;
				case '>': return pt > val;
				case '<=': return pt <= val;
				case '>=': return pt >= val;
				case '==': return pt === val;
				case '!=': default: return pt !== val;
			}
		};
	}
	else if (/^pr\{\d+}/.test(raw)) { // Check if the token is a priority modifier
		fn = _ => true; // priority placeholder
	}
	else throw new Error(`Unknown modifier '${raw}'`); // Throw an error for unknown modifiers

	// Return a function that evaluates the modifier condition,
	return neg // if the modifier is negated
		? (get, n, win) => !fn(get, n, win) // negate the result of the modifier function
		: fn; // otherwise return the modifier function as is
}

/**
 * Compiles an action definition into an evaluation function.
 *
 * This function processes the action name and its modifiers to create
 * a predicate function that evaluates whether the action is triggered
 * based on the provided state getter. It ensures that all specified
 * modifiers are satisfied for the action to be considered triggered.
 *
 * @param name - The name of the action to compile.
 * @param mods - A list of modifiers associated with the action.
 * @returns A function that evaluates the action state based on the modifiers.
 */
function compileAction(name: string, mods: string[]): EvalFn {
	// Create predicates for each modifier
	const modPreds = mods.map(makeModPred);
	// If no 'c' or '!c' modifier is present, add a predicate to check if the action is not consumed
	if (!mods.some(m => m === 'c' || m === '!c'))
		modPreds.push((get, n, win) => !get(n, win).consumed);
	// Return a function that evaluates all predicates for the action state
	return get => modPreds.every(p => p(get, name));
}

/**
 * A mapping of function helpers to their corresponding evaluation logic.
 *
 * This object defines the behavior of various function helpers used in
 * action definitions, such as logical operators (`&`, `?`) and windowed
 * functions (`&wp`, `?wp`). Each helper is associated with a function
 * that takes arguments (AST nodes) and an optional window parameter,
 * returning an evaluation function.
 *
 * @property & - Logical AND helper that evaluates to true if all arguments are true.
 * @property ? - Logical OR helper that evaluates to true if any argument is true.
 * @property &jp - Evaluates to true if all arguments are just-pressed.
 * @property ?jp - Evaluates to true if any argument is just-pressed.
 * @property ?wp - Evaluates to true if any argument was pressed within the specified window.
 * @property &wp - Evaluates to true if all arguments were pressed within the specified window.
 */
const FUN: Record<string, (args: Node[], win?: number) => EvalFn> = {
	'&': args => gs => args.every(a => a.eval(gs)), // evaluates to true if all arguments are true
	'?': args => gs => args.some(a => a.eval(gs)), // evaluates to true if any argument is true

	'&jp': args => gs => {
		if (!args.every(a => a.eval(gs))) return false;                 // all predicates true
		return args.every(a => gs((a as ActNode).name).justpressed);   // all just‑pressed
	},
	'?jp': args => gs => {
		if (!args.every(a => a.eval(gs))) return false;            // gate: all must pass modifiers first
		return args.some(a => gs((a as ActNode).name).justpressed);    // any just‑pressed
	},
	'&jr': args => gs => {
		if (!args.every(predicate => predicate.eval(gs))) return false; // gate: all pass their modifiers
		return args.every(a => gs((a as ActNode).name).justreleased);
	},
	'?jr': args => gs => {
		if (!args.every(predicate => predicate.eval(gs))) return false; // gate: all pass their modifiers
		return args.some(a => gs((a as ActNode).name).justreleased);
	},
	'?wp': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass their modifiers within window
		return args.some(a => gs((a as ActNode).name, win).waspressed);  // any was‑pressed
	},
	'&wp': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass modifiers
		return args.every(a => gs((a as ActNode).name, win).waspressed); // all were‑pressed
	},
	'?wr': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass modifiers
		return args.some(a => gs((a as ActNode).name, win).wasreleased); // any was‑released
	},
	'&wr': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass modifiers
		return args.every(a => gs((a as ActNode).name, win).wasreleased); // all were‑released
	},
};

/**
* Compiles a function helper into an evaluation function.
*
* This function maps a base function name (e.g., `&`, `?`, `&jp`, `?wp`) to its
* corresponding evaluation logic. It uses predefined helper functions to
* construct the evaluation logic based on the provided arguments and optional
* window parameter.
*
* @param base - The base function name to compile (e.g., `&`, `?`, `&jp`, `?wp`).
* @param args - The arguments to the function, represented as AST nodes.
* @param win - An optional window parameter for windowed functions.
* @returns An evaluation function that implements the logic of the specified helper.
* @throws If the base function name is unknown or unsupported.
*/
function compileFunction(base: string, args: Node[], win?: number): EvalFn {
	// Check if the base function is a valid helper
	const helper = FUN[base];
	// If not, throw an error with a list of valid function names
	if (!helper) throw new Error(`Unknown function helper '${base}', expected one of: ${Object.keys(FUN).join(', ')}`);
	// Return the evaluation function for the helper
	return helper(args, win);
}

/**
 * Parses and evaluates action definitions for input handling.
 *
 * Provides caching for parsed action definitions and exposes methods
 * to clear the cache and check if an action is triggered based on
 * the provided action definition and state getter.
 */
export class ActionParser {
	/**
	 * A static cache to store parsed action definitions.
	 * This cache improves performance by avoiding repeated parsing
	 * of the same action definition string.
	 */
	private static cache = new Map<string, Node>();

	/**
	 * Clears the static cache of parsed action definitions.
	 *
	 * This method can be called to reset the cache, which is useful
	 * when action definitions change or need to be re-evaluated.
	 */
	static clearCache() { this.cache.clear(); }

	/**
	 * Checks if an action is triggered based on the provided action definition and state getter.
	 *
	 * This method first checks the cache for a parsed AST representation of the action definition.
	 * If not found in the cache, it parses the definition and stores it in the cache.
	 * Finally, it evaluates the action definition using the provided state getter.
	 *
	 * @param def - The action definition string to check.
	 * @param get - A function that retrieves the current action state for a given input name.
	 * @returns True if the action is triggered, false otherwise.
	 */
	static checkActionTriggered(def: string,
		get: (n: string, w?: number) => ActionState): boolean {
		let ast = this.cache.get(def); // Check if the action definition is already cached
		// If not cached, parse the definition and store it in the cache
		if (!ast) { ast = Parser.parse(def); this.cache.set(def, ast); }
		// Evaluate the action definition using the provided state getter
		// This will return true if the action is triggered based on the current state (or the windowed state if applicable)
		return ast.eval(get);
	}
}
