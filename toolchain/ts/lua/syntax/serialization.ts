import { decodeBinary, encodeBinary } from '../../../../machine/ts/common/serializer/binencoder';
import { LuaSyntaxError } from '../errors';
import { LuaSyntaxKind, LuaTableFieldKind, type LuaChunk, type LuaSkippedSyntax, type LuaStatement, type LuaTableField, type LuaTypeReference } from './ast';
import type { LuaAstNode } from './ast/traversal';
import { createLuaSourceUnit, type LuaSourceUnit, type LuaSourceUnitPlacement } from './source_layout';
import { LuaSourceLocations, type LuaSyntaxSpan } from './source_locations';
import type { LuaToken } from './token';
import { LuaStatementSequence } from './statement_sequence';
import { LuaTokenSequence } from './token_sequence';

/** Storage ordinals, not runtime occurrence identities or source coordinates. */
type UnitOrdinal = number & { readonly __syntaxUnitOrdinal: unique symbol };
type SpanOrdinal = number & { readonly __syntaxSpanOrdinal: unique symbol };
type StoredSpan = { readonly unit: UnitOrdinal; readonly start: number; readonly end: number };
type SyntaxData<T, Span, Unit, Statements> = T extends LuaSyntaxSpan ? Span
	: T extends LuaStatementSequence ? Statements
	: T extends LuaSkippedSyntax ? { readonly span: Span; readonly units: readonly Unit[] }
	: T extends object ? { readonly [Key in keyof T]: SyntaxData<T[Key], Span, Unit, Statements> } : T;
type ChunkData = Omit<LuaChunk, 'locations' | 'syntaxError' | 'tokens'>;
type NodeData<Span, Unit, Statements> = SyntaxData<Exclude<LuaAstNode, LuaChunk>, Span, Unit, Statements>;
type StoredStatements = {
	readonly context: number;
	readonly parts: readonly {
		readonly statement: SyntaxData<LuaStatement, SpanOrdinal, UnitOrdinal, StoredStatements> | null;
		readonly width: number;
		readonly readWidth: number;
		readonly recovery: boolean;
		readonly endsNewLine: boolean;
		readonly units: readonly UnitOrdinal[];
	}[];
};
type StoredToken = Omit<LuaToken, keyof LuaSyntaxSpan> & { readonly span: SpanOrdinal };
type StoredChunk = {
	readonly syntax: SyntaxData<ChunkData, SpanOrdinal, UnitOrdinal, StoredStatements>;
	readonly path: string;
	readonly lexical: readonly { readonly unit: UnitOrdinal; readonly items: readonly StoredToken[] }[];
	readonly offsets: readonly number[];
	readonly spans: readonly StoredSpan[];
	readonly error: { readonly line: number; readonly column: number; readonly message: string } | null;
};

/**
 * Schema-directed wire projection. Only the storage boundary walks syntax;
 * parser publication and live location queries never clone executable nodes.
 */
class SyntaxUnits<FromSpan, FromUnit, FromStatements, ToSpan, ToUnit, ToStatements> {
	public constructor(
		public readonly span: (span: FromSpan) => ToSpan,
		private readonly unit: (unit: FromUnit) => ToUnit,
		public readonly statements: (body: FromStatements) => ToStatements,
	) {}

	public skipped(entries: readonly SyntaxData<LuaSkippedSyntax, FromSpan, FromUnit, FromStatements>[]): readonly SyntaxData<LuaSkippedSyntax, ToSpan, ToUnit, ToStatements>[] {
		return entries.map(entry => ({ span: this.span(entry.span), units: entry.units.map(this.unit) }));
	}

	public type(ref: SyntaxData<LuaTypeReference, FromSpan, FromUnit, FromStatements>): SyntaxData<LuaTypeReference, ToSpan, ToUnit, ToStatements> {
		return { ...ref, span: this.span(ref.span), arrayLengths: ref.arrayLengths.map(length => length === null ? null : this.node(length)) };
	}

	public field(field: SyntaxData<LuaTableField, FromSpan, FromUnit, FromStatements>): SyntaxData<LuaTableField, ToSpan, ToUnit, ToStatements> {
		const span = this.span(field.span), value = this.node(field.value);
		return field.kind === LuaTableFieldKind.ExpressionKey
			? { ...field, span, value, key: this.node(field.key) } : { ...field, span, value };
	}

	public node<Kind extends NodeData<FromSpan, FromUnit, FromStatements>['kind']>(node: NodeData<FromSpan, FromUnit, FromStatements> & { readonly kind: Kind }): Extract<NodeData<ToSpan, ToUnit, ToStatements>, { readonly kind: Kind }>;
	public node(node: NodeData<FromSpan, FromUnit, FromStatements>): NodeData<ToSpan, ToUnit, ToStatements> {
		const span = this.span(node.span);
		switch (node.kind) {
			case LuaSyntaxKind.Block: return { ...node, span, body: this.statements(node.body), skippedSyntax: this.skipped(node.skippedSyntax) };
			case LuaSyntaxKind.AssignmentStatement: return { ...node, span, left: node.left.map(item => this.node(item)), right: node.right.map(item => this.node(item)) };
			case LuaSyntaxKind.LocalAssignmentStatement: return { ...node, span, names: node.names.map(item => this.node(item)), values: node.values.map(item => this.node(item)),
				pointerTypeRefs: node.pointerTypeRefs.map(ref => ref === null ? null : this.type(ref)) };
			case LuaSyntaxKind.LocalFunctionStatement: return { ...node, span, name: this.node(node.name), functionExpression: this.node(node.functionExpression) };
			case LuaSyntaxKind.FunctionDeclarationStatement: return { ...node, span, functionExpression: this.node(node.functionExpression),
				name: { path: node.name.path.map(item => this.node(item)), method: node.name.method === null ? null : this.node(node.name.method) } };
			case LuaSyntaxKind.ReturnStatement: return { ...node, span, expressions: node.expressions.map(item => this.node(item)) };
			case LuaSyntaxKind.IfStatement: return { ...node, span, clauses: node.clauses.map(clause => ({
				condition: clause.condition === null ? null : this.node(clause.condition), block: this.node(clause.block) })) };
			case LuaSyntaxKind.WhileStatement:
			case LuaSyntaxKind.RepeatStatement: return { ...node, span, condition: this.node(node.condition), block: this.node(node.block) };
			case LuaSyntaxKind.ForNumericStatement: return { ...node, span, variable: this.node(node.variable), start: this.node(node.start), limit: this.node(node.limit),
				step: node.step === null ? null : this.node(node.step), block: this.node(node.block) };
			case LuaSyntaxKind.ForGenericStatement: return { ...node, span, variables: node.variables.map(item => this.node(item)),
				iterators: node.iterators.map(item => this.node(item)), block: this.node(node.block) };
			case LuaSyntaxKind.DoStatement: return { ...node, span, block: this.node(node.block) };
			case LuaSyntaxKind.StructDeclarationStatement: return { ...node, span, name: this.node(node.name), fields: node.fields.map(field => ({
				...field, span: this.span(field.span), typeRef: this.type(field.typeRef) })) };
			case LuaSyntaxKind.BssDeclarationStatement: return { ...node, span, name: this.node(node.name), typeRef: this.type(node.typeRef) };
			case LuaSyntaxKind.DataDeclarationStatement:
			case LuaSyntaxKind.RodataDeclarationStatement: return { ...node, span, name: this.node(node.name), typeRef: this.type(node.typeRef), initializer: this.node(node.initializer) };
			case LuaSyntaxKind.CallStatement: return { ...node, span, expression: this.node(node.expression) };
			case LuaSyntaxKind.ErrorStatement: return { ...node, span, expression: this.node(node.expression) };
			case LuaSyntaxKind.BinaryExpression: return { ...node, span, left: this.node(node.left), right: this.node(node.right) };
			case LuaSyntaxKind.UnaryExpression: return { ...node, span, operand: this.node(node.operand) };
			case LuaSyntaxKind.CallExpression: return { ...node, span, callee: this.node(node.callee), arguments: node.arguments.map(item => this.node(item)),
				method: node.method === null ? null : this.node(node.method), argumentList: node.argumentList === null ? null : {
					span: this.span(node.argumentList.span), separators: node.argumentList.separators } };
			case LuaSyntaxKind.MemberExpression: return { ...node, span, base: this.node(node.base), member: this.node(node.member) };
			case LuaSyntaxKind.IndexExpression: return { ...node, span, base: this.node(node.base), index: this.node(node.index) };
			case LuaSyntaxKind.TableConstructorExpression: return { ...node, span, fields: node.fields.map(field => this.field(field)) };
			case LuaSyntaxKind.FunctionExpression: return { ...node, span, parameters: node.parameters.map(item => this.node(item)), body: this.node(node.body) };
			case LuaSyntaxKind.SizeOfExpression: return { ...node, span, typeRef: this.type(node.typeRef) };
			case LuaSyntaxKind.OffsetOfExpression: return { ...node, span };
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
			case LuaSyntaxKind.MissingIdentifier: return { ...node, span };
		}
	}
}

/** Parsed ROM modules persist schema data, never source-owner indices or caches. */
export function encodeLuaChunk(chunk: LuaChunk): Uint8Array {
	const offsets: number[] = [];
	const ordinals = new Map<LuaSourceUnit, UnitOrdinal>();
	for (const placement of chunk.locations.unitPlacements()) {
		ordinals.set(placement.unit, offsets.length as UnitOrdinal);
		offsets.push(placement.offset);
	}
	const spans: StoredSpan[] = [];
	const spanOrdinals = new Map<LuaSyntaxSpan, SpanOrdinal>();
	const mapper: SyntaxUnits<LuaSyntaxSpan, LuaSourceUnit, LuaStatementSequence, SpanOrdinal, UnitOrdinal, StoredStatements> = new SyntaxUnits(span => {
		let ordinal = spanOrdinals.get(span);
		if (ordinal === undefined) {
			ordinal = spans.length as SpanOrdinal;
			spanOrdinals.set(span, ordinal);
			spans.push({ unit: ordinals.get(span.unit)!, start: span.start, end: span.end });
		}
		return ordinal;
	}, unit => ordinals.get(unit)!, body => ({
		context: body.context,
		parts: Array.from(body.parts(), part => ({
			statement: part.statement === null ? null : mapper.node(part.statement),
			width: part.width, readWidth: part.readWidth, recovery: part.recovery, endsNewLine: part.endsNewLine,
			units: part.units.map(unit => ordinals.get(unit)!),
		})),
	}));
	const syntax: SyntaxData<ChunkData, SpanOrdinal, UnitOrdinal, StoredStatements> = {
		kind: chunk.kind, span: mapper.span(chunk.span), source: chunk.source,
		body: mapper.statements(chunk.body), skippedSyntax: mapper.skipped(chunk.skippedSyntax),
		constModule: chunk.constModule, entryModule: chunk.entryModule,
	};
	const error = chunk.syntaxError;
	const lexical = Array.from(chunk.tokens.blocks(), ({ block }) => ({
		unit: ordinals.get(block.unit)!, items: block.items.map(token => {
			const { unit: _unit, start: _start, end: _end, ...data } = token;
			return { ...data, span: mapper.span(token) };
		}),
	}));
	const stored: StoredChunk = { syntax, lexical, path: chunk.locations.path, offsets, spans,
		error: error === null ? null : { line: error.line, column: error.column, message: error.message } };
	return encodeBinary(stored);
}

/** Each import creates distinct runtime occurrences without reparsing source. */
export function decodeLuaChunk(bytes: Uint8Array): LuaChunk {
	const stored = decodeBinary(bytes) as StoredChunk;
	const units = stored.offsets.map(() => createLuaSourceUnit());
	const origins = new Map<LuaSourceUnit, number>();
	const placements: LuaSourceUnitPlacement[] = units.map((unit, ordinal) => {
		const offset = stored.offsets[ordinal];
		origins.set(unit, offset);
		return { unit, offset };
	});
	const spans: LuaSyntaxSpan[] = stored.spans.map(span => ({ unit: units[span.unit], start: span.start, end: span.end }));
	const mapper: SyntaxUnits<SpanOrdinal, UnitOrdinal, StoredStatements, LuaSyntaxSpan, LuaSourceUnit, LuaStatementSequence> = new SyntaxUnits(
		ordinal => spans[ordinal], ordinal => units[ordinal], body => LuaStatementSequence.fromParts(body.context, body.parts.map(part => ({
			statement: part.statement === null ? null : mapper.node(part.statement),
			width: part.width, readWidth: part.readWidth, recovery: part.recovery, endsNewLine: part.endsNewLine,
			units: part.units.map(ordinal => units[ordinal]),
		}))),
	);
	const syntax = stored.syntax, error = stored.error;
	return {
		...syntax, span: mapper.span(syntax.span), body: mapper.statements(syntax.body), skippedSyntax: mapper.skipped(syntax.skippedSyntax),
		tokens: LuaTokenSequence.fromBlocks(stored.lexical.map(block => ({ unit: units[block.unit],
			items: block.items.map(({ span, ...data }) => ({ ...data, ...mapper.span(span) })),
		}))),
		locations: LuaSourceLocations.fromSource(stored.path, syntax.source, placements, origins),
		syntaxError: error === null ? null : new LuaSyntaxError(error.message, stored.path, error.line, error.column),
	};
}
