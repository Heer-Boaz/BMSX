import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { valueInteger, valueString } from '../../machine/ts/machine/cpu/value';
import { runCompiledTestSystem } from '../helpers/blua32';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';

const CASES = [
	{ source: '0', storage: 'word', text: '0' },
	{ source: '0.0', storage: 'f32', text: '0.0' },
	{ source: '-0.0', storage: 'f32', text: '-0.0' },
	{ source: '1.23456789', storage: 'f32', text: '1.234568' },
	{ source: '1234566.5', storage: 'f32', text: '1234566.0' },
	{ source: '1234567.5', storage: 'f32', text: '1234568.0' },
	{ source: '9999999.5', storage: 'f32', text: '1e+07' },
	{ source: '1000000', storage: 'word', text: '1000000' },
	{ source: '1000000.0', storage: 'f32', text: '1000000.0' },
	{ source: '0x80000000', storage: 'word', text: '-2147483648' },
	{ source: '-2147483648', storage: 'f32', text: '-2.147484e+09' },
	{ source: '0.0001', storage: 'f32', text: '0.0001' },
	{ source: '0.00001', storage: 'f32', text: '1e-05' },
	{ source: '1e-45', storage: 'f32', text: '1.401298e-45' },
	{ source: '3.4028234663852886e38', storage: 'f32', text: '3.402823e+38' },
	{ source: '1 / 0', storage: 'f32', text: 'inf' },
	{ source: '-1 / 0', storage: 'f32', text: '-inf' },
	{ source: '0 / 0', storage: 'f32', text: 'nan' },
] as const;

for (const optLevel of [3] as const) {
	test(`O${optLevel} folded numeric concatenation matches runtime Number text`, () => {
		for (const sample of CASES) {
			const source = `
rodata operand: ${sample.storage} = ${sample.source}
local forward<const> = 'v=' .. (${sample.source})
local backward<const> = (${sample.source}) .. '=v'
local numbers<const> = (${sample.source}) .. 42
local chain<const> = '[' .. (${sample.source}) .. ']'
return forward, 'v=' .. *operand,
    backward, *operand .. '=v',
    numbers, *operand .. 42,
    chain, '[' .. *operand .. ']'
`;
			const cpu = runCompiledTestSystem(compileHeapServiceSystem(source, optLevel, [], 'numeric_concat.lua'), 100000);
			const values = materializeCpuCompletionValues(cpu);
			assert.deepEqual(values, [
				`v=${sample.text}`, `v=${sample.text}`,
				`${sample.text}=v`, `${sample.text}=v`,
				`${sample.text}42`, `${sample.text}42`,
				`[${sample.text}]`, `[${sample.text}]`,
			].map(text => valueString(cpu.stringPool.intern(text))), sample.source);
		}
	});

	test(`O${optLevel} rodata string initializers use Number text conversion`, () => {
		const source = `
rodata labels: string[${CASES.length}] = {
${CASES.map(sample => `    '[' .. (${sample.source}) .. ']',`).join('\n')}
}
return ${CASES.map((_, index) => `labels[${index}]`).join(', ')}
`;
		const cpu = runCompiledTestSystem(compileHeapServiceSystem(source, optLevel, [], 'numeric_concat_rodata.lua'), 100000);
		const values = materializeCpuCompletionValues(cpu);
		assert.deepEqual(values, CASES.map(sample => valueString(cpu.stringPool.intern(`[${sample.text}]`))));
	});

	test(`O${optLevel} static dimensions measure folded numeric text`, () => {
		const source = CASES.map((sample, index) => `
local label${index}<const> = '[' .. (${sample.source}) .. ']'
bss via_constant${index}: u8[#label${index}]
bss direct${index}: u8[#('[' .. (${sample.source}) .. ']')]
`).join('\n') + `
return ${CASES.flatMap((_, index) => [`#via_constant${index}`, `#direct${index}`]).join(', ')}
`;
		const cpu = runCompiledTestSystem(compileHeapServiceSystem(source, optLevel, [], 'numeric_concat_dimensions.lua'), 100000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), CASES.flatMap(sample => [valueInteger(sample.text.length + 2), valueInteger(sample.text.length + 2)]));
	});
}
