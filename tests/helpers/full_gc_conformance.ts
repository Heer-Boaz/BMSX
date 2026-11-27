import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../machine/ts/common/hash';
import { FrameField } from '../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_FRAME_OFFSET } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

interface StoreCheckpoint {
	name: string;
	row: number;
	resume: number;
	file: string;
	state: ReturnType<typeof captureRuntimeCheckpointState>;
	pages: ReturnType<RamHistory['capture']>;
}

/** Drive the same submitted grants against the two actual cores. The observer
 * sees raw stores while the private root stays active, not fake phase re-entry. */
export class FullGcConformance {
	private readonly trace: string[] = [];
	private readonly expected: string[] = [];
	private readonly points: StoreCheckpoint[] = [];
	private readonly history = new RamHistory();
	private pages: ReturnType<RamHistory['capture']>;
	private readonly seed: string;
	private caller = -1;
	private callerPc = 0;

	constructor(private readonly runtime: Runtime, private readonly native: string,
		private readonly directory: string, private readonly rom: string, private readonly functionAddress: number, private readonly cartridge?: string) {
		const memory = runtime.machine.memory;
		this.history.start(memory);
		this.pages = this.history.capture(memory, null);
		this.seed = join(directory, 'seed.state');
		writeFileSync(this.seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	}

	observe(command: string, result: number | string): void {
		this.trace.push(command);
		this.expected.push(String(result));
	}

	grant(cycles: number): RunResult {
		const { cpu, scheduler } = this.runtime.machine, { gc } = cpu;
		const active = cpu.heapServiceActive();
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		const used = cycles - cpu.instructionBudgetRemaining;
		assert.ok(used > 0);
		if (this.caller !== -1 && active) {
			assert.equal(result, RunResult.Yielded);
			this.held();
		}
		this.trace.push(`L ${cycles}`);
		this.expected.push(`${result} ${used} ${+cpu.heapServiceActive()} ${gc.fullEpochs()} ${gc.phase()} ${cpu.luaHeap.usedBytes()}`);
		return result;
	}

	launch(): void {
		const { cpu, memory } = this.runtime.machine;
		const root = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function;
		const fn = this.functionAddress;
		for (let n = 0; n < 256 && !(cpu.heapServiceActive() && memory.readRamRecordWord(root) === fn); ++n)
			this.grant(16_384);
		assert.equal(cpu.heapServiceActive(), true, 'ordinary CALL enters the composed root');
		assert.equal(memory.readRamRecordWord(root), fn);
		assert.equal(cpu.gc.fullEpochs(), 0, 'the firmware owns the epoch latch before reclamation');
		this.caller = cpu.getFrameDepth() - 1;
		this.callerPc = cpu.readFramePc(this.caller);
		this.reach(() => cpu.gc.fullEpochs() !== 0, 'epoch count publication');
	}

	private held(): void {
		const { cpu } = this.runtime.machine;
		assert.equal(cpu.readFramePc(this.caller), this.callerPc, 'the collector cannot resume its paused guest');
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
	}

	reach(predicate: () => boolean, store: string, cycles = 1, limit = 32768): void {
		const cpu = this.runtime.machine.cpu;
		for (let n = 0; n < limit && cpu.heapServiceActive() && !predicate(); ++n) this.grant(cycles);
		assert.ok(predicate(), `expected firmware store not reached: ${store}`);
		assert.equal(cpu.heapServiceActive(), true, 'the store must precede the outer RET');
		this.held();
	}

	checkpoint(name: string, ranges: readonly (readonly [number, number])[]): void {
		const { cpu, memory } = this.runtime.machine;
		const file = join(this.directory, `${name}.state`);
		const row = this.trace.length;
		writeFileSync(file, encodeRuntimeSaveState(captureRuntimeSaveState(this.runtime)));
		for (const [start, end] of ranges) {
			this.trace.push(`H ${start} ${end}`);
			this.expected.push(String(hashBytes(memory.ramData(), start, end - start)));
		}
		this.trace.push('P');
		this.expected.push(`${this.caller + 1} ${this.callerPc}`);
		this.points.push({ name, row, resume: this.trace.length, file, state: captureRuntimeCheckpointState(this.runtime),
			pages: this.pages = this.history.capture(memory, this.pages) });
		cpu.requestNonMaskableInterrupt();
		assert.equal(cpu.enterPendingInterrupt(), false);
		cpu.cancelNonMaskableInterrupt();
	}

	finish(completion: number, validate: () => void): void {
		const { cpu, memory } = this.runtime.machine;
		const drain = () => {
			for (let i = 0; i < 32768 && cpu.heapServiceActive(); ++i) this.grant(911);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.gc.fullEpochs(), 0);
			assert.equal(cpu.gc.phase(), GcPhase.Pause);
			validate();
			this.held();
			const low = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			this.trace.push(`H ${low} ${end}`);
			this.expected.push(String(hashBytes(memory.ramData(), low, end - low)));
			this.caller = -1;
			let result = RunResult.Yielded;
			for (let n = 0; n < 256 && result !== RunResult.Halted; ++n) result = this.grant(1_173);
			assert.equal(result, RunResult.Halted);
			assert.equal(this.runtime.readCompletionValues()[0], valueInteger(completion));
			this.trace.push('C');
			this.expected.push(String(completion));
		};
		const caller = this.caller, tail = this.trace.length;
		drain();
		const rows = this.expected.slice(), commands = this.trace.slice();
		this.compare('cold', this.seed, ['X', ...commands], rows);
		for (const { name, row, file } of this.points) {
			// 'N' and 'I' only in the independent fence probe. The native
			// continuation starts from the same unasserted checkpoint.
			this.compare(`${name}-fence`, file, ['X', 'N', 'I'], ['0']);
			this.compare(`${name}-rewind`, file, ['X', 'l', 's', ...commands.slice(row), 'u', ...commands.slice(row)], [...rows.slice(row), ...rows.slice(row)]);
		}
		const checkpoint = this.points.at(-1)!;
		assert.ok(checkpoint);
		const continued = join(this.directory, 'cpp.state');
		this.compare('export', checkpoint.file, ['X', `x ${continued}`], []);
		const replay = () => {
			this.trace.length = this.expected.length = tail;
			this.caller = caller;
			drain();
			assert.deepEqual(this.trace.slice(tail), commands.slice(tail));
			assert.deepEqual(this.expected.slice(tail), rows.slice(tail));
		};
		assert.equal(checkpoint.resume, tail, 'finish starts from the last checkpointed store');
		this.history.restore(memory, this.history.capture(memory, checkpoint.pages), checkpoint.pages);
		applyRuntimeCheckpointState(this.runtime, checkpoint.state, RuntimeRestoreOrigin.HistorySeek);
		replay();
		applyRuntimeSaveState(this.runtime, decodeRuntimeSaveState(readFileSync(continued), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		replay();
	}

	private compare(name: string, state: string, commands: string[], expected: string[]): void {
		const path = join(this.directory, `${name}.trace`);
		writeFileSync(path, commands.join('\n'));
		const args = [this.rom, path, state];
		if (this.cartridge !== undefined) args.push(this.cartridge);
		const text = execFileSync(this.native, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
		const rows = text === '' ? [] : text.split('\n');
		const diff = rows.findIndex((row, i) => row !== expected[i]);
		assert.equal(diff, -1, `${name}: observation ${diff}, C++=${rows[diff]}, TS=${expected[diff]}`);
		assert.equal(rows.length, expected.length);
	}
}
