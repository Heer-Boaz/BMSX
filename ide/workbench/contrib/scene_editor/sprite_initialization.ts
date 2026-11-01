import { LuaMemberOperator, LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { readLuaExpressionSource } from '../../../../toolchain/ts/lua/semantic/value_graph';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import type { LuaSourceReader } from '../../../language/lua/source_reader';

/** Proves the primary Sprite construction prefix, not the initializer's final
 * gameplay state. Later own-field writes never grant unchanged owner inputs to
 * the prefab's subsequent component factories. */
export function isSceneSpriteInitializer(reader: LuaSourceReader, initializer: LuaWrittenExpression | null | undefined,
	canonical: LuaWrittenExpression | undefined): boolean {
	if (canonical?.expression.kind !== LuaSyntaxKind.FunctionExpression
		|| initializer?.expression.kind !== LuaSyntaxKind.FunctionExpression) return false;
	if (initializer === canonical) return true;
	const { expression, file } = initializer, body = expression.body.body;
	if (expression.hasVararg || expression.parameters.length !== 1 || body.length === 0) return false;
	const first = body.get(0);
	if (first.kind !== LuaSyntaxKind.CallStatement) return false;
	const flow = file.functionValueFlows.find(candidate => candidate.expression === expression)!;
	if (flow.implicitReceiver || flow.calls.length !== 1) return false;
	const call = flow.calls[0];
	if (call.expression !== first.expression || call.expression.method !== null || call.arguments.length !== 1
		|| reader.callable(file, call.expression.callee) !== canonical) return false;
	const owner = file.declarationIdsBySyntax.get(expression.parameters[0])!, argument = call.arguments[0];
	if (argument.root.kind !== 'declaration' || argument.root.declId !== owner || argument.steps.length !== 0) return false;
	for (let index = 1; index < body.length; index++) {
		const statement = body.get(index);
		if (statement.kind !== LuaSyntaxKind.AssignmentStatement) return false;
		for (const left of statement.left) {
			if (left.kind !== LuaSyntaxKind.MemberExpression || left.operator !== LuaMemberOperator.Dot
				|| left.base.kind !== LuaSyntaxKind.IdentifierExpression) return false;
			const destination = readLuaExpressionSource(file, left.base);
			if (destination.root.kind !== 'declaration' || destination.root.declId !== owner || destination.steps.length !== 0) return false;
		}
	}
	return true;
}
