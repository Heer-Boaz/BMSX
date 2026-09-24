import assert from 'node:assert/strict';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues, runCompiledLua } from './cpu_test_harness';

for (const level of [0, 3] as const) for (const section of ['bss', 'data', 'rodata'] as const) {
	test(`O${level}: ${section} declarations with equal labels retain their own lexical storage`, () => {
		const source = `${section} value: word${section === 'bss' ? '' : ' = 11'}
local read = function(...)
	${section} value: word${section === 'bss' ? '' : ' = 22'}
	${section === 'bss' ? '*value = 22' : ''}
	return value
end
${section === 'bss' ? '*value = 11' : ''}
local inner = read()
return *value, mem[inner], value == inner`;
		const compiled = compileLuaSource(source, 'static_identity', level);
		const symbols = section === 'bss' ? compiled.bss.symbols : section === 'data' ? compiled.data.symbols : compiled.rodataSymbols;
		assert.equal(symbols.length, 2);
		assert.equal(symbols[0].name, symbols[1].name, 'display labels are not storage identity');
		assert.deepEqual(symbols.map(symbol => symbol.offset), [0, 4]);
		const symbolIndices = new Set<number>();
		for (const relocation of compiled.constValueRelocs) {
			if (relocation.kind !== 'link_value') symbolIndices.add(relocation.symbolIndex);
		}
		assert.deepEqual([...symbolIndices].sort(), [0, 1]);
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled));
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [11, 22, false]);
	});
}

for (const level of [0, 3] as const) test(`O${level}: disjoint function-local static cells persist independently across calls`, () => {
	const source = `local first = function(...)
	bss counter: word
	*counter = *counter + 1
	return *counter
end
local second = function(...)
	bss counter: word
	*counter = *counter + 10
	return *counter
end
return first(), second(), first(), second()`;
	assert.deepEqual(runCompiledLua(source, 'static_persistence', level), [1, 10, 2, 20]);
});
