import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaBlock,
	type LuaCallExpression,
	type LuaDoStatement,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaForNumericStatement,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaIfStatement,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaRepeatStatement,
	type LuaSourceRange,
	type LuaStatement,
	type LuaWhileStatement,
} from '../lua/syntax/lua_ast';
import type { LuaSemanticFrontend, LuaSemanticFrontendFile } from '../ide/contrib/intellisense/lua_semantic_frontend';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type CompileValueKind =
	| 'unknown'
	| 'nil'
	| 'boolean'
	| 'number'
	| 'string'
	| 'string_ref';

/**
 * Immutable snapshot of the proven compile-time value kind for each tracked
 * symbol at a specific program point.  Keyed by semantic symbol-handle.
 */
export type SymbolFlowState = ReadonlyMap<string, CompileValueKind>;

type MutableFlowState = Map<string, CompileValueKind>;

// ---------------------------------------------------------------------------
//  State helpers
// ---------------------------------------------------------------------------

function cloneState(state: SymbolFlowState): MutableFlowState {
	return new Map(state);
}

function freezeState(state: MutableFlowState): SymbolFlowState {
	return state as SymbolFlowState;
}

/**
 * Merge two flow states.  Only symbols present in *both* states survive.
 * If both agree on the kind the kind is kept; otherwise the result is
 * `'unknown'`.
 */
function mergeStates(a: SymbolFlowState, b: SymbolFlowState): MutableFlowState {
	const result: MutableFlowState = new Map();
	for (const [handle, kindA] of a) {
		const kindB = b.get(handle);
		if (kindB === undefined) continue;
		result.set(handle, kindA === kindB ? kindA : 'unknown');
	}
	return result;
}

function mergeMultipleStates(states: ReadonlyArray<SymbolFlowState>): MutableFlowState {
	if (states.length === 0) return new Map();
	let merged = cloneState(states[0]);
	for (let i = 1; i < states.length; i += 1) {
		merged = mergeStates(merged, states[i]);
	}
	return merged;
}

function statesEqual(a: SymbolFlowState, b: SymbolFlowState): boolean {
	if (a.size !== b.size) return false;
	for (const [handle, kind] of a) {
		if (b.get(handle) !== kind) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
//  Expression-kind evaluator  (state-aware, recursive)
// ---------------------------------------------------------------------------

export function evaluateExpressionValueKind(
	expression: LuaExpression,
	state: SymbolFlowState,
	semantics: LuaSemanticFrontendFile,
): CompileValueKind {
	switch (expression.kind) {
		case LuaSyntaxKind.StringRefLiteralExpression:
			return 'string_ref';
		case LuaSyntaxKind.StringLiteralExpression:
			return 'string';
		case LuaSyntaxKind.NumericLiteralExpression:
			return 'number';
		case LuaSyntaxKind.BooleanLiteralExpression:
			return 'boolean';
		case LuaSyntaxKind.NilLiteralExpression:
			return 'nil';
		case LuaSyntaxKind.IdentifierExpression: {
			const handle = resolveIdentifierHandle(expression as LuaIdentifierExpression, semantics);
			if (handle === undefined) return 'unknown';
			return state.get(handle) ?? 'unknown';
		}
		case LuaSyntaxKind.BinaryExpression: {
			const binary = expression as LuaBinaryExpression;
			if (binary.operator === LuaBinaryOperator.And || binary.operator === LuaBinaryOperator.Or) {
				const leftKind = evaluateExpressionValueKind(binary.left, state, semantics);
				const rightKind = evaluateExpressionValueKind(binary.right, state, semantics);
				return leftKind === rightKind ? leftKind : 'unknown';
			}
			return 'unknown';
		}
		default:
			return 'unknown';
	}
}

// ---------------------------------------------------------------------------
//  Identifier → symbol-handle resolution
// ---------------------------------------------------------------------------

function resolveIdentifierHandle(
	expression: LuaIdentifierExpression,
	semantics: LuaSemanticFrontendFile,
): string | undefined {
	const ref = semantics.getReference(expression.range);
	if (ref) {
		if (ref.kind !== 'lexical') return undefined;
		return ref.decl.id;
	}
	const decl = semantics.getDeclaration(expression.range);
	if (decl && !decl.isGlobal) return decl.id;
	return undefined;
}

// ---------------------------------------------------------------------------
//  Closure-written symbol detection
// ---------------------------------------------------------------------------

/**
 * Returns the set of symbol-handles that are written from inside a nested
 * `FunctionExpression` body within the given statement list.  These are the
 * locals whose value could be mutated by an arbitrary function call.
 */
function computeClosureWrittenSymbols(
	body: ReadonlyArray<LuaStatement>,
	semantics: LuaSemanticFrontendFile,
	frontend: LuaSemanticFrontend,
): Set<string> {
	const nestedBodyRanges: LuaSourceRange[] = [];
	collectNestedFunctionBodyRanges(body, nestedBodyRanges);
	if (nestedBodyRanges.length === 0) return new Set();

	const result = new Set<string>();
	const visitedSymbols = new Set<string>();

	// Walk the direct body to collect all locally-declared symbol handles.
	collectDeclaredSymbols(body, semantics, visitedSymbols);

	for (const handle of visitedSymbols) {
		const refs = frontend.getReferences(handle);
		for (let i = 0; i < refs.length; i += 1) {
			const ref = refs[i];
			if (!ref.isWrite) continue;
			if (isRangeInsideAny(ref.range, nestedBodyRanges)) {
				result.add(handle);
				break;
			}
		}
	}
	return result;
}

function collectDeclaredSymbols(
	body: ReadonlyArray<LuaStatement>,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	for (let i = 0; i < body.length; i += 1) {
		const stmt = body[i];
		switch (stmt.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const local = stmt as LuaLocalAssignmentStatement;
				for (let j = 0; j < local.names.length; j += 1) {
					const decl = semantics.getDeclaration(local.names[j].range);
					if (decl && !decl.isGlobal) out.add(decl.id);
				}
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const fn = stmt as LuaLocalFunctionStatement;
				const decl = semantics.getDeclaration(fn.name.range);
				if (decl && !decl.isGlobal) out.add(decl.id);
				break;
			}
			case LuaSyntaxKind.IfStatement:
				for (const clause of (stmt as LuaIfStatement).clauses) {
					collectDeclaredSymbols(clause.block.body, semantics, out);
				}
				break;
			case LuaSyntaxKind.WhileStatement:
				collectDeclaredSymbols((stmt as LuaWhileStatement).block.body, semantics, out);
				break;
			case LuaSyntaxKind.RepeatStatement:
				collectDeclaredSymbols((stmt as LuaRepeatStatement).block.body, semantics, out);
				break;
			case LuaSyntaxKind.ForNumericStatement:
				collectDeclaredSymbols((stmt as LuaForNumericStatement).block.body, semantics, out);
				break;
			case LuaSyntaxKind.ForGenericStatement:
				collectDeclaredSymbols((stmt as LuaForGenericStatement).block.body, semantics, out);
				break;
			case LuaSyntaxKind.DoStatement:
				collectDeclaredSymbols((stmt as LuaDoStatement).block.body, semantics, out);
				break;
		}
	}
}

function collectNestedFunctionBodyRanges(
	body: ReadonlyArray<LuaStatement>,
	out: LuaSourceRange[],
): void {
	for (let i = 0; i < body.length; i += 1) {
		collectNestedFunctionBodyRangesFromStatement(body[i], out);
	}
}

function collectNestedFunctionBodyRangesFromStatement(
	stmt: LuaStatement,
	out: LuaSourceRange[],
): void {
	switch (stmt.kind) {
		case LuaSyntaxKind.LocalAssignmentStatement: {
			const local = stmt as LuaLocalAssignmentStatement;
			for (let i = 0; i < local.values.length; i += 1) {
				collectNestedFunctionBodyRangesFromExpression(local.values[i], out);
			}
			break;
		}
		case LuaSyntaxKind.AssignmentStatement: {
			const assign = stmt as LuaAssignmentStatement;
			for (let i = 0; i < assign.right.length; i += 1) {
				collectNestedFunctionBodyRangesFromExpression(assign.right[i], out);
			}
			break;
		}
		case LuaSyntaxKind.LocalFunctionStatement: {
			const fn = (stmt as LuaLocalFunctionStatement).functionExpression;
			out.push(fn.body.range);
			break;
		}
		case LuaSyntaxKind.IfStatement:
			for (const clause of (stmt as LuaIfStatement).clauses) {
				collectNestedFunctionBodyRanges(clause.block.body, out);
			}
			break;
		case LuaSyntaxKind.WhileStatement:
			collectNestedFunctionBodyRanges((stmt as LuaWhileStatement).block.body, out);
			break;
		case LuaSyntaxKind.RepeatStatement:
			collectNestedFunctionBodyRanges((stmt as LuaRepeatStatement).block.body, out);
			break;
		case LuaSyntaxKind.ForNumericStatement:
			collectNestedFunctionBodyRanges((stmt as LuaForNumericStatement).block.body, out);
			break;
		case LuaSyntaxKind.ForGenericStatement:
			collectNestedFunctionBodyRanges((stmt as LuaForGenericStatement).block.body, out);
			break;
		case LuaSyntaxKind.DoStatement:
			collectNestedFunctionBodyRanges((stmt as LuaDoStatement).block.body, out);
			break;
		default:
			break;
	}
}

function collectNestedFunctionBodyRangesFromExpression(
	expr: LuaExpression,
	out: LuaSourceRange[],
): void {
	if (expr.kind === LuaSyntaxKind.FunctionExpression) {
		out.push((expr as LuaFunctionExpression).body.range);
		return;
	}
	if (expr.kind === LuaSyntaxKind.CallExpression) {
		const call = expr as LuaCallExpression;
		collectNestedFunctionBodyRangesFromExpression(call.callee, out);
		for (let i = 0; i < call.arguments.length; i += 1) {
			collectNestedFunctionBodyRangesFromExpression(call.arguments[i], out);
		}
	}
}

function isRangeInsideAny(range: LuaSourceRange, containers: ReadonlyArray<LuaSourceRange>): boolean {
	for (let i = 0; i < containers.length; i += 1) {
		if (isRangeInside(range, containers[i])) return true;
	}
	return false;
}

function isRangeInside(inner: LuaSourceRange, outer: LuaSourceRange): boolean {
	if (inner.path !== outer.path) return false;
	if (inner.start.line < outer.start.line) return false;
	if (inner.start.line === outer.start.line && inner.start.column < outer.start.column) return false;
	if (inner.end.line > outer.end.line) return false;
	if (inner.end.line === outer.end.line && inner.end.column > outer.end.column) return false;
	return true;
}

// ---------------------------------------------------------------------------
//  Multi-return detection (lightweight, only for flow analysis)
// ---------------------------------------------------------------------------

function isMultiReturnExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.CallExpression
		|| expression.kind === LuaSyntaxKind.VarargExpression;
}

// ---------------------------------------------------------------------------
//  Flow analyzer
// ---------------------------------------------------------------------------

const MAX_FIXPOINT_ITERATIONS = 4;

export class ValueKindFlowAnalyzer {
	private readonly semantics: LuaSemanticFrontendFile;
	private readonly closureWrittenSymbols: Set<string>;
	private readonly stateAtStatement = new Map<LuaStatement, SymbolFlowState>();
	private state: MutableFlowState = new Map();

	constructor(
		body: ReadonlyArray<LuaStatement>,
		semantics: LuaSemanticFrontendFile,
		frontend: LuaSemanticFrontend,
	) {
		this.semantics = semantics;
		this.closureWrittenSymbols = computeClosureWrittenSymbols(body, semantics, frontend);
		this.analyzeStatementList(body);
	}

	getFlowStateAt(statement: LuaStatement): SymbolFlowState {
		return this.stateAtStatement.get(statement) ?? this.state;
	}

	// -----------------------------------------------------------------------
	//  Statement-list traversal
	// -----------------------------------------------------------------------

	private analyzeStatementList(statements: ReadonlyArray<LuaStatement>): void {
		for (let i = 0; i < statements.length; i += 1) {
			this.stateAtStatement.set(statements[i], freezeState(cloneState(this.state)));
			this.analyzeStatement(statements[i]);
		}
	}

	// -----------------------------------------------------------------------
	//  Individual statement analysis
	// -----------------------------------------------------------------------

	private analyzeStatement(stmt: LuaStatement): void {
		switch (stmt.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				this.analyzeLocalAssignment(stmt as LuaLocalAssignmentStatement);
				return;
			case LuaSyntaxKind.AssignmentStatement:
				this.analyzeAssignment(stmt as LuaAssignmentStatement);
				return;
			case LuaSyntaxKind.IfStatement:
				this.analyzeIf(stmt as LuaIfStatement);
				return;
			case LuaSyntaxKind.WhileStatement:
				this.analyzeWhile(stmt as LuaWhileStatement);
				return;
			case LuaSyntaxKind.RepeatStatement:
				this.analyzeRepeat(stmt as LuaRepeatStatement);
				return;
			case LuaSyntaxKind.ForNumericStatement:
				this.analyzeForNumeric(stmt as LuaForNumericStatement);
				return;
			case LuaSyntaxKind.ForGenericStatement:
				this.analyzeForGeneric(stmt as LuaForGenericStatement);
				return;
			case LuaSyntaxKind.DoStatement:
				this.analyzeStatementList((stmt as LuaDoStatement).block.body);
				return;
			case LuaSyntaxKind.CallStatement:
				this.degradeClosureWrittenSymbols();
				return;
			default:
				return;
		}
	}

	// -----------------------------------------------------------------------
	//  Local declarations
	// -----------------------------------------------------------------------

	private analyzeLocalAssignment(stmt: LuaLocalAssignmentStatement): void {
		const names = stmt.names;
		const values = stmt.values;
		const lastIndex = values.length - 1;

		for (let i = 0; i < names.length; i += 1) {
			const handle = this.resolveDeclarationHandle(names[i]);
			if (handle === undefined) continue;

			let kind: CompileValueKind;
			if (values.length === 0) {
				kind = 'nil';
			} else if (i < lastIndex) {
				kind = this.evalExprKind(values[i]);
			} else if (i === lastIndex) {
				const remaining = names.length - lastIndex;
				if (remaining > 1 && isMultiReturnExpression(values[lastIndex])) {
					kind = 'unknown';
				} else {
					kind = this.evalExprKind(values[lastIndex]);
				}
			} else if (i > lastIndex && isMultiReturnExpression(values[lastIndex])) {
				kind = 'unknown';
			} else {
				kind = 'nil';
			}
			this.state.set(handle, kind);
		}
	}

	// -----------------------------------------------------------------------
	//  Assignments
	// -----------------------------------------------------------------------

	private analyzeAssignment(stmt: LuaAssignmentStatement): void {
		if (stmt.operator !== LuaAssignmentOperator.Assign) {
			for (let i = 0; i < stmt.left.length; i += 1) {
				this.degradeLocalTarget(stmt.left[i]);
			}
			return;
		}
		const lastIndex = stmt.right.length - 1;
		for (let i = 0; i < stmt.left.length; i += 1) {
			const target = stmt.left[i];
			if (target.kind !== LuaSyntaxKind.IdentifierExpression) continue;
			const handle = this.resolveReferenceHandle(target as LuaIdentifierExpression);
			if (handle === undefined || !this.state.has(handle)) continue;

			let kind: CompileValueKind;
			if (stmt.right.length === 0) {
				kind = 'nil';
			} else if (i < lastIndex) {
				kind = this.evalExprKind(stmt.right[i]);
			} else if (i === lastIndex) {
				const remaining = stmt.left.length - lastIndex;
				if (remaining > 1 && isMultiReturnExpression(stmt.right[lastIndex])) {
					kind = 'unknown';
				} else {
					kind = this.evalExprKind(stmt.right[lastIndex]);
				}
			} else if (i > lastIndex && isMultiReturnExpression(stmt.right[lastIndex])) {
				kind = 'unknown';
			} else {
				kind = 'nil';
			}
			this.state.set(handle, kind);
		}
	}

	private degradeLocalTarget(expr: LuaExpression): void {
		if (expr.kind !== LuaSyntaxKind.IdentifierExpression) return;
		const handle = this.resolveReferenceHandle(expr as LuaIdentifierExpression);
		if (handle !== undefined && this.state.has(handle)) {
			this.state.set(handle, 'unknown');
		}
	}

	// -----------------------------------------------------------------------
	//  Control flow: if / elseif / else
	// -----------------------------------------------------------------------

	private analyzeIf(stmt: LuaIfStatement): void {
		const preIfState = freezeState(cloneState(this.state));
		const branchExitStates: SymbolFlowState[] = [];
		let hasElse = false;

		for (let i = 0; i < stmt.clauses.length; i += 1) {
			const clause = stmt.clauses[i];
			this.state = cloneState(preIfState);
			this.analyzeStatementList(clause.block.body);
			branchExitStates.push(freezeState(cloneState(this.state)));
			if (!clause.condition) {
				hasElse = true;
			}
		}

		if (!hasElse) {
			branchExitStates.push(preIfState);
		}

		this.state = mergeMultipleStates(branchExitStates);
	}

	// -----------------------------------------------------------------------
	//  Control flow: while
	// -----------------------------------------------------------------------

	private analyzeWhile(stmt: LuaWhileStatement): void {
		this.analyzeLoopBody(stmt.block);
	}

	// -----------------------------------------------------------------------
	//  Control flow: repeat..until
	// -----------------------------------------------------------------------

	private analyzeRepeat(stmt: LuaRepeatStatement): void {
		this.analyzeLoopBody(stmt.block);
	}

	// -----------------------------------------------------------------------
	//  Control flow: for (numeric)
	// -----------------------------------------------------------------------

	private analyzeForNumeric(stmt: LuaForNumericStatement): void {
		const handle = this.resolveDeclarationHandle(stmt.variable);
		if (handle !== undefined) {
			this.state.set(handle, 'number');
		}
		this.analyzeLoopBody(stmt.block);
	}

	// -----------------------------------------------------------------------
	//  Control flow: for (generic)
	// -----------------------------------------------------------------------

	private analyzeForGeneric(stmt: LuaForGenericStatement): void {
		for (let i = 0; i < stmt.variables.length; i += 1) {
			const handle = this.resolveDeclarationHandle(stmt.variables[i]);
			if (handle !== undefined) {
				this.state.set(handle, 'unknown');
			}
		}
		this.analyzeLoopBody(stmt.block);
	}

	// -----------------------------------------------------------------------
	//  Loop fixpoint
	// -----------------------------------------------------------------------

	private analyzeLoopBody(block: LuaBlock): void {
		const preLoopState = freezeState(cloneState(this.state));

		for (let iteration = 0; iteration < MAX_FIXPOINT_ITERATIONS; iteration += 1) {
			const entrySnapshot = freezeState(cloneState(this.state));
			this.analyzeStatementList(block.body);
			const bodyExit = freezeState(cloneState(this.state));
			const merged = mergeStates(preLoopState, bodyExit);

			if (statesEqual(merged, entrySnapshot)) {
				this.state = merged;
				return;
			}
			this.state = merged;
		}
	}

	// -----------------------------------------------------------------------
	//  Closure-written degradation after call statements
	// -----------------------------------------------------------------------

	private degradeClosureWrittenSymbols(): void {
		if (this.closureWrittenSymbols.size === 0) return;
		for (const handle of this.closureWrittenSymbols) {
			if (this.state.has(handle)) {
				this.state.set(handle, 'unknown');
			}
		}
	}

	// -----------------------------------------------------------------------
	//  Expression evaluation (delegates to module-level evaluator)
	// -----------------------------------------------------------------------

	private evalExprKind(expression: LuaExpression): CompileValueKind {
		return evaluateExpressionValueKind(expression, this.state, this.semantics);
	}

	// -----------------------------------------------------------------------
	//  Symbol resolution helpers
	// -----------------------------------------------------------------------

	private resolveDeclarationHandle(identifier: LuaIdentifierExpression): string | undefined {
		const decl = this.semantics.getDeclaration(identifier.range);
		if (decl && !decl.isGlobal) return decl.id;
		return undefined;
	}

	private resolveReferenceHandle(identifier: LuaIdentifierExpression): string | undefined {
		return resolveIdentifierHandle(identifier, this.semantics);
	}
}
