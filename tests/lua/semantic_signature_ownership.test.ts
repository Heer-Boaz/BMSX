import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferLuaFunctionSignatures } from '../../toolchain/ts/lua/semantic/function_signatures';
import { buildLuaFileSemanticData, type FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import type { FunctionValueFlowEntry } from '../../toolchain/ts/lua/semantic/value_graph';
import { LuaSyntaxKind, type LuaCallExpression } from '../../toolchain/ts/lua/syntax/ast';

function directDefinitions(file: FileSemanticData): (call: LuaCallExpression) => FunctionValueFlowEntry | undefined {
	const definitions = new Map<string, FunctionValueFlowEntry[]>();
	for (const flow of file.functionValueFlows) {
		if (flow.declaration === undefined) continue;
		const written = definitions.get(flow.declaration);
		if (written === undefined) definitions.set(flow.declaration, [flow]);
		else written.push(flow);
	}
	const sites = new Map(file.callSites.map(site => [site.expression, site]));
	return call => {
		const callee = call.callee;
		const binding = callee.kind === LuaSyntaxKind.IdentifierExpression
			? file.referencesBySyntax.get(callee)?.binding : undefined;
		const declaration = binding?.root.kind === 'declaration' ? binding.root.declId : sites.get(call)?.directTarget;
		const written = declaration === undefined ? undefined : definitions.get(declaration);
		return written?.length === 1 ? written[0] : undefined;
	};
}

function minimums(source: string): Record<string, number[]> {
	const file = buildLuaFileSemanticData(source, 'signature-owner.lua');
	const signatures = inferLuaFunctionSignatures(file, directDefinitions(file), true);
	const names = new Map(file.decls.map(decl => [decl.id, decl.name]));
	const result: Record<string, number[]> = {};
	for (const flow of file.functionValueFlows) {
		if (flow.declaration === undefined) continue;
		const name = names.get(flow.declaration)!;
		(result[name] ??= []).push(signatures.get(flow.id)!.minimumArgumentCount);
	}
	return result;
}

test('signature recipes resolve shadowed callees by bound declaration', () => {
	assert.deepEqual(minimums([
		'local function g(x) return x end',
		'do local function g(x) return x + 1 end end',
		'local function f(a, b) g(a) end',
	].join('\n')).f, [0]);
	assert.deepEqual(minimums([
		'local function g(x) return x + 1 end',
		'local function f(a, b)',
		' local function g(x) return x end',
		' g(a)',
		'end',
	].join('\n')).f, [0]);
});

test('signature recipes ignore shadowed parameter uses and guards', () => {
	assert.deepEqual(minimums('local function f(a) do local a = {}; print(a.x) end end').f, [0]);
	assert.deepEqual(minimums('local function f(a) do local a = true; if not a then return end end; return a.x end').f, [1]);
	assert.deepEqual(minimums('local function f(a) for a = 1, 3 do print(a + 1) end end').f, [0]);
	assert.deepEqual(minimums('local function f(a) local type = function(x) return "table" end; if type(a) == "table" then return a.x end end').f, [1]);
});

test('only actual callee edits change forwarding signatures', () => {
	const make = (actual: string, irrelevant: string) => [
		`local function g(x) return ${actual} end`,
		`do local function g(x) return ${irrelevant} end end`,
		'local function f(a, b) g(a) end',
	].join('\n');
	assert.deepEqual(minimums(make('x', 'x')).f, [0]);
	assert.deepEqual(minimums(make('x', 'x + 1')).f, [0]);
	assert.deepEqual(minimums(make('x + 1', 'x')).f, [1]);
});

test('acyclic forwarding propagates optionality through direct definitions', () => {
	assert.deepEqual(minimums([
		'local function leaf(a) return a end',
		'local function middle(a, b) leaf(a) end',
		'local function outer(a, b) middle(a) end',
	].join('\n')), { leaf: [0], middle: [0], outer: [0] });
});

test('recursive signature components are independent of flow enumeration order', () => {
	const file = buildLuaFileSemanticData([
		'local first, second',
		'first = function(a, b) second(a) end',
		'second = function(a, b) first(a) end',
		'local function consumer(a, b) first(a) end',
	].join('\n'), 'recursive.lua');
	const resolve = directDefinitions(file);
	const forward = inferLuaFunctionSignatures(file, resolve, true);
	const reverse = inferLuaFunctionSignatures({ ...file, functionValueFlows: [...file.functionValueFlows].reverse() }, resolve, true);
	for (const flow of file.functionValueFlows) {
		assert.deepEqual(forward.get(flow.id), reverse.get(flow.id));
		assert.equal(forward.get(flow.id)!.minimumArgumentCount, 0);
	}
});

test('unrelated calls cannot create recursive signature dependencies', () => {
	const file = buildLuaFileSemanticData([
		'local first, second',
		'first = function(a, b) second(a); return a + 1 end',
		'second = function(a, b) first(a) end',
	].join('\n'), 'irrelevant-cycle.lua');
	const signatures = inferLuaFunctionSignatures(file, directDefinitions(file), true);
	const first = file.functionValueFlows[0];
	const second = file.functionValueFlows[1];
	assert.equal(signatures.get(first.id)!.minimumArgumentCount, 1);
	assert.equal(signatures.get(second.id)!.minimumArgumentCount, 1);
});

test('unknown forwarding does not resolve or retain other optional OR operands', () => {
	const file = buildLuaFileSemanticData('local function f(a, b) unknown(a); also_unknown(a) end', 'unknown.lua');
	let calls = 0;
	const signatures = inferLuaFunctionSignatures(file, () => { calls++; return undefined; }, true);
	assert.equal(calls, 1);
	assert.equal(signatures.get(file.functionValueFlows[0].id)!.minimumArgumentCount, 0);
});

test('local optional evidence eliminates forwarding dependencies', () => {
	const file = buildLuaFileSemanticData('local function f(a, b) unknown(a); a = a or 0 end', 'local-proof.lua');
	const signatures = inferLuaFunctionSignatures(file, () => { throw new Error('unneeded signature lookup'); }, true);
	assert.equal(signatures.get(file.functionValueFlows[0].id)!.minimumArgumentCount, 0);
});

test('retained recipe facts do not cache inferred direct-call answers', () => {
	const file = buildLuaFileSemanticData('local function g(x) return x + 1 end\nlocal function f(a, b) g(a) end', 'snapshots.lua');
	const flow = file.functionValueFlows[1];
	const known = inferLuaFunctionSignatures(file, directDefinitions(file), true);
	const unknown = inferLuaFunctionSignatures(file, () => undefined, true);
	assert.equal(known.get(flow.id)!.minimumArgumentCount, 1);
	assert.equal(unknown.get(flow.id)!.minimumArgumentCount, 0);
	assert.equal(known.get(flow.id)!.minimumArgumentCount, 1);
});


test('builtin availability is an explicit recipe dependency across snapshots', () => {
	const file = buildLuaFileSemanticData('local function f(a) if type(a) == "table" then return a.x end end', 'type-guard.lua');
	const flow = file.functionValueFlows[0];
	const builtin = inferLuaFunctionSignatures(file, () => undefined, true);
	const shadowed = inferLuaFunctionSignatures(file, () => undefined, false);
	assert.equal(builtin.get(flow.id)!.minimumArgumentCount, 0);
	assert.equal(shadowed.get(flow.id)!.minimumArgumentCount, 1);
	assert.equal(inferLuaFunctionSignatures(file, () => undefined, true).get(flow.id)!.minimumArgumentCount, 0);
});

test('receiver adjustment uses the canonical function and method signature contract', () => {
	for (const methodBody of ['return a', 'return a + 1']) {
		const file = buildLuaFileSemanticData([
			'local receiver = {}',
			`function receiver:m(a) ${methodBody} end`,
			'local function colon(a, b) receiver:m(a) end',
			'local function dot(a, b) receiver.m(receiver, a) end',
		].join('\n'), 'receivers.lua');
		const method = file.functionValueFlows[0];
		const signatures = inferLuaFunctionSignatures(file, () => method, true);
		assert.equal(signatures.get(method.id)!.declarationStyle, 'method');
		assert.deepEqual(signatures.get(method.id)!.params, ['a']);
		const expected = methodBody === 'return a' ? 0 : 1;
		assert.equal(signatures.get(file.functionValueFlows[1].id)!.minimumArgumentCount, expected);
		assert.equal(signatures.get(file.functionValueFlows[2].id)!.minimumArgumentCount, expected);
	}
});

test('foreign-file and multiple written targets remain unknown', () => {
	const foreign = buildLuaFileSemanticData('local function g(x) return x + 1 end', 'foreign.lua');
	const file = buildLuaFileSemanticData('local function f(a, b) g(a) end', 'local.lua');
	assert.equal(inferLuaFunctionSignatures(file, () => foreign.functionValueFlows[0], true)
		.get(file.functionValueFlows[0].id)!.minimumArgumentCount, 0);
	assert.deepEqual(minimums([
		'local g',
		'g = function(x) return x + 1 end',
		'g = function(x) return x end',
		'local function f(a, b) g(a) end',
	].join('\n')).f, [0]);
});
