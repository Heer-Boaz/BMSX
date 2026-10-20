import assert from 'node:assert/strict';
import { test } from 'node:test';

import { valueToString } from '../../machine/ts/machine/cpu/value';
import { runCompiledTestSystem } from '../helpers/blua32';
import { compileLuaSource, materializeCpuCompletionValues } from './cpu_test_harness';

const CASES = [
	{ source: '0', text: '0' },
	{ source: '-0.0', text: '-0' },
	{ source: '1.23456789', text: '1.23457' },
	{ source: '1.234565', text: '1.23456' },
	{ source: '1.234575', text: '1.23458' },
	{ source: '123456.5', text: '123457' },
	{ source: '999999.5', text: '1e+06' },
	{ source: '1000000', text: '1e+06' },
	{ source: '0.00009999995', text: '0.0001' },
	{ source: '5e-324', text: '4.94066e-324' },
	{ source: '1.7976931348623157e308', text: '1.79769e+308' },
	{ source: '1 / 0', text: 'inf' },
	{ source: '-1 / 0', text: '-inf' },
	{ source: '0 / 0', text: 'nan' },
] as const;

for (const optLevel of [0, 3] as const) {
	test(`O${optLevel} folded numeric concatenation matches runtime Number text`, () => {
		for (const sample of CASES) {
			const source = `
rodata operand: f64 = ${sample.source}
local forward<const> = 'v=' .. (${sample.source})
local backward<const> = (${sample.source}) .. '=v'
local numbers<const> = (${sample.source}) .. 42
local chain<const> = '[' .. (${sample.source}) .. ']'
return forward, 'v=' .. *operand,
    backward, *operand .. '=v',
    numbers, *operand .. 42,
    chain, '[' .. *operand .. ']'
`;
			const cpu = runCompiledTestSystem(compileLuaSource(source, 'numeric_concat.lua', optLevel), 100000);
			const values = materializeCpuCompletionValues(cpu);
			assert.deepEqual(values.map(value => valueToString(value, cpu.stringPool)), [
				`v=${sample.text}`, `v=${sample.text}`,
				`${sample.text}=v`, `${sample.text}=v`,
				`${sample.text}42`, `${sample.text}42`,
				`[${sample.text}]`, `[${sample.text}]`,
			], sample.source);
		}
	});

	test(`O${optLevel} rodata string initializers use Number text conversion`, () => {
		const source = `
rodata labels: string[${CASES.length}] = {
${CASES.map(sample => `    '[' .. (${sample.source}) .. ']',`).join('\n')}
}
return ${CASES.map((_, index) => `labels[${index}]`).join(', ')}
`;
		const cpu = runCompiledTestSystem(compileLuaSource(source, 'numeric_concat_rodata.lua', optLevel), 100000);
		const values = materializeCpuCompletionValues(cpu);
		assert.deepEqual(values.map(value => valueToString(value, cpu.stringPool)), CASES.map(sample => `[${sample.text}]`));
	});

	test(`O${optLevel} static dimensions measure folded numeric text`, () => {
		const source = CASES.map((sample, index) => `
local label${index}<const> = '[' .. (${sample.source}) .. ']'
bss via_constant${index}: u8[#label${index}]
bss direct${index}: u8[#('[' .. (${sample.source}) .. ']')]
`).join('\n') + `
return ${CASES.flatMap((_, index) => [`#via_constant${index}`, `#direct${index}`]).join(', ')}
`;
		const cpu = runCompiledTestSystem(compileLuaSource(source, 'numeric_concat_dimensions.lua', optLevel), 100000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), CASES.flatMap(sample => [sample.text.length + 2, sample.text.length + 2]));
	});
}
