import { LuaSyntaxError } from '../errors';
import type { LuaToken } from './token';
import { LuaTokenType } from './token';
import {
	LuaSyntaxKind,
	LuaBinaryOperator,
	LuaUnaryOperator,
	LuaTableFieldKind,
	LuaAssignmentOperator,
	LuaMemberOperator,
} from './ast';
import type {
	LuaAssignableExpression,
	LuaAssignmentStatement,
	LuaBlock,
	LuaBssDeclarationStatement,
	LuaDataDeclarationStatement,
	LuaRodataDeclarationStatement,
	LuaBinaryExpression,
	LuaBooleanLiteralExpression,
	LuaBreakStatement,
	LuaCallArgumentList,
	LuaCallExpression,
	LuaCallStatement,
	LuaChunk,
	LuaDoStatement,
	LuaExpression,
	LuaErrorStatement,
	LuaForGenericStatement,
	LuaForNumericStatement,
	LuaFunctionAttribute,
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
	LuaMissingIdentifier,
	LuaNilLiteralExpression,
	LuaNode,
	LuaNumericLiteralExpression,
	LuaRepeatStatement,
	LuaReturnStatement,
	LuaSourcePosition,
	LuaSourceRange,
	LuaStatement,
	LuaStringLiteralExpression,
	LuaStructDeclarationStatement,
	LuaStructFieldDeclaration,
	LuaLocalAttribute,
	LuaTableArrayField,
	LuaTableConstructorExpression,
	LuaTableExpressionField,
	LuaTableField,
	LuaTableIdentifierField,
	LuaGotoStatement,
	LuaUnaryExpression,
	LuaTypeReference,
	LuaVarargExpression,
	LuaWhileStatement,
} from './ast';

type ParsedArguments = {
	readonly arguments: ReadonlyArray<LuaExpression>;
	readonly end: LuaSourcePosition;
	readonly argumentList: LuaCallArgumentList | null;
};

type LuaBinaryOperatorSpec = readonly [LuaTokenType, LuaBinaryOperator];
type LuaOperandParser = (this: LuaParser) => LuaExpression;

const OR_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [[LuaTokenType.Or, LuaBinaryOperator.Or]];
const AND_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [[LuaTokenType.And, LuaBinaryOperator.And]];
const COMPARISON_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [
	[LuaTokenType.EqualEqual, LuaBinaryOperator.Equal],
	[LuaTokenType.TildeEqual, LuaBinaryOperator.NotEqual],
	[LuaTokenType.Less, LuaBinaryOperator.LessThan],
	[LuaTokenType.LessEqual, LuaBinaryOperator.LessEqual],
	[LuaTokenType.Greater, LuaBinaryOperator.GreaterThan],
	[LuaTokenType.GreaterEqual, LuaBinaryOperator.GreaterEqual],
];
const BITWISE_OR_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [[LuaTokenType.Pipe, LuaBinaryOperator.BitwiseOr]];
const BITWISE_XOR_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [[LuaTokenType.Tilde, LuaBinaryOperator.BitwiseXor]];
const BITWISE_AND_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [[LuaTokenType.Ampersand, LuaBinaryOperator.BitwiseAnd]];
const SHIFT_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [
	[LuaTokenType.ShiftLeft, LuaBinaryOperator.ShiftLeft],
	[LuaTokenType.ShiftRight, LuaBinaryOperator.ShiftRight],
];
const ADDITIVE_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [
	[LuaTokenType.Plus, LuaBinaryOperator.Add],
	[LuaTokenType.Minus, LuaBinaryOperator.Subtract],
];
const MULTIPLICATIVE_BINARY_OPERATORS: readonly LuaBinaryOperatorSpec[] = [
	[LuaTokenType.Star, LuaBinaryOperator.Multiply],
	[LuaTokenType.Slash, LuaBinaryOperator.Divide],
	[LuaTokenType.FloorDivide, LuaBinaryOperator.FloorDivide],
	[LuaTokenType.Percent, LuaBinaryOperator.Modulus],
];
const CHUNK_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.Eof]);
const END_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.End]);
const IF_CLAUSE_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([
	LuaTokenType.ElseIf,
	LuaTokenType.Else,
	LuaTokenType.End,
]);
const REPEAT_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.Until]);

export class LuaParser {
	private readonly tokens: ReadonlyArray<LuaToken>;
	private readonly path: string;
	private readonly source: string;
	private index: number;
	private previousToken: LuaToken;
	private recoverStatements = false;
	private recoveredSyntaxError: LuaSyntaxError | null = null;

	constructor(tokens: ReadonlyArray<LuaToken>, path: string, source: string) {
		this.tokens = tokens;
		this.path = path;
		this.source = source;
		this.index = 0;
		this.previousToken = this.tokens[0];
	}

	public parseChunk(): LuaChunk {
		const moduleAttribute = this.parseModuleAttribute();
		const block = this.parseBlock(CHUNK_TERMINATORS);
		const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
		const range = this.rangeFromBlockAndToken(block, eofToken);
		return {
			kind: LuaSyntaxKind.Chunk,
			range,
			constModule: moduleAttribute === 'const',
			entryModule: moduleAttribute === 'entry',
			body: block.body,
		};
	}

	public parseChunkWithRecovery(): { path: LuaChunk; syntaxError: LuaSyntaxError | null } {
		this.recoverStatements = true;
		const moduleAttribute = this.parseModuleAttribute();
		const block = this.parseBlock(CHUNK_TERMINATORS);
		const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
		const end = this.positionFromToken(eofToken);
		const range: LuaSourceRange = { path: this.path, start: block.range.start, end };
		const path: LuaChunk = {
			kind: LuaSyntaxKind.Chunk,
			range,
			constModule: moduleAttribute === 'const',
			entryModule: moduleAttribute === 'entry',
			body: block.body,
		};
		return { path, syntaxError: this.recoveredSyntaxError };
	}

	private parseModuleAttribute(): 'const' | 'entry' | null {
		if (this.current().type !== LuaTokenType.Identifier || this.current().lexeme !== 'module') {
			return null;
		}
		if (this.peekType(1) !== LuaTokenType.Less
			|| this.peekType(2) !== LuaTokenType.Identifier
			|| this.peekType(3) !== LuaTokenType.Greater) {
			return null;
		}
		const attribute = this.tokens[this.index + 2].lexeme;
		if (attribute !== 'const' && attribute !== 'entry') {
			return null;
		}
		this.advance();
		this.advance();
		this.advance();
		this.advance();
		this.match(LuaTokenType.Semicolon);
		return attribute;
	}

	private parseBlock(terminators: ReadonlySet<LuaTokenType>): LuaBlock {
		const startToken = this.current();
		const startInclusive = this.blockStartPosition();
		const statements: LuaStatement[] = [];
		while (!this.isAtEnd() && !terminators.has(this.current().type)) {
			if (this.current().type === LuaTokenType.Semicolon) {
				this.advance();
				continue;
			}
			if (!this.recoverStatements) {
				statements.push(this.parseStatement());
				continue;
			}
			try {
				statements.push(this.parseStatement());
			} catch (error) {
				if (!(error instanceof LuaSyntaxError)) {
					throw error;
				}
				this.retainSyntaxError(error);
				this.synchronizeStatement(terminators);
			}
		}
		const startPosition = statements.length > 0 ? statements[0].range.start : this.positionFromToken(startToken);
		const endPosition = statements.length > 0 ? statements[statements.length - 1].range.end : startPosition;
		return {
			kind: LuaSyntaxKind.Block,
			startInclusive,
			range: {
				path: this.path,
				start: startPosition,
				end: endPosition,
			},
			endExclusive: this.positionFromToken(this.current()),
			body: statements,
		};
	}

	private synchronizeStatement(terminators: ReadonlySet<LuaTokenType>): void {
		while (!this.isAtEnd() && !terminators.has(this.current().type)) {
			if (this.match(LuaTokenType.Semicolon)) {
				return;
			}
			const token = this.current();
			if (token.line > this.previous().endLine && this.isStatementStart(token.type)) {
				return;
			}
			this.advance();
		}
	}

	private isStatementStart(type: LuaTokenType): boolean {
		switch (type) {
			case LuaTokenType.DoubleColon:
			case LuaTokenType.Identifier:
			case LuaTokenType.LeftParen:
			case LuaTokenType.Star:
			case LuaTokenType.Local:
			case LuaTokenType.Function:
			case LuaTokenType.Return:
			case LuaTokenType.Break:
			case LuaTokenType.If:
			case LuaTokenType.While:
			case LuaTokenType.Repeat:
			case LuaTokenType.For:
			case LuaTokenType.Do:
			case LuaTokenType.HaltUntilIrq:
			case LuaTokenType.Goto:
				return true;
			default:
				return false;
		}
	}

	private parseStatement(): LuaStatement {
		const token = this.current();
		if (token.type === LuaTokenType.DoubleColon) {
			return this.parseLabelStatement();
		}
		const bluaDeclaration = this.parseBluaDeclarationStatement();
		if (bluaDeclaration !== null) {
			return bluaDeclaration;
		}
		switch (token.type) {
			case LuaTokenType.Local:
				return this.parseLocalStatement();
			case LuaTokenType.Function:
				return this.parseFunctionDeclaration();
			case LuaTokenType.Return:
				return this.parseReturnStatement();
			case LuaTokenType.Break:
				return this.parseTokenStatement(LuaSyntaxKind.BreakStatement);
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
				return this.parseTokenStatement(LuaSyntaxKind.HaltUntilIrqStatement);
			case LuaTokenType.Goto:
				return this.parseGotoStatement();
			default:
				return this.parseAssignmentOrCall();
		}
	}

	private parseBluaDeclarationStatement(): LuaStatement | null {
		const token = this.current();
		if (token.type !== LuaTokenType.Identifier || this.peekType(1) !== LuaTokenType.Identifier) {
			return null;
		}
		switch (token.lexeme) {
			case 'struct':
				return this.parseStructDeclaration();
			case 'bss':
				if (this.peekType(2) === LuaTokenType.Colon) {
					return this.parseBssDeclaration();
				}
				return null;
			case 'data':
				if (this.peekType(2) === LuaTokenType.Colon) {
					return this.parseDataDeclaration();
				}
				return null;
			case 'rodata':
				if (this.peekType(2) === LuaTokenType.Colon) {
					return this.parseRodataDeclaration();
				}
				return null;
			default:
				return null;
		}
	}

	private parseStructDeclaration(): LuaStructDeclarationStatement {
		const structToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected struct name.');
		const name = this.createIdentifierExpression(nameToken);
		const fields: LuaStructFieldDeclaration[] = [];
		while (!this.check(LuaTokenType.End) && !this.isAtEnd()) {
			if (this.match(LuaTokenType.Semicolon)) {
				continue;
			}
			const fieldToken = this.consume(LuaTokenType.Identifier, 'Expected struct field name.');
			this.consume(LuaTokenType.Colon, 'Expected ":" after struct field name.');
			const typeRef = this.parseTypeReference();
			fields.push({
				name: fieldToken.lexeme,
				typeRef,
				range: {
					path: this.path,
					start: this.positionFromToken(fieldToken),
					end: typeRef.range.end,
				},
			});
			this.match(LuaTokenType.Comma);
			this.match(LuaTokenType.Semicolon);
		}
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after struct declaration.');
		return {
			kind: LuaSyntaxKind.StructDeclarationStatement,
			range: this.rangeFromTokenAndToken(structToken, endToken),
			name,
			fields,
		};
	}

	private parseBssDeclaration(): LuaBssDeclarationStatement {
		const bssToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected bss symbol name.');
		const name = this.createIdentifierExpression(nameToken);
		this.consume(LuaTokenType.Colon, 'Expected ":" after bss symbol name.');
		const typeRef = this.parseTypeReference();
		this.match(LuaTokenType.Semicolon);
		return {
			kind: LuaSyntaxKind.BssDeclarationStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(bssToken),
				end: typeRef.range.end,
			},
			name,
			typeRef,
		};
	}

	private parseDataDeclaration(): LuaDataDeclarationStatement {
		const dataToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected data symbol name.');
		const name = this.createIdentifierExpression(nameToken);
		this.consume(LuaTokenType.Colon, 'Expected ":" after data symbol name.');
		const typeRef = this.parseTypeReference();
		this.consume(LuaTokenType.Equal, 'Expected "=" after data type.');
		const initializer = this.parseExpression();
		this.match(LuaTokenType.Semicolon);
		return {
			kind: LuaSyntaxKind.DataDeclarationStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(dataToken),
				end: initializer.range.end,
			},
			name,
			typeRef,
			initializer,
		};
	}

	private parseRodataDeclaration(): LuaRodataDeclarationStatement {
		const rodataToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected rodata symbol name.');
		const name = this.createIdentifierExpression(nameToken);
		this.consume(LuaTokenType.Colon, 'Expected ":" after rodata symbol name.');
		const typeRef = this.parseTypeReference();
		this.consume(LuaTokenType.Equal, 'Expected "=" after rodata type.');
		const initializer = this.parseExpression();
		this.match(LuaTokenType.Semicolon);
		return {
			kind: LuaSyntaxKind.RodataDeclarationStatement,
			range: {
				path: this.path,
				start: this.positionFromToken(rodataToken),
				end: initializer.range.end,
			},
			name,
			typeRef,
			initializer,
		};
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
		const attribute = this.parseLocalFunctionAttribute();
		const functionExpression = this.parseFunctionExpression(functionToken);
		const range = this.rangeFromTokenAndNode(localToken, functionExpression);
		return {
			kind: LuaSyntaxKind.LocalFunctionStatement,
			range,
			name: nameExpression,
			attribute,
			functionExpression,
		};
	}

	private parseLocalFunctionAttribute(): LuaFunctionAttribute | null {
		if (!this.match(LuaTokenType.Less)) {
			return null;
		}
		const attributeToken = this.consume(LuaTokenType.Identifier, 'Expected function attribute name.');
		const attribute = attributeToken.lexeme.toLowerCase();
		if (attribute !== 'init') {
			throw this.error(attributeToken, `Unsupported function attribute '${attributeToken.lexeme}'.`);
		}
		this.consume(LuaTokenType.Greater, 'Expected ">" after function attribute name.');
		return 'init';
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

	private parseTokenStatement(kind: LuaSyntaxKind.BreakStatement): LuaBreakStatement;
	private parseTokenStatement(kind: LuaSyntaxKind.HaltUntilIrqStatement): LuaHaltUntilIrqStatement;
	private parseTokenStatement(kind: LuaSyntaxKind.BreakStatement | LuaSyntaxKind.HaltUntilIrqStatement): LuaBreakStatement | LuaHaltUntilIrqStatement {
		const token = this.advance();
		return {
			kind,
			range: this.finishOptionalSemicolonStatementRange(token),
		};
	}

	private parseLocalAssignment(localToken: LuaToken): LuaLocalAssignmentStatement {
		const names: LuaIdentifierExpression[] = [];
		const attributes: (LuaLocalAttribute | null)[] = [];
		const pointerTypeRefs: (LuaTypeReference | null)[] = [];
		let endPosition = this.endPositionFromToken(localToken);
		do {
			const nameToken = this.consume(LuaTokenType.Identifier, 'Expected local variable name.');
			names.push(this.createIdentifierExpression(nameToken));
			endPosition = this.endPositionFromToken(nameToken);
			const attribute = this.parseLocalAttribute();
			attributes.push(attribute);
			if (attribute !== null) {
				endPosition = this.endPositionFromToken(this.previous());
			}
			const pointerTypeRef = this.parseLocalPointerTypeReference();
			pointerTypeRefs.push(pointerTypeRef);
			if (pointerTypeRef !== null) {
				endPosition = pointerTypeRef.range.end;
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
			pointerTypeRefs,
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

	private parseLocalPointerTypeReference(): LuaTypeReference | null {
		if (!this.match(LuaTokenType.Colon)) {
			return null;
		}
		this.consume(LuaTokenType.Star, 'Expected "*" after ":" in local pointer type.');
		return this.parseTypeReference();
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
		const path: LuaIdentifierExpression[] = [];
		const firstToken = this.consume(LuaTokenType.Identifier, 'Expected function name.');
		path.push(this.createIdentifierExpression(firstToken));
		while (this.match(LuaTokenType.Dot)) {
			const identifierToken = this.consume(LuaTokenType.Identifier, 'Expected identifier after "." in function name.');
			path.push(this.createIdentifierExpression(identifierToken));
		}
		let method: LuaIdentifierExpression | null = null;
		if (this.match(LuaTokenType.Colon)) {
			const methodToken = this.consume(LuaTokenType.Identifier, 'Expected method name after ":".');
			method = this.createIdentifierExpression(methodToken);
		}
		return {
			path,
			method,
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
		const body = this.parseBlock(END_TERMINATORS);
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
		let endPosition: LuaSourcePosition = this.endPositionFromToken(returnToken);
		if (expressions.length > 0) {
			endPosition = expressions[expressions.length - 1].range.end;
		}
		if (this.match(LuaTokenType.Semicolon)) {
			endPosition = this.endPositionFromToken(this.previous());
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

	private finishOptionalSemicolonStatementRange(firstToken: LuaToken): LuaSourceRange {
		if (this.match(LuaTokenType.Semicolon)) {
			// Semicolon is optional and ignored.
		}
		return {
			path: this.path,
			start: this.positionFromToken(firstToken),
			end: this.endPositionFromToken(this.previous()),
		};
	}

	private parseIfStatement(): LuaIfStatement {
		const ifToken = this.advance();
		const clauses: LuaIfClause[] = [];
		const condition = this.parseExpression();
		this.consume(LuaTokenType.Then, 'Expected "then" after condition.');
		const thenBlock = this.parseBlock(IF_CLAUSE_TERMINATORS);
		clauses.push({
			condition,
			block: thenBlock,
		});
		while (this.match(LuaTokenType.ElseIf)) {
			const elseifCondition = this.parseExpression();
			this.consume(LuaTokenType.Then, 'Expected "then" after elseif condition.');
			const elseifBlock = this.parseBlock(IF_CLAUSE_TERMINATORS);
			clauses.push({
				condition: elseifCondition,
				block: elseifBlock,
			});
		}
		if (this.match(LuaTokenType.Else)) {
			const elseBlock = this.parseBlock(END_TERMINATORS);
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
		const block = this.parseBlock(END_TERMINATORS);
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
		const block = this.parseBlock(REPEAT_TERMINATORS);
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
		const block = this.parseBlock(END_TERMINATORS);
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
		const block = this.parseBlock(END_TERMINATORS);
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
		const block = this.parseBlock(END_TERMINATORS);
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after do block.');
		const range = this.rangeFromTokenAndToken(doToken, endToken);
		return {
			kind: LuaSyntaxKind.DoStatement,
			range,
			block,
		};
	}

	private parseAssignmentOrCall(): LuaStatement {
		const expression = this.parseAssignmentTargetExpression();
		if (this.check(LuaTokenType.Comma) || this.isAssignmentOperator(this.current().type)) {
			return this.parseAssignment(expression);
		}
		if (expression.kind === LuaSyntaxKind.CallExpression) {
			return this.createCallStatement(expression as LuaCallExpression);
		}
		if (this.recoverStatements && expression.kind === LuaSyntaxKind.MemberExpression) {
			this.retainSyntaxError(this.errorAtRange(expression.range, 'Expected assignment or function call.'));
			const statement: LuaErrorStatement = {
				kind: LuaSyntaxKind.ErrorStatement,
				range: expression.range,
				expression,
			};
			return statement;
		}
		throw this.errorAtRange(expression.range, 'Expected assignment or function call.');
	}

	private parseAssignment(firstExpression: LuaExpression): LuaAssignmentStatement {
		const targets: LuaAssignableExpression[] = [];
		targets.push(this.requireAssignable(firstExpression));
		while (this.match(LuaTokenType.Comma)) {
			const next = this.parseAssignmentTargetExpression();
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
		const endPosition = values.length > 0 ? values[values.length - 1].range.end : this.endPositionFromToken(this.previous());
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

	private parseAssignmentTargetExpression(): LuaExpression {
		return this.check(LuaTokenType.Star) ? this.parseUnaryExpression() : this.parsePrefixExpression();
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
		return this.parseLeftAssociativeExpression(this.parseAndExpression, OR_BINARY_OPERATORS);
	}

	private parseAndExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseComparisonExpression, AND_BINARY_OPERATORS);
	}

	private parseComparisonExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseBitwiseOrExpression, COMPARISON_BINARY_OPERATORS);
	}

	private parseBitwiseOrExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseBitwiseXorExpression, BITWISE_OR_BINARY_OPERATORS);
	}

	private parseBitwiseXorExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseBitwiseAndExpression, BITWISE_XOR_BINARY_OPERATORS);
	}

	private parseBitwiseAndExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseShiftExpression, BITWISE_AND_BINARY_OPERATORS);
	}

	private parseShiftExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseConcatenationExpression, SHIFT_BINARY_OPERATORS);
	}

	private parseConcatenationExpression(): LuaExpression {
		return this.parseRightAssociativeExpression(this.parseAdditiveExpression, LuaTokenType.DotDot, this.parseConcatenationExpression, LuaBinaryOperator.Concat);
	}

	private parseAdditiveExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseMultiplicativeExpression, ADDITIVE_BINARY_OPERATORS);
	}

	private parseMultiplicativeExpression(): LuaExpression {
		return this.parseLeftAssociativeExpression(this.parseUnaryExpression, MULTIPLICATIVE_BINARY_OPERATORS);
	}

	private parseUnaryExpression(): LuaExpression {
		if (this.check(LuaTokenType.Ampersand)) {
			const ampersandToken = this.advance();
			return this.createUnaryExpression(ampersandToken, this.parseUnaryExpression(), LuaUnaryOperator.StringId);
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
		if (this.match(LuaTokenType.Star)) {
			const operatorToken = this.previous();
			const operand = this.parseUnaryExpression();
			return this.createUnaryExpression(operatorToken, operand, LuaUnaryOperator.Dereference);
		}
		return this.parseRightAssociativeExpression(this.parsePrefixExpression, LuaTokenType.Caret, this.parseUnaryExpression, LuaBinaryOperator.Exponent);
	}

	private parseLeftAssociativeExpression(parseOperand: LuaOperandParser, operators: readonly LuaBinaryOperatorSpec[]): LuaExpression {
		let expression = parseOperand.call(this);
		while (true) {
			const operator = this.matchBinaryOperator(operators);
			if (operator === null) {
				return expression;
			}
			const right = parseOperand.call(this);
			expression = this.createBinaryExpression(expression, right, operator);
		}
	}

	private parseRightAssociativeExpression(parseLeft: LuaOperandParser, tokenType: LuaTokenType, parseRight: LuaOperandParser, operator: LuaBinaryOperator): LuaExpression {
		const expression = parseLeft.call(this);
		if (!this.match(tokenType)) {
			return expression;
		}
		const right = parseRight.call(this);
		return this.createBinaryExpression(expression, right, operator);
	}

	private matchBinaryOperator(operators: readonly LuaBinaryOperatorSpec[]): LuaBinaryOperator | null {
		for (let index = 0; index < operators.length; index += 1) {
			const [tokenType, operator] = operators[index];
			if (tokenType === LuaTokenType.Star && this.startsOnNewLine(this.current())) {
				continue;
			}
			if (this.match(tokenType)) {
				return operator;
			}
		}
		return null;
	}

	private startsOnNewLine(token: LuaToken): boolean {
		return this.previous().endLine < token.line;
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
			if (this.match(LuaTokenType.Dot) || this.match(LuaTokenType.Arrow)) {
				expression = this.parseNamedAccess(expression, this.previous());
				continue;
			}
			if (this.match(LuaTokenType.Colon)) {
				expression = this.parseNamedAccess(expression, this.previous());
				continue;
			}
			if (this.startsCallArguments()) {
				const parsedArguments = this.parseCallArguments();
				expression = this.createCallExpression(expression, parsedArguments, null);
				continue;
			}
			break;
		}
		return expression;
	}

	private parseNamedAccess(expression: LuaExpression, operatorToken: LuaToken): LuaExpression {
		const operator = operatorToken.type === LuaTokenType.Dot
			? LuaMemberOperator.Dot
			: operatorToken.type === LuaTokenType.Arrow
				? LuaMemberOperator.Arrow
				: LuaMemberOperator.Colon;
		const message = operator === LuaMemberOperator.Colon
			? 'Expected method name after ":".'
			: 'Expected identifier after member access operator.';
		let member: LuaIdentifierExpression | LuaMissingIdentifier;
		if (this.check(LuaTokenType.Identifier)) {
			member = this.createIdentifierExpression(this.advance());
		} else {
			if (!this.recoverStatements) {
				throw this.error(this.current(), message);
			}
			const column = operatorToken.endColumn + 1;
			const range: LuaSourceRange = {
				path: this.path,
				start: { line: operatorToken.endLine, column },
				end: { line: operatorToken.endLine, column },
			};
			this.retainSyntaxError(this.errorAtRange(range, message));
			member = {
				kind: LuaSyntaxKind.MissingIdentifier,
				range,
				name: '',
			};
		}
		if (operator === LuaMemberOperator.Colon
			&& member.kind === LuaSyntaxKind.IdentifierExpression) {
			if (this.startsCallArguments()) {
				return this.createCallExpression(expression, this.parseCallArguments(), member);
			}
			if (!this.recoverStatements) {
				throw this.error(this.current(), 'Invalid function call arguments.');
			}
			this.retainSyntaxError(this.error(this.current(), 'Invalid function call arguments.'));
		}
		return {
			kind: LuaSyntaxKind.MemberExpression,
			range: {
				path: this.path,
				start: expression.range.start,
				end: member.kind === LuaSyntaxKind.MissingIdentifier
					? this.endPositionFromToken(operatorToken)
					: member.range.end,
			},
			base: expression,
			member,
			operator,
		};
	}

	private startsCallArguments(): boolean {
		const type = this.current().type;
		return type === LuaTokenType.LeftParen
			|| type === LuaTokenType.LeftBrace
			|| type === LuaTokenType.String;
	}

	private startsExpression(): boolean {
		switch (this.current().type) {
			case LuaTokenType.Ampersand:
			case LuaTokenType.False:
			case LuaTokenType.Function:
			case LuaTokenType.Hash:
			case LuaTokenType.Identifier:
			case LuaTokenType.LeftBrace:
			case LuaTokenType.LeftParen:
			case LuaTokenType.Minus:
			case LuaTokenType.Nil:
			case LuaTokenType.Not:
			case LuaTokenType.Number:
			case LuaTokenType.Star:
			case LuaTokenType.String:
			case LuaTokenType.Tilde:
			case LuaTokenType.True:
			case LuaTokenType.Vararg:
				return true;
			default:
				return false;
		}
	}

	private parseCallArguments(): ParsedArguments {
		if (this.match(LuaTokenType.LeftParen)) {
			const leftParen = this.previous();
			const args: LuaExpression[] = [];
			const separators: LuaSourcePosition[] = [];
			if (!this.check(LuaTokenType.RightParen)) {
				if (!this.recoverStatements || this.startsExpression()) {
					args.push(this.parseExpression());
					while (this.match(LuaTokenType.Comma)) {
						separators.push(this.positionFromToken(this.previous()));
						if (this.recoverStatements && !this.startsExpression()) {
							this.retainSyntaxError(this.error(this.current(), 'Expected expression after ",".'));
							break;
						}
						args.push(this.parseExpression());
					}
				} else {
					this.retainSyntaxError(this.error(this.current(), 'Expected expression after "(".'));
				}
			}
			if (this.match(LuaTokenType.RightParen)) {
				const rightParen = this.previous();
				const end = this.endPositionFromToken(rightParen);
				return {
					arguments: args,
					end,
					argumentList: {
						range: {
							path: this.path,
							start: this.positionFromToken(leftParen),
							end,
						},
						separators,
					},
				};
			}
			if (!this.recoverStatements) {
				this.consume(LuaTokenType.RightParen, 'Expected ")" after arguments.');
			}
			this.retainSyntaxError(this.error(this.current(), 'Expected ")" after arguments.'));
			const current = this.current();
			const previous = this.previous();
			const end = current.type === LuaTokenType.Eof
				? this.positionFromToken(current)
				: { line: previous.endLine, column: previous.endColumn + 1 };
			return {
				arguments: args,
				end,
				argumentList: {
					range: {
						path: this.path,
						start: this.positionFromToken(leftParen),
						end,
					},
					separators,
				},
			};
		}
		if (this.check(LuaTokenType.LeftBrace)) {
			const leftBrace = this.advance();
			const tableExpression = this.parseTableConstructorExpression(leftBrace);
			const endToken = this.previous();
			return {
				arguments: [tableExpression],
				end: this.endPositionFromToken(endToken),
				argumentList: null,
			};
		}
		if (this.check(LuaTokenType.String)) {
			const stringToken = this.advance();
			const stringExpression = this.createStringLiteralExpression(stringToken);
			return {
				arguments: [stringExpression],
				end: this.endPositionFromToken(stringToken),
				argumentList: null,
			};
		}
		throw this.error(this.current(), 'Invalid function call arguments.');
	}

	private createCallExpression(
		callee: LuaExpression,
		parsedArguments: ParsedArguments,
		method: LuaIdentifierExpression | null,
	): LuaCallExpression {
		return {
			kind: LuaSyntaxKind.CallExpression,
			range: {
				path: this.path,
				start: callee.range.start,
				end: parsedArguments.end,
			},
			callee,
			arguments: parsedArguments.arguments,
			method,
			argumentList: parsedArguments.argumentList,
		};
	}

	private parsePrimaryExpression(): LuaExpression {
		const token = this.current();
		switch (token.type) {
				case LuaTokenType.Nil:
					return this.createTokenOnlyExpression(this.advance(), LuaSyntaxKind.NilLiteralExpression);
			case LuaTokenType.True:
				return this.parseBooleanLiteral(true);
			case LuaTokenType.False:
				return this.parseBooleanLiteral(false);
			case LuaTokenType.Number:
				return this.parseNumericLiteral();
			case LuaTokenType.String:
				return this.parseStringLiteral();
			case LuaTokenType.Identifier:
				if (token.lexeme === 'sizeof') {
					return this.parseSizeOfExpression();
				}
				if (token.lexeme === 'offsetof') {
					return this.parseOffsetOfExpression();
				}
				return this.parseIdentifier();
				case LuaTokenType.Vararg:
					return this.createTokenOnlyExpression(this.advance(), LuaSyntaxKind.VarargExpression);
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

	private parseSizeOfExpression(): LuaExpression {
		const sizeofToken = this.advance();
		this.consume(LuaTokenType.LeftParen, 'Expected "(" after sizeof.');
		const typeRef = this.parseTypeReference();
		const rightParen = this.consume(LuaTokenType.RightParen, 'Expected ")" after sizeof type.');
		return {
			kind: LuaSyntaxKind.SizeOfExpression,
			range: this.rangeFromTokenAndToken(sizeofToken, rightParen),
			typeRef,
		};
	}

	private parseOffsetOfExpression(): LuaExpression {
		const offsetofToken = this.advance();
		this.consume(LuaTokenType.LeftParen, 'Expected "(" after offsetof.');
		const typeToken = this.consume(LuaTokenType.Identifier, 'Expected struct type name in offsetof.');
		const fieldPath: string[] = [];
		this.consume(LuaTokenType.Dot, 'Expected "." after offsetof struct type.');
		const firstField = this.consume(LuaTokenType.Identifier, 'Expected field name in offsetof.');
		fieldPath.push(firstField.lexeme);
		while (this.match(LuaTokenType.Dot)) {
			const fieldToken = this.consume(LuaTokenType.Identifier, 'Expected field name in offsetof.');
			fieldPath.push(fieldToken.lexeme);
		}
		const rightParen = this.consume(LuaTokenType.RightParen, 'Expected ")" after offsetof path.');
		return {
			kind: LuaSyntaxKind.OffsetOfExpression,
			range: this.rangeFromTokenAndToken(offsetofToken, rightParen),
			typeName: typeToken.lexeme,
			fieldPath,
		};
	}

		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.NilLiteralExpression): LuaNilLiteralExpression;
		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.VarargExpression): LuaVarargExpression;
		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.NilLiteralExpression | LuaSyntaxKind.VarargExpression): LuaNilLiteralExpression | LuaVarargExpression {
			return {
				kind,
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

	private parseTypeReference(): LuaTypeReference {
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected type name.');
		const arrayLengths: Array<LuaExpression | null> = [];
		let end = this.endPositionFromToken(nameToken);
		while (this.match(LuaTokenType.LeftBracket)) {
			arrayLengths.push(this.check(LuaTokenType.RightBracket) ? null : this.parseExpression());
			const rightBracket = this.consume(LuaTokenType.RightBracket, 'Expected "]" after type array length.');
			end = this.endPositionFromToken(rightBracket);
		}
		return {
			name: nameToken.lexeme,
			arrayLengths,
			range: {
				path: this.path,
				start: this.positionFromToken(nameToken),
				end,
			},
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
		return {
			kind: LuaSyntaxKind.StringLiteralExpression,
			range: this.rangeFromTokenAndToken(token, token),
			value: this.stringLiteralValue(token, 'Expected string literal.'),
		};
	}

	private stringLiteralValue(token: LuaToken, message: string): string {
		if (typeof token.literal !== 'string') {
			throw this.error(token, message);
		}
		return token.literal;
	}

	private requireAssignable(expression: LuaExpression): LuaAssignableExpression {
		if (
			expression.kind === LuaSyntaxKind.IdentifierExpression ||
			expression.kind === LuaSyntaxKind.MemberExpression ||
			expression.kind === LuaSyntaxKind.IndexExpression ||
			(expression.kind === LuaSyntaxKind.UnaryExpression && expression.operator === LuaUnaryOperator.Dereference)
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
			end: this.endPositionFromToken(endToken),
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
			end: this.endPositionFromToken(endToken),
		};
	}

	private rangeFromBlockAndToken(block: LuaBlock, endToken: LuaToken): LuaSourceRange {
		return {
			path: this.path,
			start: block.range.start,
			end: this.endPositionFromToken(endToken),
		};
	}

	private positionFromToken(token: LuaToken): LuaSourcePosition {
		return { line: token.line, column: token.column };
	}

	private endPositionFromToken(token: LuaToken): LuaSourcePosition {
		return { line: token.endLine, column: token.endColumn };
	}

	private blockStartPosition(): LuaSourcePosition {
		if (this.index === 0) {
			return { line: 1, column: 1 };
		}
		const token = this.previous();
		return { line: token.endLine, column: token.endColumn + 1 };
	}

	private retainSyntaxError(error: LuaSyntaxError): void {
		if (this.recoveredSyntaxError === null) {
			this.recoveredSyntaxError = error;
		}
	}

	private error(token: LuaToken, message: string): LuaSyntaxError {
		const payload = this.formatError(token.line, token.column, message, token.lexeme);
		return new LuaSyntaxError(payload, this.path, token.line, token.column);
	}

	private errorAtRange(range: LuaSourceRange, message: string): LuaSyntaxError {
		const lexeme = this.extractLexeme(range);
		const payload = this.formatError(range.start.line, range.start.column, message, lexeme);
		return new LuaSyntaxError(payload, this.path, range.start.line, range.start.column);
	}

	private formatError(line: number, column: number, message: string, lexeme?: string): string {
		const near = lexeme && lexeme.length > 0 ? ` near '${lexeme}'` : '';
		const lineText = this.sourceLine(line);
		const pointer = ' '.repeat(Math.max(column - 1, 0)) + '^';
		return `[line ${line}, column ${column}] ${message}${near}\n${lineText}\n${pointer}`;
	}

	private extractLexeme(range: LuaSourceRange): string {
		const line = this.sourceLine(range.start.line);
		const startIndex = Math.max(range.start.column - 1, 0);
		let endIndex = Math.max(range.end.column, startIndex + 1);
		endIndex = Math.min(endIndex, line.length);
		return line.slice(startIndex, endIndex);
	}

	private sourceLine(line: number): string {
		let currentLine = 1;
		let lineStart = 0;
		for (let index = 0; index < this.source.length; index += 1) {
			if (this.source.charCodeAt(index) !== 10) {
				continue;
			}
			if (currentLine === line) {
				const lineEnd = index > lineStart && this.source.charCodeAt(index - 1) === 13
					? index - 1
					: index;
				return this.source.slice(lineStart, lineEnd);
			}
			currentLine += 1;
			lineStart = index + 1;
		}
		const lineEnd = this.source.length > lineStart && this.source.charCodeAt(this.source.length - 1) === 13
			? this.source.length - 1
			: this.source.length;
		return this.source.slice(lineStart, lineEnd);
	}
}
