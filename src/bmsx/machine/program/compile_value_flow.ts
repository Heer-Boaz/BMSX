import {
	LuaAssignmentOperator,
	LuaBinaryOperator,
	LuaSyntaxKind,
	LuaTableFieldKind,
	LuaUnaryOperator,
	type LuaAssignableExpression,
	type LuaAssignmentStatement,
	type LuaBinaryExpression,
	type LuaBlock,
	type LuaCallExpression,
	type LuaCallStatement,
	type LuaDoStatement,
	type LuaExpression,
	type LuaForGenericStatement,
	type LuaForNumericStatement,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
	type LuaIfStatement,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaRepeatStatement,
	type LuaReturnStatement,
	type LuaStatement,
	type LuaWhileStatement,
} from '../../lua/syntax/ast';
import { walkLuaExpressionTree } from '../../lua/syntax/ast_traversal';
import type { LuaSemanticFrontendFile } from '../../lua/semantic/frontend';
import {
	getBoundIdentifierReference,
	getIdentifierSymbolHandle,
	getReferenceSymbolHandle,
} from './bound_reference';
import {
	classifyAssignmentTargetPreparation,
	classifyFunctionDeclarationTarget,
} from './target_semantics';

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

type CompileTruthiness = 'truthy' | 'falsy' | 'unknown';

type CompileValueFact = {
	readonly kind: CompileValueKind;
	readonly truthiness: CompileTruthiness;
};

/**
 * Membership means: "tracked lexical symbol that is currently in scope at this
 * program point." Block-local declarations are removed when their scope ends,
 * so state merges can safely intersect by symbol handle without leaking
 * branch-local symbols outward.
 */
export type SymbolFlowState = ReadonlyMap<string, CompileValueFact>;

type MutableFlowState = Map<string, CompileValueFact>;

type ExpressionEvaluation = {
	fact: CompileValueFact;
	state: MutableFlowState;
};

const UNKNOWN_VALUE_FACT: CompileValueFact = { kind: 'unknown', truthiness: 'unknown' };
const UNKNOWN_TRUTHY_VALUE_FACT: CompileValueFact = { kind: 'unknown', truthiness: 'truthy' };
const UNKNOWN_FALSY_VALUE_FACT: CompileValueFact = { kind: 'unknown', truthiness: 'falsy' };
const NIL_VALUE_FACT: CompileValueFact = { kind: 'nil', truthiness: 'falsy' };
const BOOLEAN_VALUE_FACT: CompileValueFact = { kind: 'boolean', truthiness: 'unknown' };
const TRUE_VALUE_FACT: CompileValueFact = { kind: 'boolean', truthiness: 'truthy' };
const FALSE_VALUE_FACT: CompileValueFact = { kind: 'boolean', truthiness: 'falsy' };
const NUMBER_VALUE_FACT: CompileValueFact = { kind: 'number', truthiness: 'truthy' };
const STRING_VALUE_FACT: CompileValueFact = { kind: 'string', truthiness: 'truthy' };
const STRING_REF_VALUE_FACT: CompileValueFact = { kind: 'string_ref', truthiness: 'truthy' };
// Functions are currently represented as generic truthy facts; this is enough
// for short-circuit reasoning without adding a runtime-visible value category.
const FUNCTION_VALUE_FACT: CompileValueFact = UNKNOWN_TRUTHY_VALUE_FACT;

function unreachableFlowValue(value: never, label: string): never {
	throw new Error(`[ValueKindFlowAnalyzer] Unhandled ${label}: ${String(value)}`);
}

// ---------------------------------------------------------------------------
//  State helpers
// ---------------------------------------------------------------------------

function cloneState(state: SymbolFlowState): MutableFlowState {
	return new Map(state);
}

function freezeState(state: MutableFlowState): SymbolFlowState {
	return state as SymbolFlowState;
}

function selectValueFact(kind: CompileValueKind, truthiness: CompileTruthiness): CompileValueFact {
	switch (kind) {
		case 'nil':
			return NIL_VALUE_FACT;
		case 'boolean':
			if (truthiness === 'truthy') return TRUE_VALUE_FACT;
			if (truthiness === 'falsy') return FALSE_VALUE_FACT;
			return BOOLEAN_VALUE_FACT;
		case 'number':
			return NUMBER_VALUE_FACT;
		case 'string':
			return STRING_VALUE_FACT;
		case 'string_ref':
			return STRING_REF_VALUE_FACT;
		case 'unknown':
			if (truthiness === 'truthy') return UNKNOWN_TRUTHY_VALUE_FACT;
			if (truthiness === 'falsy') return UNKNOWN_FALSY_VALUE_FACT;
			return UNKNOWN_VALUE_FACT;
		default:
			return unreachableFlowValue(kind, 'compile value kind');
	}
}

function mergeValueFacts(a: CompileValueFact, b: CompileValueFact): CompileValueFact {
	if (a === b) return a;
	const kind = a.kind === b.kind ? a.kind : 'unknown';
	const truthiness = a.truthiness === b.truthiness ? a.truthiness : 'unknown';
	return selectValueFact(kind, truthiness);
}

function valueFactsEqual(a: CompileValueFact | undefined, b: CompileValueFact | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.kind === b.kind && a.truthiness === b.truthiness;
}

function mergeStates(a: SymbolFlowState, b: SymbolFlowState): MutableFlowState {
	const result: MutableFlowState = new Map();
	for (const [handle, factA] of a) {
		const factB = b.get(handle);
		if (factB === undefined) continue;
		result.set(handle, mergeValueFacts(factA, factB));
	}
	return result;
}

function mergeMultipleStates(states: ReadonlyArray<SymbolFlowState>): MutableFlowState {
	if (states.length === 0) return new Map();
	let merged = cloneState(states[0]);
	for (let index = 1; index < states.length; index += 1) {
		merged = mergeStates(merged, states[index]);
	}
	return merged;
}

function statesEqual(a: SymbolFlowState, b: SymbolFlowState): boolean {
	if (a.size !== b.size) return false;
	for (const [handle, fact] of a) {
		if (!valueFactsEqual(fact, b.get(handle))) return false;
	}
	return true;
}

function setUnknown(state: MutableFlowState, handle: string): void {
	if (state.has(handle)) {
		state.set(handle, UNKNOWN_VALUE_FACT);
	}
}

function degradeClosureWrittenSymbolsInState(state: MutableFlowState, closureWrittenSymbols: ReadonlySet<string>): void {
	if (closureWrittenSymbols.size === 0) return;
	for (const handle of closureWrittenSymbols) {
		setUnknown(state, handle);
	}
}

// ---------------------------------------------------------------------------
//  Expression facts (state-aware, short-circuit-aware)
// ---------------------------------------------------------------------------

function evaluateBinaryOperatorFact(operator: LuaBinaryOperator): CompileValueFact {
	switch (operator) {
		case LuaBinaryOperator.Equal:
		case LuaBinaryOperator.NotEqual:
		case LuaBinaryOperator.LessThan:
		case LuaBinaryOperator.LessEqual:
		case LuaBinaryOperator.GreaterThan:
		case LuaBinaryOperator.GreaterEqual:
			return BOOLEAN_VALUE_FACT;
		case LuaBinaryOperator.Concat:
			// Concatenation materializes a normal runtime string; string_ref proofs do
			// not survive '..'.
			return STRING_VALUE_FACT;
		case LuaBinaryOperator.BitwiseOr:
		case LuaBinaryOperator.BitwiseXor:
		case LuaBinaryOperator.BitwiseAnd:
		case LuaBinaryOperator.ShiftLeft:
		case LuaBinaryOperator.ShiftRight:
		case LuaBinaryOperator.Add:
		case LuaBinaryOperator.Subtract:
		case LuaBinaryOperator.Multiply:
		case LuaBinaryOperator.Divide:
		case LuaBinaryOperator.FloorDivide:
		case LuaBinaryOperator.Modulus:
		case LuaBinaryOperator.Exponent:
			return NUMBER_VALUE_FACT;
		case LuaBinaryOperator.And:
		case LuaBinaryOperator.Or:
			return UNKNOWN_VALUE_FACT;
		default:
			return unreachableFlowValue(operator, 'binary operator');
	}
}

function evaluateExpressionFact(
	expression: LuaExpression,
	state: MutableFlowState,
	semantics: LuaSemanticFrontendFile,
	closureWrittenSymbols: ReadonlySet<string>,
): ExpressionEvaluation {
	const kind = expression.kind;
	switch (kind) {
		case LuaSyntaxKind.StringRefLiteralExpression:
			return { fact: STRING_REF_VALUE_FACT, state };
		case LuaSyntaxKind.StringLiteralExpression:
			return { fact: STRING_VALUE_FACT, state };
		case LuaSyntaxKind.NumericLiteralExpression:
			return { fact: NUMBER_VALUE_FACT, state };
		case LuaSyntaxKind.BooleanLiteralExpression:
			return {
				fact: expression.value ? TRUE_VALUE_FACT : FALSE_VALUE_FACT,
				state,
			};
		case LuaSyntaxKind.NilLiteralExpression:
			return { fact: NIL_VALUE_FACT, state };
		case LuaSyntaxKind.FunctionExpression:
			return { fact: FUNCTION_VALUE_FACT, state };
		case LuaSyntaxKind.TableConstructorExpression: {
			let currentState = state;
			for (let index = 0; index < expression.fields.length; index += 1) {
				const field = expression.fields[index];
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					currentState = evaluateExpressionFact(field.key, currentState, semantics, closureWrittenSymbols).state;
				}
				currentState = evaluateExpressionFact(field.value, currentState, semantics, closureWrittenSymbols).state;
			}
			return {
				fact: UNKNOWN_TRUTHY_VALUE_FACT,
				state: currentState,
			};
		}
		case LuaSyntaxKind.VarargExpression:
			return { fact: UNKNOWN_VALUE_FACT, state };
		case LuaSyntaxKind.IdentifierExpression: {
			const handle = getIdentifierSymbolHandle(semantics, expression as LuaIdentifierExpression);
			if (handle === null) return { fact: UNKNOWN_VALUE_FACT, state };
			return { fact: state.get(handle) ?? UNKNOWN_VALUE_FACT, state };
		}
		case LuaSyntaxKind.MemberExpression: {
			const base = evaluateExpressionFact(expression.base, state, semantics, closureWrittenSymbols);
			return { fact: UNKNOWN_VALUE_FACT, state: base.state };
		}
		case LuaSyntaxKind.IndexExpression: {
			const indexExpression = expression as LuaIndexExpression;
			const base = evaluateExpressionFact(indexExpression.base, state, semantics, closureWrittenSymbols);
			const index = evaluateExpressionFact(indexExpression.index, base.state, semantics, closureWrittenSymbols);
			return { fact: UNKNOWN_VALUE_FACT, state: index.state };
		}
		case LuaSyntaxKind.UnaryExpression: {
			const unary = expression;
			const operand = evaluateExpressionFact(unary.operand, state, semantics, closureWrittenSymbols);
			switch (unary.operator) {
				case LuaUnaryOperator.Not:
					if (operand.fact.truthiness === 'truthy') {
						return { fact: FALSE_VALUE_FACT, state: operand.state };
					}
					if (operand.fact.truthiness === 'falsy') {
						return { fact: TRUE_VALUE_FACT, state: operand.state };
					}
					return { fact: BOOLEAN_VALUE_FACT, state: operand.state };
				case LuaUnaryOperator.Length:
				case LuaUnaryOperator.Negate:
				case LuaUnaryOperator.BitwiseNot:
					return { fact: NUMBER_VALUE_FACT, state: operand.state };
				default:
					return { fact: unreachableFlowValue(unary.operator, 'unary operator'), state: operand.state };
			}
		}
		case LuaSyntaxKind.BinaryExpression: {
			const binary = expression as LuaBinaryExpression;
			const left = evaluateExpressionFact(binary.left, state, semantics, closureWrittenSymbols);
			if (binary.operator === LuaBinaryOperator.And) {
				if (left.fact.truthiness === 'truthy') {
					return evaluateExpressionFact(binary.right, left.state, semantics, closureWrittenSymbols);
				}
				if (left.fact.truthiness === 'falsy') {
					return left;
				}
				const right = evaluateExpressionFact(binary.right, cloneState(left.state), semantics, closureWrittenSymbols);
				return {
					fact: mergeValueFacts(left.fact, right.fact),
					state: mergeStates(left.state, right.state),
				};
			}
			if (binary.operator === LuaBinaryOperator.Or) {
				if (left.fact.truthiness === 'truthy') {
					return left;
				}
				if (left.fact.truthiness === 'falsy') {
					return evaluateExpressionFact(binary.right, left.state, semantics, closureWrittenSymbols);
				}
				const right = evaluateExpressionFact(binary.right, cloneState(left.state), semantics, closureWrittenSymbols);
				return {
					fact: mergeValueFacts(left.fact, right.fact),
					state: mergeStates(left.state, right.state),
				};
			}
			const right = evaluateExpressionFact(binary.right, left.state, semantics, closureWrittenSymbols);
			return {
				fact: evaluateBinaryOperatorFact(binary.operator),
				state: right.state,
			};
		}
		case LuaSyntaxKind.CallExpression: {
			const call = expression as LuaCallExpression;
			let currentState = evaluateExpressionFact(call.callee, state, semantics, closureWrittenSymbols).state;
			for (let index = 0; index < call.arguments.length; index += 1) {
				currentState = evaluateExpressionFact(call.arguments[index], currentState, semantics, closureWrittenSymbols).state;
			}
			degradeClosureWrittenSymbolsInState(currentState, closureWrittenSymbols);
			return { fact: UNKNOWN_VALUE_FACT, state: currentState };
		}
		default:
			return { fact: unreachableFlowValue(kind, 'expression kind'), state };
	}
}

// ---------------------------------------------------------------------------
//  Lexical symbol resolution
// ---------------------------------------------------------------------------

function resolveDeclarationHandle(
	identifier: LuaIdentifierExpression,
	semantics: LuaSemanticFrontendFile,
): string | undefined {
	const decl = semantics.getDeclaration(identifier.range);
	if (decl && !decl.isGlobal) return decl.id;
	return undefined;
}

function resolveReferenceHandle(
	identifier: LuaIdentifierExpression,
	semantics: LuaSemanticFrontendFile,
): string | null {
	const reference = getBoundIdentifierReference(semantics, identifier);
	return getReferenceSymbolHandle(reference);
}

// ---------------------------------------------------------------------------
//  Closure-written symbol detection
// ---------------------------------------------------------------------------

function collectNestedClosureWritesFromStatementList(
	body: ReadonlyArray<LuaStatement>,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	for (let index = 0; index < body.length; index += 1) {
		collectNestedClosureWritesFromStatement(body[index], semantics, out);
	}
}

function collectNestedClosureWritesFromStatement(
	statement: LuaStatement,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	const kind = statement.kind;
	switch (kind) {
		case LuaSyntaxKind.LocalAssignmentStatement: {
			const local = statement as LuaLocalAssignmentStatement;
			for (let index = 0; index < local.values.length; index += 1) {
				collectNestedClosureWritesFromExpression(local.values[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.AssignmentStatement: {
			const assignment = statement as LuaAssignmentStatement;
			for (let index = 0; index < assignment.left.length; index += 1) {
				collectNestedClosureWritesFromExpression(assignment.left[index], semantics, out);
			}
			for (let index = 0; index < assignment.right.length; index += 1) {
				collectNestedClosureWritesFromExpression(assignment.right[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.LocalFunctionStatement:
			collectLexicalWritesInFunctionBody((statement as LuaLocalFunctionStatement).functionExpression.body.body, semantics, out);
			return;
		case LuaSyntaxKind.FunctionDeclarationStatement:
			collectLexicalWritesInFunctionBody((statement as LuaFunctionDeclarationStatement).functionExpression.body.body, semantics, out);
			return;
		case LuaSyntaxKind.ReturnStatement: {
			const returnStatement = statement as LuaReturnStatement;
			for (let index = 0; index < returnStatement.expressions.length; index += 1) {
				collectNestedClosureWritesFromExpression(returnStatement.expressions[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.IfStatement:
			for (const clause of (statement as LuaIfStatement).clauses) {
				const condition = clause.condition as LuaExpression | null;
				if (condition) {
					collectNestedClosureWritesFromExpression(condition, semantics, out);
				}
				collectNestedClosureWritesFromStatementList(clause.block.body, semantics, out);
			}
			return;
		case LuaSyntaxKind.WhileStatement: {
			const whileStatement = statement as LuaWhileStatement;
			collectNestedClosureWritesFromExpression(whileStatement.condition, semantics, out);
			collectNestedClosureWritesFromStatementList(whileStatement.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.RepeatStatement: {
			const repeatStatement = statement as LuaRepeatStatement;
			collectNestedClosureWritesFromStatementList(repeatStatement.block.body, semantics, out);
			collectNestedClosureWritesFromExpression(repeatStatement.condition, semantics, out);
			return;
		}
		case LuaSyntaxKind.ForNumericStatement: {
			const forNumeric = statement as LuaForNumericStatement;
			collectNestedClosureWritesFromExpression(forNumeric.start, semantics, out);
			collectNestedClosureWritesFromExpression(forNumeric.limit, semantics, out);
			if (forNumeric.step !== null) {
				collectNestedClosureWritesFromExpression(forNumeric.step, semantics, out);
			}
			collectNestedClosureWritesFromStatementList(forNumeric.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.ForGenericStatement: {
			const forGeneric = statement as LuaForGenericStatement;
			for (let index = 0; index < forGeneric.iterators.length; index += 1) {
				collectNestedClosureWritesFromExpression(forGeneric.iterators[index], semantics, out);
			}
			collectNestedClosureWritesFromStatementList(forGeneric.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.DoStatement:
			collectNestedClosureWritesFromStatementList((statement as LuaDoStatement).block.body, semantics, out);
			return;
		case LuaSyntaxKind.CallStatement:
			collectNestedClosureWritesFromExpression((statement as LuaCallStatement).expression, semantics, out);
			return;
		case LuaSyntaxKind.BreakStatement:
		case LuaSyntaxKind.HaltUntilIrqStatement:
		case LuaSyntaxKind.GotoStatement:
		case LuaSyntaxKind.LabelStatement:
			return;
		default:
			unreachableFlowValue(kind, 'statement kind');
	}
}

function collectNestedClosureWritesFromExpression(
	expression: LuaExpression,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	walkLuaExpressionTree(expression, (candidate) => {
		if (candidate.kind !== LuaSyntaxKind.FunctionExpression) {
			return;
		}
		collectLexicalWritesInFunctionBody((candidate as LuaFunctionExpression).body.body, semantics, out);
		return false;
	});
}

function collectLexicalWritesInFunctionBody(
	body: ReadonlyArray<LuaStatement>,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	for (let index = 0; index < body.length; index += 1) {
		collectLexicalWritesInStatement(body[index], semantics, out);
	}
}

function collectLexicalWritesInStatement(
	statement: LuaStatement,
	semantics: LuaSemanticFrontendFile,
	out: Set<string>,
): void {
	const kind = statement.kind;
	switch (kind) {
		case LuaSyntaxKind.LocalAssignmentStatement: {
			const local = statement as LuaLocalAssignmentStatement;
			for (let index = 0; index < local.names.length; index += 1) {
				const handle = resolveDeclarationHandle(local.names[index], semantics);
				if (handle !== undefined) out.add(handle);
			}
			for (let index = 0; index < local.values.length; index += 1) {
				collectNestedClosureWritesFromExpression(local.values[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.AssignmentStatement: {
			const assignment = statement as LuaAssignmentStatement;
			for (let index = 0; index < assignment.left.length; index += 1) {
				const target = assignment.left[index];
				if (target.kind === LuaSyntaxKind.IdentifierExpression) {
					const handle = resolveReferenceHandle(target as LuaIdentifierExpression, semantics);
				if (handle !== undefined) out.add(handle);
				}
				collectNestedClosureWritesFromExpression(target, semantics, out);
			}
			for (let index = 0; index < assignment.right.length; index += 1) {
				collectNestedClosureWritesFromExpression(assignment.right[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.LocalFunctionStatement: {
			const localFunction = statement as LuaLocalFunctionStatement;
			const handle = resolveDeclarationHandle(localFunction.name, semantics);
						if (handle !== null) out.add(handle);
			collectLexicalWritesInFunctionBody(localFunction.functionExpression.body.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.FunctionDeclarationStatement: {
			const declaration = statement as LuaFunctionDeclarationStatement;
			const target = classifyFunctionDeclarationTarget(semantics, declaration);
			if (target.kind === 'simple' && target.lexicalHandle !== undefined) {
				out.add(target.lexicalHandle);
			}
			collectLexicalWritesInFunctionBody(declaration.functionExpression.body.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.ReturnStatement: {
			const returnStatement = statement as LuaReturnStatement;
			for (let index = 0; index < returnStatement.expressions.length; index += 1) {
				collectNestedClosureWritesFromExpression(returnStatement.expressions[index], semantics, out);
			}
			return;
		}
		case LuaSyntaxKind.IfStatement:
			for (const clause of (statement as LuaIfStatement).clauses) {
				const condition = clause.condition as LuaExpression | null;
				if (condition) {
					collectNestedClosureWritesFromExpression(condition, semantics, out);
				}
				collectLexicalWritesInFunctionBody(clause.block.body, semantics, out);
			}
			return;
		case LuaSyntaxKind.WhileStatement: {
			const whileStatement = statement as LuaWhileStatement;
			collectNestedClosureWritesFromExpression(whileStatement.condition, semantics, out);
			collectLexicalWritesInFunctionBody(whileStatement.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.RepeatStatement: {
			const repeatStatement = statement as LuaRepeatStatement;
			collectLexicalWritesInFunctionBody(repeatStatement.block.body, semantics, out);
			collectNestedClosureWritesFromExpression(repeatStatement.condition, semantics, out);
			return;
		}
		case LuaSyntaxKind.ForNumericStatement: {
			const forNumeric = statement as LuaForNumericStatement;
			const handle = resolveDeclarationHandle(forNumeric.variable, semantics);
			if (handle !== undefined) out.add(handle);
			collectNestedClosureWritesFromExpression(forNumeric.start, semantics, out);
			collectNestedClosureWritesFromExpression(forNumeric.limit, semantics, out);
			if (forNumeric.step !== null) {
				collectNestedClosureWritesFromExpression(forNumeric.step, semantics, out);
			}
			collectLexicalWritesInFunctionBody(forNumeric.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.ForGenericStatement: {
			const forGeneric = statement as LuaForGenericStatement;
			for (let index = 0; index < forGeneric.variables.length; index += 1) {
				const handle = resolveDeclarationHandle(forGeneric.variables[index], semantics);
				if (handle !== undefined) out.add(handle);
			}
			for (let index = 0; index < forGeneric.iterators.length; index += 1) {
				collectNestedClosureWritesFromExpression(forGeneric.iterators[index], semantics, out);
			}
			collectLexicalWritesInFunctionBody(forGeneric.block.body, semantics, out);
			return;
		}
		case LuaSyntaxKind.DoStatement:
			collectLexicalWritesInFunctionBody((statement as LuaDoStatement).block.body, semantics, out);
			return;
		case LuaSyntaxKind.CallStatement:
			collectNestedClosureWritesFromExpression((statement as LuaCallStatement).expression, semantics, out);
			return;
		case LuaSyntaxKind.BreakStatement:
		case LuaSyntaxKind.HaltUntilIrqStatement:
		case LuaSyntaxKind.GotoStatement:
		case LuaSyntaxKind.LabelStatement:
			return;
		default:
			unreachableFlowValue(kind, 'statement kind');
	}
}

function computeClosureWrittenSymbols(
	body: ReadonlyArray<LuaStatement>,
	semantics: LuaSemanticFrontendFile,
): Set<string> {
	const result = new Set<string>();
	collectNestedClosureWritesFromStatementList(body, semantics, result);
	return result;
}

// ---------------------------------------------------------------------------
//  Multi-return detection (lightweight, only for flow analysis)
// ---------------------------------------------------------------------------

function isMultiReturnExpression(expression: LuaExpression): boolean {
	return expression.kind === LuaSyntaxKind.CallExpression
		|| expression.kind === LuaSyntaxKind.VarargExpression;
}

const LOOP_FIXPOINT_SAFETY_LIMIT = 1024;

// ---------------------------------------------------------------------------
//  Flow analyzer
// ---------------------------------------------------------------------------

export class ValueKindFlowAnalyzer {
	private readonly semantics: LuaSemanticFrontendFile;
	private readonly closureWrittenSymbols: Set<string>;
	private readonly stateAtStatement = new Map<LuaStatement, SymbolFlowState>();
	private readonly scopeHandles: string[][] = [[]];
	private state: MutableFlowState = new Map();

	constructor(
		body: ReadonlyArray<LuaStatement>,
		semantics: LuaSemanticFrontendFile,
	) {
		this.semantics = semantics;
		this.closureWrittenSymbols = computeClosureWrittenSymbols(body, semantics);
		this.analyzeStatementList(body);
	}

	getFlowStateAt(statement: LuaStatement): SymbolFlowState {
		return this.stateAtStatement.get(statement) ?? this.state;
	}

	// -----------------------------------------------------------------------
	//  Statement-list traversal
	// -----------------------------------------------------------------------

	private analyzeStatementList(statements: ReadonlyArray<LuaStatement>): void {
		for (let index = 0; index < statements.length; index += 1) {
			this.stateAtStatement.set(statements[index], freezeState(cloneState(this.state)));
			this.analyzeStatement(statements[index]);
		}
	}

	private snapshotState(): SymbolFlowState {
		return freezeState(cloneState(this.state));
	}

	private pushLexicalScope(): void {
		this.scopeHandles.push([]);
	}

	private popLexicalScope(): void {
		const handles = this.scopeHandles.pop()!;
		for (let index = handles.length - 1; index >= 0; index -= 1) {
			this.state.delete(handles[index]);
		}
	}

	private withLexicalScope<T>(run: () => T): T {
		this.pushLexicalScope();
		try {
			return run();
		} finally {
			this.popLexicalScope();
		}
	}

	private recordDeclaredHandle(handle: string): void {
		this.scopeHandles[this.scopeHandles.length - 1].push(handle);
	}

	private analyzeBlockWithScope(block: LuaBlock): SymbolFlowState {
		this.pushLexicalScope();
		this.analyzeStatementList(block.body);
		this.popLexicalScope();
		return this.snapshotState();
	}

	private evalExprFact(expression: LuaExpression): CompileValueFact {
		const result = evaluateExpressionFact(expression, this.state, this.semantics, this.closureWrittenSymbols);
		this.state = result.state;
		return result.fact;
	}

	evaluateExpressionValueKind(expression: LuaExpression, state: SymbolFlowState): CompileValueKind {
		return evaluateExpressionFact(expression, cloneState(state), this.semantics, this.closureWrittenSymbols).fact.kind;
	}

	private evalExpressionList(expressions: ReadonlyArray<LuaExpression>): CompileValueFact[] {
		const facts = new Array<CompileValueFact>(expressions.length);
		for (let index = 0; index < expressions.length; index += 1) {
			facts[index] = this.evalExprFact(expressions[index]);
		}
		return facts;
	}

	private resolveAssignedFact(
		targetIndex: number,
		targetCount: number,
		expressions: ReadonlyArray<LuaExpression>,
		facts: ReadonlyArray<CompileValueFact>,
	): CompileValueFact {
		if (expressions.length === 0) {
			return NIL_VALUE_FACT;
		}
		const lastIndex = expressions.length - 1;
		if (targetIndex < lastIndex) {
			return facts[targetIndex];
		}
		if (targetIndex === lastIndex) {
			const remaining = targetCount - lastIndex;
			if (remaining > 1 && isMultiReturnExpression(expressions[lastIndex])) {
				return UNKNOWN_VALUE_FACT;
			}
			return facts[lastIndex];
		}
		if (isMultiReturnExpression(expressions[lastIndex])) {
			return UNKNOWN_VALUE_FACT;
		}
		return NIL_VALUE_FACT;
	}

	private analyzeLoopEntryFixpoint(
		baseEntryState: SymbolFlowState,
		transfer: () => SymbolFlowState,
		locationLabel: string,
	): SymbolFlowState {
		let entryState = baseEntryState;
		for (let iteration = 0; iteration < LOOP_FIXPOINT_SAFETY_LIMIT; iteration += 1) {
			this.state = cloneState(entryState);
			const bodyExit = transfer();
			const nextEntry = freezeState(mergeStates(baseEntryState, bodyExit));
			if (statesEqual(nextEntry, entryState)) {
				return nextEntry;
			}
			entryState = nextEntry;
		}
		throw new Error(`[ValueKindFlowAnalyzer] Loop fixpoint did not converge for ${locationLabel}.`);
	}

	// -----------------------------------------------------------------------
	//  Individual statement analysis
	// -----------------------------------------------------------------------

	private analyzeStatement(statement: LuaStatement): void {
		const kind = statement.kind;
		switch (kind) {
			case LuaSyntaxKind.LocalAssignmentStatement:
				this.analyzeLocalAssignment(statement as LuaLocalAssignmentStatement);
				return;
			case LuaSyntaxKind.LocalFunctionStatement:
				this.analyzeLocalFunction(statement as LuaLocalFunctionStatement);
				return;
			case LuaSyntaxKind.FunctionDeclarationStatement:
				this.analyzeFunctionDeclaration(statement as LuaFunctionDeclarationStatement);
				return;
			case LuaSyntaxKind.AssignmentStatement:
				this.analyzeAssignment(statement as LuaAssignmentStatement);
				return;
			case LuaSyntaxKind.ReturnStatement:
				this.evalExpressionList((statement as LuaReturnStatement).expressions);
				return;
			case LuaSyntaxKind.IfStatement:
				this.analyzeIf(statement as LuaIfStatement);
				return;
			case LuaSyntaxKind.WhileStatement:
				this.analyzeWhile(statement as LuaWhileStatement);
				return;
			case LuaSyntaxKind.RepeatStatement:
				this.analyzeRepeat(statement as LuaRepeatStatement);
				return;
			case LuaSyntaxKind.ForNumericStatement:
				this.analyzeForNumeric(statement as LuaForNumericStatement);
				return;
			case LuaSyntaxKind.ForGenericStatement:
				this.analyzeForGeneric(statement as LuaForGenericStatement);
				return;
			case LuaSyntaxKind.DoStatement:
				this.withLexicalScope(() => {
					this.analyzeStatementList((statement as LuaDoStatement).block.body);
				});
				return;
			case LuaSyntaxKind.CallStatement:
				this.evalExprFact((statement as LuaCallStatement).expression);
				return;
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.HaltUntilIrqStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				return;
			default:
				unreachableFlowValue(kind, 'statement kind');
		}
	}

	private analyzeLocalAssignment(statement: LuaLocalAssignmentStatement): void {
		const facts = this.evalExpressionList(statement.values);
		for (let index = 0; index < statement.names.length; index += 1) {
			const handle = this.resolveDeclarationHandle(statement.names[index]);
			if (handle === undefined) continue;
			this.recordDeclaredHandle(handle);
			this.state.set(
				handle,
				this.resolveAssignedFact(index, statement.names.length, statement.values, facts),
			);
		}
	}

	private analyzeLocalFunction(statement: LuaLocalFunctionStatement): void {
		const handle = this.resolveDeclarationHandle(statement.name);
		if (handle === undefined) return;
		this.recordDeclaredHandle(handle);
		this.state.set(handle, FUNCTION_VALUE_FACT);
	}

	private analyzeFunctionDeclaration(statement: LuaFunctionDeclarationStatement): void {
		const target = classifyFunctionDeclarationTarget(this.semantics, statement);
		if (target.kind === 'path') {
			// Function declaration headers are identifier chains only; path targets
			// perform pure symbol/table lookup and do not change tracked lexical
			// facts. Only the simple identifier form rewrites a lexical slot.
			return;
		}
		if (target.lexicalHandle === undefined) return;
		this.state.set(target.lexicalHandle, FUNCTION_VALUE_FACT);
	}

	private analyzeAssignmentTargetPreparation(expression: LuaAssignableExpression): void {
		const target = classifyAssignmentTargetPreparation(this.semantics, expression);
		switch (target.kind) {
			case 'identifier':
				return;
			case 'member':
				this.evalExprFact(target.base);
				return;
			case 'memory':
				this.evalExprFact(target.index);
				return;
			case 'index':
				this.evalExprFact(target.base);
				this.evalExprFact(target.index);
				return;
			// default:
				// unreachableFlowValue(target.kind, 'assignment target preparation');
		}
	}

	private analyzeAssignment(statement: LuaAssignmentStatement): void {
		for (let index = 0; index < statement.left.length; index += 1) {
			this.analyzeAssignmentTargetPreparation(statement.left[index]);
		}
		const facts = this.evalExpressionList(statement.right);
		if (statement.operator !== LuaAssignmentOperator.Assign) {
			for (let index = 0; index < statement.left.length; index += 1) {
				this.degradeLocalTarget(statement.left[index]);
			}
			return;
		}
		for (let index = 0; index < statement.left.length; index += 1) {
			const target = statement.left[index];
			if (target.kind !== LuaSyntaxKind.IdentifierExpression) continue;
			const handle = this.resolveReferenceHandle(target as LuaIdentifierExpression);
				if (handle === null || !this.state.has(handle)) continue;
			this.state.set(
				handle,
				this.resolveAssignedFact(index, statement.left.length, statement.right, facts),
			);
		}
	}

	private analyzeIf(statement: LuaIfStatement): void {
		const exitStates: SymbolFlowState[] = [];
		let fallthroughStates: SymbolFlowState[] = [this.snapshotState()];

		for (let clauseIndex = 0; clauseIndex < statement.clauses.length; clauseIndex += 1) {
			const clause = statement.clauses[clauseIndex];
			const condition = clause.condition as LuaExpression | null;
			const nextFallthroughStates: SymbolFlowState[] = [];

			for (let stateIndex = 0; stateIndex < fallthroughStates.length; stateIndex += 1) {
				this.state = cloneState(fallthroughStates[stateIndex]);
				if (condition === null) {
					exitStates.push(this.analyzeBlockWithScope(clause.block));
					continue;
				}

				const conditionFact = this.evalExprFact(condition);
				const postConditionState = this.snapshotState();

				if (conditionFact.truthiness !== 'falsy') {
					this.state = cloneState(postConditionState);
					exitStates.push(this.analyzeBlockWithScope(clause.block));
				}
				if (conditionFact.truthiness !== 'truthy') {
					nextFallthroughStates.push(postConditionState);
				}
			}

			if (condition === null) {
				fallthroughStates = [];
				break;
			}
			fallthroughStates = nextFallthroughStates;
			if (fallthroughStates.length === 0) {
				break;
			}
		}

		for (let index = 0; index < fallthroughStates.length; index += 1) {
			exitStates.push(fallthroughStates[index]);
		}
		this.state = mergeMultipleStates(exitStates);
	}

	private analyzeWhile(statement: LuaWhileStatement): void {
		const baseEntryState = this.snapshotState();
		let entryState = baseEntryState;
		for (let iteration = 0; iteration < LOOP_FIXPOINT_SAFETY_LIMIT; iteration += 1) {
			this.state = cloneState(entryState);
			const conditionFact = this.evalExprFact(statement.condition);
			const conditionState = this.snapshotState();
			if (conditionFact.truthiness === 'falsy') {
				this.state = cloneState(conditionState);
				return;
			}
			const bodyExit = this.analyzeBlockWithScope(statement.block);
			const nextEntry = freezeState(mergeStates(baseEntryState, bodyExit));
			if (statesEqual(nextEntry, entryState)) {
				this.state = cloneState(conditionState);
				return;
			}
			entryState = nextEntry;
		}
		throw new Error(`[ValueKindFlowAnalyzer] Loop fixpoint did not converge for while at ${statement.range.path}:${statement.range.start.line}.`);
	}

	private analyzeRepeat(statement: LuaRepeatStatement): void {
		const baseEntryState = this.snapshotState();
		let entryState = baseEntryState;
		for (let iteration = 0; iteration < LOOP_FIXPOINT_SAFETY_LIMIT; iteration += 1) {
			this.state = cloneState(entryState);
			const bodyExit = this.analyzeBlockWithScope(statement.block);
			this.state = cloneState(bodyExit);
			const conditionFact = this.evalExprFact(statement.condition);
			const conditionState = this.snapshotState();
			if (conditionFact.truthiness === 'truthy') {
				this.state = cloneState(conditionState);
				return;
			}
			const nextEntry = freezeState(mergeStates(baseEntryState, conditionState));
			if (statesEqual(nextEntry, entryState)) {
				this.state = cloneState(conditionState);
				return;
			}
			entryState = nextEntry;
		}
		throw new Error(`[ValueKindFlowAnalyzer] Loop fixpoint did not converge for repeat at ${statement.range.path}:${statement.range.start.line}.`);
	}

	private analyzeForNumeric(statement: LuaForNumericStatement): void {
		this.evalExprFact(statement.start);
		this.evalExprFact(statement.limit);
		if (statement.step !== null) {
			this.evalExprFact(statement.step);
		}
		this.withLexicalScope(() => {
			const handle = this.resolveDeclarationHandle(statement.variable);
			if (handle !== undefined) {
				this.recordDeclaredHandle(handle);
				this.state.set(handle, NUMBER_VALUE_FACT);
			}
			const stableEntry = this.analyzeLoopEntryFixpoint(
				this.snapshotState(),
				() => this.analyzeBlockWithScope(statement.block),
				`numeric-for ${statement.range.path}:${statement.range.start.line}`,
			);
			this.state = cloneState(stableEntry);
		});
	}

	private analyzeForGeneric(statement: LuaForGenericStatement): void {
		this.evalExpressionList(statement.iterators);
		this.withLexicalScope(() => {
			for (let index = 0; index < statement.variables.length; index += 1) {
				const handle = this.resolveDeclarationHandle(statement.variables[index]);
				if (handle === undefined) continue;
				this.recordDeclaredHandle(handle);
				this.state.set(handle, UNKNOWN_VALUE_FACT);
			}
			const stableEntry = this.analyzeLoopEntryFixpoint(
				this.snapshotState(),
				() => this.analyzeBlockWithScope(statement.block),
				`generic-for ${statement.range.path}:${statement.range.start.line}`,
			);
			this.state = cloneState(stableEntry);
		});
	}

	private degradeLocalTarget(expression: LuaExpression): void {
		if (expression.kind !== LuaSyntaxKind.IdentifierExpression) return;
		const handle = this.resolveReferenceHandle(expression as LuaIdentifierExpression);
			if (handle !== null) {
				setUnknown(this.state, handle);
			}
	}

	private resolveDeclarationHandle(identifier: LuaIdentifierExpression): string | undefined {
		return resolveDeclarationHandle(identifier, this.semantics);
	}

	private resolveReferenceHandle(identifier: LuaIdentifierExpression): string | null {
		return resolveReferenceHandle(identifier, this.semantics);
	}
}
