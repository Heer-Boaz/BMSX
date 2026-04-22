// start normalized-body-acceptable -- Chunk and returned-function compilation intentionally share setup shape but produce different entry contracts.
import { splitText } from '../../common/text_lines';
import { LuaParser } from '../../lua/syntax/parser';
import {
	LuaSyntaxKind,
	LuaAssignmentOperator,
	LuaUnaryOperator,
	type LuaAssignmentStatement,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionExpression,
	type LuaReturnStatement,
	type LuaSourceRange,
} from '../../lua/syntax/ast';
import { LuaLexer } from '../../lua/syntax/lexer';
import { createNativeFunction, isNativeObject, Table, type NativeFunction, type Value } from '../cpu/cpu';
import { isStringValue, type StringValue } from '../memory/string_pool';
import type { Runtime } from '../runtime/runtime';

type LoadSubsetValueExpr =
	| {
		kind: 'literal';
		value: Value;
	}
	| {
		kind: 'param';
		rootParamIndex: number;
		path: LoadSubsetPathStep[];
	};

type LoadSubsetPathStep =
	| {
		kind: 'key';
		key: Value;
	}
	| {
		kind: 'field';
		key: StringValue;
	}
	| {
		kind: 'index';
		index: number;
	};

type LoadSubsetOp = {
	rootParamIndex: number;
	path: LoadSubsetPathStep[];
	valueExpr: LoadSubsetValueExpr;
};

type LoadSubsetCompiledFunction = {
	ops: LoadSubsetOp[];
};

const describeValue = (value: Value): string => {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (isStringValue(value)) {
		return 'string';
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
};

const getPathStepValue = (runtime: Runtime, target: Value, step: LoadSubsetPathStep): Value => {
	if (target instanceof Table) {
		if (step.kind === 'index') {
			return target.getInteger(step.index);
		}
		if (step.kind === 'field') {
			return target.getStringKey(step.key);
		}
		return target.get(step.key);
	}
	if (isNativeObject(target)) {
		if (step.kind === 'index') {
			return target.get(step.index);
		}
		if (step.kind === 'field') {
			return target.get(step.key);
		}
		return target.get(step.key);
	}
	throw runtime.createApiRuntimeError(`[loadstring] attempted to index a non-table value (${describeValue(target)}).`);
};

const setPathStepValue = (runtime: Runtime, target: Value, step: LoadSubsetPathStep, value: Value): void => {
	if (target instanceof Table) {
		if (step.kind === 'index') {
			target.setInteger(step.index, value);
			return;
		}
		if (step.kind === 'field') {
			target.setStringKey(step.key, value);
			return;
		}
		target.set(step.key, value);
		return;
	}
	if (isNativeObject(target)) {
		if (step.kind === 'index') {
			target.set(step.index, value);
			return;
		}
		if (step.kind === 'field') {
			target.set(step.key, value);
			return;
		}
		target.set(step.key, value);
		return;
	}
	throw runtime.createApiRuntimeError(`[loadstring] attempted to assign through a non-table value (${describeValue(target)}).`);
};

const resolveValueExpr = (runtime: Runtime, args: ReadonlyArray<Value>, expr: LoadSubsetValueExpr): Value => {
	if (expr.kind === 'literal') {
		return expr.value;
	}
	let node: Value = expr.rootParamIndex < args.length ? args[expr.rootParamIndex]! : null;
	for (let index = 0; index < expr.path.length; index += 1) {
		node = getPathStepValue(runtime, node, expr.path[index]!);
	}
	return node;
};

const buildNativeFunction = (runtime: Runtime, compiled: LoadSubsetCompiledFunction, name: string): NativeFunction =>
	createNativeFunction(name, (args, out) => {
		out.length = 0;
		for (let index = 0; index < compiled.ops.length; index += 1) {
			const op = compiled.ops[index]!;
			let node: Value = op.rootParamIndex < args.length ? args[op.rootParamIndex]! : null;
			for (let pathIndex = 0; pathIndex < op.path.length - 1; pathIndex += 1) {
				node = getPathStepValue(runtime, node, op.path[pathIndex]!);
			}
			setPathStepValue(
				runtime,
				node,
				op.path[op.path.length - 1]!,
				resolveValueExpr(runtime, args, op.valueExpr),
			);
		}
	});

const fail = (runtime: Runtime, chunkName: string, message: string, range?: LuaSourceRange): never => {
	if (range !== undefined) {
		throw runtime.createApiRuntimeError(`[loadstring:${chunkName}] ${message} at ${range.start.line}:${range.start.column}.`);
	}
	throw runtime.createApiRuntimeError(`[loadstring:${chunkName}] ${message}`);
};

const compileParamPath = (
	runtime: Runtime,
	chunkName: string,
	expression: LuaExpression,
	paramIndexByName: ReadonlyMap<string, number>,
): { rootParamIndex: number; path: LoadSubsetPathStep[] } => {
	if (expression.kind === LuaSyntaxKind.IdentifierExpression) {
		const rootParamIndex = paramIndexByName.get(expression.name);
		if (rootParamIndex === undefined) {
			fail(runtime, chunkName, `unknown function parameter '${expression.name}'`, expression.range);
		}
		return {
			rootParamIndex,
			path: [],
		};
	}
	if (expression.kind === LuaSyntaxKind.MemberExpression) {
		const base = compileParamPath(runtime, chunkName, expression.base, paramIndexByName);
		base.path.push({ kind: 'field', key: runtime.internString(expression.identifier) });
		return base;
	}
	if (expression.kind === LuaSyntaxKind.IndexExpression) {
		const base = compileParamPath(runtime, chunkName, expression.base, paramIndexByName);
		base.path.push(compilePathStep(runtime, chunkName, expression.index));
		return base;
	}
	fail(runtime, chunkName, 'expected a parameter path expression', expression.range);
};

const compilePathStep = (runtime: Runtime, chunkName: string, expression: LuaExpression): LoadSubsetPathStep => {
	if (expression.kind === LuaSyntaxKind.UnaryExpression) {
		if (expression.operator === LuaUnaryOperator.Negate) {
			const operand = expression.operand;
			if (operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
				return { kind: 'key', key: -operand.value };
			}
		}
		fail(runtime, chunkName, 'index expressions must use string or numeric literals', expression.range);
	}
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) {
		if (Number.isSafeInteger(expression.value) && expression.value >= 1) {
			return { kind: 'index', index: expression.value };
		}
		return { kind: 'key', key: expression.value };
	}
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return { kind: 'field', key: runtime.internString(expression.value) };
	}
	fail(runtime, chunkName, 'index expressions must use string or numeric literals', expression.range);
};

const compileLiteralExpr = (runtime: Runtime, chunkName: string, expression: LuaExpression): Value => {
	if (expression.kind === LuaSyntaxKind.UnaryExpression) {
		if (expression.operator === LuaUnaryOperator.Negate) {
			const operand = expression.operand;
			if (operand.kind === LuaSyntaxKind.NumericLiteralExpression) {
				return -operand.value;
			}
		}
		fail(runtime, chunkName, 'unsupported literal expression', expression.range);
	}
	if (expression.kind === LuaSyntaxKind.NilLiteralExpression) {
		return null;
	}
	if (expression.kind === LuaSyntaxKind.BooleanLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.NumericLiteralExpression) {
		return expression.value;
	}
	if (expression.kind === LuaSyntaxKind.StringLiteralExpression) {
		return runtime.internString(expression.value);
	}
	fail(runtime, chunkName, 'unsupported literal expression', expression.range);
};

const compileValueExpr = (
	runtime: Runtime,
	chunkName: string,
	expression: LuaExpression,
	paramIndexByName: ReadonlyMap<string, number>,
): LoadSubsetValueExpr => {
	if (
		expression.kind === LuaSyntaxKind.NilLiteralExpression
		|| expression.kind === LuaSyntaxKind.BooleanLiteralExpression
		|| expression.kind === LuaSyntaxKind.NumericLiteralExpression
		|| expression.kind === LuaSyntaxKind.StringLiteralExpression
		|| expression.kind === LuaSyntaxKind.UnaryExpression
	) {
		return {
			kind: 'literal',
			value: compileLiteralExpr(runtime, chunkName, expression),
		};
	}
	const paramPath = compileParamPath(runtime, chunkName, expression, paramIndexByName);
	return {
		kind: 'param',
		rootParamIndex: paramPath.rootParamIndex,
		path: paramPath.path,
	};
};

const compileAssignment = (
	runtime: Runtime,
	chunkName: string,
	statement: LuaAssignmentStatement,
	paramIndexByName: ReadonlyMap<string, number>,
): LoadSubsetOp => {
	if (statement.operator !== LuaAssignmentOperator.Assign) {
		fail(runtime, chunkName, 'only plain assignment statements are supported', statement.range);
	}
	if (statement.left.length !== 1 || statement.right.length !== 1) {
		fail(runtime, chunkName, 'only single-target assignments are supported', statement.range);
	}
	const target = compileParamPath(runtime, chunkName, statement.left[0]!, paramIndexByName);
	if (target.path.length === 0) {
		fail(runtime, chunkName, 'direct parameter assignment is unsupported', statement.left[0]!.range);
	}
	return {
		rootParamIndex: target.rootParamIndex,
		path: target.path,
		valueExpr: compileValueExpr(runtime, chunkName, statement.right[0]!, paramIndexByName),
	};
};

const compileFunctionExpression = (runtime: Runtime, chunkName: string, fn: LuaFunctionExpression): LoadSubsetCompiledFunction => {
	if (fn.hasVararg) {
		fail(runtime, chunkName, 'vararg parameters are unsupported', fn.range);
	}
	const paramIndexByName = new Map<string, number>();
	for (let index = 0; index < fn.parameters.length; index += 1) {
		const parameter = fn.parameters[index]!;
		if (paramIndexByName.has(parameter.name)) {
			fail(runtime, chunkName, `duplicate function parameter '${parameter.name}'`, parameter.range);
		}
		paramIndexByName.set(parameter.name, index);
	}
	const ops: LoadSubsetOp[] = [];
	for (let index = 0; index < fn.body.body.length; index += 1) {
		const statement = fn.body.body[index]!;
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement) {
			fail(runtime, chunkName, 'only assignment statements are supported inside loadstring functions', statement.range);
		}
		ops.push(compileAssignment(runtime, chunkName, statement as LuaAssignmentStatement, paramIndexByName));
	}
	return { ops };
};

const compileReturnedFunction = (runtime: Runtime, chunkName: string, statement: LuaReturnStatement): LoadSubsetCompiledFunction => {
	if (statement.expressions.length !== 1) {
		fail(runtime, chunkName, 'chunk must return exactly one function expression', statement.range);
	}
	const expression = statement.expressions[0]!;
	if (expression.kind !== LuaSyntaxKind.FunctionExpression) {
		fail(runtime, chunkName, 'chunk must return a function expression', expression.range);
	}
	return compileFunctionExpression(runtime, chunkName, expression as LuaFunctionExpression);
};

const compileChunk = (runtime: Runtime, chunkName: string, chunk: LuaChunk): LoadSubsetCompiledFunction => {
	if (chunk.body.length !== 1) {
		fail(runtime, chunkName, 'chunk must contain exactly one return statement', chunk.range);
	}
	const statement = chunk.body[0]!;
	if (statement.kind !== LuaSyntaxKind.ReturnStatement) {
		fail(runtime, chunkName, 'chunk must contain exactly one return statement', statement.range);
	}
	return compileReturnedFunction(runtime, chunkName, statement as LuaReturnStatement);
};

export function compileLoadChunk(runtime: Runtime, source: string, chunkName: string): NativeFunction {
	const lexer = new LuaLexer(source, chunkName);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, chunkName, splitText(source));
	const chunk = parser.parseChunk();
	const compiled = compileChunk(runtime, chunkName, chunk);
	const compiledFunction = buildNativeFunction(runtime, compiled, `${chunkName}:inner`);
	return createNativeFunction(`loadstring:${chunkName}`, (_args, out) => {
		out.push(compiledFunction);
	});
}
// end normalized-body-acceptable
