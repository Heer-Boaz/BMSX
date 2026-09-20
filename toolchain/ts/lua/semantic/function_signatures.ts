import { stronglyConnectedComponents, type StronglyConnectedNode } from '../../collections/strongly_connected_components';
import {
	LuaBinaryOperator, LuaSyntaxKind, LuaTableFieldKind, LuaUnaryOperator,
	type LuaCallExpression, type LuaExpression, type LuaStatement,
} from '../syntax/ast';
import type { LuaStatementSequence } from '../syntax/statement_sequence';
import { getLuaCallMinimumArgumentCount, getLuaCallStyle } from './call_signature';
import type { FileSemanticData, SymbolID } from './model';
import type { ScopeID } from './scope_facts';
import { semanticValueSourcesEqual, type FunctionSemanticValueSource, type FunctionValueFlowEntry } from './value_graph';

export type FunctionSignatureInfo = {
	readonly params: readonly string[];
	readonly hasVararg: boolean;
	readonly minimumArgumentCount: number;
	readonly declarationStyle: 'function' | 'method';
};

const definitionsByFile = new WeakMap<FileSemanticData, ReadonlyMap<SymbolID, readonly FunctionValueFlowEntry[]>>();
const EMPTY_FUNCTIONS: readonly FunctionValueFlowEntry[] = [];

/** Written headers need neither value-shape evaluation nor optionality analysis. */
export function getLuaDeclaredFunctions(file: FileSemanticData, declaration: SymbolID): readonly FunctionValueFlowEntry[] {
	let definitions = definitionsByFile.get(file);
	if (definitions === undefined) {
		const byDeclaration = new Map<SymbolID, FunctionValueFlowEntry[]>();
		for (const flow of file.functionValueFlows) {
			if (flow.declaration === undefined) continue;
			const bucket = byDeclaration.get(flow.declaration);
			if (bucket === undefined) byDeclaration.set(flow.declaration, [flow]);
			else bucket.push(flow);
		}
		definitions = byDeclaration;
		definitionsByFile.set(file, definitions);
	}
	return definitions.get(declaration) ?? EMPTY_FUNCTIONS;
}

type ForwardingRead = { readonly call: LuaCallExpression; readonly argumentIndex: number };
type ParameterRecipe = { readonly index: number; readonly forwarding: readonly ForwardingRead[] };
type FunctionRecipe = {
	readonly flow: FunctionValueFlowEntry;
	readonly params: readonly string[];
	readonly minimum: number;
	readonly parameters: readonly ParameterRecipe[];
};

// Intraprocedural facts depend only on this immutable bound file. Inferred
// signatures below also depend on the snapshot's direct-call resolution.
const recipesWithBuiltinType = new WeakMap<FileSemanticData, readonly FunctionRecipe[]>();
const recipesWithoutBuiltinType = new WeakMap<FileSemanticData, readonly FunctionRecipe[]>();

type ResolvedRead = { readonly target: SignatureNode; readonly read: ForwardingRead };
type SignatureNode = StronglyConnectedNode<SignatureNode> & {
	readonly recipe: FunctionRecipe;
	readonly parameters: { readonly index: number; readonly reads: readonly ResolvedRead[] }[];
	readonly dependencies: SignatureNode[];
};

/**
 * Signatures of directly identified written functions in one file. Parameters
 * and effects are not solved. Every intra-component forwarding read is unknown;
 * recursion never depends on the order in which consumers request signatures.
 */
export function inferLuaFunctionSignatures(
	file: FileSemanticData,
	resolveDirectCall: (call: LuaCallExpression) => FunctionValueFlowEntry | undefined,
	builtinTypeAvailable: boolean,
): ReadonlyMap<ScopeID, FunctionSignatureInfo> {
	const nodes = new Map<ScopeID, SignatureNode>();
	const recipesByFile = builtinTypeAvailable ? recipesWithBuiltinType : recipesWithoutBuiltinType;
	let recipes = recipesByFile.get(file);
	if (recipes === undefined) {
		const builder = new OptionalityRecipeBuilder(file, builtinTypeAvailable);
		recipes = file.functionValueFlows.map(flow => builder.build(flow));
		recipesByFile.set(file, recipes);
	}
	for (const recipe of recipes) {
		nodes.set(recipe.flow.id, {
			recipe, parameters: [], dependencies: [],
			index: -1, lowlink: 0, component: -1, active: false,
		});
	}
	const targets = new Map<LuaCallExpression, SignatureNode | undefined>();
	for (const node of nodes.values()) {
		for (const parameter of node.recipe.parameters) {
			const reads: ResolvedRead[] = [];
			let unknown = false;
			for (const read of parameter.forwarding) {
				if (!targets.has(read.call)) {
					const flow = resolveDirectCall(read.call);
					targets.set(read.call, flow === undefined ? undefined : nodes.get(flow.id));
				}
				const target = targets.get(read.call);
				if (target === undefined) {
					unknown = true;
					break;
				}
				reads.push({ target, read });
			}
			// Unknown forwarding is an explicit optional pattern under the local
			// policy. Other OR operands no longer impose signature dependencies.
			if (unknown) continue;
			node.parameters.push({ index: parameter.index, reads });
			for (const read of reads) node.dependencies.push(read.target);
		}
	}

	const components = stronglyConnectedComponents(nodes.values());
	const signatures = new Map<ScopeID, FunctionSignatureInfo>();
	for (const component of components) {
		for (const node of component) {
			const recipe = node.recipe;
			let minimumArgumentCount = recipe.minimum;
			for (const parameter of node.parameters) {
				let optional = false;
				for (const { target, read } of parameter.reads) {
					if (target.component === node.component
						|| read.argumentIndex + 1 > getLuaCallMinimumArgumentCount(
							signatures.get(target.recipe.flow.id)!, getLuaCallStyle(read.call),
						)) {
						optional = true;
						break;
					}
				}
				if (!optional) {
					minimumArgumentCount = parameter.index + 1;
					break;
				}
			}
			signatures.set(recipe.flow.id, {
				params: recipe.params,
				hasVararg: recipe.flow.expression.hasVararg,
				minimumArgumentCount,
				declarationStyle: recipe.flow.implicitReceiver ? 'method' : 'function',
			});
		}
	}
	return signatures;
}

class OptionalityRecipeBuilder {
	private forwarding: ForwardingRead[] = [];
	constructor(
		private readonly file: FileSemanticData,
		private readonly builtinTypeAvailable: boolean,
	) {}

	public build(flow: FunctionValueFlowEntry): FunctionRecipe {
		const params = flow.expression.parameters.map(parameter => parameter.name);
		const parameters: ParameterRecipe[] = [];
		let minimum = params.length;
		for (let index = params.length - 1; index >= 0; index--) {
			const parameter = flow.parameters[index + (flow.implicitReceiver ? 1 : 0)];
			if (this.parameterHasUnsafeUse(flow.expression.body.body, parameter, false)) break;
			if (index < params.length - 1) {
				this.forwarding = [];
				const explicitOptional = this.parameterHasExplicitOptionalPattern(flow.expression.body.body, parameter);
				if (!explicitOptional) {
					if (this.forwarding.length === 0) break;
					parameters.push({ index, forwarding: this.forwarding });
				}
			}
			minimum = index;
		}
		return { flow, params, minimum, parameters };
	}

	private parameterHasUnsafeUse(
		statements: LuaStatementSequence,
		parameter: FunctionSemanticValueSource,
		guarded: boolean,
	): boolean {
		let parameterGuarded = guarded;
		for (const cursor = statements.cursor(); cursor.statement !== undefined; cursor.advance()) {
			const statement = cursor.statement;
			if (statement.kind === LuaSyntaxKind.IfStatement) {
				const ifStatement = statement;
				for (let clauseIndex = 0; clauseIndex < ifStatement.clauses.length; clauseIndex += 1) {
					const clause = ifStatement.clauses[clauseIndex];
					const condition = clause.condition;
					if (condition && this.expressionHasUnsafeParameterUse(condition, parameter, parameterGuarded)) {
						return true;
					}
					const clauseGuarded = parameterGuarded || (condition ? this.conditionGuaranteesParameterPresent(condition, parameter) : false);
					if (this.parameterHasUnsafeUse(clause.block.body, parameter, clauseGuarded)) {
						return true;
					}
				}
				if (this.isEarlyReturnOnMissingParameter(ifStatement, parameter)) {
					parameterGuarded = true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.WhileStatement) {
				const whileStatement = statement;
				if (this.expressionHasUnsafeParameterUse(whileStatement.condition, parameter, parameterGuarded)) {
					return true;
				}
				if (this.parameterHasUnsafeUse(whileStatement.block.body, parameter, parameterGuarded || this.conditionGuaranteesParameterPresent(whileStatement.condition, parameter))) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.RepeatStatement) {
				const repeatStatement = statement;
				if (this.parameterHasUnsafeUse(repeatStatement.block.body, parameter, parameterGuarded)) {
					return true;
				}
				if (this.expressionHasUnsafeParameterUse(repeatStatement.condition, parameter, parameterGuarded)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.DoStatement) {
				if (this.parameterHasUnsafeUse(statement.block.body, parameter, parameterGuarded)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ForNumericStatement) {
				if (this.expressionHasUnsafeParameterUse(statement.start, parameter, parameterGuarded)
					|| this.expressionHasUnsafeParameterUse(statement.limit, parameter, parameterGuarded)
					|| (statement.step ? this.expressionHasUnsafeParameterUse(statement.step, parameter, parameterGuarded) : false)) {
					return true;
				}
				if (this.parameterHasUnsafeUse(statement.block.body, parameter, parameterGuarded)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ForGenericStatement) {
				for (let iteratorIndex = 0; iteratorIndex < statement.iterators.length; iteratorIndex += 1) {
					if (this.expressionHasUnsafeParameterUse(statement.iterators[iteratorIndex], parameter, parameterGuarded)) {
						return true;
					}
				}
				if (this.parameterHasUnsafeUse(statement.block.body, parameter, parameterGuarded)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.LocalFunctionStatement || statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
				continue;
			}
			if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
				for (let valueIndex = 0; valueIndex < statement.values.length; valueIndex += 1) {
					if (this.expressionHasUnsafeParameterUse(statement.values[valueIndex], parameter, parameterGuarded)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
				for (let targetIndex = 0; targetIndex < statement.left.length; targetIndex += 1) {
					if (this.expressionHasUnsafeParameterUse(statement.left[targetIndex], parameter, parameterGuarded)) {
						return true;
					}
				}
				for (let valueIndex = 0; valueIndex < statement.right.length; valueIndex += 1) {
					if (this.expressionHasUnsafeParameterUse(statement.right[valueIndex], parameter, parameterGuarded)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ReturnStatement) {
				for (let expressionIndex = 0; expressionIndex < statement.expressions.length; expressionIndex += 1) {
					if (this.expressionHasUnsafeParameterUse(statement.expressions[expressionIndex], parameter, parameterGuarded)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.CallStatement) {
				if (this.expressionHasUnsafeParameterUse(statement.expression, parameter, parameterGuarded)) {
					return true;
				}
			}
		}
		return false;
	}

	private parameterHasExplicitOptionalPattern(
		statements: LuaStatementSequence,
		parameter: FunctionSemanticValueSource,
	): boolean {
		for (const cursor = statements.cursor(); cursor.statement !== undefined; cursor.advance()) {
			const statement = cursor.statement;
			if (statement.kind === LuaSyntaxKind.IfStatement) {
				if (this.isEarlyReturnOnMissingParameter(statement, parameter)) {
					return true;
				}
				for (let clauseIndex = 0; clauseIndex < statement.clauses.length; clauseIndex += 1) {
					const clause = statement.clauses[clauseIndex];
					const condition = clause.condition;
					if (condition && this.expressionHasExplicitOptionalPattern(condition, parameter)) {
						return true;
					}
					if (this.parameterHasExplicitOptionalPattern(clause.block.body, parameter)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.WhileStatement) {
				if (this.expressionHasExplicitOptionalPattern(statement.condition, parameter)
					|| this.parameterHasExplicitOptionalPattern(statement.block.body, parameter)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.RepeatStatement) {
				if (this.parameterHasExplicitOptionalPattern(statement.block.body, parameter)
					|| this.expressionHasExplicitOptionalPattern(statement.condition, parameter)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.DoStatement) {
				if (this.parameterHasExplicitOptionalPattern(statement.block.body, parameter)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ForNumericStatement) {
				if (this.expressionHasExplicitOptionalPattern(statement.start, parameter)
					|| this.expressionHasExplicitOptionalPattern(statement.limit, parameter)
					|| (statement.step ? this.expressionHasExplicitOptionalPattern(statement.step, parameter) : false)
					|| this.parameterHasExplicitOptionalPattern(statement.block.body, parameter)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ForGenericStatement) {
				for (let iteratorIndex = 0; iteratorIndex < statement.iterators.length; iteratorIndex += 1) {
					if (this.expressionHasExplicitOptionalPattern(statement.iterators[iteratorIndex], parameter)) {
						return true;
					}
				}
				if (this.parameterHasExplicitOptionalPattern(statement.block.body, parameter)) {
					return true;
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.LocalFunctionStatement || statement.kind === LuaSyntaxKind.FunctionDeclarationStatement) {
				continue;
			}
			if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
				for (let valueIndex = 0; valueIndex < statement.values.length; valueIndex += 1) {
					if (this.expressionHasExplicitOptionalPattern(statement.values[valueIndex], parameter)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.AssignmentStatement) {
				for (let targetIndex = 0; targetIndex < statement.left.length; targetIndex += 1) {
					if (this.expressionHasExplicitOptionalPattern(statement.left[targetIndex], parameter)) {
						return true;
					}
				}
				for (let valueIndex = 0; valueIndex < statement.right.length; valueIndex += 1) {
					if (this.expressionHasExplicitOptionalPattern(statement.right[valueIndex], parameter)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.ReturnStatement) {
				for (let expressionIndex = 0; expressionIndex < statement.expressions.length; expressionIndex += 1) {
					if (this.expressionHasExplicitOptionalPattern(statement.expressions[expressionIndex], parameter)) {
						return true;
					}
				}
				continue;
			}
			if (statement.kind === LuaSyntaxKind.CallStatement && this.expressionHasExplicitOptionalPattern(statement.expression, parameter)) {
				return true;
			}
		}
		return false;
	}

	private expressionHasUnsafeParameterUse(
		expression: LuaExpression,
		parameter: FunctionSemanticValueSource,
		guarded: boolean,
	): boolean {
		if (!this.expressionContainsParameter(expression, parameter)) {
			return false;
		}
		if (guarded) {
			return false;
		}
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression:
				return false;
			case LuaSyntaxKind.MemberExpression:
				return this.expressionContainsParameter(expression.base, parameter);
			case LuaSyntaxKind.IndexExpression:
				return this.expressionContainsParameter(expression.base, parameter)
					|| this.expressionHasUnsafeParameterUse(expression.index, parameter, false);
			case LuaSyntaxKind.UnaryExpression:
				if (expression.operator === LuaUnaryOperator.Not) {
					return this.expressionHasUnsafeParameterUse(expression.operand, parameter, false);
				}
				return this.expressionContainsParameter(expression.operand, parameter);
			case LuaSyntaxKind.BinaryExpression:
				switch (expression.operator) {
					case LuaBinaryOperator.And:
						if (this.conditionGuaranteesParameterPresent(expression.left, parameter)) {
							return this.expressionHasUnsafeParameterUse(expression.left, parameter, false)
								|| this.expressionHasUnsafeParameterUse(expression.right, parameter, true);
						}
						return this.expressionHasUnsafeParameterUse(expression.left, parameter, false)
							|| this.expressionHasUnsafeParameterUse(expression.right, parameter, false);
					case LuaBinaryOperator.Or:
						if (this.expressionContainsParameter(expression.left, parameter)
							&& !this.expressionHasUnsafeParameterUse(expression.left, parameter, false)) {
							return this.expressionHasUnsafeParameterUse(expression.right, parameter, false);
						}
						return this.expressionHasUnsafeParameterUse(expression.left, parameter, false)
							|| this.expressionHasUnsafeParameterUse(expression.right, parameter, false);
					case LuaBinaryOperator.Equal:
					case LuaBinaryOperator.NotEqual:
						return this.expressionHasUnsafeParameterUse(expression.left, parameter, false)
							|| this.expressionHasUnsafeParameterUse(expression.right, parameter, false);
					default:
						return this.expressionContainsParameter(expression.left, parameter)
							|| this.expressionContainsParameter(expression.right, parameter);
				}
			case LuaSyntaxKind.CallExpression:
				if (this.expressionContainsParameter(expression.callee, parameter)) {
					return true;
				}
				for (let index = 0; index < expression.arguments.length; index += 1) {
					const argument = expression.arguments[index];
					if (this.expressionHasUnsafeParameterUse(argument, parameter, false)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.TableConstructorExpression:
				for (let index = 0; index < expression.fields.length; index += 1) {
					const field = expression.fields[index];
					if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
						if (this.expressionHasUnsafeParameterUse(field.value, parameter, false)) {
							return true;
						}
						continue;
					}
					if (this.expressionHasUnsafeParameterUse(field.key, parameter, false)
						|| this.expressionHasUnsafeParameterUse(field.value, parameter, false)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.FunctionExpression:
				return false;
			default:
				return false;
		}
	}

	private expressionHasExplicitOptionalPattern(
		expression: LuaExpression,
		parameter: FunctionSemanticValueSource,
	): boolean {
		if (!this.expressionContainsParameter(expression, parameter)) {
			return false;
		}
		if (expression.kind === LuaSyntaxKind.BinaryExpression) {
			if (expression.operator === LuaBinaryOperator.Or
				&& this.expressionContainsParameter(expression.left, parameter)
				&& !this.expressionHasUnsafeParameterUse(expression.left, parameter, false)) {
				return true;
			}
			if (this.expressionHasExplicitOptionalPattern(expression.left, parameter)
				|| this.expressionHasExplicitOptionalPattern(expression.right, parameter)) {
				return true;
			}
			return false;
		}
		if (expression.kind === LuaSyntaxKind.UnaryExpression) {
			return this.expressionHasExplicitOptionalPattern(expression.operand, parameter);
		}
		if (expression.kind === LuaSyntaxKind.CallExpression) {
			for (let index = 0; index < expression.arguments.length; index += 1) {
				if (this.isDirectParameterReference(expression.arguments[index], parameter)) {
					this.forwarding.push({ call: expression, argumentIndex: index });
				}
				if (this.expressionHasExplicitOptionalPattern(expression.arguments[index], parameter)) {
					return true;
				}
			}
			return this.expressionHasExplicitOptionalPattern(expression.callee, parameter);
		}
		if (expression.kind === LuaSyntaxKind.MemberExpression) {
			return this.expressionHasExplicitOptionalPattern(expression.base, parameter);
		}
		if (expression.kind === LuaSyntaxKind.IndexExpression) {
			return this.expressionHasExplicitOptionalPattern(expression.base, parameter)
				|| this.expressionHasExplicitOptionalPattern(expression.index, parameter);
		}
		if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
			for (let index = 0; index < expression.fields.length; index += 1) {
				const field = expression.fields[index];
				if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
					if (this.expressionHasExplicitOptionalPattern(field.value, parameter)) {
						return true;
					}
					continue;
				}
				if (this.expressionHasExplicitOptionalPattern(field.key, parameter)
					|| this.expressionHasExplicitOptionalPattern(field.value, parameter)) {
					return true;
				}
			}
		}
		return false;
	}

	private isEarlyReturnOnMissingParameter(statement: LuaStatement, parameter: FunctionSemanticValueSource): boolean {
		if (statement.kind !== LuaSyntaxKind.IfStatement || statement.clauses.length !== 1) {
			return false;
		}
		const clause = statement.clauses[0];
		const condition = clause.condition;
		return !!condition && this.conditionGuaranteesParameterAbsent(condition, parameter) && this.blockEndsWithReturn(clause.block.body);
	}

	private blockEndsWithReturn(statements: LuaStatementSequence): boolean {
		if (statements.length === 0) {
			return false;
		}
		return statements.get(statements.length - 1).kind === LuaSyntaxKind.ReturnStatement;
	}

	private conditionGuaranteesParameterPresent(expression: LuaExpression, parameter: FunctionSemanticValueSource): boolean {
		if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
			return this.isDirectParameterReference(expression, parameter);
		}
		if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
			return false;
		}
		if (expression.kind === LuaSyntaxKind.BinaryExpression) {
			if (expression.operator === LuaBinaryOperator.And) {
				return this.conditionGuaranteesParameterPresent(expression.left, parameter)
					|| this.conditionGuaranteesParameterPresent(expression.right, parameter);
			}
			if (expression.operator === LuaBinaryOperator.NotEqual && this.isDirectParameterReference(expression.left, parameter) && expression.right.kind === LuaSyntaxKind.NilLiteralExpression) {
				return true;
			}
			if (expression.operator === LuaBinaryOperator.NotEqual && this.isDirectParameterReference(expression.right, parameter) && expression.left.kind === LuaSyntaxKind.NilLiteralExpression) {
				return true;
			}
			if (expression.operator === LuaBinaryOperator.Equal && this.isTypeCallOnParameter(expression.left, parameter)
				&& expression.right.kind === LuaSyntaxKind.StringLiteralExpression && expression.right.value !== 'nil') {
				return true;
			}
			if (expression.operator === LuaBinaryOperator.Equal && this.isTypeCallOnParameter(expression.right, parameter)
				&& expression.left.kind === LuaSyntaxKind.StringLiteralExpression && expression.left.value !== 'nil') {
				return true;
			}
		}
		return false;
	}

	private conditionGuaranteesParameterAbsent(expression: LuaExpression, parameter: FunctionSemanticValueSource): boolean {
		if (expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Not) {
			return this.isDirectParameterReference(expression.operand, parameter);
		}
		if (expression.kind === LuaSyntaxKind.BinaryExpression) {
			if (expression.operator === LuaBinaryOperator.Equal && this.isDirectParameterReference(expression.left, parameter) && expression.right.kind === LuaSyntaxKind.NilLiteralExpression) {
				return true;
			}
			if (expression.operator === LuaBinaryOperator.Equal && this.isDirectParameterReference(expression.right, parameter) && expression.left.kind === LuaSyntaxKind.NilLiteralExpression) {
				return true;
			}
		}
		return false;
	}

	private isDirectParameterReference(expression: LuaExpression, parameter: FunctionSemanticValueSource): boolean {
		return expression.kind === LuaSyntaxKind.IdentifierExpression
			&& semanticValueSourcesEqual(this.file.referencesBySyntax.get(expression)?.binding, parameter);
	}

	private isTypeCallOnParameter(expression: LuaExpression, parameter: FunctionSemanticValueSource): boolean {
		if (expression.kind !== LuaSyntaxKind.CallExpression || expression.method) {
			return false;
		}
		if (!this.builtinTypeAvailable
			|| expression.callee.kind !== LuaSyntaxKind.IdentifierExpression
			|| expression.callee.name !== 'type'
			|| this.file.referencesBySyntax.get(expression.callee)?.binding !== undefined
			|| expression.arguments.length !== 1) {
			return false;
		}
		return this.isDirectParameterReference(expression.arguments[0], parameter);
	}

	private expressionContainsParameter(expression: LuaExpression, parameter: FunctionSemanticValueSource): boolean {
		switch (expression.kind) {
			case LuaSyntaxKind.IdentifierExpression:
				return this.isDirectParameterReference(expression, parameter);
			case LuaSyntaxKind.MemberExpression:
				return this.expressionContainsParameter(expression.base, parameter);
			case LuaSyntaxKind.IndexExpression:
				return this.expressionContainsParameter(expression.base, parameter) || this.expressionContainsParameter(expression.index, parameter);
			case LuaSyntaxKind.CallExpression:
				if (this.expressionContainsParameter(expression.callee, parameter)) {
					return true;
				}
				for (let index = 0; index < expression.arguments.length; index += 1) {
					if (this.expressionContainsParameter(expression.arguments[index], parameter)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.BinaryExpression:
				return this.expressionContainsParameter(expression.left, parameter) || this.expressionContainsParameter(expression.right, parameter);
			case LuaSyntaxKind.UnaryExpression:
				return this.expressionContainsParameter(expression.operand, parameter);
			case LuaSyntaxKind.TableConstructorExpression:
				for (let index = 0; index < expression.fields.length; index += 1) {
					const field = expression.fields[index];
					if (field.kind === LuaTableFieldKind.Array || field.kind === LuaTableFieldKind.IdentifierKey) {
						if (this.expressionContainsParameter(field.value, parameter)) {
							return true;
						}
						continue;
					}
					if (this.expressionContainsParameter(field.key, parameter) || this.expressionContainsParameter(field.value, parameter)) {
						return true;
					}
				}
				return false;
			case LuaSyntaxKind.FunctionExpression:
				return false;
			default:
				return false;
		}
	}
}
