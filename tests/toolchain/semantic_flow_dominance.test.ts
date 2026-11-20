import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaCompletionAnalysis } from '../../toolchain/ts/lua/analysis/completion';
import { parseLuaChunkWithRecovery, updateLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaExpression, type LuaFunctionExpression, type LuaLocalAssignmentStatement } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

function fixture(source: string) {
	const chunk = parseLuaChunkWithRecovery(source, 'flow.lua').chunk;
	const declarations = new Map<string, LuaLocalAssignmentStatement>();
	const reads = new Map<string, LuaExpression[]>();
	const functions: LuaFunctionExpression[] = [];
	walkLuaAst(chunk, node => {
		if (node.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			for (const name of node.names) declarations.set(name.name, node);
		}
		if (node.kind === LuaSyntaxKind.FunctionExpression) functions.push(node);
		if (node.kind === LuaSyntaxKind.CallExpression && node.callee.kind === LuaSyntaxKind.IdentifierExpression && node.callee.name === 'use') {
			const value = node.arguments[0];
			if (value.kind === LuaSyntaxKind.IdentifierExpression) {
				const entries = reads.get(value.name);
				if (entries === undefined) reads.set(value.name, [value]);
				else entries.push(value);
			}
		}
	});
	return { chunk, declarations, reads, functions };
}

test('each alias edge requires its own initializer to dominate its read', () => {
	const f = fixture('local a<const> = 1\nlocal b<const> = a\nuse(a)\nuse(b)');
	const flow = LuaCompletionAnalysis.sourceFlow(f.chunk.body);
	const a = f.declarations.get('a')!, b = f.declarations.get('b')!;
	assert.equal(flow.dominates(a, b.values[0]), true);
	assert.equal(flow.dominates(a, f.reads.get('a')![0]), true);
	assert.equal(flow.dominates(b, f.reads.get('b')![0]), true);
	assert.equal(flow.dominates(b, b.values[0]), false);
});

test('forward and backward gotos preserve real paths across initialization', () => {
	const skipped = fixture('goto skip\nlocal a<const> = 1\n::skip::\nuse(a)');
	assert.equal(LuaCompletionAnalysis.sourceFlow(skipped.chunk.body).dominates(skipped.declarations.get('a')!, skipped.reads.get('a')![0]), false);
	const after = fixture('local a<const> = 1\ngoto done\n::again::\nuse(a)\n::done::\nif cond then goto again end\nuse(a)');
	const flow = LuaCompletionAnalysis.sourceFlow(after.chunk.body);
	assert.equal(flow.dominates(after.declarations.get('a')!, after.reads.get('a')![0]), true);
	assert.equal(flow.dominates(after.declarations.get('a')!, after.reads.get('a')![1]), true);
	const backwardSkip = fixture('goto next\n::use_here::\nuse(a)\ngoto finish\n::next::\ngoto use_here\nlocal a<const> = 1\n::finish::');
	assert.equal(LuaCompletionAnalysis.sourceFlow(backwardSkip.chunk.body).dominates(backwardSkip.declarations.get('a')!, backwardSkip.reads.get('a')![0]), false);
});

test('branch, loop, and unreachable paths do not create false proofs', () => {
	for (const source of [
		'if cond then local a<const> = 1 end\nuse(a)',
		'while cond do local a<const> = 1 end\nuse(a)',
		'repeat if cond then break end local a<const> = 1 until cond\nuse(a)',
		'goto inside\nlocal a<const> = 1\nwhile cond do ::inside:: if use(a) then break end end',
		'goto inside\nlocal a<const> = 1\nrepeat ::inside:: until use(a)',
		'goto end_here\nlocal a<const> = 1\nuse(a)\n::end_here::',
	]) {
		const f = fixture(source);
		assert.equal(LuaCompletionAnalysis.sourceFlow(f.chunk.body).dominates(f.declarations.get('a')!, f.reads.get('a')![0]), false, source);
	}
	const f = fixture('local a<const> = 1\nwhile cond do use(a) end\nrepeat use(a) until cond\nif cond then use(a) else use(a) end');
	const flow = LuaCompletionAnalysis.sourceFlow(f.chunk.body);
	for (const read of f.reads.get('a')!) assert.equal(flow.dominates(f.declarations.get('a')!, read), true);
});

test('initializer self-reference and reads in a nested closure remain unproven', () => {
	const f = fixture('local a<const> = a\nlocal function nested() use(a) end\nuse(a)');
	const declaration = f.declarations.get('a')!;
	const outer = LuaCompletionAnalysis.sourceFlow(f.chunk.body);
	assert.equal(outer.dominates(declaration, declaration.values[0]), false);
	assert.equal(outer.dominates(declaration, f.reads.get('a')![0]), false);
	assert.equal(outer.dominates(declaration, f.reads.get('a')![1]), true);
	const inner = LuaCompletionAnalysis.sourceFlow(f.functions[0].body.body);
	assert.equal(inner.dominates(declaration, f.reads.get('a')![0]), false);
});

test('retained syntax uses body identities rather than generation-specific absolute offsets', () => {
	const source = 'local ignored = 0\n' + 'use(ignored)\n'.repeat(100) + 'local function f()\n local a<const> = 1\n use(a)\nend\n';
	const old = fixture(source);
	const change = { offset: 16, deletedLength: 1, insertedLength: 4 };
	const next = updateLuaChunk(old.chunk, source.slice(0, 16) + '1234' + source.slice(17), SourceChangeMap.unchanged(source.length).append([change])).chunk;
	let nextFunction: LuaFunctionExpression | undefined;
	walkLuaAst(next, node => { if (node.kind === LuaSyntaxKind.FunctionExpression) nextFunction = node; });
	assert.equal(nextFunction!.body, old.functions[0].body);
	const declaration = old.declarations.get('a')!, read = old.reads.get('a')![0];
	assert.equal(LuaCompletionAnalysis.sourceFlow(nextFunction!.body.body).dominates(declaration, read), true);
	assert.equal(old.chunk.locations.offset(read.span.unit, read.span.start) + 3, next.locations.offset(read.span.unit, read.span.start));
});

test('unresolved jumps and duplicate labels do not prove initialization', () => {
	for (const source of [
		'local a<const> = 1\nuse(a)\ngoto missing',
		'local a<const> = 1\n::duplicate::\nuse(a)\n::duplicate::',
	]) {
		const f = fixture(source);
		assert.equal(LuaCompletionAnalysis.sourceFlow(f.chunk.body).dominates(f.declarations.get('a')!, f.reads.get('a')![0]), false);
	}
});
