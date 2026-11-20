import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueInteger, valuePayload, valueTag } from '../../machine/ts/machine/cpu/value';
import { compileLuaSource, materializeCpuCompletionValues, parseLuaChunk, runGuestToHalt } from '../helpers/cpu_test_harness';
import { createTestSystemCpu, disassembleTestBlua32Functions, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';

test('scoped locals reuse the frame window, and O3 returns an existing argument directly', () => {
	const source = `local function probe(t)\n${'do local x = 1 end\n'.repeat(256)}return t\nend\nreturn probe`;
	for (const opt of [0, 3] as const) {
		const linked = linkTestSystemBlua32(compileLuaSource(source, 'frame.lua', opt));
		const index = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(':probe'));
		const listing = disassembleTestBlua32Functions(linked, [linked.symbols.functionAddresses[index]]);
		if (opt === 3) assert.match(listing, /len=4 params=1 vararg=0 stack=1 upvalues=0/);
		else assert.match(listing, /params=1 vararg=0 stack=2 upvalues=0/);
		assert.match(listing, /RET r0, 1/);
	}
});

test('O3 replaces private tables without dropping effects, escapes, or old register values', () => {
	const boot = 'protect = __bmsx_pcall';
	const source = `
require('boot')
local function dense(churn)
	local t = {1, 2, 3}
	local length = #t
	churn()
	return length
end
local function forward(make)
	local t = { field = make() }
	local alias = t
	alias.other = 4
	return alias.field, t.other
end
local function point_sum(x, y)
	local p = {x = x, y = y}
	return p.x + p.y
end
local function use(t)
	t[3] = 8
end
local function escaped()
	local t = {1, 2}
	use(t)
	return #t
end
local function reused_parameter(p)
	local t = { p }
	p = p + 1
	return t[1], p
end
local function reads_from_capture()
	local data
	local function read() return data.value end
	data = {value = 13}
	return read()
end
local function fault(x)
	local t = {x + 1}
	return 73
end
local calls = 0
local function make() calls = calls + 1; return 7 end
local length = dense(make)
local forwarded, other = forward(make)
local before, after = reused_parameter(8)
local ok = protect(fault, false)
return length, forwarded, other, escaped(), before, after, reads_from_capture(), calls, ok, point_sum(4, 20)
`;
	for (const opt of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileLuaChunkToProgram(
			parseLuaChunk(source, 'scalar-tables.lua'),
			[{ path: 'boot', source: boot, chunk: parseLuaChunk(boot, 'boot.lua') }],
			{ entrySource: source, optLevel: opt, programDomain: 'system' },
		));
		if (opt === 3) {
			for (const name of ['dense', 'forward']) {
				const index = image.symbols.metadata.functionIds.findIndex(id => id.endsWith(`:${name}`));
				const disassembly = disassembleTestBlua32Functions(image, [image.symbols.functionAddresses[index]]);
				assert.doesNotMatch(disassembly, /\b(?:NEWT|SETFIELD|SETI|GETFIELD|GETI|LEN)\b/);
				assert.match(disassembly, /\bCALL\b/);
			}
			const pointIndex = image.symbols.metadata.functionIds.findIndex(id => id.endsWith(':point_sum'));
			const point = disassembleTestBlua32Functions(image, [image.symbols.functionAddresses[pointIndex]]);
			assert.match(point, /len=8 params=2/);
			assert.match(point, /ADD r\d+, r0, r1/);
			const index = image.symbols.metadata.functionIds.findIndex(id => id.endsWith(':escaped'));
			assert.match(disassembleTestBlua32Functions(image, [image.symbols.functionAddresses[index]]), /\bNEWT\b/);
		}
		const expected = [...[3, 7, 4, 3, 8, 9, 13, 2].map(valueInteger), valueBool(false), valueInteger(24)];
		const budget = 20_000;
		let remaining = 0;
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const { cpu } = createTestSystemCpu(image, backend);
			cpu.installBootPrimitives();
			runGuestToHalt(cpu, budget);
			assert.deepEqual(materializeCpuCompletionValues(cpu), expected, `O${opt}, backend ${backend}`);
			if (backend === CpuExecutionBackend.Interpreter) remaining = cpu.instructionBudgetRemaining;
			else assert.equal(cpu.instructionBudgetRemaining, remaining);
		}
		const nativeRunner = process.env.BMSX_CPU32_RUNNER;
		if (nativeRunner) {
			const output = execFileSync(nativeRunner, ['--execute-rom', '--boot-primitives', String(budget)],
				{ input: image.romBytes, encoding: 'utf8' });
			assert.equal(output, [`budget ${remaining} fault 0`,
				...expected.map(value => `${valueTag(value).toString(16)} ${valuePayload(value).toString(16)}`), ''].join('\n'));
		}
	}
});

test('each iteration and re-entered block owns a distinct captured cell', () => {
	const source = `
local function case()
	local out = {}
	local n = 1
	local outer = 10
	local function read_outer() return outer end
	do
		local v = 20
		local function read() return v end
		out[1] = read
		v = 21
	end
	do local v = 99; n = n + v end
	while n < 102 do
		local v = n
		out[n - 98] = function() return v end
		n = n + 1
	end
	repeat
		local v = n
		out[n - 98] = function() return v end
		n = n + 1
	until v == 103
	for i = 1, 2 do
		out[i + 5] = function() return i end
		i = i + 10
	end
	local function iterator(_, i)
		if i < 2 then return i + 1 end
	end
	for i in iterator, nil, 0 do
		out[i + 7] = function() return i end
	end
	while true do
		local v = 30
		do
			local w = 40
			out[10] = function() return v + w end
			break
		end
	end
	n = 0
	::again::
	n = n + 1
	local v = n
	out[10 + n] = function() return v end
	if n < 2 then goto again end
	do
		local w = 50
		out[13] = function() return w end
		goto done
	end
	::done::
	outer = 11
	return out[1](), out[2](), out[3](), out[4](), out[5](), out[6](), out[7](),
		out[8](), out[9](), out[10](), out[11](), out[12](), out[13](), read_outer()
end
local function direct()
	local read, update
	do
		local x = 7
		read = function() return x end
		update = function(v) x = v end
	end
	do
		local x = 9
		local old = read()
		update(8)
		return old, x, read()
	end
end
local a,b,c,d,e,f,g,h,i,j,k,l,m,n
for runs = 1, 40 do
	a,b,c,d,e,f,g,h,i,j,k,l,m,n = case()
end
return a,b,c,d,e,f,g,h,i,j,k,l,m,n,direct()
`;
	const expected = [21, 100, 101, 102, 103, 11, 12, 1, 2, 70, 1, 2, 50, 11, 7, 9, 8].map(valueInteger);
	const budget = 100_000;
	const nativeRunner = process.env.BMSX_CPU32_RUNNER;
	for (const opt of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileLuaSource(source, 'lifetime.lua', opt));
		let scalarBudget = 0;
		for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
			const { cpu } = createTestSystemCpu(image, backend);
			runGuestToHalt(cpu, budget);
			assert.deepEqual(materializeCpuCompletionValues(cpu), expected, `O${opt}, backend ${backend}`);
			if (backend === CpuExecutionBackend.Interpreter) scalarBudget = cpu.instructionBudgetRemaining;
			else assert.equal(cpu.instructionBudgetRemaining, scalarBudget);
		}
		if (nativeRunner) {
			const output = execFileSync(nativeRunner, ['--execute-rom'], { input: image.romBytes, encoding: 'utf8' });
			assert.equal(output, [`budget ${scalarBudget} fault 0`,
				...expected.map(value => `${valueTag(value).toString(16)} ${valuePayload(value).toString(16)}`), ''].join('\n'));
		}
	}
});

test('debug locations for two locals sharing a slot do not overlap', () => {
	const source = `local function scoped(sink)
	do
		local first = 1
		sink(first)
	end
	do
		local second = 2
		sink(second)
	end
end
return scoped`;
	const { metadata } = compileLuaSource(source, 'debug-slots.lua', 0);
	const index = metadata.protoIds.findIndex(id => id.endsWith(':scoped'));
	const slots = metadata.localSlotsByProto[index];
	const first = slots.find(slot => slot.name === 'first')!;
	const second = slots.find(slot => slot.name === 'second')!;
	assert.equal(first.registerIndex, second.registerIndex);
	assert.ok(first.liveWordRanges.length > 0);
	assert.ok(second.liveWordRanges.length > 0);
	assert.ok(first.liveWordRanges.at(-1)!.end <= second.liveWordRanges[0].start);
});
