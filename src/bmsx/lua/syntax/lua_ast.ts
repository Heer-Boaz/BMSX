export type LuaSourcePosition = {
	readonly line: number;
	readonly column: number;
};

export type LuaSourceLocation = {
	readonly path: string;
} & LuaSourcePosition;

export type LuaSourceRange = {
	readonly path: string;
	readonly start: LuaSourcePosition;
	readonly end: LuaSourcePosition;
};

export const enum LuaSyntaxKind {
	Chunk,
	Block,
	AssignmentStatement,
	LocalAssignmentStatement,
	LocalFunctionStatement,
	FunctionDeclarationStatement,
	ReturnStatement,
	BreakStatement,
	IfStatement,
	WhileStatement,
	RepeatStatement,
	ForNumericStatement,
	ForGenericStatement,
	DoStatement,
	HaltUntilIrqStatement,
	CallStatement,
	GotoStatement,
	LabelStatement,
	NumericLiteralExpression,
	StringLiteralExpression,
	StringRefLiteralExpression,
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
	IndexExpression,
}

export type LuaNode = {
	readonly kind: LuaSyntaxKind;
	readonly range: LuaSourceRange;
};

export type LuaDefinitionInfo = {
	readonly name: string;
	readonly namePath: ReadonlyArray<string>;
	readonly definition: LuaSourceRange;
	readonly scope: LuaSourceRange;
	readonly kind: LuaDefinitionKind;
};

export type LuaDefinitionKind =
	| 'variable'
	| 'constant'
	| 'function'
	| 'table_field'
	| 'parameter'
	| 'assignment';

export type LuaStatement =
	| LuaAssignmentStatement
	| LuaLocalAssignmentStatement
	| LuaLocalFunctionStatement
	| LuaFunctionDeclarationStatement
	| LuaReturnStatement
	| LuaBreakStatement
	| LuaIfStatement
	| LuaWhileStatement
	| LuaRepeatStatement
	| LuaForNumericStatement
	| LuaForGenericStatement
	| LuaDoStatement
	| LuaHaltUntilIrqStatement
	| LuaGotoStatement
	| LuaLabelStatement
	| LuaCallStatement;

export type LuaExpression =
	| LuaNumericLiteralExpression
	| LuaStringLiteralExpression
	| LuaStringRefLiteralExpression
	| LuaBooleanLiteralExpression
	| LuaNilLiteralExpression
	| LuaVarargExpression
	| LuaIdentifierExpression
	| LuaTableConstructorExpression
	| LuaFunctionExpression
	| LuaBinaryExpression
	| LuaUnaryExpression
	| LuaCallExpression
	| LuaMemberExpression
	| LuaIndexExpression;

export type LuaChunk = LuaNode & {
	readonly kind: LuaSyntaxKind.Chunk;
	readonly body: ReadonlyArray<LuaStatement>;
	readonly definitions: ReadonlyArray<LuaDefinitionInfo>;
};

export type LuaBlock = LuaNode & {
	readonly kind: LuaSyntaxKind.Block;
	readonly body: ReadonlyArray<LuaStatement>;
};

export const enum LuaAssignmentOperator {
	Assign,
	AddAssign,
	SubtractAssign,
	MultiplyAssign,
	DivideAssign,
	ModulusAssign,
	ExponentAssign,
}

export type LuaAssignmentStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.AssignmentStatement;
	readonly left: ReadonlyArray<LuaAssignableExpression>;
	readonly right: ReadonlyArray<LuaExpression>;
	readonly operator: LuaAssignmentOperator;
};

export type LuaLocalAttribute = 'const';

export type LuaLocalAssignmentStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.LocalAssignmentStatement;
	readonly names: ReadonlyArray<LuaIdentifierExpression>;
	readonly attributes: ReadonlyArray<LuaLocalAttribute | null>;
	readonly values: ReadonlyArray<LuaExpression>;
};

export type LuaLocalFunctionStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.LocalFunctionStatement;
	readonly name: LuaIdentifierExpression;
	readonly functionExpression: LuaFunctionExpression;
};

export type LuaFunctionName = {
	readonly identifiers: ReadonlyArray<string>;
	readonly methodName: string | null;
};

export type LuaFunctionDeclarationStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.FunctionDeclarationStatement;
	readonly name: LuaFunctionName;
	readonly functionExpression: LuaFunctionExpression;
};

export type LuaReturnStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.ReturnStatement;
	readonly expressions: ReadonlyArray<LuaExpression>;
};

export type LuaBreakStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.BreakStatement;
};

export type LuaIfClause = {
	readonly condition: LuaExpression | null;
	readonly block: LuaBlock;
};

export type LuaIfStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.IfStatement;
	readonly clauses: ReadonlyArray<LuaIfClause>;
};

export type LuaWhileStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.WhileStatement;
	readonly condition: LuaExpression;
	readonly block: LuaBlock;
};

export type LuaRepeatStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.RepeatStatement;
	readonly block: LuaBlock;
	readonly condition: LuaExpression;
};

export type LuaForNumericStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.ForNumericStatement;
	readonly variable: LuaIdentifierExpression;
	readonly start: LuaExpression;
	readonly limit: LuaExpression;
	readonly step: LuaExpression | null;
	readonly block: LuaBlock;
};

export type LuaForGenericStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.ForGenericStatement;
	readonly variables: ReadonlyArray<LuaIdentifierExpression>;
	readonly iterators: ReadonlyArray<LuaExpression>;
	readonly block: LuaBlock;
};

export type LuaDoStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.DoStatement;
	readonly block: LuaBlock;
};

export type LuaHaltUntilIrqStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.HaltUntilIrqStatement;
};

export type LuaCallStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.CallStatement;
	readonly expression: LuaCallExpression;
};

export type LuaGotoStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.GotoStatement;
	readonly label: string;
};

export type LuaLabelStatement = LuaNode & {
	readonly kind: LuaSyntaxKind.LabelStatement;
	readonly label: string;
};

export type LuaNumericLiteralExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.NumericLiteralExpression;
	readonly value: number;
};

export type LuaStringLiteralExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.StringLiteralExpression;
	readonly value: string;
};

export type LuaStringRefLiteralExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.StringRefLiteralExpression;
	readonly value: string;
};

export type LuaBooleanLiteralExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.BooleanLiteralExpression;
	readonly value: boolean;
};

export type LuaNilLiteralExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.NilLiteralExpression;
};

export type LuaVarargExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.VarargExpression;
};

export type LuaIdentifierExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.IdentifierExpression;
	readonly name: string;
};

export const enum LuaTableFieldKind {
	Array,
	IdentifierKey,
	ExpressionKey,
}

export type LuaTableArrayField = {
	readonly kind: LuaTableFieldKind.Array;
	readonly value: LuaExpression;
	readonly range: LuaSourceRange;
};

export type LuaTableIdentifierField = {
	readonly kind: LuaTableFieldKind.IdentifierKey;
	readonly name: string;
	readonly value: LuaExpression;
	readonly range: LuaSourceRange;
};

export type LuaTableExpressionField = {
	readonly kind: LuaTableFieldKind.ExpressionKey;
	readonly key: LuaExpression;
	readonly value: LuaExpression;
	readonly range: LuaSourceRange;
};

export type LuaTableField = LuaTableArrayField | LuaTableIdentifierField | LuaTableExpressionField;

export type LuaTableConstructorExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.TableConstructorExpression;
	readonly fields: ReadonlyArray<LuaTableField>;
};

export type LuaFunctionParameter = {
	readonly name: LuaIdentifierExpression;
};

export type LuaFunctionExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.FunctionExpression;
	readonly parameters: ReadonlyArray<LuaIdentifierExpression>;
	readonly hasVararg: boolean;
	readonly body: LuaBlock;
};

export const enum LuaBinaryOperator {
	Or,
	And,
	Equal,
	NotEqual,
	LessThan,
	LessEqual,
	GreaterThan,
	GreaterEqual,
	BitwiseOr,
	BitwiseXor,
	BitwiseAnd,
	ShiftLeft,
	ShiftRight,
	Concat,
	Add,
	Subtract,
	Multiply,
	Divide,
	FloorDivide,
	Modulus,
	Exponent,
}

export type LuaBinaryExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.BinaryExpression;
	readonly operator: LuaBinaryOperator;
	readonly left: LuaExpression;
	readonly right: LuaExpression;
};

export const enum LuaUnaryOperator {
	Negate,
	Not,
	Length,
	BitwiseNot,
}

export type LuaUnaryExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.UnaryExpression;
	readonly operator: LuaUnaryOperator;
	readonly operand: LuaExpression;
};

export type LuaCallExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.CallExpression;
	readonly callee: LuaExpression;
	readonly arguments: ReadonlyArray<LuaExpression>;
	readonly methodName: string | null;
};

export type LuaMemberExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.MemberExpression;
	readonly base: LuaExpression;
	readonly identifier: string;
};

export type LuaIndexExpression = LuaNode & {
	readonly kind: LuaSyntaxKind.IndexExpression;
	readonly base: LuaExpression;
	readonly index: LuaExpression;
};

export type LuaAssignableExpression = LuaIdentifierExpression | LuaMemberExpression | LuaIndexExpression;
