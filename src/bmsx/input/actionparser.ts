import type { ActionState } from './inputtypes';

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

function tokenToString(t: Tokens): string {
	switch (t) {
		case Tokens.Sym: return 'Symbol';
		case Tokens.Ident: return 'Identifier';
		case Tokens.FuncWin: return 'FuncWin';
		case Tokens.Func: return 'Func';
		case Tokens.ModTok: return 'ModTok';
		case Tokens.Cmp: return 'Cmp';
		default: return 'Unknown';
	}
}

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
	const R = /\s*(\|\||&&|\||!|\(|\)|\[|]|,|\?jp|&jp|\?gp|&gp|\?rp|&rp|\?wp\{\d+}|&wp\{\d+}|\?jr|&jr|\?wr\{\d+}|&wr\{\d+}|[&?]|(?:t|wp|wr|pr|rc)\{[^}]*}|[a-zA-Z_][a-zA-Z0-9_]*|[<>!=]=?)/gy;
	const out: Token[] = []; // Array to hold the parsed tokens
	let m: RegExpExecArray; // Regular expression to match tokens in the input string
	while ((m = R.exec(src)) !== null) {
		const v = m[1]; // Extract the matched token value
		// If the token value is undefined, skip to the next iteration
		if (v === undefined) continue;
		// Classify the token based on its value and add it to the output array
		if (v === '||' || v === '&&' || v === '|' || v === '!' || v === '(' || v === ')' || v === '[' || v === ']' || v === ',') {
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
interface ActNode extends NodeBase {
	name: string;
	mods: string[];
	_edgeForJP: boolean; // positive press-like
	_edgeForJR: boolean; // positive release-like
	_edgeForWP: boolean; // positive press-like (same as JP)
	_edgeForWR: boolean; // positive release-like (same as JR)
	_edgeForGP: boolean;
	_edgeForRP: boolean;
}

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
class InputActionParser {
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
		const parser = new InputActionParser(lex(src));
		const ast = parser.expr();
		if (parser.current()) throw new Error(`[Action Parser] Unexpected token '${parser.current()!.value}' in input expression "${src}"`);
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
		if (!c || c.kind !== kind || (v && c.value !== v)) throw new Error(`[Action Parser] Unexpected token ${c?.value ?? '<eos>'} (expected ${tokenToString(kind)}${v ? ` '${v}'` : ''})`);
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
		while (this.isOrOperator(this.current()?.value)) {
			this.eat();
			const r = this.term(); // Parse the right-hand side of the OR operation
			const l = n; // Store the left-hand side of the OR operation
			// Create a new OpNode for the OR operation
			n = { op: 'OR', left: l, right: r, eval: g => l.eval(g) || r.eval(g) };
		}
		return n; // Return the constructed expression node
	}

	private isOrOperator(value: string): boolean {
		return value === '||' || value === '|';
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
		while (this.isAndOperator(this.current()?.value)) {
			this.eat();
			const r = this.factor(); // Parse the right-hand side of the AND operation
			const l = n; // Store the left-hand side of the AND operation
			// Create a new OpNode for the AND operation
			n = { op: 'AND', left: l, right: r, eval: g => l.eval(g) && r.eval(g) };
		}
		return n; // Return the constructed term node
	}

	private isAndOperator(value: string): boolean {
		return value === '&&';
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
		if (!c) throw new Error('[Action Parser] Unexpected end of input while parsing factor');
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
		if (this.current()?.value === '[') {
			const mods = this.parseModifierList();
			this.applyModifiersInPlace(e, mods);
		}
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
		let win: number;

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
		return { fname: base, args, window: win, eval: compileFunction(base, args, win) };
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
	const mods = this.current()?.value === '[' ? this.parseModifierList() : [];

	const node = { name, mods, _edgeForJP: false, _edgeForJR: false, _edgeForWP: false, _edgeForWR: false, _edgeForGP: false, _edgeForRP: false };
	this.annotateActNode(node);
	// Return an ActNode representing the parsed action
	return { ...node, eval: compileAction(name, mods) };
}

	private parseModifierList(): string[] {
		const mods: string[] = [];
		this.take(Tokens.Sym, '[');
		while (this.current() && this.current()!.value !== ']') {
			const t = this.eat();
			if (t.value === ',') continue;
			if (t.value === '!') {
				const next = this.take(this.current()?.kind ?? Tokens.Ident);
				mods.push(`!${next.value}`);
				continue;
			}
			mods.push(t.value);
		}
		this.take(Tokens.Sym, ']');
		return mods;
	}

	private annotateActNode(n: Partial<ActNode>) {
		// empty mods = implicit press-positive
		if (n.mods.length === 0) {
			n._edgeForJP = n._edgeForWP = n._edgeForGP = n._edgeForRP = true;
			n._edgeForJR = n._edgeForWR = false;
			return;
		}
		let pressPos = false;
		let releasePos = false;
		let guardPos = false;
		let repeatPos = false;
		let guardExplicit = false;
		let repeatExplicit = false;
		for (const m of n.mods) {
			const neg = m.startsWith('!');
			const raw = neg ? m.slice(1) : m;
			if (raw === 'gp') {
				guardExplicit = true;
				if (!neg) guardPos = true;
				continue;
			}
			if (raw === 'rp') {
				repeatExplicit = true;
				if (!neg) repeatPos = true;
				continue;
			}
			const pressish = raw === 'p' || raw === 'j' || /^wp\{\d+}/.test(raw);
			const releaseish = raw === 'jr' || /^wr\{\d+}/.test(raw);
			if (pressish && !neg) pressPos = true;
			if (releaseish && !neg) releasePos = true;
		}
		if (!guardExplicit) guardPos = pressPos;
		if (!repeatExplicit) repeatPos = pressPos;
		n._edgeForJP = n._edgeForWP = pressPos;
		n._edgeForJR = n._edgeForWR = releasePos;
		n._edgeForGP = guardPos;
		n._edgeForRP = repeatPos;
	}

	private applyModifiersInPlace(node: Node, mods: string[]): void {
		if (!mods.length) return;
		if ((node as ActNode).name !== undefined) {
			const act = node as ActNode;
			act.mods.push(...mods);
			this.annotateActNode(act);
			act.eval = compileAction(act.name, act.mods);
			return;
		}
		if ((node as OpNode).op) {
			const op = node as OpNode;
			if (op.left) this.applyModifiersInPlace(op.left, mods);
			if (op.right) this.applyModifiersInPlace(op.right, mods);
			return;
		}
		const fn = node as FunNode;
		for (const arg of fn.args) this.applyModifiersInPlace(arg, mods);
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
			throw new Error(`[Action Parser] Root-level action '${a.name}' must specify a modifier like '[p]', but none found in compiled AST.`);
	};
	// Start walking the AST from the root node
	walk(n, false);
}

type EvalResult = { truth: boolean; leaves: ActNode[] };

function evalAndCollect(node: Node, gs: GetterFn, win?: number, out?: ActNode[]): EvalResult {
	const leaves = out ?? []; // allow reuse of a scratch array

	if ((node as ActNode).name !== undefined) {
		const ok = node.eval(gs); // uses compileAction predicates
		if (ok) leaves.push(node as ActNode);
		return { truth: ok, leaves };
	}

	if ((node as OpNode).op) {
		const o = node as OpNode;
		if (o.op === 'NOT') {
			const r = evalAndCollect(o.left!, gs, win);
			return { truth: !r.truth, leaves }; // guards only; do not carry leaves
		}
		if (o.op === 'AND') {
			const l = evalAndCollect(o.left!, gs, win, leaves);
			if (!l.truth) return { truth: false, leaves };
			const r = evalAndCollect(o.right!, gs, win, leaves);
			return { truth: r.truth, leaves };
		}
		// OR with short-circuit
		const l = evalAndCollect(o.left!, gs, win);
		if (l.truth) return { truth: true, leaves: l.leaves };
		const r = evalAndCollect(o.right!, gs, win);
		return { truth: r.truth, leaves: r.leaves };
	}

	const f = node as FunNode;
	if (f.fname === '&') {
		let all = true;
		const acc = out ?? [];
		for (const a of f.args) {
			const r = evalAndCollect(a, gs, win, acc);
			if (!r.truth) { all = false; break; }
		}
		return { truth: all, leaves: all ? acc : (out ?? []) };
	}
	if (f.fname === '?') {
		for (const a of f.args) {
			const r = evalAndCollect(a, gs, win);
			if (r.truth) return r; // first winning branch
		}
		return { truth: false, leaves: out ?? [] };
	}

	// For jp/jr/wp/wr, evaluate in helper using evalAndCollect again with proper window
	return { truth: node.eval(gs), leaves: out ?? [] };
}

/**
 * A mapping of static modifiers to their corresponding evaluation functions.
 *
 * This object defines the behavior of static modifiers used in action definitions,
 * such as `p` (pressed), `j` (just-pressed), `jr` (just-released),
 * `&j` (all-just-pressed), `&jr` (all-just-released), and `c` (consumed).
 * Added: `h` (hold) which is equivalent to a press time comparator `t{>1}`.
 * Each modifier is associated with a function that evaluates the modifier condition
 * for a given action state.
 *
 * @property p - Evaluates to true if the action is currently pressed.
 * @property r - Evaluates to true if the action is currently not pressed (released).
 * @property j - Evaluates to true if the action was just pressed.
 * @property &j - Evaluates to true if all actions are just pressed.
 * @property jr - Evaluates to true if the action was just released.
 * @property &jr - Evaluates to true if all actions are just released.
 * @property c - Evaluates to true if the action is consumed.
 * @property h - Evaluates to true if the action has been held (presstime >= 1 frame).
 */
const STATIC: Record<string, ModFn> = {
	'p': (get, n, win) => get(n, win).pressed,
	'r': (get, n, win) => !get(n, win).pressed,
	'j': (get, n, win) => get(n, win).justpressed,
	'&j': (get, n, win) => get(n, win).alljustpressed,
	'jr': (get, n, win) => get(n, win).justreleased,
	'&jr': (get, n, win) => get(n, win).alljustreleased,
	'gp': (get, n, win) => get(n, win).guardedjustpressed === true,
	'rp': (get, n, win) => get(n, win).repeatpressed === true,
	'c': (get, n, win) => get(n, win).consumed,
	// 'h' (hold) == held for more than 1 frame (equivalent to t{>=1})
	'h': (get, n, win) => (get(n, win).presstime ?? 0) >= 1,
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
 * A regular expression to match repeat-count comparison tokens in the format `rc{comparator}`.
 *
 * Examples:
 * - `rc{>2}`
 * - `rc{==0}`
 */
const R_RC = /^rc\{([^}]+)}/;

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
			// Accept either a full comparator expression (e.g. ">=10") OR a shorthand number (e.g. "10" == ">=10").
			const cmpRaw = raw.match(R_T)![1].trim(); // content inside t{...}
			let op: string; let val: number;
			const m = cmpRaw.match(NUM_RE);
			if (m) { // standard comparator form
				op = m[1];
				val = +m[2];
			} else {
				// Shorthand: just a number => treat as ">= number"
				const numOnly = cmpRaw.match(/^\d+(?:\.\d+)?$/);
				if (!numOnly) throw new Error(`Invalid t{…} comparator '${cmpRaw}'`);
				op = '>='; val = +cmpRaw;
			}
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
	else if (R_RC.test(raw)) {
			const cmpRaw = raw.match(R_RC)![1].trim();
			let op: string; let val: number;
			const m = cmpRaw.match(NUM_RE);
			if (m) {
				op = m[1];
				val = +m[2];
			} else {
				const numOnly = cmpRaw.match(/^\d+(?:\.\d+)?$/);
				if (!numOnly) throw new Error(`Invalid rc{…} comparator '${cmpRaw}'`);
				op = '>='; val = +cmpRaw;
			}
			fn = (get, n, win) => {
				const count = get(n, win).repeatcount ?? 0;
				switch (op) {
					case '<': return count < val;
					case '>': return count > val;
					case '<=': return count <= val;
					case '>=': return count >= val;
					case '==': return count === val;
					case '!=': default: return count !== val;
				}
			};
	}
	else if (/^pr\{\d+}/.test(raw)) { // Check if the token is a priority modifier
		fn = _ => true; // priority placeholder
	}
	else throw new Error(`[Action Parser] Unknown modifier '${raw}' while creating modifier predicate.`); // Throw an error for unknown modifiers

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
	// Plain logical helpers (no edge semantics, no window)
	'&': (args) => (gs) => {
		for (let i = 0; i < args.length; i++) {
			if (!args[i].eval(gs)) return false;
		}
		return true;
	},

	'?': (args) => (gs) => {
		for (let i = 0; i < args.length; i++) {
			if (args[i].eval(gs)) return true;
		}
		return false;
	},

	// --- Just-pressed (edge from positive press-like leaves) ---

	'?jp': (args) => (gs) => {
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) continue;
			any = true;
			// At least one eligible contributing leaf is just-pressed
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForJP && gs(a.name).justpressed) return true;
			}
		}
		return false && any; // if no eligible leaf matched
	},

	'&jp': (args) => (gs) => {
		// All args must be true, and for each arg, all eligible contributing leaves are just-pressed.
		// (Switch to 'some' if you prefer permissive chords.)
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForJP) {
					hasEligible = true;
					if (!gs(a.name).justpressed) return false;
				}
			}
			if (!hasEligible) return false; // require at least one eligible leaf per arg
		}
		return true;
	},

	// --- Guarded press (edge requiring guard acceptance) ---

	'?gp': (args) => (gs) => {
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) continue;
			any = true;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForGP && gs(a.name).guardedjustpressed === true) return true;
			}
		}
		return false && any;
	},

	'&gp': (args) => (gs) => {
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForGP) {
					hasEligible = true;
					if (gs(a.name).guardedjustpressed !== true) return false;
				}
			}
			if (!hasEligible) return false;
		}
		return true;
	},

	// --- Repeat press pulses (edge from repeat handler) ---

	'?rp': (args) => (gs) => {
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) continue;
			any = true;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForRP && gs(a.name).repeatpressed === true) return true;
			}
		}
		return false && any;
	},

	'&rp': (args) => (gs) => {
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForRP) {
					hasEligible = true;
					if (gs(a.name).repeatpressed !== true) return false;
				}
			}
			if (!hasEligible) return false;
		}
		return true;
	},

	// --- Just-released (edge from positive release-like leaves) ---

	'?jr': (args) => (gs) => {
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) continue;
			any = true;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForJR && gs(a.name).justreleased) return true;
			}
		}
		return false && any;
	},

	'&jr': (args) => (gs) => {
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], gs, /*win*/ undefined, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForJR) {
					hasEligible = true;
					if (!gs(a.name).justreleased) return false;
				}
			}
			if (!hasEligible) return false;
		}
		return true;
	},

	// --- Windowed press (edge from positive press-like leaves within 'win') ---

	'?wp': (args, win) => (gs) => {
		const g = (n: string, w?: number) => gs(n, win ?? w);
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], g, win, []);
			if (!truth) continue;
			any = true;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForWP && g(a.name, win).waspressed) return true;
			}
		}
		return false && any;
	},

	'&wp': (args, win) => (gs) => {
		const g = (n: string, w?: number) => gs(n, win ?? w);
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], g, win, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForWP) {
					hasEligible = true;
					if (!g(a.name, win).waspressed) return false; // strict: all eligible leaves inside arg within window
				}
			}
			if (!hasEligible) return false;
		}
		return true;
	},

	// --- Windowed release (edge from positive release-like leaves within 'win') ---

	'?wr': (args, win) => (gs) => {
		const g = (n: string, w?: number) => gs(n, win ?? w);
		let any = false;
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], g, win, []);
			if (!truth) continue;
			any = true;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForWR && g(a.name, win).wasreleased) return true;
			}
		}
		return false && any;
	},

	'&wr': (args, win) => (gs) => {
		const g = (n: string, w?: number) => gs(n, win ?? w);
		for (let i = 0; i < args.length; i++) {
			const { truth, leaves } = evalAndCollect(args[i], g, win, []);
			if (!truth) return false;
			let hasEligible = false;
			for (let j = 0; j < leaves.length; j++) {
				const a = leaves[j] as ActNode;
				if (a._edgeForWR) {
					hasEligible = true;
					if (!g(a.name, win).wasreleased) return false;
				}
			}
			if (!hasEligible) return false;
		}
		return true;
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
	if (!helper) throw new Error(`[Action Parser] Unknown function helper '${base}', expected one of: ${Object.keys(FUN).join(', ')} and variants with {n} window (now: "${win ?? 0}").`);
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
export class ActionDefinitionEvaluator {
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
		if (!ast) { ast = InputActionParser.parse(def); this.cache.set(def, ast); }
		// Evaluate the action definition using the provided state getter
		// This will return true if the action is triggered based on the current state (or the windowed state if applicable)
		return ast.eval(get);
	}

	/**
	 * Return all action names referenced by the given action definition string.
	 * Uses the parser (cached) and traverses the AST collecting ActNode names.
	 */
	static getReferencedActions(def: string): string[] {
		let ast = this.cache.get(def);
		if (!ast) { ast = InputActionParser.parse(def); this.cache.set(def, ast); }
		const out = new Set<string>();
		const walk = (n: Node) => {
			if ((n as ActNode).name !== undefined) {
				out.add((n as ActNode).name);
				return;
			}
			if ((n as FunNode).fname !== undefined) {
				for (const a of (n as FunNode).args) walk(a);
				return;
			}
			if ((n as OpNode).op !== undefined) {
				if ((n as OpNode).left) walk((n as OpNode).left!);
				if ((n as OpNode).right) walk((n as OpNode).right!);
				return;
			}
		};
		walk(ast);
		return Array.from(out);
	}
}
