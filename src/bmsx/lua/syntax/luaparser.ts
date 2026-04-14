import { LuaSyntaxError } from '../luaerrors';
import type { LuaToken } from './luatoken';
import { LuaTokenType } from './luatoken';
import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
	LuaAssignmentOperator,
} from './lua_ast';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
	LuaBlock,
	LuaBinaryExpression,
	LuaBooleanLiteralExpression,
	LuaBreakStatement,
	LuaCallExpression,
	LuaCallStatement,
	LuaChunk,
	LuaDoStatement,
	LuaExpression,
	LuaForGenericStatement,
	LuaForNumericStatement,
	LuaFunctionDeclarationStatement,
	LuaFunctionExpression,
	LuaFunctionName,
	LuaHaltUntilIrqStatement,
	LuaIdentifierExpression,
	LuaIfClause,
	LuaIfStatement,
	LuaIndexExpression,
	LuaLabelStatement,
	LuaLocalAssignmentStatement,
	LuaLocalFunctionStatement,
	LuaMemberExpression,
	LuaNilLiteralExpression,
	LuaNode,
	LuaNumericLiteralExpression,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaSourcePosition,
	LuaSourceRange,
	LuaStatement,
	LuaStringLiteralExpression,
	LuaStringRefLiteralExpression,
	LuaLocalAttribute,
	LuaTableArrayField,
	LuaTableConstructorExpression,
	LuaTableExpressionField,
	LuaTableField,
	LuaTableIdentifierField,
	LuaGotoStatement,
	LuaUnaryExpression,
	LuaVarargExpression,
	LuaWhileStatement,
LuaDefinitionInfo,
LuaDefinitionKind,
} from './lua_ast';

type ParsedArguments = {
	readonly arguments: ReadonlyArray<LuaExpression>;
	readonly endToken: LuaToken;
};

export class LuaParser {
	private readonly tokens: ReadonlyArray<LuaToken>;
	private readonly path: string;
	private readonly sourceLines: string[];
	private index: number;
	private previousToken: LuaToken;

	constructor(tokens: ReadonlyArray<LuaToken>, path: string, source: string, lines?: readonly string[]) {
		this.tokens = tokens;
		this.path = path;
		this.sourceLines = lines ? (lines as readonly string[] as string[]) : source.split('\n');
		this.index = 0;
		this.previousToken = this.tokens[0];
	}

	public parseChunk(): LuaChunk {
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.Eof]));
		const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
		const range = this.rangeFromBlockAndToken(block, eofToken);
		return {
			kind: LuaSyntaxKind.Chunk,
			range,
			body: block.body,
			definitions: this.buildDefinitionIndex(block),
		};
	}

	public parseChunkWithRecovery(): { path: LuaChunk; syntaxError: LuaSyntaxError | null } {
		const { block, syntaxError } = this.parseBlockWithRecovery(new Set<LuaTokenType>([LuaTokenType.Eof]));
		let end: LuaSourcePosition;
		if (syntaxError) {
			end = { line: syntaxError.line, column: syntaxError.column };
		} else {
			const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
			end = this.positionFromToken(eofToken);
		}
		const range: LuaSourceRange = { path: this.path, start: block.range.start, end };
		const path: LuaChunk = {
			kind: LuaSyntaxKind.Chunk,
			range,
			body: block.body,
			definitions: this.buildDefinitionIndex(block),
		};
		return { path, syntaxError };
	}

	private parseBlock(terminators: ReadonlySet<LuaTokenType>): LuaBlock {
		const startToken = this.current();
		const statements: LuaStatement[] = [];
		while (!this.isAtEnd() && !terminators.has(this.current().type)) {
			if (this.current().type === LuaTokenType.Semicolon) {
				this.advance();
				continue;
			}
			statements.push(this.parseStatement());
		}
		const startPosition = statements.length > 0 ? statements[0].range.start : this.positionFromToken(startToken);
		const endPosition = statements.length > 0 ? statements[statements.length - 1].range.end : startPosition;
		return {
			kind: LuaSyntaxKind.Block,
			range: {
				path: this.path,
				start: startPosition,
				end: endPosition,
			},
			body: statements,
		};
	}

	private parseBlockWithRecovery(terminators: ReadonlySet<LuaTokenType>): { block: LuaBlock; syntaxError: LuaSyntaxError | null } {
		const startToken = this.current();
		const statements: LuaStatement[] = [];
		let syntaxError: LuaSyntaxError | null = null;
		try {
			while (!this.isAtEnd() && !terminators.has(this.current().type)) {
				if (this.current().type === LuaTokenType.Semicolon) {
					this.advance();
					continue;
				}
				statements.push(this.parseStatement());
			}
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) {
				throw error;
			}
			syntaxError = error;
		}
		const startPosition = statements.length > 0 ? statements[0].range.start : this.positionFromToken(startToken);
		const endPosition = statements.length > 0 ? statements[statements.length - 1].range.end : startPosition;
		return {
			block: {
				kind: LuaSyntaxKind.Block,
				range: {
					path: this.path,
					start: startPosition,
					end: endPosition,
				},
				body: statements,
			},
			syntaxError,
		};
	}

	private parseStatement(): LuaStatement {
		const token = this.current();
		if (token.type === LuaTokenType.DoubleColon) {
			return this.parseLabelStatement();
		}
		switch (token.type) {
			case LuaTokenType.Local:
				return this.parseLocalStatement();
			case LuaTokenType.Function:
				return this.parseFunctionDeclaration();
			case LuaTokenType.Return:
				return this.parseReturnStatement();
			case LuaTokenType.Break:
				return this.parseBreakStatement();
			case LuaTokenType.If:
				return this.parseIfStatement();
			case LuaTokenType.While:
				return this.parseWhileStatement();
			case LuaTokenType.Repeat:
				return this.parseRepeatStatement();
			case LuaTokenType.For:
				return this.parseForStatement();
			case LuaTokenType.Do:
				return this.parseDoStatement();
			case LuaTokenType.HaltUntilIrq:
				return this.parseHaltUntilIrqStatement();
			case LuaTokenType.Goto:
				return this.parseGotoStatement();
			default:
				return this.parseAssignmentOrCall();
		}
	}

	private parseLocalStatement(): LuaStatement {
		const localToken = this.advance();
		if (this.match(LuaTokenType.Function)) {
			return this.parseLocalFunction(localToken);
		}
		return this.parseLocalAssignment(localToken);
	}

	private parseLocalFunction(localToken: LuaToken): LuaLocalFunctionStatement {
		const functionToken = this.previous();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected function name after local function declaration.');
		const nameExpression = this.createIdentifierExpression(nameToken);
		const functionExpression = this.parseFunctionExpression(functionToken);
		const range = this.rangeFromTokenAndNode(localToken, functionExpression);
		return {
			kind: LuaSyntaxKind.LocalFunctionStatement,
			range,
			name: nameExpression,
			functionExpression,
		};
	}

	private parseLabelStatement(): LuaLabelStatement {
		const firstColon = this.consume(LuaTokenType.DoubleColon, 'Expected "::" to begin label.');
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected label name.');
		const secondColon = this.consume(LuaTokenType.DoubleColon, 'Expected closing "::" after label name.');
		return {
			kind: LuaSyntaxKind.LabelStatement,
			range: this.rangeFromTokenAndToken(firstColon, secondColon),
			label: nameToken.lexeme,
		};
	}

	private parseGotoStatement(): LuaGotoStatement {
		const gotoToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected label name after goto.');
		return {
			kind: LuaSyntaxKind.GotoStatement,
			range: this.rangeFromTokenAndToken(gotoToken, nameToken),
			label: nameToken.lexeme,
		};
	}

	private parseHaltUntilIrqStatement(): LuaHaltUntilIrqStatement {
		const haltToken = this.advance();
		if (this.match(LuaTokenType.Semicolon)) {
			// Semicolon is optional and ignored.
		}
		return {
			kind: LuaSyntaxKind.HaltUntilIrqStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(haltToken),
				end: this.positionFromToken(this.previous()),
			},
		};
	}

	private parseLocalAssignment(localToken: LuaToken): LuaLocalAssignmentStatement {
		const names: LuaIdentifierExpression[] = [];
		const attributes: (LuaLocalAttribute | null)[] = [];
		let endPosition = this.positionFromToken(localToken);
		do {
			const nameToken = this.consume(LuaTokenType.Identifier, 'Expected local variable name.');
			names.push(this.createIdentifierExpression(nameToken));
			endPosition = this.positionFromToken(nameToken);
			const attribute = this.parseLocalAttribute();
			attributes.push(attribute);
			if (attribute !== null) {
				endPosition = this.positionFromToken(this.previous());
			}
		} while (this.match(LuaTokenType.Comma));
		const values: LuaExpression[] = [];
		if (this.match(LuaTokenType.Equal)) {
			values.push(...this.parseExpressionList());
			endPosition = values[values.length - 1].range.end;
		}
		return {
			kind: LuaSyntaxKind.LocalAssignmentStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(localToken),
				end: endPosition,
			},
			names,
			attributes,
			values,
		};
	}

	private parseLocalAttribute(): LuaLocalAttribute | null {
		if (!this.match(LuaTokenType.Less)) {
			return null;
		}
		const attributeToken = this.consume(LuaTokenType.Identifier, 'Expected local attribute name.');
		const attribute = this.parseLocalAttributeName(attributeToken);
		this.consume(LuaTokenType.Greater, 'Expected ">" after local attribute name.');
		return attribute;
	}

	private parseLocalAttributeName(attributeToken: LuaToken): LuaLocalAttribute {
		const attribute = attributeToken.lexeme.toLowerCase();
		if (attribute === 'const') {
			return 'const';
		}
		if (attribute === 'close') {
			throw this.error(attributeToken, 'To-be-closed locals are not supported.');
		}
		throw this.error(attributeToken, `Unsupported local attribute '${attributeToken.lexeme}'.`);
	}

	private parseFunctionDeclaration(): LuaFunctionDeclarationStatement {
		const functionToken = this.advance();
		const functionName = this.parseFunctionName();
		const functionExpression = this.parseFunctionExpression(functionToken);
		const range = this.rangeFromTokenAndNode(functionToken, functionExpression);
		return {
			kind: LuaSyntaxKind.FunctionDeclarationStatement,
			range,
			name: functionName,
			functionExpression,
		};
	}

	private parseFunctionName(): LuaFunctionName {
		const identifiers: string[] = [];
		const firstToken = this.consume(LuaTokenType.Identifier, 'Expected function name.');
		identifiers.push(firstToken.lexeme);
		while (this.match(LuaTokenType.Dot)) {
			const identifierToken = this.consume(LuaTokenType.Identifier, 'Expected identifier after "." in function name.');
			identifiers.push(identifierToken.lexeme);
		}
		let methodName: string = null;
		if (this.match(LuaTokenType.Colon)) {
			const methodToken = this.consume(LuaTokenType.Identifier, 'Expected method name after ":".');
			methodName = methodToken.lexeme;
		}
		return {
			identifiers,
			methodName,
		};
	}

	private parseFunctionExpression(functionToken: LuaToken): LuaFunctionExpression {
		this.consume(LuaTokenType.LeftParen, 'Expected "(" after function keyword.');
		const parameters: LuaIdentifierExpression[] = [];
		let hasVararg = false;
		if (!this.check(LuaTokenType.RightParen)) {
			do {
				if (this.match(LuaTokenType.Vararg)) {
					hasVararg = true;
					break;
				}
				const parameterToken = this.consume(LuaTokenType.Identifier, 'Expected parameter name.');
				parameters.push(this.createIdentifierExpression(parameterToken));
			} while (this.match(LuaTokenType.Comma));
			if (hasVararg && this.match(LuaTokenType.Comma)) {
				throw this.error(this.previous(), 'Vararg must be the last parameter.');
			}
			if (hasVararg && !this.check(LuaTokenType.RightParen)) {
				throw this.error(this.current(), 'Unexpected token after vararg parameter.');
			}
		}
		this.consume(LuaTokenType.RightParen, 'Expected ")" after function parameters.');
		const body = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after function body.');
		const range = this.rangeFromTokenAndToken(functionToken, endToken);
		return {
			kind: LuaSyntaxKind.FunctionExpression,
			range,
			parameters,
			hasVararg,
			body,
		};
	}

	private parseReturnStatement(): LuaReturnStatement {
		const returnToken = this.advance();
		const expressions: LuaExpression[] = [];
		if (!this.isReturnTerminator(this.current().type)) {
			expressions.push(this.parseExpression());
			while (this.match(LuaTokenType.Comma)) {
				expressions.push(this.parseExpression());
			}
		}
		let endPosition: LuaSourcePosition = this.positionFromToken(returnToken);
		if (expressions.length > 0) {
			endPosition = expressions[expressions.length - 1].range.end;
		}
		if (this.match(LuaTokenType.Semicolon)) {
			endPosition = this.positionFromToken(this.previous());
		}
		return {
			kind: LuaSyntaxKind.ReturnStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(returnToken),
				end: endPosition,
			},
			expressions,
		};
	}

	private parseBreakStatement(): LuaBreakStatement {
		const breakToken = this.advance();
		if (this.match(LuaTokenType.Semicolon)) {
			// Semicolon is optional and ignored.
		}
		return {
			kind: LuaSyntaxKind.BreakStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(breakToken),
				end: this.positionFromToken(this.previous()),
			},
		};
	}

	private parseIfStatement(): LuaIfStatement {
		const ifToken = this.advance();
		const clauses: LuaIfClause[] = [];
		const condition = this.parseExpression();
		this.consume(LuaTokenType.Then, 'Expected "then" after condition.');
		const thenBlock = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.ElseIf, LuaTokenType.Else, LuaTokenType.End]));
		clauses.push({
			condition,
			block: thenBlock,
		});
		while (this.match(LuaTokenType.ElseIf)) {
			const elseifCondition = this.parseExpression();
			this.consume(LuaTokenType.Then, 'Expected "then" after elseif condition.');
			const elseifBlock = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.ElseIf, LuaTokenType.Else, LuaTokenType.End]));
			clauses.push({
				condition: elseifCondition,
				block: elseifBlock,
			});
		}
		if (this.match(LuaTokenType.Else)) {
			const elseBlock = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
			clauses.push({
				condition: null,
				block: elseBlock,
			});
		}
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after if statement.');
		const range = this.rangeFromTokenAndToken(ifToken, endToken);
		return {
			kind: LuaSyntaxKind.IfStatement,
			range,
			clauses,
		};
	}

	private parseWhileStatement(): LuaWhileStatement {
		const whileToken = this.advance();
		const condition = this.parseExpression();
		this.consume(LuaTokenType.Do, 'Expected "do" after while condition.');
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after while body.');
		const range = this.rangeFromTokenAndToken(whileToken, endToken);
		return {
			kind: LuaSyntaxKind.WhileStatement,
			range,
			condition,
			block,
		};
	}

	private parseRepeatStatement(): LuaRepeatStatement {
		const repeatToken = this.advance();
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.Until]));
		this.consume(LuaTokenType.Until, 'Expected "until" after repeat block.');
		const condition = this.parseExpression();
		const range = this.rangeFromTokenAndNode(repeatToken, condition);
		return {
			kind: LuaSyntaxKind.RepeatStatement,
			range,
			block,
			condition,
		};
	}

	private parseForStatement(): LuaStatement {
		const forToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected loop variable name.');
		const firstVariable = this.createIdentifierExpression(nameToken);
		if (this.match(LuaTokenType.Equal)) {
			return this.parseForNumeric(forToken, firstVariable);
		}
		const variables: LuaIdentifierExpression[] = [firstVariable];
		while (this.match(LuaTokenType.Comma)) {
			const identifierToken = this.consume(LuaTokenType.Identifier, 'Expected loop variable name.');
			variables.push(this.createIdentifierExpression(identifierToken));
		}
		this.consume(LuaTokenType.In, 'Expected "in" in generic for loop.');
		const iterators = this.parseExpressionList();
		this.consume(LuaTokenType.Do, 'Expected "do" in for loop.');
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after for loop.');
		const range = this.rangeFromTokenAndToken(forToken, endToken);
		const statement: LuaForGenericStatement = {
			kind: LuaSyntaxKind.ForGenericStatement,
			range,
			variables,
			iterators,
			block,
		};
		return statement;
	}

	private parseForNumeric(forToken: LuaToken, variable: LuaIdentifierExpression): LuaForNumericStatement {
		const startExpression = this.parseExpression();
		this.consume(LuaTokenType.Comma, 'Expected "," after start expression in numeric for loop.');
		const limitExpression = this.parseExpression();
		let stepExpression: LuaExpression | null = null;
		if (this.match(LuaTokenType.Comma)) {
			stepExpression = this.parseExpression();
		}
		this.consume(LuaTokenType.Do, 'Expected "do" in numeric for loop.');
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after numeric for loop.');
		const range = this.rangeFromTokenAndToken(forToken, endToken);
		return {
			kind: LuaSyntaxKind.ForNumericStatement,
			range,
			variable,
			start: startExpression,
			limit: limitExpression,
			step: stepExpression,
			block,
		};
	}

	private parseDoStatement(): LuaDoStatement {
		const doToken = this.advance();
		const block = this.parseBlock(new Set<LuaTokenType>([LuaTokenType.End]));
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after do block.');
		const range = this.rangeFromTokenAndToken(doToken, endToken);
		return {
			kind: LuaSyntaxKind.DoStatement,
			range,
			block,
		};
	}

	private parseAssignmentOrCall(): LuaStatement {
		const expression = this.parsePrefixExpression();
		if (this.check(LuaTokenType.Comma) || this.isAssignmentOperator(this.current().type)) {
			return this.parseAssignment(expression);
		}
		if (expression.kind === LuaSyntaxKind.CallExpression) {
			return this.createCallStatement(expression as LuaCallExpression);
		}
		throw this.errorAtRange(expression.range, 'Expected assignment or function call.');
	}

	private parseAssignment(firstExpression: LuaExpression): LuaAssignmentStatement {
		const targets: LuaAssignableExpression[] = [];
		targets.push(this.requireAssignable(firstExpression));
		while (this.match(LuaTokenType.Comma)) {
			const next = this.parsePrefixExpression();
			targets.push(this.requireAssignable(next));
		}
		const operatorToken = this.current();
		if (!this.isAssignmentOperator(operatorToken.type)) {
			throw this.error(operatorToken, 'Expected assignment operator.');
		}
		const operator = this.resolveAssignmentOperator(operatorToken.type);
		this.advance();
		let values: LuaExpression[] = [];
		if (operator === LuaAssignmentOperator.Assign) {
			values = this.parseExpressionList();
		}
		else {
			if (targets.length !== 1) {
				throw this.error(operatorToken, 'Augmented assignment requires exactly one target.');
			}
			const expression = this.parseExpression();
			if (this.check(LuaTokenType.Comma)) {
				throw this.error(this.current(), 'Augmented assignment accepts only one expression.');
			}
			values = [expression];
		}
		const startPosition = targets[0].range.start;
		const endPosition = values.length > 0 ? values[values.length - 1].range.end : this.positionFromToken(this.previous());
		return {
			kind: LuaSyntaxKind.AssignmentStatement,
			range: {
				path: this.path,
				start: startPosition,
				end: endPosition,
			},
			left: targets,
			right: values,
			operator,
		};
	}

	private createCallStatement(expression: LuaCallExpression): LuaCallStatement {
		return {
			kind: LuaSyntaxKind.CallStatement,
			range: expression.range,
			expression,
		};
	}

	private isAssignmentOperator(tokenType: LuaTokenType): boolean {
		switch (tokenType) {
			case LuaTokenType.Equal:
			case LuaTokenType.PlusEqual:
			case LuaTokenType.MinusEqual:
			case LuaTokenType.StarEqual:
			case LuaTokenType.SlashEqual:
			case LuaTokenType.PercentEqual:
			case LuaTokenType.CaretEqual:
				return true;
			default:
				return false;
		}
	}

	private resolveAssignmentOperator(tokenType: LuaTokenType): LuaAssignmentOperator {
		switch (tokenType) {
			case LuaTokenType.Equal:
				return LuaAssignmentOperator.Assign;
			case LuaTokenType.PlusEqual:
				return LuaAssignmentOperator.AddAssign;
			case LuaTokenType.MinusEqual:
				return LuaAssignmentOperator.SubtractAssign;
			case LuaTokenType.StarEqual:
				return LuaAssignmentOperator.MultiplyAssign;
			case LuaTokenType.SlashEqual:
				return LuaAssignmentOperator.DivideAssign;
			case LuaTokenType.PercentEqual:
				return LuaAssignmentOperator.ModulusAssign;
			case LuaTokenType.CaretEqual:
				return LuaAssignmentOperator.ExponentAssign;
			default:
				throw this.error(this.current(), 'Unsupported assignment operator.');
		}
	}

	private parseExpression(): LuaExpression {
		return this.parseOrExpression();
	}

	private parseOrExpression(): LuaExpression {
		let expression = this.parseAndExpression();
		while (this.match(LuaTokenType.Or)) {
			const right = this.parseAndExpression();
			expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Or);
		}
		return expression;
	}

	private parseAndExpression(): LuaExpression {
		let expression = this.parseComparisonExpression();
		while (this.match(LuaTokenType.And)) {
			const right = this.parseComparisonExpression();
			expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.And);
		}
		return expression;
	}

	private parseComparisonExpression(): LuaExpression {
		let expression = this.parseBitwiseOrExpression();
		while (true) {
			if (this.match(LuaTokenType.EqualEqual)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Equal);
				continue;
			}
			if (this.match(LuaTokenType.TildeEqual)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.NotEqual);
				continue;
			}
			if (this.match(LuaTokenType.Less)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.LessThan);
				continue;
			}
			if (this.match(LuaTokenType.LessEqual)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.LessEqual);
				continue;
			}
			if (this.match(LuaTokenType.Greater)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.GreaterThan);
				continue;
			}
			if (this.match(LuaTokenType.GreaterEqual)) {
				const right = this.parseBitwiseOrExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.GreaterEqual);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseBitwiseOrExpression(): LuaExpression {
		let expression = this.parseBitwiseXorExpression();
		while (this.match(LuaTokenType.Pipe)) {
			const right = this.parseBitwiseXorExpression();
			expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.BitwiseOr);
		}
		return expression;
	}

	private parseBitwiseXorExpression(): LuaExpression {
		let expression = this.parseBitwiseAndExpression();
		while (this.match(LuaTokenType.Tilde)) {
			const right = this.parseBitwiseAndExpression();
			expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.BitwiseXor);
		}
		return expression;
	}

	private parseBitwiseAndExpression(): LuaExpression {
		let expression = this.parseShiftExpression();
		while (this.match(LuaTokenType.Ampersand)) {
			const right = this.parseShiftExpression();
			expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.BitwiseAnd);
		}
		return expression;
	}

	private parseShiftExpression(): LuaExpression {
		let expression = this.parseConcatenationExpression();
		while (true) {
			if (this.match(LuaTokenType.ShiftLeft)) {
				const right = this.parseConcatenationExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.ShiftLeft);
				continue;
			}
			if (this.match(LuaTokenType.ShiftRight)) {
				const right = this.parseConcatenationExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.ShiftRight);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseConcatenationExpression(): LuaExpression {
		const expression = this.parseAdditiveExpression();
		if (this.match(LuaTokenType.DotDot)) {
			const right = this.parseConcatenationExpression();
			return this.createBinaryExpression(expression, right, LuaBinaryOperator.Concat);
		}
		return expression;
	}

	private parseAdditiveExpression(): LuaExpression {
		let expression = this.parseMultiplicativeExpression();
		while (true) {
			if (this.match(LuaTokenType.Plus)) {
				const right = this.parseMultiplicativeExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Add);
				continue;
			}
			if (this.match(LuaTokenType.Minus)) {
				const right = this.parseMultiplicativeExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Subtract);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseMultiplicativeExpression(): LuaExpression {
		let expression = this.parseUnaryExpression();
		while (true) {
			if (this.match(LuaTokenType.Star)) {
				const right = this.parseUnaryExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Multiply);
				continue;
			}
			if (this.match(LuaTokenType.Slash)) {
				const right = this.parseUnaryExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Divide);
				continue;
			}
			if (this.match(LuaTokenType.FloorDivide)) {
				const right = this.parseUnaryExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.FloorDivide);
				continue;
			}
			if (this.match(LuaTokenType.Percent)) {
				const right = this.parseUnaryExpression();
				expression = this.createBinaryExpression(expression, right, LuaBinaryOperator.Modulus);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseUnaryExpression(): LuaExpression {
		if (this.check(LuaTokenType.Ampersand) && this.peekType(1) === LuaTokenType.String) {
			const ampersandToken = this.advance();
			const stringToken = this.advance();
			return this.createStringRefLiteralExpression(ampersandToken, stringToken);
		}
		if (this.match(LuaTokenType.Not)) {
			const operatorToken = this.previous();
			const operand = this.parseUnaryExpression();
			return this.createUnaryExpression(operatorToken, operand, LuaUnaryOperator.Not);
		}
		if (this.match(LuaTokenType.Minus)) {
			const operatorToken = this.previous();
			const operand = this.parseUnaryExpression();
			return this.createUnaryExpression(operatorToken, operand, LuaUnaryOperator.Negate);
		}
		if (this.match(LuaTokenType.Hash)) {
			const operatorToken = this.previous();
			const operand = this.parseUnaryExpression();
			return this.createUnaryExpression(operatorToken, operand, LuaUnaryOperator.Length);
		}
		if (this.match(LuaTokenType.Tilde)) {
			const operatorToken = this.previous();
			const operand = this.parseUnaryExpression();
			return this.createUnaryExpression(operatorToken, operand, LuaUnaryOperator.BitwiseNot);
		}
		return this.parseExponentExpression();
	}

	private parseExponentExpression(): LuaExpression {
		const baseExpression = this.parsePrefixExpression();
		if (this.match(LuaTokenType.Caret)) {
			const right = this.parseUnaryExpression();
			return this.createBinaryExpression(baseExpression, right, LuaBinaryOperator.Exponent);
		}
		return baseExpression;
	}

	private parsePrefixExpression(): LuaExpression {
		let expression = this.parsePrimaryExpression();
		while (true) {
			if (this.match(LuaTokenType.LeftBracket)) {
				const indexExpression = this.parseExpression();
				const rightBracket = this.consume(LuaTokenType.RightBracket, 'Expected "]" after index expression.');
				const range = this.rangeFromNodeAndToken(expression, rightBracket);
				const indexNode: LuaIndexExpression = {
					kind: LuaSyntaxKind.IndexExpression,
					range,
					base: expression,
					index: indexExpression,
				};
				expression = indexNode;
				continue;
			}
			if (this.match(LuaTokenType.Dot)) {
				const identifierToken = this.consume(LuaTokenType.Identifier, 'Expected identifier after ".".');
				const range = this.rangeFromNodeAndToken(expression, identifierToken);
				const memberNode: LuaMemberExpression = {
					kind: LuaSyntaxKind.MemberExpression,
					range,
					base: expression,
					identifier: identifierToken.lexeme,
				};
				expression = memberNode;
				continue;
			}
			if (this.match(LuaTokenType.Colon)) {
				const methodToken = this.consume(LuaTokenType.Identifier, 'Expected method name after ":".');
				const parsedArguments = this.parseCallArguments();
				expression = this.createCallExpression(expression, parsedArguments, methodToken.lexeme);
				continue;
			}
			const tokenType = this.current().type;
			if (
				tokenType === LuaTokenType.LeftParen ||
				tokenType === LuaTokenType.LeftBrace ||
				tokenType === LuaTokenType.String
			) {
				const parsedArguments = this.parseCallArguments();
				expression = this.createCallExpression(expression, parsedArguments, null);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseCallArguments(): ParsedArguments {
		if (this.match(LuaTokenType.LeftParen)) {
			const args: LuaExpression[] = [];
			if (!this.check(LuaTokenType.RightParen)) {
				args.push(this.parseExpression());
				while (this.match(LuaTokenType.Comma)) {
					args.push(this.parseExpression());
				}
			}
			const rightParen = this.consume(LuaTokenType.RightParen, 'Expected ")" after arguments.');
			return {
				arguments: args,
				endToken: rightParen,
			};
		}
		if (this.check(LuaTokenType.LeftBrace)) {
			const leftBrace = this.advance();
			const tableExpression = this.parseTableConstructorExpression(leftBrace);
			const endToken = this.previous();
			return {
				arguments: [tableExpression],
				endToken,
			};
		}
		if (this.check(LuaTokenType.String)) {
			const stringToken = this.advance();
			const stringExpression = this.createStringLiteralExpression(stringToken);
			return {
				arguments: [stringExpression],
				endToken: stringToken,
			};
		}
		throw this.error(this.current(), 'Invalid function call arguments.');
	}

	private createCallExpression(callee: LuaExpression, parsedArguments: ParsedArguments, methodName: string): LuaCallExpression {
		return {
			kind: LuaSyntaxKind.CallExpression,
			range: this.rangeFromNodeAndToken(callee, parsedArguments.endToken),
			callee,
			arguments: parsedArguments.arguments,
			methodName,
		};
	}

	private parsePrimaryExpression(): LuaExpression {
		const token = this.current();
		switch (token.type) {
			case LuaTokenType.Nil:
				return this.parseNilLiteral();
			case LuaTokenType.True:
				return this.parseBooleanLiteral(true);
			case LuaTokenType.False:
				return this.parseBooleanLiteral(false);
			case LuaTokenType.Number:
				return this.parseNumericLiteral();
			case LuaTokenType.String:
				return this.parseStringLiteral();
			case LuaTokenType.Identifier:
				return this.parseIdentifier();
			case LuaTokenType.Vararg:
				return this.parseVararg();
			case LuaTokenType.Function:
				return this.parseFunctionExpression(this.advance());
			case LuaTokenType.LeftBrace:
				return this.parseTableConstructorExpression(this.advance());
			case LuaTokenType.LeftParen: {
				this.advance();
				const expression = this.parseExpression();
				this.consume(LuaTokenType.RightParen, 'Expected ")" after expression.');
				return expression;
			}
			default:
				throw this.error(token, 'Unexpected token.');
		}
	}

	private parseNilLiteral(): LuaNilLiteralExpression {
		const token = this.advance();
		return {
			kind: LuaSyntaxKind.NilLiteralExpression,
			range: this.rangeFromTokenAndToken(token, token),
		};
	}

	private parseBooleanLiteral(value: boolean): LuaBooleanLiteralExpression {
		const token = this.advance();
		return {
			kind: LuaSyntaxKind.BooleanLiteralExpression,
			range: this.rangeFromTokenAndToken(token, token),
			value,
		};
	}

	private parseNumericLiteral(): LuaNumericLiteralExpression {
		const token = this.advance();
		if (typeof token.literal !== 'number') {
			throw this.error(token, 'Expected numeric literal.');
		}
		return {
			kind: LuaSyntaxKind.NumericLiteralExpression,
			range: this.rangeFromTokenAndToken(token, token),
			value: token.literal,
		};
	}

	private parseStringLiteral(): LuaStringLiteralExpression {
		const token = this.advance();
		return this.createStringLiteralExpression(token);
	}

	private parseIdentifier(): LuaIdentifierExpression {
		const token = this.advance();
		return this.createIdentifierExpression(token);
	}

	private parseVararg(): LuaVarargExpression {
		const token = this.advance();
		return {
			kind: LuaSyntaxKind.VarargExpression,
			range: this.rangeFromTokenAndToken(token, token),
		};
	}

	private parseTableConstructorExpression(leftBrace: LuaToken): LuaTableConstructorExpression {
		const fields: LuaTableField[] = [];
		if (!this.check(LuaTokenType.RightBrace)) {
			while (true) {
				if (this.match(LuaTokenType.LeftBracket)) {
					const keyExpression = this.parseExpression();
					this.consume(LuaTokenType.RightBracket, 'Expected "]" after table key.');
					this.consume(LuaTokenType.Equal, 'Expected "=" after table key.');
					const valueExpression = this.parseExpression();
					const range: LuaSourceRange = {
						path: this.path,
						start: keyExpression.range.start,
						end: valueExpression.range.end,
					};
					const field: LuaTableExpressionField = {
						kind: LuaTableFieldKind.ExpressionKey,
						range,
						key: keyExpression,
						value: valueExpression,
					};
					fields.push(field);
				}
				else if (this.check(LuaTokenType.Identifier) && this.peekType(1) === LuaTokenType.Equal) {
					const nameToken = this.advance();
					this.consume(LuaTokenType.Equal, 'Expected "=" after table identifier key.');
					const valueExpression = this.parseExpression();
					const range: LuaSourceRange = {
						path: this.path,
						start: this.positionFromToken(nameToken),
						end: valueExpression.range.end,
					};
					const field: LuaTableIdentifierField = {
						kind: LuaTableFieldKind.IdentifierKey,
						range,
						name: nameToken.lexeme,
						value: valueExpression,
					};
					fields.push(field);
				}
				else {
					const valueExpression = this.parseExpression();
					const field: LuaTableArrayField = {
						kind: LuaTableFieldKind.Array,
						range: valueExpression.range,
						value: valueExpression,
					};
					fields.push(field);
				}
				if (this.match(LuaTokenType.Comma) || this.match(LuaTokenType.Semicolon)) {
					if (this.check(LuaTokenType.RightBrace)) {
						break;
					}
					continue;
				}
				break;
			}
		}
		const rightBrace = this.consume(LuaTokenType.RightBrace, 'Expected "}" after table constructor.');
		const range = this.rangeFromTokenAndToken(leftBrace, rightBrace);
		return {
			kind: LuaSyntaxKind.TableConstructorExpression,
			range,
			fields,
		};
	}

	private parseExpressionList(): LuaExpression[] {
		const expressions: LuaExpression[] = [];
		expressions.push(this.parseExpression());
		while (this.match(LuaTokenType.Comma)) {
			expressions.push(this.parseExpression());
		}
		return expressions;
	}

	private createBinaryExpression(left: LuaExpression, right: LuaExpression, operator: LuaBinaryOperator): LuaBinaryExpression {
		return {
			kind: LuaSyntaxKind.BinaryExpression,
			range: {
				path: this.path,
				start: left.range.start,
				end: right.range.end,
			},
			operator,
			left,
			right,
		};
	}

	private buildDefinitionIndex(rootBlock: LuaBlock): LuaDefinitionInfo[] {
		const definitions: LuaDefinitionInfo[] = [];
		const pushDefinition = (path: ReadonlyArray<string>, definitionRange: LuaSourceRange, scopeRange: LuaSourceRange, kind: LuaDefinitionKind): void => {
			if (!path || path.length === 0) {
				return;
			}
			const name = path[path.length - 1];
			definitions.push({ name, namePath: Array.from(path), definition: definitionRange, scope: scopeRange, kind });
		};
		const extractTableKeyFromExpression = (expression: LuaExpression): string => {
			switch (expression.kind) {
				case LuaSyntaxKind.StringLiteralExpression:
					return (expression as LuaStringLiteralExpression).value;
				case LuaSyntaxKind.IdentifierExpression:
					return (expression as LuaIdentifierExpression).name;
				default:
					return null;
			}
		};
		const extractPathFromExpression = (expression: LuaExpression): string[] => {
			switch (expression.kind) {
				case LuaSyntaxKind.IdentifierExpression:
					return [(expression as LuaIdentifierExpression).name];
				case LuaSyntaxKind.MemberExpression: {
					const member = expression as LuaMemberExpression;
					const basePath = extractPathFromExpression(member.base);
					if (!basePath) {
						return null;
					}
					const extended = basePath.slice();
					extended.push(member.identifier);
					return extended;
				}
				case LuaSyntaxKind.IndexExpression: {
					const indexExpression = expression as LuaIndexExpression;
					const basePath = extractPathFromExpression(indexExpression.base);
					if (!basePath) {
						return null;
					}
					const key = extractTableKeyFromExpression(indexExpression.index);
					if (!key) {
						return null;
					}
					const extended = basePath.slice();
					extended.push(key);
					return extended;
				}
				default:
					return null;
			}
		};
		const mapAssignmentValues = (targetCount: number, values: ReadonlyArray<LuaExpression>): Array<LuaExpression> => {
			const mapped: Array<LuaExpression> = [];
			if (targetCount <= 0) {
				return mapped;
			}
			for (let index = 0; index < targetCount; index += 1) {
				if (index < values.length) {
					mapped.push(values[index]);
				} else {
					mapped.push(null);
				}
			}
			return mapped;
		};
		const recordTableFields = (tableExpression: LuaTableConstructorExpression, basePath: ReadonlyArray<string>, scope: LuaSourceRange): void => {
			for (const field of tableExpression.fields) {
				if (field.kind === LuaTableFieldKind.Array) {
					const arrayField = field as LuaTableArrayField;
					visitExpression(arrayField.value);
					continue;
				}
				if (field.kind === LuaTableFieldKind.IdentifierKey) {
					const identifierField = field as LuaTableIdentifierField;
					const fieldPath = [...basePath, identifierField.name];
					const identifierStart = identifierField.range.start;
					const identifierLength = identifierField.name.length;
					const identifierEndColumn = identifierLength > 0
						? identifierStart.column + Math.max(0, identifierLength - 1)
						: identifierStart.column;
					const identifierRange: LuaSourceRange = {
						path: this.path,
						start: identifierStart,
						end: {
							line: identifierStart.line,
							column: identifierEndColumn,
						},
					};
					pushDefinition(fieldPath, identifierRange, scope, 'table_field');
					if (identifierField.value.kind === LuaSyntaxKind.TableConstructorExpression) {
						recordTableFields(identifierField.value as LuaTableConstructorExpression, fieldPath, scope);
					} else {
						visitExpression(identifierField.value);
					}
					continue;
				}
				const expressionField = field as LuaTableExpressionField;
				const key = extractTableKeyFromExpression(expressionField.key);
				if (key !== null) {
					const fieldPath = [...basePath, key];
					pushDefinition(fieldPath, expressionField.key.range, scope, 'table_field');
					if (expressionField.value.kind === LuaSyntaxKind.TableConstructorExpression) {
						recordTableFields(expressionField.value as LuaTableConstructorExpression, fieldPath, scope);
					} else {
						visitExpression(expressionField.value);
					}
				} else {
					visitExpression(expressionField.key);
					visitExpression(expressionField.value);
				}
			}
		};
		const refineAssignmentDefinitionRange = (target: LuaAssignableExpression, baseRange: LuaSourceRange): LuaSourceRange => {
			if (!target) {
				return baseRange;
			}
			if (target.kind === LuaSyntaxKind.MemberExpression) {
				const member = target as LuaMemberExpression;
				const identifierLength = member.identifier.length;
				const start = member.range.end;
				const adjustedEndColumn = identifierLength > 0 ? start.column + Math.max(0, identifierLength - 1) : start.column;
				return {
					path: baseRange.path,
					start,
					end: {
						line: start.line,
						column: adjustedEndColumn,
					},
				};
			}
			if (target.kind === LuaSyntaxKind.IndexExpression) {
				const indexExpression = target as LuaIndexExpression;
				const start = indexExpression.index.range.start;
				const end = indexExpression.index.range.end;
				return {
					path: baseRange.path,
					start,
					end,
				};
			}
			return baseRange;
		};
		const recordAssignmentValue = (path: ReadonlyArray<string>, value: LuaExpression, scope: LuaSourceRange): void => {
			if (!value) {
				return;
			}
			if (value.kind === LuaSyntaxKind.TableConstructorExpression) {
				recordTableFields(value as LuaTableConstructorExpression, path, scope);
			}
		};
		const visitExpression = (expression: LuaExpression): void => {
			switch (expression.kind) {
				case LuaSyntaxKind.FunctionExpression:
					visitFunctionExpression(expression as LuaFunctionExpression);
					break;
				case LuaSyntaxKind.BinaryExpression: {
					const binary = expression as LuaBinaryExpression;
					visitExpression(binary.left);
					visitExpression(binary.right);
					break;
				}
				case LuaSyntaxKind.UnaryExpression:
					visitExpression((expression as LuaUnaryExpression).operand);
					break;
				case LuaSyntaxKind.CallExpression: {
					const call = expression as LuaCallExpression;
					visitExpression(call.callee);
					for (const argument of call.arguments) {
						visitExpression(argument);
					}
					break;
				}
				case LuaSyntaxKind.MemberExpression:
					visitExpression((expression as LuaMemberExpression).base);
					break;
				case LuaSyntaxKind.IndexExpression: {
					const indexExpression = expression as LuaIndexExpression;
					visitExpression(indexExpression.base);
					visitExpression(indexExpression.index);
					break;
				}
				case LuaSyntaxKind.TableConstructorExpression: {
					const tableExpression = expression as LuaTableConstructorExpression;
					for (const field of tableExpression.fields) {
						if (field.kind === LuaTableFieldKind.Array) {
							visitExpression((field as LuaTableArrayField).value);
						} else if (field.kind === LuaTableFieldKind.IdentifierKey) {
							visitExpression((field as LuaTableIdentifierField).value);
						} else if (field.kind === LuaTableFieldKind.ExpressionKey) {
							const expressionField = field as LuaTableExpressionField;
							visitExpression(expressionField.key);
							visitExpression(expressionField.value);
						}
					}
					break;
				}
				default:
					break;
			}
		};
		const visitFunctionExpression = (expression: LuaFunctionExpression): void => {
			const scope = expression.body.range;
			for (const parameter of expression.parameters) {
				pushDefinition([parameter.name], parameter.range, scope, 'parameter');
			}
			visitBlock(expression.body, scope);
		};
		const visitStatement = (statement: LuaStatement, currentScope: LuaSourceRange): void => {
			switch (statement.kind) {
			case LuaSyntaxKind.LocalAssignmentStatement: {
				const localAssignment = statement as LuaLocalAssignmentStatement;
				const mappedValues = mapAssignmentValues(localAssignment.names.length, localAssignment.values);
				for (let index = 0; index < localAssignment.names.length; index += 1) {
					const identifier = localAssignment.names[index];
					const path = [identifier.name];
					const kind = localAssignment.attributes[index] === 'const' ? 'constant' : 'variable';
					pushDefinition(path, identifier.range, currentScope, kind);
					recordAssignmentValue(path, mappedValues[index], currentScope);
				}
					for (const value of localAssignment.values) {
						visitExpression(value);
					}
					break;
				}
			case LuaSyntaxKind.LocalFunctionStatement: {
				const localFunction = statement as LuaLocalFunctionStatement;
				pushDefinition([localFunction.name.name], localFunction.name.range, currentScope, 'function');
				visitFunctionExpression(localFunction.functionExpression);
				break;
			}
				case LuaSyntaxKind.FunctionDeclarationStatement: {
					const functionDeclaration = statement as LuaFunctionDeclarationStatement;
					visitFunctionExpression(functionDeclaration.functionExpression);
					break;
				}
				case LuaSyntaxKind.AssignmentStatement: {
					const assignment = statement as LuaAssignmentStatement;
					for (const expression of assignment.right) {
						visitExpression(expression);
					}
				const mappedValues = mapAssignmentValues(assignment.left.length, assignment.right);
				for (let index = 0; index < assignment.left.length; index += 1) {
					const target = assignment.left[index];
					const path = extractPathFromExpression(target);
					if (!path) {
						continue;
					}
					const refinedRange = refineAssignmentDefinitionRange(target, target.range);
					pushDefinition(path, refinedRange, currentScope, 'assignment');
					recordAssignmentValue(path, mappedValues[index], currentScope);
				}
				break;
			}
				case LuaSyntaxKind.ReturnStatement: {
					const returnStatement = statement as LuaReturnStatement;
					for (const expression of returnStatement.expressions) {
						if (expression.kind === LuaSyntaxKind.TableConstructorExpression) {
							const tableExpression = expression as LuaTableConstructorExpression;
							recordTableFields(tableExpression, [], returnStatement.range);
							continue;
						}
						visitExpression(expression);
					}
					break;
				}
				case LuaSyntaxKind.IfStatement: {
					const ifStatement = statement as LuaIfStatement;
					for (const clause of ifStatement.clauses) {
						if (clause.condition) {
							visitExpression(clause.condition);
						}
						visitBlock(clause.block, clause.block.range);
					}
					break;
				}
				case LuaSyntaxKind.WhileStatement: {
					const whileStatement = statement as LuaWhileStatement;
					visitExpression(whileStatement.condition);
					visitBlock(whileStatement.block, whileStatement.block.range);
					break;
				}
				case LuaSyntaxKind.RepeatStatement: {
					const repeatStatement = statement as LuaRepeatStatement;
					visitBlock(repeatStatement.block, repeatStatement.block.range);
					visitExpression(repeatStatement.condition);
					break;
				}
				case LuaSyntaxKind.DoStatement: {
					const doStatement = statement as LuaDoStatement;
					visitBlock(doStatement.block, doStatement.block.range);
					break;
				}
				case LuaSyntaxKind.HaltUntilIrqStatement:
					break;
			case LuaSyntaxKind.ForNumericStatement: {
				const forNumeric = statement as LuaForNumericStatement;
				pushDefinition([forNumeric.variable.name], forNumeric.variable.range, forNumeric.block.range, 'variable');
				visitExpression(forNumeric.start);
				visitExpression(forNumeric.limit);
				if (forNumeric.step) {
					visitExpression(forNumeric.step);
				}
					visitBlock(forNumeric.block, forNumeric.block.range);
					break;
				}
			case LuaSyntaxKind.ForGenericStatement: {
				const forGeneric = statement as LuaForGenericStatement;
				for (const variable of forGeneric.variables) {
					pushDefinition([variable.name], variable.range, forGeneric.block.range, 'variable');
				}
				for (const iterator of forGeneric.iterators) {
					visitExpression(iterator);
				}
					visitBlock(forGeneric.block, forGeneric.block.range);
					break;
				}
				case LuaSyntaxKind.CallStatement: {
					const callStatement = statement as LuaCallStatement;
					visitExpression(callStatement.expression);
					break;
				}
				case LuaSyntaxKind.GotoStatement:
				case LuaSyntaxKind.LabelStatement:
				case LuaSyntaxKind.BreakStatement:
					break;
			}
		};
		const visitBlock = (block: LuaBlock, scope: LuaSourceRange): void => {
			for (const statement of block.body) {
				visitStatement(statement, scope);
			}
		};
		visitBlock(rootBlock, rootBlock.range);
		return definitions;
	}

	private createUnaryExpression(operatorToken: LuaToken, operand: LuaExpression, operator: LuaUnaryOperator): LuaUnaryExpression {
		return {
			kind: LuaSyntaxKind.UnaryExpression,
			range: {
				path: this.path,
				start: this.positionFromToken(operatorToken),
				end: operand.range.end,
			},
			operator,
			operand,
		};
	}

	private createIdentifierExpression(token: LuaToken): LuaIdentifierExpression {
		return {
			kind: LuaSyntaxKind.IdentifierExpression,
			range: this.rangeFromTokenAndToken(token, token),
			name: token.lexeme,
		};
	}

	private createStringLiteralExpression(token: LuaToken): LuaStringLiteralExpression {
		if (typeof token.literal !== 'string') {
			throw this.error(token, 'Expected string literal.');
		}
		return {
			kind: LuaSyntaxKind.StringLiteralExpression,
			range: this.rangeFromTokenAndToken(token, token),
			value: token.literal,
		};
	}

	private createStringRefLiteralExpression(ampersandToken: LuaToken, stringToken: LuaToken): LuaStringRefLiteralExpression {
		if (typeof stringToken.literal !== 'string') {
			throw this.error(stringToken, 'Expected string literal after "&".');
		}
		return {
			kind: LuaSyntaxKind.StringRefLiteralExpression,
			range: this.rangeFromTokenAndToken(ampersandToken, stringToken),
			value: stringToken.literal,
		};
	}

	private requireAssignable(expression: LuaExpression): LuaAssignableExpression {
		if (
			expression.kind === LuaSyntaxKind.IdentifierExpression ||
			expression.kind === LuaSyntaxKind.MemberExpression ||
			expression.kind === LuaSyntaxKind.IndexExpression
		) {
			return expression as LuaAssignableExpression;
		}
		throw this.error(this.current(), 'Expression is not assignable.');
	}

	private isReturnTerminator(type: LuaTokenType): boolean {
		return type === LuaTokenType.End ||
			type === LuaTokenType.Else ||
			type === LuaTokenType.ElseIf ||
			type === LuaTokenType.Until ||
			type === LuaTokenType.Eof;
	}

	private isAtEnd(): boolean {
		return this.current().type === LuaTokenType.Eof;
	}

	private current(): LuaToken {
		return this.tokens[this.index];
	}

	private previous(): LuaToken {
		return this.previousToken;
	}

	private advance(): LuaToken {
		const token = this.tokens[this.index];
		if (!this.isAtEnd()) {
			this.index += 1;
		}
		this.previousToken = token;
		return token;
	}

	private check(type: LuaTokenType): boolean {
		if (this.isAtEnd()) {
			return type === LuaTokenType.Eof;
		}
		return this.current().type === type;
	}

	private match(type: LuaTokenType): boolean;
	private match(...types: LuaTokenType[]): boolean;
	private match(...types: LuaTokenType[]): boolean {
		for (const type of types) {
			if (this.check(type)) {
				this.advance();
				return true;
			}
		}
		return false;
	}

	private consume(type: LuaTokenType, message: string): LuaToken {
		if (this.check(type)) {
			return this.advance();
		}
		throw this.error(this.current(), message);
	}

	private peekType(offset: number): LuaTokenType {
		const index = this.index + offset;
		if (index >= this.tokens.length) {
			return LuaTokenType.Eof;
		}
		return this.tokens[index].type;
	}

	private rangeFromTokenAndToken(startToken: LuaToken, endToken: LuaToken): LuaSourceRange {
		return {
			path: this.path,
			start: this.positionFromToken(startToken),
			end: this.positionFromToken(endToken),
		};
	}

	private rangeFromTokenAndNode(startToken: LuaToken, node: LuaNode): LuaSourceRange {
		return {
			path: this.path,
			start: this.positionFromToken(startToken),
			end: node.range.end,
		};
	}

	private rangeFromNodeAndToken(node: LuaNode, endToken: LuaToken): LuaSourceRange {
		return {
			path: this.path,
			start: node.range.start,
			end: this.positionFromToken(endToken),
		};
	}

	private rangeFromBlockAndToken(block: LuaBlock, endToken: LuaToken): LuaSourceRange {
		return {
			path: this.path,
			start: block.range.start,
			end: this.positionFromToken(endToken),
		};
	}

	private positionFromToken(token: LuaToken): LuaSourcePosition {
		return { line: token.line, column: token.column };
	}

	private error(token: LuaToken, message: string): LuaSyntaxError {
		const payload = this.formatError(token.line, token.column, message, token.lexeme ?? '');
		return new LuaSyntaxError(payload, this.path, token.line, token.column);
	}

	private errorAtRange(range: LuaSourceRange, message: string): LuaSyntaxError {
		const lexeme = this.extractLexeme(range);
		const payload = this.formatError(range.start.line, range.start.column, message, lexeme);
		return new LuaSyntaxError(payload, this.path, range.start.line, range.start.column);
	}

	private formatError(line: number, column: number, message: string, lexeme: string): string {
		const near = lexeme.length > 0 ? ` near '${lexeme}'` : '';
		const lineText = this.sourceLines[line - 1] ?? '';
		const pointer = ' '.repeat(Math.max(column - 1, 0)) + '^';
		return `[line ${line}, column ${column}] ${message}${near}\n${lineText}\n${pointer}`;
	}

	private extractLexeme(range: LuaSourceRange): string {
		const lineIndex = range.start.line - 1;
		if (lineIndex < 0 || lineIndex >= this.sourceLines.length) {
			return '';
		}
		const line = this.sourceLines[lineIndex];
		const startIndex = Math.max(range.start.column - 1, 0);
		let endIndex = Math.max(range.end.column - 1, startIndex + 1);
		endIndex = Math.min(endIndex, line.length);
		return line.slice(startIndex, endIndex);
	}
}
