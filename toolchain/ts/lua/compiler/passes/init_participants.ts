import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionExpression,
	type LuaStatement,
	type LuaTypeReference,
} from '../../syntax/ast';
import { walkLuaExpressionTree } from '../../syntax/ast/traversal';

const visitTypeReference = (
	typeRef: LuaTypeReference,
	visitExpression: (expression: LuaExpression) => void,
): void => {
	for (let index = 0; index < typeRef.arrayLengths.length; index += 1) {
		const length = typeRef.arrayLengths[index];
		if (length !== null) {
			visitExpression(length);
		}
	}
};

export function validateInitParticipantPlacement(
	chunk: LuaChunk,
	compileTimeModule: boolean = chunk.constModule,
): void {
	function visitExpression(expression: LuaExpression): void {
		walkLuaExpressionTree(expression, nested => {
			if (nested.kind === LuaSyntaxKind.FunctionExpression) {
				visitStatements((nested as LuaFunctionExpression).body.body, false);
				return false;
			}
		});
	}

	function visitStatements(statements: ReadonlyArray<LuaStatement>, topLevel: boolean): void {
		for (let index = 0; index < statements.length; index += 1) {
			const statement = statements[index];
			switch (statement.kind) {
				case LuaSyntaxKind.LocalAssignmentStatement:
					for (let valueIndex = 0; valueIndex < statement.values.length; valueIndex += 1) {
						visitExpression(statement.values[valueIndex]);
					}
					for (let typeIndex = 0; typeIndex < statement.pointerTypeRefs.length; typeIndex += 1) {
						const typeRef = statement.pointerTypeRefs[typeIndex];
						if (typeRef !== null) {
							visitTypeReference(typeRef, visitExpression);
						}
					}
					break;
				case LuaSyntaxKind.LocalFunctionStatement:
					if (statement.attribute === 'init') {
						if (compileTimeModule) {
							throw new Error(`Compile-time module '${chunk.range.path}' cannot declare an <init> function.`);
						}
						if (!topLevel) {
							throw new Error('Function attribute <init> is only valid on module/chunk top-level local functions.');
						}
						if (statement.functionExpression.parameters.length !== 0
							|| statement.functionExpression.hasVararg) {
							throw new Error('Function attribute <init> requires a zero-parameter, non-vararg function.');
						}
					}
					visitStatements(statement.functionExpression.body.body, false);
					break;
				case LuaSyntaxKind.FunctionDeclarationStatement:
					visitStatements(statement.functionExpression.body.body, false);
					break;
				case LuaSyntaxKind.AssignmentStatement:
					for (let leftIndex = 0; leftIndex < statement.left.length; leftIndex += 1) {
						visitExpression(statement.left[leftIndex]);
					}
					for (let rightIndex = 0; rightIndex < statement.right.length; rightIndex += 1) {
						visitExpression(statement.right[rightIndex]);
					}
					break;
				case LuaSyntaxKind.ReturnStatement:
					for (let expressionIndex = 0; expressionIndex < statement.expressions.length; expressionIndex += 1) {
						visitExpression(statement.expressions[expressionIndex]);
					}
					break;
				case LuaSyntaxKind.IfStatement:
					for (let clauseIndex = 0; clauseIndex < statement.clauses.length; clauseIndex += 1) {
						const clause = statement.clauses[clauseIndex];
						if (clause.condition !== null) {
							visitExpression(clause.condition);
						}
						visitStatements(clause.block.body, false);
					}
					break;
				case LuaSyntaxKind.WhileStatement:
					visitExpression(statement.condition);
					visitStatements(statement.block.body, false);
					break;
				case LuaSyntaxKind.RepeatStatement:
					visitStatements(statement.block.body, false);
					visitExpression(statement.condition);
					break;
				case LuaSyntaxKind.ForNumericStatement:
					visitExpression(statement.start);
					visitExpression(statement.limit);
					if (statement.step !== null) {
						visitExpression(statement.step);
					}
					visitStatements(statement.block.body, false);
					break;
				case LuaSyntaxKind.ForGenericStatement:
					for (let iteratorIndex = 0; iteratorIndex < statement.iterators.length; iteratorIndex += 1) {
						visitExpression(statement.iterators[iteratorIndex]);
					}
					visitStatements(statement.block.body, false);
					break;
				case LuaSyntaxKind.DoStatement:
					visitStatements(statement.block.body, false);
					break;
				case LuaSyntaxKind.CallStatement:
					visitExpression(statement.expression);
					break;
				case LuaSyntaxKind.StructDeclarationStatement:
					for (let fieldIndex = 0; fieldIndex < statement.fields.length; fieldIndex += 1) {
						visitTypeReference(statement.fields[fieldIndex].typeRef, visitExpression);
					}
					break;
				case LuaSyntaxKind.BssDeclarationStatement:
					visitTypeReference(statement.typeRef, visitExpression);
					break;
				case LuaSyntaxKind.DataDeclarationStatement:
				case LuaSyntaxKind.RodataDeclarationStatement:
					visitTypeReference(statement.typeRef, visitExpression);
					visitExpression(statement.initializer);
					break;
				case LuaSyntaxKind.BreakStatement:
				case LuaSyntaxKind.HaltUntilIrqStatement:
				case LuaSyntaxKind.GotoStatement:
				case LuaSyntaxKind.LabelStatement:
					break;
			}
		}
	}

	visitStatements(chunk.body, true);
}
