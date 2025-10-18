export type LuaSourcePosition = {
	readonly line: number;
	readonly column: number;
};

export type LuaSourceRange = {
	readonly chunkName: string;
	readonly start: LuaSourcePosition;
	readonly end: LuaSourcePosition;
};

export const enum LuaSyntaxKind {
	Chunk,
	Block,
	EmptyStatement,
	AssignmentStatement,
	LocalAssignmentStatement,
	FunctionDeclarationStatement,
	ReturnStatement,
	BreakStatement,
	IfStatement,
	WhileStatement,
	RepeatStatement,
	ForNumericStatement,
	ForGenericStatement,
	CallStatement,
	NumericLiteralExpression,
	StringLiteralExpression,
	BooleanLiteralExpression,
	NilLiteralExpression,
	VarargExpression,
	IdentifierExpression,
	TableConstructorExpression,
	FunctionExpression,
	BinaryExpression,
	UnaryExpression,
	CallExpression,
	MemberExpression,
}

export type LuaNode = {
	readonly kind: LuaSyntaxKind;
	readonly range: LuaSourceRange;
};

export type LuaStatement = LuaNode;
export type LuaExpression = LuaNode;

export type LuaChunk = LuaNode & {
	readonly kind: LuaSyntaxKind.Chunk;
	readonly body: ReadonlyArray<LuaStatement>;
};

export type LuaBlock = LuaNode & {
	readonly kind: LuaSyntaxKind.Block;
	readonly body: ReadonlyArray<LuaStatement>;
};
