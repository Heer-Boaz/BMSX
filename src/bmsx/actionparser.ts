import type { ActionState } from './input';

const enum T {
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
interface Tok { kind: T; value: string; }

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
function lex(src: string): Tok[] {
	const R = /\s*(\|\||&&|!|\(|\)|\[|]|,|\?jp|&jp|\?wp\{\d+}|&wp\{\d+}|[&?]|(?:t|wp|pr)\{[^}]*}|[a-zA-Z_][a-zA-Z0-9_]*|[<>!=]=?)/gy;
	const out: Tok[] = [];
	let m: RegExpExecArray | null;
	while ((m = R.exec(src)) !== null) {
		const v = m[1];
		if (v === undefined) continue;
		if (v === '||' || v === '&&' || v === '!' || v === '(' || v === ')' || v === '[' || v === ']' || v === ',') {
			out.push({ kind: T.Sym, value: v });
		} else if (/^[?&]wp\{\d+}$/.test(v)) {
			out.push({ kind: T.FuncWin, value: v });
		} else if (v === '&' || v === '?' || v === '?jp' || v === '&jp') {
			out.push({ kind: T.Func, value: v });
		} else if (/^[<>!=]=?$/.test(v)) {
			out.push({ kind: T.Cmp, value: v });
		} else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) {
			out.push({ kind: T.Ident, value: v });
		} else {
			out.push({ kind: T.ModTok, value: v });
		}
	}
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
 * @property op - The logical operator ('AND', 'OR', or 'NOT').
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
	private i = 0;

	/**
	 * Constructs a new `Parser` instance.
	 * @param t - The list of tokens to parse.
	 */
	constructor(private readonly t: Tok[]) { }

	/**
	 * Parses a source string into an AST.
	 * @param src - The source string to parse.
	 * @returns The root node of the parsed AST.
	 * @throws If the input contains unexpected tokens or is invalid.
	 */
	static parse(src: string): Node {
		const p = new Parser(lex(src));
		const ast = p.expr();
		if (p.cur()) throw new Error(`Unexpected token '${p.cur()!.value}'`);
		enforceRootModifiers(ast);
		return ast;
	}

	/**
	 * Retrieves the current token in the token stream without advancing the cursor.
	 *
	 * @returns The current token, or `undefined` if the end of the stream is reached.
	 */
	private cur() { return this.t[this.i]; }

	/**
	 * Advances the cursor in the token stream and returns the current token.
	 *
	 * @returns The token at the current cursor position before advancing.
	 */
	private eat() { return this.t[this.i++]; }

	/**
	 * Consumes the current token if it matches the specified kind and optional value.
	 *
	 * @param kind - The expected kind of the token.
	 * @param v - An optional expected value of the token.
	 * @returns The consumed token.
	 * @throws If the current token does not match the expected kind or value.
	 */
	private take(kind: T, v?: string) {
		const c = this.cur();
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
		let n = this.term();
		while (this.cur()?.value === '||') {
			this.eat();
			const r = this.term();
			const l = n;
			n = { op: 'OR', left: l, right: r, eval: g => l.eval(g) || r.eval(g) };
		}
		return n;
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
		let n = this.factor();
		while (this.cur()?.value === '&&') {
			this.eat();
			const r = this.factor();
			const l = n;
			n = { op: 'AND', left: l, right: r, eval: g => l.eval(g) && r.eval(g) };
		}
		return n;
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
		const c = this.cur();
		if (!c) throw new Error('Unexpected end of input');
		if (c.value === '!') {
			this.eat();
			const o = this.factor();
			return { op: 'NOT', left: o, eval: g => !o.eval(g) };
		}
		if (c.value === '(') {
			this.eat();
			const e = this.expr();
			this.take(T.Sym, ')');
			return e;
		}
		if (c.kind === T.Func || c.kind === T.FuncWin) return this.func();
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
		const tok = this.eat();
		let base = tok.value;
		let win: number | undefined;

		if (tok.kind === T.FuncWin) {
			const m = tok.value.match(/^([?&]wp)\{(\d+)}/)!;
			base = m[1];
			win = +m[2];
		}

		this.take(T.Sym, '(');
		const args: Node[] = [];
		if (this.cur()?.value !== ')') {
			args.push(this.expr());
			while (this.cur()?.value === ',') { this.eat(); args.push(this.expr()); }
		}
		this.take(T.Sym, ')');

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
		const name = this.take(T.Ident).value;
		const mods: string[] = [];
		if (this.cur()?.value === '[') {
			this.eat();
			while (this.cur() && this.cur()!.value !== ']') {
				const t = this.eat();
				if (t.value === '!') mods.push('!' + this.take(this.cur()!.kind).value);
				else mods.push(t.value);
			}
			this.take(T.Sym, ']');
		}
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
	const walk = (node: Node, inFun: boolean) => {
		if ((node as FunNode).fname) { (node as FunNode).args.forEach(a => walk(a, true)); return; }
		if ((node as OpNode).op) {
			const o = node as OpNode;
			if (o.left) walk(o.left, inFun);
			if (o.right) walk(o.right, inFun);
			return;
		}
		const a = node as ActNode;
		if (!inFun && a.mods.length === 0)
			throw new Error(`Root‑level action '${a.name}' must specify a modifier like '[p]'`);
	};
	walk(n, false);
}

const STATIC: Record<string, ModFn> = {
	'p': (get, n, win) => get(n, win).pressed,
	'j': (get, n, win) => get(n, win).justpressed,
	'&j': (get, n, win) => get(n, win).alljustpressed,
	'c': (get, n, win) => get(n, win).consumed,
};
const NUM_RE = /^(<|>|<=|>=|==|!=)\s*(\d+(?:\.\d+)?)/;
const R_WP = /^wp\{(\d+)}/;
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
	const neg = tok.startsWith('!');
	const raw = neg ? tok.slice(1) : tok;
	let fn: ModFn;

	if (STATIC[raw]) fn = STATIC[raw];
	else if (R_WP.test(raw)) {
		const ms = +raw.match(R_WP)![1];
		fn = (get, n, _) => get(n, ms).waspressed;
	}
	else if (R_T.test(raw)) {
		const cmp = raw.match(R_T)![1];
		const m = cmp.match(NUM_RE);
		if (!m) throw new Error(`Invalid t{…} comparator '${cmp}'`);
		const op = m[1];
		const val = +m[2];
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
	else if (/^pr\{\d+}/.test(raw)) {
		fn = _ => true; // priority placeholder
	}
	else throw new Error(`Unknown modifier '${raw}'`);

	return neg
		? (get, n, win) => !fn(get, n, win)
		: fn;
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

/* -------------------------------- Function helpers ------------------------ */

const FUN: Record<string, (args: Node[], win?: number) => EvalFn> = {
	// Generic ALL / ANY helpers – these keep their original semantics
	'&': args => gs => args.every(a => a.eval(gs)),
	'?': args => gs => args.some(a => a.eval(gs)),

	/* ──────────────── just‑pressed helpers ──────────────── */
	'&jp': args => gs => {
		if (!args.every(a => a.eval(gs))) return false;                 // all predicates true
		return args.every(a => gs((a as ActNode).name).justpressed);   // *** all just‑pressed ***
	},
	'?jp': args => gs => {
		if (!args.every(a => a.eval(gs))) return false;                 // gate: all must pass modifiers first
		return args.some(a => gs((a as ActNode).name).justpressed);    // any just‑pressed
	},

	/* ──────────────── was‑pressed‑within‑window helpers ──────────────── */
	'?wp': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass their modifiers within window
		return args.some(a => gs((a as ActNode).name, win).waspressed);  // any was‑pressed
	},
	'&wp': (args, win) => gs => {
		if (!args.every(a => a.eval((n, _) => gs(n, win)))) return false; // gate: all pass modifiers
		return args.every(a => gs((a as ActNode).name, win).waspressed); // all were‑pressed
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
	const h = FUN[base];
	if (!h) throw new Error(`Unknown function helper '${base}', expected one of: ${Object.keys(FUN).join(', ')}`);
	return h(args, win);
}

/**
 * Parses and evaluates action definitions for input handling.
 *
 * Provides caching for parsed action definitions and exposes methods
 * to clear the cache and check if an action is triggered based on
 * the provided action definition and state getter.
 */
export class ActionParser {
	private static cache = new Map<string, Node>();
	static clearCache() { this.cache.clear(); }

	static checkActionTriggered(def: string,
		get: (n: string, w?: number) => ActionState): boolean {
		let ast = this.cache.get(def);
		if (!ast) { ast = Parser.parse(def); this.cache.set(def, ast); }
		return ast.eval(get);
	}
}
