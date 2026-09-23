import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import { buildTestCartridge, type BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ScenarioTestSource } from '../../toolchain/ts/rompack/scenario_test';
import { LuaError } from '../../toolchain/ts/lua/errors';
import { TestExecution, DEFAULT_TEST_BUDGETS, type TestBudgets } from './execution';
import type { TestTarget, TestTargetFactory } from './target';
import { TestInput } from './input';
import { ScenarioResultService, type ScenarioRun, type ScenarioRunItemSource } from './scenario/result_service';

export type TestRunMedia = {
	readonly sourceOnlyModules?: readonly ScenarioTestSource[];
	readonly systemRom: Uint8Array;
	readonly cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null];
	readonly machineModel: MachineModelSpec;
	readonly optLevel: 0 | 1 | 2 | 3;
};

/** A serial run owns at most its current machine and one retained failed machine. */
export class TestRun {
	public active = true;
	public execution: TestExecution | null = null;
	public failedExecution: TestExecution | null = null;
	private index = 0;
	private cancelled = false;
	private program: BuiltTestCartridge | null = null;
	private programSource: ScenarioRunItemSource | null = null;

	public constructor(
		public readonly result: ScenarioRun,
		private readonly sources: readonly ScenarioRunItemSource[],
		private readonly media: TestRunMedia,
		private readonly results: ScenarioResultService,
		private readonly createTarget: TestTargetFactory,
		private readonly finished: () => void,
		private readonly budgets: TestBudgets = DEFAULT_TEST_BUDGETS,
		private readonly captured?: (target: TestTarget, label: string) => void,
	) {}

	public async prepare(): Promise<void> {
		const source = this.sources[this.index];
		const result = this.results.startItem(this.result, this.index, 0);
		const slot = source.test.resource.domain;
		const companion = this.media.cartridgeSlots[1 - slot];
		try {
			if (this.programSource === null || this.programSource.test.resource.domain !== slot || this.programSource.test.assetId !== source.test.assetId
				|| this.programSource.source !== source.source) {
				this.program = await buildTestCartridge({ ...this.media, ramByteCount: this.media.machineModel.ramBytes,
					cartridge: this.media.cartridgeSlots[slot]!, companionCartridge: companion,
					test: { sourcePath: source.test.resource.path, source: source.source } });
				this.programSource = source;
			}
			if (!this.active) { this.program = null; return; }
			const target = this.createTarget(this.media.systemRom, [this.program!.layer.bytes, companion], this.media.machineModel, new TestInput());
			this.execution = new TestExecution(target, this.program!, this.results, result, this.budgets, this.captured);
		} catch (error) {
			if (!this.active) return;
			this.results.fail(result, 0, {
				phase: 'prepare', message: error instanceof Error ? error.message : String(error),
				stackTrace: error instanceof Error ? error.stack : undefined,
				location: error instanceof LuaError ? { resource: { domain: source.test.resource.domain, path: error.path }, line: error.line, column: error.column } : undefined,
			}, null);
			this.results.failRun(this.result);
			this.finish();
		}
	}

	public advance(): void {
		const execution = this.execution;
		if (execution === null) return; // Compilation is asynchronous; no machine exists yet.
		try {
			if (execution.active) execution.advance();
		} catch (error) {
			this.results.fail(execution.result, execution.target.runtime.frameScheduler.lastTickSequence, {
				phase: 'runner', message: error instanceof Error ? error.message : String(error),
				stackTrace: error instanceof Error ? error.stack : undefined,
			}, null);
			execution.target.input.reset();
			execution.target.runtime.machine.cpu.setExecutionHook(null, 0, 0);
			execution.active = false;
			this.failedExecution?.target.dispose();
			this.failedExecution = execution;
			this.execution = null;
			this.results.failRun(this.result);
			this.finish();
			return;
		}
		if (execution.active) return;
		if (execution.result.state === 'failed') {
			this.failedExecution?.target.dispose();
			this.failedExecution = execution;
		} else execution.target.dispose();
		this.execution = null;
		this.index += 1;
		if (this.cancelled) {
			this.results.cancelRun(this.result);
			this.finish();
		} else if (this.index === this.sources.length) {
			this.results.completeRun(this.result);
			this.finish();
		} else void this.prepare();
	}

	private finish(): void {
		this.active = false;
		this.program = null;
		this.programSource = null;
		this.finished();
	}

	public cancel(): void {
		this.cancelled = true;
		if (this.execution !== null) {
			this.execution.cancel();
			return;
		}
		this.results.cancel(this.result.items[this.index], 0);
		this.results.cancelRun(this.result);
		this.finish();
	}

	public dispose(): void {
		if (this.active) {
			if (this.execution !== null) {
				if (this.execution.active) this.execution.cancel(false);
				this.execution.target.dispose();
				this.execution = null;
			} else this.results.cancel(this.result.items[this.index], 0);
			this.results.cancelRun(this.result);
			this.finish();
		}
		this.failedExecution?.target.dispose();
		this.failedExecution = null;
	}
}
