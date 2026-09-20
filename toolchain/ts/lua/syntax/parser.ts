import { LuaSourceLocations, type LuaSyntaxSpan } from './source_locations';
import { createLuaSourceUnit, type LuaSourceUnitPlacement } from './source_layout';
import { LuaSyntaxError } from '../errors';
import type { LuaToken } from './token';
import { LuaTokenType, isLuaTrivia } from './token';
import type { LuaTokenSequence, LuaTokenCursor } from './token_sequence';
import { LuaStatementSequence, type LuaStatementPart } from './statement_sequence';
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
	LuaStatement,
	LuaSkippedSyntax,
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
	readonly end: number;
	readonly argumentList: LuaCallArgumentList | null;
};

/** Unformatted parser failure; recovery retains its syntax occurrence until publication. */
class LuaParserSpanError extends Error {
	public constructor(public readonly span: LuaSyntaxSpan, message: string) { super(message); }
}

/** A statement owns its units, while nested statements own their own occurrences. */
type StatementParseFrame = {
	statement: LuaStatement | null;
	width: number;
	/** Absolute while active; made relative before publication. */
	readWidth: number;
	recovery: boolean;
	endsNewLine: boolean;
	units: LuaSyntaxSpan['unit'][];
};

const enum BlockContext {
	Chunk,
	End,
	IfClause,
	Repeat,
	Recovering = 4,
}

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
const EMPTY_SKIPPED_SYNTAX: readonly LuaSkippedSyntax[] = [];
const CHUNK_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.Eof]);
const END_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.End]);
const IF_CLAUSE_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([
	LuaTokenType.ElseIf,
	LuaTokenType.Else,
	LuaTokenType.End,
]);
const REPEAT_TERMINATORS: ReadonlySet<LuaTokenType> = new Set([LuaTokenType.Until]);

/** One syntax-generation builder; publication transfers its location index. */
export class LuaParser {
	private readonly tokens: LuaTokenSequence;
	private readonly cursor: LuaTokenCursor;
	private readonly lexicalUnits: LuaSourceUnitPlacement[];
	private nextLexicalUnit = 0;
	private readonly recoveryUnits: LuaSyntaxSpan['unit'][] = [];
	private startsNewLine = false;
	private statementFrame: StatementParseFrame | undefined;
	private readonly locations: LuaSourceLocations;
	private readonly path: string;
	private readonly source: string;
	private index: number;
	private previousToken: LuaToken;
	private recoverStatements = false;
	private recoveredSyntaxError: LuaSyntaxError | { span: LuaSyntaxSpan; message: string } | null = null;
	private currentUnit: LuaSourceUnitPlacement = { unit: createLuaSourceUnit(), offset: 0 };
	private readonly units: LuaSourceUnitPlacement[] = [this.currentUnit];
	private unitOrigins: Map<LuaSourceUnitPlacement['unit'], number> | undefined = new Map([[this.currentUnit.unit, 0]]);

	constructor(tokens: LuaTokenSequence, path: string, source: string) {
		this.tokens = tokens;
		this.path = path;
		this.source = source;
		this.index = 0;
		this.lexicalUnits = [...tokens.placements()];
		for (const placement of this.lexicalUnits) this.unitOrigins.set(placement.unit, placement.offset);
		this.locations = LuaSourceLocations.fromSource(path, source, this.units, this.unitOrigins);
		this.cursor = tokens.cursor();
		while (isLuaTrivia(this.cursor.token!.type)) this.cursor.advance();
		this.previousToken = this.cursor.token!;
	}

	public parseChunk(): LuaChunk {
		const moduleAttribute = this.parseModuleAttribute();
		const block = this.parseBlock(CHUNK_TERMINATORS);
		const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
		const span = this.spanFromBlockAndToken(block, eofToken);
		return {
			kind: LuaSyntaxKind.Chunk,
			source: this.source,
			locations: this.publishLocations(),
			tokens: this.tokens,
			syntaxError: null,
			span,
			constModule: moduleAttribute === 'const',
			entryModule: moduleAttribute === 'entry',
			body: block.body,
			skippedSyntax: block.skippedSyntax,
		};
	}

	/** A complete expression fragment; no fabricated statement or coordinate prefix. */
	public parseExpressionOnly(): { expression: LuaExpression; locations: LuaSourceLocations } {
		const expression = this.parseExpression();
		this.consume(LuaTokenType.Eof, 'Expected end of expression.');
		return { expression, locations: this.publishLocations() };
	}

	public parseChunkWithRecovery(): { path: LuaChunk; syntaxError: LuaSyntaxError | null } {
		this.recoverStatements = true;
		const moduleAttribute = this.parseModuleAttribute();
		const block = this.parseBlock(CHUNK_TERMINATORS);
		const eofToken = this.consume(LuaTokenType.Eof, 'Expected end of input.');
		const end = this.spanStart(eofToken);
		const span: LuaSyntaxSpan = this.createSpan(this.spanStart(block.span), end);
		const locations = this.publishLocations();
		let lexicalError: LuaSyntaxError | null = null;
		if (eofToken.error !== undefined) {
			const position = locations.range(eofToken).start;
			lexicalError = new LuaSyntaxError(eofToken.error, this.path, position.line, position.column);
		}
		const diagnostic = this.recoveredSyntaxError;
		let syntaxError: LuaSyntaxError | null = null;
		if (diagnostic instanceof LuaSyntaxError) syntaxError = diagnostic;
		else if (diagnostic !== null) syntaxError = this.errorAtSpan(diagnostic.span, diagnostic.message, locations);
		if (lexicalError && (!syntaxError || lexicalError.line < syntaxError.line
			|| (lexicalError.line === syntaxError.line && lexicalError.column < syntaxError.column))) {
			syntaxError = lexicalError;
		}
		const path: LuaChunk = {
			kind: LuaSyntaxKind.Chunk,
			source: this.source,
			locations,
			tokens: this.tokens,
			syntaxError,
			span,
			constModule: moduleAttribute === 'const',
			entryModule: moduleAttribute === 'entry',
			body: block.body,
			skippedSyntax: lexicalError === null ? block.skippedSyntax : [...block.skippedSyntax, {
				span: this.createSpan(end, this.source.length - 1), units: [],
			}],
		};
		return { path, syntaxError };
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
		const attribute = this.peek(2)!.lexeme;
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
		const startInclusive = this.blockStartOffset();
		const parts: LuaStatementPart[] = [];
		const firstOffset = this.spanStart(startToken);
		if (firstOffset > startInclusive) parts.push({ statement: null, width: firstOffset - startInclusive,
			readWidth: firstOffset - startInclusive, recovery: false, endsNewLine: this.startsNewLine, units: [] });
		let skippedSyntax: LuaSkippedSyntax[] | undefined;
		while (!this.isAtEnd() && !terminators.has(this.current().type)) {
			const partStart = this.spanStart(this.current());
			const firstUnit = this.recoveryUnits.length;
			const parentFrame = this.statementFrame;
			const frame: StatementParseFrame = { statement: null, width: 0,
				readWidth: this.cursor.blockOffset + this.cursor.token!.end + 1, recovery: false, endsNewLine: this.startsNewLine, units: [] };
			this.statementFrame = frame;
			try {
				if (this.current().type === LuaTokenType.Semicolon) this.advance();
				else frame.statement = this.parseStatement();
			} catch (error) {
				if (!this.recoverStatements || (!(error instanceof LuaSyntaxError) && !(error instanceof LuaParserSpanError))) throw error;
				this.retainSyntaxError(error);
				this.synchronizeStatement(terminators);
				if (skippedSyntax === undefined) skippedSyntax = [];
				const units = this.recoveryUnits.slice(firstUnit);
				frame.units = units;
				skippedSyntax.push({ span: this.createSpan(partStart, this.spanStart(this.current()) - 1), units });
			} finally {
				this.statementFrame = parentFrame;
				if (parentFrame !== undefined) {
					parentFrame.readWidth = Math.max(parentFrame.readWidth, frame.readWidth);
					parentFrame.recovery ||= frame.recovery;
				}
			}
			frame.endsNewLine = this.startsNewLine;
			frame.width = this.cursor.offset - partStart;
			frame.readWidth = Math.max(frame.readWidth - partStart, frame.width);
			parts.push(frame);
		}
		const context = (terminators === CHUNK_TERMINATORS ? BlockContext.Chunk
			: terminators === END_TERMINATORS ? BlockContext.End
			: terminators === IF_CLAUSE_TERMINATORS ? BlockContext.IfClause : BlockContext.Repeat)
			| (this.recoverStatements ? BlockContext.Recovering : 0);
		const statements = LuaStatementSequence.fromParts(context, parts);
		const startPosition = statements.length > 0 ? this.spanStart(statements.get(0)!.span) : this.spanStart(startToken);
		const endPosition = statements.length > 0 ? this.spanEnd(statements.get(statements.length - 1)!.span) : startPosition;
		return {
			kind: LuaSyntaxKind.Block,
			startInclusive: startInclusive - this.currentUnit.offset,
			span: this.createSpan(startPosition, endPosition),
			endExclusive: this.spanStart(this.current()) - this.currentUnit.offset,
			body: statements,
			skippedSyntax: skippedSyntax === undefined ? EMPTY_SKIPPED_SYNTAX : skippedSyntax,
		};
	}

	private synchronizeStatement(terminators: ReadonlySet<LuaTokenType>): void {
		while (!this.isAtEnd() && !terminators.has(this.current().type)) {
			if (this.match(LuaTokenType.Semicolon)) {
				return;
			}
			const token = this.current();
			if (this.startsNewLine && this.isStatementStart(token.type)) {
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
		const parentUnit = this.currentUnit;
		this.beginUnit(this.spanStart(this.current()));
		try { return this.parseStatementBody(); }
		finally { this.currentUnit = parentUnit; }
	}

	private parseStatementBody(): LuaStatement {
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
				span: this.createSpan(this.spanStart(fieldToken), this.spanEnd(typeRef.span)),
			});
			this.match(LuaTokenType.Comma);
			this.match(LuaTokenType.Semicolon);
		}
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after struct declaration.');
		return {
			kind: LuaSyntaxKind.StructDeclarationStatement,
			span: this.spanFromTokenAndToken(structToken, endToken),
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
			span: this.createSpan(this.spanStart(bssToken), this.spanEnd(typeRef.span)),
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
			span: this.createSpan(this.spanStart(dataToken), this.spanEnd(initializer.span)),
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
			span: this.createSpan(this.spanStart(rodataToken), this.spanEnd(initializer.span)),
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
		const span = this.spanFromTokenAndNode(localToken, functionExpression);
		return {
			kind: LuaSyntaxKind.LocalFunctionStatement,
			span,
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
			span: this.spanFromTokenAndToken(firstColon, secondColon),
			label: nameToken.lexeme,
		};
	}

	private parseGotoStatement(): LuaGotoStatement {
		const gotoToken = this.advance();
		const nameToken = this.consume(LuaTokenType.Identifier, 'Expected label name after goto.');
		return {
			kind: LuaSyntaxKind.GotoStatement,
			span: this.spanFromTokenAndToken(gotoToken, nameToken),
			label: nameToken.lexeme,
		};
	}

	private parseTokenStatement(kind: LuaSyntaxKind.BreakStatement): LuaBreakStatement;
	private parseTokenStatement(kind: LuaSyntaxKind.HaltUntilIrqStatement): LuaHaltUntilIrqStatement;
	private parseTokenStatement(kind: LuaSyntaxKind.BreakStatement | LuaSyntaxKind.HaltUntilIrqStatement): LuaBreakStatement | LuaHaltUntilIrqStatement {
		const token = this.advance();
		return {
			kind,
			span: this.finishOptionalSemicolonStatementRange(token),
		};
	}

	private parseLocalAssignment(localToken: LuaToken): LuaLocalAssignmentStatement {
		const names: LuaIdentifierExpression[] = [];
		const attributes: (LuaLocalAttribute | null)[] = [];
		const pointerTypeRefs: (LuaTypeReference | null)[] = [];
		let endPosition = this.tokenEndOffset(localToken);
		do {
			const nameToken = this.consume(LuaTokenType.Identifier, 'Expected local variable name.');
			names.push(this.createIdentifierExpression(nameToken));
			endPosition = this.tokenEndOffset(nameToken);
			const attribute = this.parseLocalAttribute();
			attributes.push(attribute);
			if (attribute !== null) {
				endPosition = this.tokenEndOffset(this.previous());
			}
			const pointerTypeRef = this.parseLocalPointerTypeReference();
			pointerTypeRefs.push(pointerTypeRef);
			if (pointerTypeRef !== null) {
				endPosition = this.spanEnd(pointerTypeRef.span);
			}
		} while (this.match(LuaTokenType.Comma));
		const values: LuaExpression[] = [];
		if (this.match(LuaTokenType.Equal)) {
			values.push(...this.parseExpressionList());
			endPosition = this.spanEnd(values[values.length - 1].span);
		}
		return {
			kind: LuaSyntaxKind.LocalAssignmentStatement,
			span: this.createSpan(this.spanStart(localToken), endPosition),
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
		const span = this.spanFromTokenAndNode(functionToken, functionExpression);
		return {
			kind: LuaSyntaxKind.FunctionDeclarationStatement,
			span,
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
		const parentUnit = this.currentUnit;
		this.beginUnit(this.spanStart(functionToken));
		try { return this.parseFunctionExpressionBody(functionToken); }
		finally { this.currentUnit = parentUnit; }
	}

	private parseFunctionExpressionBody(functionToken: LuaToken): LuaFunctionExpression {
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
		const span = this.spanFromTokenAndToken(functionToken, endToken);
		return {
			kind: LuaSyntaxKind.FunctionExpression,
			span,
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
		let endPosition: number = this.tokenEndOffset(returnToken);
		if (expressions.length > 0) {
			endPosition = this.spanEnd(expressions[expressions.length - 1].span);
		}
		if (this.match(LuaTokenType.Semicolon)) {
			endPosition = this.tokenEndOffset(this.previous());
		}
		return {
			kind: LuaSyntaxKind.ReturnStatement,
			span: this.createSpan(this.spanStart(returnToken), endPosition),
			expressions,
		};
	}

	private finishOptionalSemicolonStatementRange(firstToken: LuaToken): LuaSyntaxSpan {
		if (this.match(LuaTokenType.Semicolon)) {
			// Semicolon is optional and ignored.
		}
		return this.createSpan(this.spanStart(firstToken), this.tokenEndOffset(this.previous()));
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
		const span = this.spanFromTokenAndToken(ifToken, endToken);
		return {
			kind: LuaSyntaxKind.IfStatement,
			span,
			clauses,
		};
	}

	private parseWhileStatement(): LuaWhileStatement {
		const whileToken = this.advance();
		const condition = this.parseExpression();
		this.consume(LuaTokenType.Do, 'Expected "do" after while condition.');
		const block = this.parseBlock(END_TERMINATORS);
		const endToken = this.consume(LuaTokenType.End, 'Expected "end" after while body.');
		const span = this.spanFromTokenAndToken(whileToken, endToken);
		return {
			kind: LuaSyntaxKind.WhileStatement,
			span,
			condition,
			block,
		};
	}

	private parseRepeatStatement(): LuaRepeatStatement {
		const repeatToken = this.advance();
		const block = this.parseBlock(REPEAT_TERMINATORS);
		this.consume(LuaTokenType.Until, 'Expected "until" after repeat block.');
		const condition = this.parseExpression();
		const span = this.spanFromTokenAndNode(repeatToken, condition);
		return {
			kind: LuaSyntaxKind.RepeatStatement,
			span,
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
		const span = this.spanFromTokenAndToken(forToken, endToken);
		const statement: LuaForGenericStatement = {
			kind: LuaSyntaxKind.ForGenericStatement,
			span,
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
		const span = this.spanFromTokenAndToken(forToken, endToken);
		return {
			kind: LuaSyntaxKind.ForNumericStatement,
			span,
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
		const span = this.spanFromTokenAndToken(doToken, endToken);
		return {
			kind: LuaSyntaxKind.DoStatement,
			span,
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
			this.retainSpanError(expression.span, 'Expected assignment or function call.');
			const statement: LuaErrorStatement = {
				kind: LuaSyntaxKind.ErrorStatement,
				span: expression.span,
				expression,
			};
			return statement;
		}
		if (this.recoverStatements) throw new LuaParserSpanError(expression.span, 'Expected assignment or function call.');
		throw this.errorAtSpan(expression.span, 'Expected assignment or function call.', this.publishLocations());
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
		const startPosition = this.spanStart(targets[0].span);
		const endPosition = values.length > 0 ? this.spanEnd(values[values.length - 1].span) : this.tokenEndOffset(this.previous());
		return {
			kind: LuaSyntaxKind.AssignmentStatement,
			span: this.createSpan(startPosition, endPosition),
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
			span: expression.span,
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
			if (tokenType === LuaTokenType.Star && this.startsNewLine) {
				continue;
			}
			if (this.match(tokenType)) {
				return operator;
			}
		}
		return null;
	}

	private parsePrefixExpression(): LuaExpression {
		let expression = this.parsePrimaryExpression();
		while (true) {
			if (this.match(LuaTokenType.LeftBracket)) {
				const indexExpression = this.parseExpression();
				const rightBracket = this.consume(LuaTokenType.RightBracket, 'Expected "]" after index expression.');
				const span = this.spanFromNodeAndToken(expression, rightBracket);
				const indexNode: LuaIndexExpression = {
					kind: LuaSyntaxKind.IndexExpression,
					span,
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
			const offset = this.tokenEndOffset(operatorToken) + 1;
			const span = this.createSpan(offset, offset);
			this.retainSpanError(span, message);
			member = {
				kind: LuaSyntaxKind.MissingIdentifier,
				span,
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
			this.retainTokenError(this.current(), 'Invalid function call arguments.');
		}
		return {
			kind: LuaSyntaxKind.MemberExpression,
			span: this.createSpan(this.spanStart(expression.span), member.kind === LuaSyntaxKind.MissingIdentifier
					? this.tokenEndOffset(operatorToken)
					: this.spanEnd(member.span)),
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
			const separators: number[] = [];
			if (!this.check(LuaTokenType.RightParen)) {
				if (!this.recoverStatements || this.startsExpression()) {
					args.push(this.parseExpression());
					while (this.match(LuaTokenType.Comma)) {
						separators.push(this.spanStart(this.previous()) - this.currentUnit.offset);
						if (this.recoverStatements && !this.startsExpression()) {
							this.retainTokenError(this.current(), 'Expected expression after ",".');
							break;
						}
						args.push(this.parseExpression());
					}
				} else {
					this.retainTokenError(this.current(), 'Expected expression after "(".');
				}
			}
			if (this.match(LuaTokenType.RightParen)) {
				const rightParen = this.previous();
				const end = this.tokenEndOffset(rightParen);
				return {
					arguments: args,
					end,
					argumentList: {
						span: this.createSpan(this.spanStart(leftParen), end),
						separators,
					},
				};
			}
			if (!this.recoverStatements) {
				this.consume(LuaTokenType.RightParen, 'Expected ")" after arguments.');
			}
			this.retainTokenError(this.current(), 'Expected ")" after arguments.');
			const current = this.current();
			const previous = this.previous();
			const end = current.type === LuaTokenType.Eof
				? this.spanStart(current)
				: this.tokenEndOffset(previous) + 1;
			return {
				arguments: args,
				end,
				argumentList: {
					span: this.createSpan(this.spanStart(leftParen), end),
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
				end: this.tokenEndOffset(endToken),
				argumentList: null,
			};
		}
		if (this.check(LuaTokenType.String)) {
			const stringToken = this.advance();
			const stringExpression = this.createStringLiteralExpression(stringToken);
			return {
				arguments: [stringExpression],
				end: this.tokenEndOffset(stringToken),
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
			span: this.createSpan(this.spanStart(callee.span), parsedArguments.end),
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
			span: this.spanFromTokenAndToken(sizeofToken, rightParen),
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
			span: this.spanFromTokenAndToken(offsetofToken, rightParen),
			typeName: typeToken.lexeme,
			fieldPath,
		};
	}

		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.NilLiteralExpression): LuaNilLiteralExpression;
		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.VarargExpression): LuaVarargExpression;
		private createTokenOnlyExpression(token: LuaToken, kind: LuaSyntaxKind.NilLiteralExpression | LuaSyntaxKind.VarargExpression): LuaNilLiteralExpression | LuaVarargExpression {
			return {
				kind,
				span: this.spanFromTokenAndToken(token, token),
			};
		}

	private parseBooleanLiteral(value: boolean): LuaBooleanLiteralExpression {
		const token = this.advance();
		return {
			kind: LuaSyntaxKind.BooleanLiteralExpression,
			span: this.spanFromTokenAndToken(token, token),
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
			span: this.spanFromTokenAndToken(token, token),
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
		let end = this.tokenEndOffset(nameToken);
		while (this.match(LuaTokenType.LeftBracket)) {
			arrayLengths.push(this.check(LuaTokenType.RightBracket) ? null : this.parseExpression());
			const rightBracket = this.consume(LuaTokenType.RightBracket, 'Expected "]" after type array length.');
			end = this.tokenEndOffset(rightBracket);
		}
		return {
			name: nameToken.lexeme,
			arrayLengths,
			span: this.createSpan(this.spanStart(nameToken), end),
		};
	}

	private parseTableConstructorExpression(leftBrace: LuaToken): LuaTableConstructorExpression {
		const fields: LuaTableField[] = [];
		if (!this.check(LuaTokenType.RightBrace)) {
			while (true) {
				const fieldStart = this.current();
				if (this.match(LuaTokenType.LeftBracket)) {
					const keyExpression = this.parseExpression();
					this.consume(LuaTokenType.RightBracket, 'Expected "]" after table key.');
					this.consume(LuaTokenType.Equal, 'Expected "=" after table key.');
					const valueExpression = this.parseExpression();
					const field: LuaTableExpressionField = {
						kind: LuaTableFieldKind.ExpressionKey,
						span: this.spanAroundNode(fieldStart, valueExpression, this.previous()),
						key: keyExpression,
						value: valueExpression,
					};
					fields.push(field);
				}
				else if (this.check(LuaTokenType.Identifier) && this.peekType(1) === LuaTokenType.Equal) {
					const nameToken = this.advance();
					this.consume(LuaTokenType.Equal, 'Expected "=" after table identifier key.');
					const valueExpression = this.parseExpression();
					const field: LuaTableIdentifierField = {
						kind: LuaTableFieldKind.IdentifierKey,
						span: this.spanAroundNode(fieldStart, valueExpression, this.previous()),
						name: nameToken.lexeme,
						value: valueExpression,
					};
					fields.push(field);
				}
				else {
					const valueExpression = this.parseExpression();
					const field: LuaTableArrayField = {
						kind: LuaTableFieldKind.Array,
						span: this.spanAroundNode(fieldStart, valueExpression, this.previous()),
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
		const span = this.spanFromTokenAndToken(leftBrace, rightBrace);
		return {
			kind: LuaSyntaxKind.TableConstructorExpression,
			span,
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
			span: this.createSpan(this.spanStart(left.span), this.spanEnd(right.span)),
			operator,
			left,
			right,
		};
	}

	private createUnaryExpression(operatorToken: LuaToken, operand: LuaExpression, operator: LuaUnaryOperator): LuaUnaryExpression {
		return {
			kind: LuaSyntaxKind.UnaryExpression,
			span: this.createSpan(this.spanStart(operatorToken), this.spanEnd(operand.span)),
			operator,
			operand,
		};
	}

	private createIdentifierExpression(token: LuaToken): LuaIdentifierExpression {
		return {
			kind: LuaSyntaxKind.IdentifierExpression,
			span: this.spanFromTokenAndToken(token, token),
			name: token.lexeme,
		};
	}

	private createStringLiteralExpression(token: LuaToken): LuaStringLiteralExpression {
		return {
			kind: LuaSyntaxKind.StringLiteralExpression,
			span: this.spanFromTokenAndToken(token, token),
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
		return this.cursor.token!;
	}

	private previous(): LuaToken {
		return this.previousToken;
	}

	private advance(): LuaToken {
		const token = this.current();
		if (token.type !== LuaTokenType.Eof) {
			this.index += 1;
			this.startsNewLine = false;
			this.cursor.advance();
			while (isLuaTrivia(this.cursor.token!.type)) {
				if (this.cursor.token!.breaks > 0) this.startsNewLine = true;
				this.cursor.advance();
			}
		}
		// The trivia loop also inspects the next significant token's kind.
		// Record that read once per advance, not at every repeated current().
		if (this.statementFrame !== undefined) this.statementFrame.readWidth = Math.max(
			this.statementFrame.readWidth, this.cursor.blockOffset + this.cursor.token!.end + 1);
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

	private peek(offset: number): LuaToken | undefined {
		const token = this.cursor.peekSignificant(offset);
		if (this.statementFrame !== undefined) {
			this.statementFrame.readWidth = Math.max(this.statementFrame.readWidth, token === undefined ? this.source.length + 1 : this.spanEnd(token) + 1);
		}
		return token;
	}

	private peekType(offset: number): LuaTokenType {
		const token = this.peek(offset);
		return token === undefined ? LuaTokenType.Eof : token.type;
	}

	private spanFromTokenAndToken(startToken: LuaToken, endToken: LuaToken): LuaSyntaxSpan {
		return this.createSpan(this.spanStart(startToken), this.tokenEndOffset(endToken));
	}

	/** Retains span identity when a field adds no syntax around its value. */
	private spanAroundNode(startToken: LuaToken, node: LuaNode, endToken: LuaToken): LuaSyntaxSpan {
		if (this.spanStart(node.span) === this.spanStart(startToken) && this.spanEnd(node.span) === this.tokenEndOffset(endToken)) return node.span;
		return this.spanFromTokenAndToken(startToken, endToken);
	}

	private spanFromTokenAndNode(startToken: LuaToken, node: LuaNode): LuaSyntaxSpan {
		return this.createSpan(this.spanStart(startToken), this.spanEnd(node.span));
	}

	private spanFromNodeAndToken(node: LuaNode, endToken: LuaToken): LuaSyntaxSpan {
		return this.createSpan(this.spanStart(node.span), this.tokenEndOffset(endToken));
	}

	private spanFromBlockAndToken(block: LuaBlock, endToken: LuaToken): LuaSyntaxSpan {
		return this.createSpan(this.spanStart(block.span), this.tokenEndOffset(endToken));
	}

	private tokenEndOffset(token: LuaToken): number {
		return this.spanEnd(token);
	}

	private blockStartOffset(): number {
		return this.index === 0 ? 0 : this.tokenEndOffset(this.previous()) + 1;
	}

	private createSpan(start: number, end: number): LuaSyntaxSpan {
		return { unit: this.currentUnit.unit, start: start - this.currentUnit.offset, end: end - this.currentUnit.offset };
	}

	private spanStart(span: LuaSyntaxSpan): number {
		return this.unitOrigins.get(span.unit)! + span.start;
	}

	private spanEnd(span: LuaSyntaxSpan): number {
		return this.unitOrigins.get(span.unit)! + span.end;
	}

	private beginUnit(offset: number): void {
		while (this.nextLexicalUnit < this.lexicalUnits.length && this.lexicalUnits[this.nextLexicalUnit].offset <= offset) {
			this.units.push(this.lexicalUnits[this.nextLexicalUnit++]);
		}
		const unit = { unit: createLuaSourceUnit(), offset };
		this.currentUnit = unit;
		this.statementFrame?.units.push(unit.unit);
		this.units.push(unit);
		this.unitOrigins.set(unit.unit, offset);
		if (this.recoverStatements) this.recoveryUnits.push(unit.unit);
	}

	private publishLocations(): LuaSourceLocations {
		while (this.nextLexicalUnit < this.lexicalUnits.length) this.units.push(this.lexicalUnits[this.nextLexicalUnit++]);
		this.unitOrigins = undefined;
		return this.locations;
	}

	private retainSyntaxError(error: LuaSyntaxError | LuaParserSpanError): void {
		if (this.statementFrame !== undefined) this.statementFrame.recovery = true;
		if (this.recoveredSyntaxError === null) {
			this.recoveredSyntaxError = error;
		}
	}

	private retainSpanError(span: LuaSyntaxSpan, message: string): void {
		if (this.statementFrame !== undefined) this.statementFrame.recovery = true;
		if (this.recoveredSyntaxError === null) this.recoveredSyntaxError = { span, message };
	}

	private retainTokenError(token: LuaToken, message: string): void {
		if (this.statementFrame !== undefined) this.statementFrame.recovery = true;
		if (this.recoveredSyntaxError === null) this.recoveredSyntaxError = this.error(token, message);
	}

	private error(token: LuaToken, message: string): LuaSyntaxError {
		const { line, column } = this.locations.range(token).start;
		const payload = this.formatError(line, column, message, token.lexeme);
		return new LuaSyntaxError(payload, this.path, line, column);
	}

	private errorAtSpan(span: LuaSyntaxSpan, message: string, locations: LuaSourceLocations): LuaSyntaxError {
		// Diagnostics are exceptional parser output, not per-node presentation.
		const { start, end } = locations.range(span);
		const lineText = this.sourceLine(start.line);
		const startIndex = Math.max(start.column - 1, 0);
		const endIndex = Math.min(Math.max(end.column, startIndex + 1), lineText.length);
		const lexeme = lineText.slice(startIndex, endIndex);
		return new LuaSyntaxError(this.formatError(start.line, start.column, message, lexeme), this.path, start.line, start.column);
	}

	private formatError(line: number, column: number, message: string, lexeme?: string): string {
		const near = lexeme && lexeme.length > 0 ? ` near '${lexeme}'` : '';
		const lineText = this.sourceLine(line);
		const pointer = ' '.repeat(Math.max(column - 1, 0)) + '^';
		return `[line ${line}, column ${column}] ${message}${near}\n${lineText}\n${pointer}`;
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
