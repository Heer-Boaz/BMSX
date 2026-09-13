import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asStringId, type StringValue } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { TraceStatementSelection } from '../../toolchain/ts/lua/compiler/trace_statement';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

function compileTraceSource(source: string, traceStatements: TraceStatementSelection, optLevel: 0 | 3 = 3) {
	return compileLuaChunkToProgram(parseLuaChunk(source, 'trace_statement.lua'), [], {
		entrySource: source,
		optLevel,
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

for (const optLevel of [0, 3] as const) test(`unselected traces do not turn an otherwise static function into a captured closure (O${optLevel})`, () => {
	const baseline = `
local subject<const> = {}
return function() return 7 end
`;
	const traced = `
local subject<const> = {}
return function()
	blua32.trace(subject, 'sample', 7)
	return 7
end
`;
	const baselineProgram = compileTraceSource(baseline, 'erase', optLevel).program;
	for (const selection of ['erase', [], ['sample.child']] as const) {
		const tracedProgram = compileTraceSource(traced, selection, optLevel).program;
		assert.deepEqual(tracedProgram.code, baselineProgram.code);
		assert.deepEqual(tracedProgram.constPool, baselineProgram.constPool);
		assert.deepEqual(tracedProgram.protos, baselineProgram.protos);
	}
});

for (const optLevel of [0, 3] as const) test(`channel selection erases the entire excluded statement, not just its call (O${optLevel})`, () => {
	const setup = `
local subject<const> = {}
local sink<const> = { count = 0 }
function sink:record(value) self.count = self.count + value end
local evaluations = 0
local evaluated<const> = function(value) evaluations = evaluations + 1; return value end
blua32.trace_sink(subject, 'compile', sink)
blua32.trace(subject, 'compile', 3)
`;
	const excluded = `
blua32.trace_sink(evaluated(subject), 'compile.node', evaluated(sink))
blua32.trace(evaluated(subject), 'compile.node', evaluated(100))
blua32.trace_sink(evaluated(subject), 'tick', evaluated(sink))
blua32.trace(evaluated(subject), 'tick', evaluated(100))
`;
	const end = `
blua32.trace_sink(subject, 'compile', nil)
blua32.trace(subject, 'compile', evaluated(100))
return sink.count, evaluations
`;
	const selected = compileTraceSource(setup + excluded + end, ['compile'], optLevel);
	const baseline = compileTraceSource(setup + end, 'emit', optLevel).program;
	assert.deepEqual(selected.program.code, baseline.code);
	assert.deepEqual(selected.program.constPool, baseline.constPool);
	assert.deepEqual(selected.program.protos, baseline.protos);
	const cpu = runCompiledTestSystem(selected, 100_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [3, 0]);
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
	for (const selection of ['emit', []] as const) {
		assert.throws(
			() => compileTraceSource(source, selection),
			/trace channel must be a string literal/,
		);
	}
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
