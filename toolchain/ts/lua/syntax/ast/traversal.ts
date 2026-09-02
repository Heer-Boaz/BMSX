import {
	LuaSyntaxKind,
	LuaTableFieldKind,
	type LuaBlock,
	type LuaChunk,
	type LuaExpression,
	type LuaMissingIdentifier,
	type LuaBinaryExpression,
	type LuaCallExpression,
	type LuaIndexExpression,
	type LuaMemberExpression,
	type LuaSizeOfExpression,
	type LuaStatement,
	type LuaTableConstructorExpression,
	type LuaUnaryExpression,
} from './index';

export type LuaAstNode = LuaChunk | LuaBlock | LuaStatement | LuaExpression | LuaMissingIdentifier;

/**
 * Walks the complete retained syntax tree, including function bodies nested in
 * expressions. Returning false from the visitor keeps the node but skips its
 * descendants.
 */
export function walkLuaAst(
	node: LuaAstNode,
	visit: (node: LuaAstNode) => void | false,
): void {
	if (visit(node) === false) {
		return;
	}
	switch (node.kind) {
		case LuaSyntaxKind.Chunk:
		case LuaSyntaxKind.Block:
			walkLuaStatements(node.body, visit);
			return;
		case LuaSyntaxKind.AssignmentStatement:
			walkLuaExpressions(node.left, visit);
			walkLuaExpressions(node.right, visit);
			return;
		case LuaSyntaxKind.LocalAssignmentStatement:
			walkLuaExpressions(node.names, visit);
			for (let index = 0; index < node.pointerTypeRefs.length; index += 1) {
				walkLuaTypeArrayLengths(node.pointerTypeRefs[index], visit);
			}
			walkLuaExpressions(node.values, visit);
			return;
		case LuaSyntaxKind.LocalFunctionStatement:
			walkLuaAst(node.name, visit);
			walkLuaAst(node.functionExpression, visit);
			return;
		case LuaSyntaxKind.FunctionDeclarationStatement:
			walkLuaExpressions(node.name.path, visit);
			if (node.name.method) {
				walkLuaAst(node.name.method, visit);
			}
			walkLuaAst(node.functionExpression, visit);
			return;
		case LuaSyntaxKind.ReturnStatement:
			walkLuaExpressions(node.expressions, visit);
			return;
		case LuaSyntaxKind.IfStatement:
			for (let index = 0; index < node.clauses.length; index += 1) {
				const clause = node.clauses[index];
				if (clause.condition) {
					walkLuaAst(clause.condition, visit);
				}
				walkLuaAst(clause.block, visit);
			}
			return;
		case LuaSyntaxKind.WhileStatement:
			walkLuaAst(node.condition, visit);
			walkLuaAst(node.block, visit);
			return;
		case LuaSyntaxKind.RepeatStatement:
			walkLuaAst(node.block, visit);
			walkLuaAst(node.condition, visit);
			return;
		case LuaSyntaxKind.ForNumericStatement:
			walkLuaAst(node.variable, visit);
			walkLuaAst(node.start, visit);
			walkLuaAst(node.limit, visit);
			if (node.step) {
				walkLuaAst(node.step, visit);
			}
			walkLuaAst(node.block, visit);
			return;
		case LuaSyntaxKind.ForGenericStatement:
			walkLuaExpressions(node.variables, visit);
			walkLuaExpressions(node.iterators, visit);
			walkLuaAst(node.block, visit);
			return;
		case LuaSyntaxKind.DoStatement:
			walkLuaAst(node.block, visit);
			return;
		case LuaSyntaxKind.StructDeclarationStatement:
			walkLuaAst(node.name, visit);
			for (let index = 0; index < node.fields.length; index += 1) {
				walkLuaTypeArrayLengths(node.fields[index].typeRef, visit);
			}
			return;
		case LuaSyntaxKind.BssDeclarationStatement:
			walkLuaAst(node.name, visit);
			walkLuaTypeArrayLengths(node.typeRef, visit);
			return;
		case LuaSyntaxKind.DataDeclarationStatement:
		case LuaSyntaxKind.RodataDeclarationStatement:
			walkLuaAst(node.name, visit);
			walkLuaTypeArrayLengths(node.typeRef, visit);
			walkLuaAst(node.initializer, visit);
			return;
		case LuaSyntaxKind.CallStatement:
		case LuaSyntaxKind.ErrorStatement:
			walkLuaAst(node.expression, visit);
			return;
		case LuaSyntaxKind.BinaryExpression:
			walkLuaAst(node.left, visit);
			walkLuaAst(node.right, visit);
			return;
		case LuaSyntaxKind.UnaryExpression:
			walkLuaAst(node.operand, visit);
			return;
		case LuaSyntaxKind.CallExpression:
			walkLuaAst(node.callee, visit);
			if (node.method) {
				walkLuaAst(node.method, visit);
			}
			walkLuaExpressions(node.arguments, visit);
			return;
		case LuaSyntaxKind.MemberExpression:
			walkLuaAst(node.base, visit);
			walkLuaAst(node.member, visit);
			return;
		case LuaSyntaxKind.IndexExpression:
			walkLuaAst(node.base, visit);
			walkLuaAst(node.index, visit);
			return;
		case LuaSyntaxKind.SizeOfExpression:
			walkLuaTypeArrayLengths(node.typeRef, visit);
			return;
		case LuaSyntaxKind.FunctionExpression:
			walkLuaExpressions(node.parameters, visit);
			walkLuaAst(node.body, visit);
			return;
		case LuaSyntaxKind.TableConstructorExpression:
			for (let index = 0; index < node.fields.length; index += 1) {
				const field = node.fields[index];
				if (field.kind === LuaTableFieldKind.ExpressionKey) {
					walkLuaAst(field.key, visit);
				}
				walkLuaAst(field.value, visit);
			}
			return;
		case LuaSyntaxKind.BreakStatement:
		case LuaSyntaxKind.HaltUntilIrqStatement:
		case LuaSyntaxKind.GotoStatement:
		case LuaSyntaxKind.LabelStatement:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.NilLiteralExpression:
		case LuaSyntaxKind.VarargExpression:
		case LuaSyntaxKind.IdentifierExpression:
		case LuaSyntaxKind.MissingIdentifier:
		case LuaSyntaxKind.OffsetOfExpression:
			return;
		default:
			node satisfies never;
			return;
	}
}

function walkLuaStatements(
	statements: ReadonlyArray<LuaStatement>,
	visit: (node: LuaAstNode) => void | false,
): void {
	for (let index = 0; index < statements.length; index += 1) {
		walkLuaAst(statements[index], visit);
	}
}

function walkLuaExpressions(
	expressions: ReadonlyArray<LuaExpression>,
	visit: (node: LuaAstNode) => void | false,
): void {
	for (let index = 0; index < expressions.length; index += 1) {
		walkLuaAst(expressions[index], visit);
	}
}

function walkLuaTypeArrayLengths(
	typeRef: { readonly arrayLengths: ReadonlyArray<LuaExpression | null> } | null,
	visit: (node: LuaAstNode) => void | false,
): void {
	if (!typeRef) {
		return;
	}
	for (let index = 0; index < typeRef.arrayLengths.length; index += 1) {
		const expression = typeRef.arrayLengths[index];
		if (expression) {
			walkLuaAst(expression, visit);
		}
	}
}

// function unreachableTableFieldKind(value: never): never {
// 	throw new Error(`[LuaAstTraversal] Unhandled table field kind: ${String(value)}`);
// }

export function walkLuaExpressionTree(
	expression: LuaExpression,
	visit: (expression: LuaExpression) => void | false,
): void {
	if (visit(expression) === false) {
		return;
	}
	visitLuaExpressionChildren(expression, (child) => {
		walkLuaExpressionTree(child, visit);
	});
}

export function visitLuaExpressionChildren(
	expression: LuaExpression,
	visit: (expression: LuaExpression) => void,
): void {
	const kind = expression.kind;
	switch (kind) {
		case LuaSyntaxKind.BinaryExpression: {
			const binary = expression as LuaBinaryExpression;
			visit(binary.left);
			visit(binary.right);
			return;
		}
		case LuaSyntaxKind.UnaryExpression:
			visit((expression as LuaUnaryExpression).operand);
			return;
		case LuaSyntaxKind.CallExpression: {
			const call = expression as LuaCallExpression;
			visit(call.callee);
			for (let index = 0; index < call.arguments.length; index += 1) {
				visit(call.arguments[index]);
			}
			return;
		}
		case LuaSyntaxKind.MemberExpression:
			visit((expression as LuaMemberExpression).base);
			return;
		case LuaSyntaxKind.IndexExpression: {
			const indexExpression = expression as LuaIndexExpression;
			visit(indexExpression.base);
			visit(indexExpression.index);
			return;
		}
		case LuaSyntaxKind.SizeOfExpression: {
			const sizeOf = expression as LuaSizeOfExpression;
			for (const lengthExpression of sizeOf.typeRef.arrayLengths) {
				if (lengthExpression) visit(lengthExpression);
			}
			return;
		}
		case LuaSyntaxKind.TableConstructorExpression: {
			const table = expression as LuaTableConstructorExpression;
			for (let index = 0; index < table.fields.length; index += 1) {
				const field = table.fields[index];
				switch (field.kind) {
					case LuaTableFieldKind.Array:
					case LuaTableFieldKind.IdentifierKey:
						visit(field.value);
						break;
					case LuaTableFieldKind.ExpressionKey:
						visit(field.key);
						visit(field.value);
						break;
					// default:
					// 	unreachableTableFieldKind(field.kind);
				}
			}
			return;
		}
		case LuaSyntaxKind.FunctionExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.NilLiteralExpression:
		case LuaSyntaxKind.VarargExpression:
		case LuaSyntaxKind.OffsetOfExpression:
		case LuaSyntaxKind.IdentifierExpression:
			return;
		default:
			throw new Error(`[LuaAstTraversal] Unhandled expression kind: ${String(kind)}`);
	}
}
