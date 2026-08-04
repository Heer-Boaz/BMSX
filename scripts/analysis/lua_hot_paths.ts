import {
	LuaBinaryOperator,
	type LuaBinaryExpression,
	type LuaBlock,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionDeclarationStatement,
	type LuaFunctionExpression,
	type LuaIndexExpression,
	type LuaLocalAssignmentStatement,
	type LuaLocalFunctionStatement,
	type LuaMemberExpression,
	type LuaNode,
	type LuaReturnStatement,
	type LuaStatement,
	LuaSyntaxKind,
} from '../../toolchain/ts/lua/syntax/ast';

type LuaNamedFunction = {
	name: string;
	expression: LuaFunctionExpression;
};

function namedTopLevelLuaFunction(statement: LuaStatement): LuaNamedFunction | null {
	switch (statement.kind) {
		case LuaSyntaxKind.LocalFunctionStatement: {
			const localFunction = statement as LuaLocalFunctionStatement;
			return { name: localFunction.name.name, expression: localFunction.functionExpression };
		}
		case LuaSyntaxKind.FunctionDeclarationStatement: {
			const declaration = statement as LuaFunctionDeclarationStatement;
			const prefix = declaration.name.identifiers.join('.');
			const name = declaration.name.methodName === null ? prefix : `${prefix}:${declaration.name.methodName}`;
			return { name, expression: declaration.functionExpression };
		}
		case LuaSyntaxKind.LocalAssignmentStatement: {
			const assignment = statement as LuaLocalAssignmentStatement;
			if (assignment.names.length !== 1 || assignment.values.length !== 1 || assignment.values[0].kind !== LuaSyntaxKind.FunctionExpression) {
				return null;
			}
			return { name: assignment.names[0].name, expression: assignment.values[0] as LuaFunctionExpression };
		}
		default:
			return null;
	}
}

export function indexTopLevelLuaFunctions(chunk: LuaChunk): Map<string, LuaFunctionExpression> {
	const functions = new Map<string, LuaFunctionExpression>();
	for (const statement of chunk.body) {
		const named = namedTopLevelLuaFunction(statement);
		if (named !== null) {
			functions.set(named.name, named.expression);
		}
	}
	return functions;
}

export function indexLuaModuleFunctions(chunk: LuaChunk, defaultFunctionName: string): Map<string, LuaFunctionExpression> {
	const functions = indexTopLevelLuaFunctions(chunk);
	for (const statement of chunk.body) {
		if (statement.kind !== LuaSyntaxKind.ReturnStatement) {
			continue;
		}
		const returnStatement = statement as LuaReturnStatement;
		if (returnStatement.expressions.length === 1
			&& returnStatement.expressions[0].kind === LuaSyntaxKind.FunctionExpression) {
			functions.set(defaultFunctionName, returnStatement.expressions[0] as LuaFunctionExpression);
		}
	}
	return functions;
}

function walkLuaAst(
	value: unknown,
	visit: (node: LuaNode) => boolean | void,
): void {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			walkLuaAst(value[index], visit);
		}
		return;
	}
	if (value === null || typeof value !== 'object') {
		return;
	}
	const record = value as Record<string, unknown>;
	if ('kind' in record && 'range' in record) {
		const node = value as LuaNode;
		// Returning false records the node but keeps its child tree out of the
		// current function-body analysis. Nested closures use that boundary.
		if (visit(node) === false) {
			return;
		}
	}
	for (const [key, child] of Object.entries(record)) {
		if (key !== 'range') {
			walkLuaAst(child, visit);
		}
	}
}

function luaCallRootName(call: LuaCallExpression): string | null {
	const callee = call.callee;
	if (callee.kind === LuaSyntaxKind.IdentifierExpression) {
		return callee.name;
	}
	if (callee.kind === LuaSyntaxKind.MemberExpression && callee.base.kind === LuaSyntaxKind.IdentifierExpression) {
		return callee.base.name;
	}
	return null;
}

export function auditLuaNoHeapBody(file: string, label: string, body: LuaBlock): string[] {
	const errors: string[] = [];
	walkLuaAst(body, (node) => {
		let allocation: string | null = null;
		let descend = true;
		switch (node.kind) {
			case LuaSyntaxKind.TableConstructorExpression:
				allocation = 'table literal';
				break;
			case LuaSyntaxKind.FunctionExpression:
				allocation = 'function literal';
				descend = false;
				break;
			case LuaSyntaxKind.BinaryExpression:
				if ((node as LuaBinaryExpression).operator === LuaBinaryOperator.Concat) {
					allocation = 'string concat';
				}
				break;
			case LuaSyntaxKind.CallExpression: {
				const root = luaCallRootName(node as LuaCallExpression);
				if (root === 'table') allocation = 'table library';
				else if (root === 'string') allocation = 'string library';
				else if (root === 'coroutine') allocation = 'coroutine';
				else if (root === 'pairs' || root === 'ipairs') allocation = `${root} iterator`;
				else if (root === 'setmetatable' || root === 'getmetatable') allocation = 'metatable';
				break;
			}
		}
		if (allocation !== null) {
			errors.push(`${file}:${node.range.start.line}: function ${label} forbidden lua heap/gc pattern ${allocation}`);
		}
		return descend;
	});
	return errors;
}

function luaExpressionPath(expression: LuaExpression): string | null {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
			return expression.name;
		case LuaSyntaxKind.MemberExpression: {
			const member = expression as LuaMemberExpression;
			const base = luaExpressionPath(member.base);
			return base === null ? null : `${base}.${member.identifier}`;
		}
		case LuaSyntaxKind.IndexExpression: {
			const index = expression as LuaIndexExpression;
			const base = luaExpressionPath(index.base);
			return base === null ? null : `${base}[]`;
		}
		default:
			return null;
	}
}

export function luaCallTargetPath(call: LuaCallExpression): string | null {
	const callee = luaExpressionPath(call.callee);
	if (callee === null) {
		return null;
	}
	return call.methodName === null ? callee : `${callee}:${call.methodName}`;
}

export function luaFunctionCallTargetCounts(expression: LuaFunctionExpression): Map<string, number> {
	const counts = new Map<string, number>();
	walkLuaAst(expression.body, (node) => {
		if (node.kind === LuaSyntaxKind.FunctionExpression) {
			return false;
		}
		if (node.kind !== LuaSyntaxKind.CallExpression) {
			return;
		}
		const target = luaCallTargetPath(node as LuaCallExpression);
		if (target !== null) {
			counts.set(target, (counts.get(target) ?? 0) + 1);
		}
	});
	return counts;
}

export function luaFunctionSyntaxCount(expression: LuaFunctionExpression, kind: LuaSyntaxKind): number {
	let count = 0;
	walkLuaAst(expression.body, (node) => {
		if (node.kind === kind) {
			count += 1;
		}
		if (node.kind === LuaSyntaxKind.FunctionExpression) {
			return false;
		}
	});
	return count;
}
