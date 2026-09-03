import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asStringId, type StringValue } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { TraceStatementMode } from '../../toolchain/ts/lua/compiler/trace_statement';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

function compileTraceSource(source: string, traceStatements: TraceStatementMode) {
	return compileLuaChunkToProgram(parseLuaChunk(source, 'trace_statement.lua'), [], {
		entrySource: source,
		optLevel: 3,
		programDomain: 'system',
		traceStatements,
	});
}

test('erased trace statements emit no guest instructions or constants', () => {
	const baseline = `
local subject<const> = {}
local value = 7
return value
`;
	const traced = `
local subject<const> = {}
local value = 7
blua32.trace_sink(subject, 'sample', subject)
blua32.trace(subject, 'sample', 'accepted', value)
return value
`;
	const baselineProgram = compileTraceSource(baseline, 'erase').program;
	const tracedProgram = compileTraceSource(traced, 'erase').program;

	assert.deepEqual(tracedProgram.code, baselineProgram.code);
	assert.deepEqual(tracedProgram.constPool, baselineProgram.constPool);
	assert.deepEqual(tracedProgram.protos, baselineProgram.protos);
});

test('emitted trace statements bind one subject channel and preserve static string values', () => {
	const source = `
local subject<const> = {}
local sink<const> = { count = 0, outcome = '' }
function sink:record(outcome, amount)
	self.count = self.count + amount
	self.outcome = outcome
end

blua32.trace_sink(subject, 'sample', sink)
blua32.trace(subject, 'sample', 'accepted', 3)
blua32.trace_sink(subject, 'sample', nil)
blua32.trace(subject, 'sample', 'ignored', 100)
return sink.count, sink.outcome
`;
	const cpu = runCompiledTestSystem(compileTraceSource(source, 'emit'), 100_000);
	const result = materializeCpuCompletionValues(cpu);
	assert.equal(result[0], 3);
	assert.equal(cpu.stringPool.toString(asStringId(result[1] as StringValue)), 'accepted');
});

test('erased trace statements do not evaluate subject, sink or payload expressions', () => {
	const source = `
local evaluations = 0
local evaluate<const> = function(value)
	evaluations = evaluations + 1
	return value
end
blua32.trace_sink(evaluate({}), 'sample', evaluate({}))
blua32.trace(evaluate({}), 'sample', evaluate('value'))
return evaluations
`;
	const cpu = runCompiledTestSystem(compileTraceSource(source, 'erase'), 100_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
});

test('emitted trace statements evaluate payloads only for a selected sink', () => {
	const source = `
local subject<const> = {}
local evaluations = 0
local evaluate<const> = function()
	evaluations = evaluations + 1
	return evaluations
end
blua32.trace(subject, 'sample', evaluate())
return evaluations
`;
	const cpu = runCompiledTestSystem(compileTraceSource(source, 'emit'), 100_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [0]);
});

test('trace channels are compiler-owned static names', () => {
	const source = `
local subject<const> = {}
local channel<const> = 'sample'
blua32.trace(subject, channel, 1)
return true
`;
	assert.throws(
		() => compileTraceSource(source, 'emit'),
		/trace channel must be a string literal/,
	);
});

test('trace intrinsics cannot become runtime Lua values', () => {
	const source = `
local subject<const> = {}
local result = blua32.trace(subject, 'sample', 1)
return result
`;
	assert.throws(
		() => compileTraceSource(source, 'emit'),
		/blua32\.trace is a statement-only compiler intrinsic/,
	);
});
