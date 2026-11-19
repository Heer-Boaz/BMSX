import { test } from 'node:test';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { completionBoundaryVectors, exerciseCompletionBoundary } from '../helpers/completion_boundary';

for (const level of [0, 3] as const) for (const [name, body] of Object.entries(completionBoundaryVectors)) {
	test(`${name} O${level} respects the physical completion return boundary`, () => {
		const { cpu } = createTestSystemCpu(compileCoroutineTest(body, level));
		cpu.installBootPrimitives();
		exerciseCompletionBoundary(cpu, name);
	});
}
