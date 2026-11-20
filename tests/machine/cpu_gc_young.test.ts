import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { createTestSystemCpu } from '../helpers/blua32';
import { compileCoroutineTest } from '../helpers/coroutine';
import { exerciseYoungGc, gcYoungBody } from '../helpers/gc_young';

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`young collection preserves remembered edges, weak semantics and replay (${backend})`, () => {
		const { cpu } = createTestSystemCpu(compileCoroutineTest(gcYoungBody, 3), backend);
		cpu.installBootPrimitives();
		exerciseYoungGc(cpu, backend === CpuExecutionBackend.JavaScript);
	});
}
