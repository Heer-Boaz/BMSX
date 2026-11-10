import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { decodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cpuWorkloads } from './cpu_workloads';

// Run through npm run test:exec. All child VMs share that kernel memory budget.
// Fresh processes prevent verification/serialization garbage from becoming part
// of a later timed run. Process startup is outside the measured CPU interval.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
	native: { type: 'string' }, interpreter: { type: 'string' }, output: { type: 'string' },
	filter: { type: 'string', default: '.*' }, 'opt-level': { type: 'string', default: '3' },
	grants: { type: 'string', default: '256,4096' },
} });
assert.ok(positionals.length <= 2, 'Expected [iterations] [rounds]');
assert.equal(values.native === undefined, values.interpreter === undefined, 'Supply both actual C++ executables, or neither');
assert.ok(values['opt-level'] === '0' || values['opt-level'] === '3', 'Expected --opt-level 0 or 3');
const iterations = Number(positionals[0] ?? 100000), rounds = Number(positionals[1] ?? 3);
assert.ok(iterations >= 32 && rounds > 0 && iterations === Math.trunc(iterations) && rounds === Math.trunc(rounds));
const grants = values.grants.split(',').map(Number);
assert.ok(grants.length > 0 && grants.every(grant => grant > 0 && grant <= 0x7fffffff && grant === Math.trunc(grant)));
const optLevel = values['opt-level'] === '0' ? 0 : 3;
const filter = new RegExp(values.filter);
const directory = values.output === undefined ? mkdtempSync(join(tmpdir(), 'bmsx-cpu-execution-')) : resolve(values.output);
mkdirSync(directory, { recursive: true });
const runner = fileURLToPath(new URL('./cpu_execution_runner.ts', import.meta.url));
const backends = ['ts-interpreter', 'javascript', ...(values.native === undefined ? [] : ['cpp-interpreter', 'cpp-native'])];
let workloadCount = 0;
try {
	for (const workload of cpuWorkloads(iterations, optLevel)) {
		if (!filter.test(workload.name)) continue;
		++workloadCount;
		const romPath = join(directory, `${workload.name}.rom`), statePath = join(directory, 'current.state');
		writeFileSync(romPath, workload.romBytes);
		const romSha256 = createHash('sha256').update(workload.romBytes).digest('hex');
		for (const grant of grants) {
			let expectedState: ReturnType<typeof decodeRuntimeSaveState> | null = null;
			let expectedExecution: object | null = null;
			for (let round = 0; round < rounds; ++round) {
				const order = round % 2 === 0 ? backends : [...backends].reverse();
				for (const backend of order) {
					const args = [romPath, statePath, String(grant), String(workload.wordCount)];
					const command = backend.startsWith('cpp-')
						? resolve(backend === 'cpp-native' ? values.native : values.interpreter) : process.execPath;
					if (!backend.startsWith('cpp-')) args.unshift(...process.execArgv, runner, backend);
					const child = spawnSync(command, args, { encoding: 'utf8', timeout: 600000 });
					assert.ifError(child.error);
					assert.equal(child.status, 0, `${workload.name}/${backend}: ${child.stderr}`);
					const result = JSON.parse(child.stdout);
					assert.equal(result.backend, backend, 'The C++ reference must be a real native-OFF binary');
					const bytes = readFileSync(statePath);
					const state = decodeRuntimeSaveState(bytes, PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
					const execution = { activeCycles: result.activeCycles, remainingCycles: result.remainingCycles,
						currentPc: result.currentPc, lastPc: result.lastPc };
					if (expectedState === null) { expectedState = state; expectedExecution = execution; }
					else {
						assert.deepEqual(execution, expectedExecution, `${workload.name}/${backend}: cycle grants and exact PC`);
						assert.ok(isDeepStrictEqual(state, expectedState), `${workload.name}/${backend}: entire runtime state, including RAM, must match`);
					}
					const record = { workload: workload.name, iterations: workload.iterations, wordCount: workload.wordCount,
						optLevel, round, grant, cache: 'cold-bmsx', modelHz: PSX_MACHINE_SPEC.cpuFreqHz,
						romSha256, stateSha256: createHash('sha256').update(bytes).digest('hex'), ...result };
					console.log(JSON.stringify(record));
					// Keep ROMs/results, not hundreds of complete RAM/device snapshots.
					rmSync(statePath);
				}
			}
		}
	}
	assert.ok(workloadCount > 0, 'No workloads matched --filter');
} finally {
	if (values.output === undefined) rmSync(directory, { recursive: true, force: true });
}
