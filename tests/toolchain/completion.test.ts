import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaCompletion, LuaCompletionAnalysis } from '../../toolchain/ts/lua/analysis/completion';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { computeLuaProjectDiagnostics } from '../../toolchain/ts/lua/semantic/diagnostics';
import { compileLuaSource } from '../helpers/cpu_test_harness';

test('source completion follows branches and lexical loop exits without entering nested functions', () => {
	const analysis = new LuaCompletionAnalysis();
	const cases: readonly [string, LuaCompletion][] = [
		['', LuaCompletion.Fallthrough],
		['return 1', LuaCompletion.None],
		['local function nested() return 1 end', LuaCompletion.Fallthrough],
		['local callback = function() return 1 end', LuaCompletion.Fallthrough],
		['do return 1 end', LuaCompletion.None],
		['if enabled then return 1 end', LuaCompletion.Fallthrough],
		['if enabled then return 1 else return 2 end', LuaCompletion.None],
		['if enabled then return 1 elseif other then return 2 end', LuaCompletion.Fallthrough],
		['if enabled then return 1 elseif other then return 2 else return 3 end', LuaCompletion.None],
		['while true do end', LuaCompletion.None],
		['while false do return 1 end', LuaCompletion.Fallthrough],
		['while true do if enabled then break end end', LuaCompletion.Fallthrough],
		['while true do if false then break end end', LuaCompletion.None],
		['while true do while true do break end end', LuaCompletion.None],
		['while true do do break end end', LuaCompletion.Fallthrough],
		['repeat return 1 until true', LuaCompletion.None],
		['repeat if enabled then return 1 end until false', LuaCompletion.None],
		['repeat break until false', LuaCompletion.Fallthrough],
		['for index = first, last do return 1 end', LuaCompletion.Fallthrough],
		['for key, value in iterator() do return 1 end', LuaCompletion.Fallthrough],
		['halt_until_irq', LuaCompletion.Fallthrough],
		['halt_until_irq; return 1', LuaCompletion.None],
		['local error = callback; error()', LuaCompletion.Fallthrough],
	];
	for (const [source, expected] of cases) {
		const parsed = parseLuaChunk(source, 'completion.lua');
		assert.equal(parsed.syntaxError, null, source);
		assert.equal(analysis.analyze(parsed.chunk!.body), expected, source);
	}
});

test('completion uses Lua literal truthiness, including zero, empty strings and logical conditions', () => {
	const analysis = new LuaCompletionAnalysis();
	for (const condition of ['true', '0', "''", '{}', 'function() end', 'not nil', 'unknown or true', 'true and 0']) {
		const parsed = parseLuaChunk(`while ${condition} do end`, 'truthy.lua');
		assert.equal(parsed.syntaxError, null, condition);
		assert.equal(analysis.analyze(parsed.chunk!.body), LuaCompletion.None, condition);
	}
	for (const condition of ['false', 'nil', 'not 0', 'unknown and false', 'nil or false']) {
		const parsed = parseLuaChunk(`while ${condition} do end`, 'falsy.lua');
		assert.equal(parsed.syntaxError, null, condition);
		assert.equal(analysis.analyze(parsed.chunk!.body), LuaCompletion.Fallthrough, condition);
	}
});

test('completion resolves forward, backward and cross-block jumps without entering a block or a local scope', () => {
	const analysis = new LuaCompletionAnalysis();
	const cases: readonly [string, LuaCompletion][] = [
		['goto done; do return 1 end; ::done::', LuaCompletion.Fallthrough],
		['goto done; ::done:: return 1', LuaCompletion.None],
		['::again:: goto again', LuaCompletion.None],
		['::again:: if enabled then goto done end; goto again; ::done::', LuaCompletion.Fallthrough],
		['goto done; if false then ::done:: end', LuaCompletion.Unresolved],
		['goto done; if false then ::done:: return 1 end', LuaCompletion.Unresolved],
		['do goto done; local skip = 1; ::done:: end', LuaCompletion.Fallthrough],
		['do goto done; local skip = 1; ::done:: return skip end', LuaCompletion.Unresolved],
		['repeat goto done; local skip = 1; ::done:: until skip', LuaCompletion.Unresolved],
		['do goto done; ::done:: end; do ::done:: return 1 end', LuaCompletion.None],
		['while true do goto done end; ::done::', LuaCompletion.Fallthrough],
		['while true do if enabled then goto done end end; ::done:: return 1', LuaCompletion.None],
		['goto done; local function nested() ::done:: end', LuaCompletion.Unresolved],
		['goto absent', LuaCompletion.Unresolved],
		['break', LuaCompletion.Unresolved],
		['::duplicate:: ::duplicate:: return 1', LuaCompletion.Unresolved],
	];
	for (const [source, expected] of cases) {
		const parsed = parseLuaChunk(source, 'jumps.lua');
		assert.equal(parsed.syntaxError, null, source);
		assert.equal(analysis.analyze(parsed.chunk!.body), expected, source);
	}
	// Reusing the scratch owner cannot retain a prior body's label or visited set.
	const empty = parseLuaChunk('', 'next.lua');
	assert.equal(analysis.analyze(empty.chunk!.body), LuaCompletion.Fallthrough);
});

test('parser-recovery statements leave completion explicitly unresolved', () => {
	const parsed = parseLuaChunkWithRecovery('self.', 'incomplete.lua');
	assert.notEqual(parsed.syntaxError, null);
	assert.ok(new LuaCompletionAnalysis().analyze(parsed.chunk!.body) & LuaCompletion.Unresolved);
});

test('compiler and semantic diagnostics agree on illegal lexical jumps and their source lines', () => {
	for (const [source, row, message] of [
		['local function f()\n goto inside\n do ::inside:: end\nend\nreturn f', 1, "No visible label 'inside' for goto."],
		['goto done\nlocal x = 1\n::done::\nreturn x', 0, "Goto 'done' jumps into the scope of local 'x'."],
		['::here::\ndo\n ::here::\nend', 2, "Duplicate label 'here'."],
		['repeat\n goto done\n local x = true\n ::done::\nuntil x', 1, "Goto 'done' jumps into the scope of local 'x'."],
	] as const) {
		const file = 'jumps.lua';
		const diagnostics = computeLuaProjectDiagnostics([{ path: file, source }], new Map()).get(file)!;
		assert.deepEqual(diagnostics.map(item => [item.row, item.severity, item.message]), [[row, 'error', message]]);
		assert.throws(() => compileLuaSource(source, file), (error: Error) => error.message.includes(message));
	}
});
