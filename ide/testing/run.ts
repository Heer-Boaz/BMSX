import { buildFixtureProgram, type BuiltFixtureProgram, type FixtureMedia } from './fixture_media';
import { LuaError } from '../../toolchain/ts/lua/errors';
import { TestExecution, DEFAULT_TEST_BUDGETS, type TestBudgets } from './execution';
import type { TestTarget, TestTargetFactory } from './target';
import type { TestDebugger } from './debugger';
import { TestInput } from './input';
import { ScenarioResultService, type ScenarioRun, type ScenarioRunItemSource } from './scenario/result_service';

/** A serial run owns a rebootable machine and at most one retained failed machine. */
export class TestRun {
	public active = true;
	public execution: TestExecution | null = null;
	public failedExecution: TestExecution | null = null;
	private index = 0;
	private cancelled = false;
	private target: TestTarget | null = null;
	private program: BuiltFixtureProgram | null = null;
	private programSource: ScenarioRunItemSource | null = null;

	public constructor(
		public readonly result: ScenarioRun,
		private readonly media: FixtureMedia,
		private readonly results: ScenarioResultService,
		private readonly createTarget: TestTargetFactory,
		private readonly finished: () => void,
		private readonly budgets: TestBudgets = DEFAULT_TEST_BUDGETS,
		private readonly captured?: (target: TestTarget, label: string) => void,
		private readonly debuggerChanged?: (debuggerState: TestDebugger) => void,
	) {}

	public async prepare(): Promise<void> {
		const result = this.results.startItem(this.result, this.index, 0);
		const contextId = result.test.resource.contextId;
		const companion = this.media.cartridgeSlots[1];
		try {
			const source = this.programSource;
			const program = source !== null && source.test.resource.contextId === contextId
				&& source.test.assetId === result.test.assetId && source.source === result.source
				? this.program!
				: await buildFixtureProgram(this.media, { sourcePath: result.test.resource.path, source: result.source });
			if (!this.active) return;
			if (this.target === null) {
				this.target = this.createTarget(this.media.systemRom, [program.layer.bytes, companion], this.media.machineModel, new TestInput());
			} else {
				// Every fixture image replaces only the ROM of the same installed card.
				if (program !== this.program) this.target.runtime.machine.cartridgeController.installRom(0, program.layer.bytes);
				// The previous case released all held input. Start a new ICU sample epoch.
				this.target.input.samples = 0;
				this.target.reboot();
			}
			this.program = program;
			this.programSource = result;
			this.execution = new TestExecution(this.target, program, this.results, result, this.budgets, this.captured, this.result.mode);
			const debug = this.execution.debugger;
			if (debug !== undefined && this.debuggerChanged !== undefined) {
				debug.onDidChange(() => this.debuggerChanged!(debug));
				this.debuggerChanged(debug);
			}
		} catch (error) {
			if (!this.active) return;
			this.results.fail(result, 0, {
				phase: 'prepare', message: error instanceof Error ? error.message : String(error),
				stackTrace: error instanceof Error ? error.stack : undefined,
				location: error instanceof LuaError ? { resource: { contextId: result.test.resource.contextId, path: error.path }, line: error.line, column: error.column } : undefined,
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
			execution.failRunner(error);
			this.releaseFailedTarget();
			this.failedExecution = execution;
			this.target = null;
			this.execution = null;
			this.results.failRun(this.result);
			this.finish();
			return;
		}
		if (execution.active) return;
		if (execution.result.state === 'failed') {
			this.releaseFailedTarget();
			this.failedExecution = execution;
			this.target = null;
		} else execution.dispose();
		this.execution = null;
		this.index += 1;
		if (this.cancelled) {
			this.results.cancelRun(this.result);
			this.finish();
		} else if (this.index === this.result.items.length) {
			this.results.completeRun(this.result);
			this.finish();
		} else void this.prepare();
	}

	private finish(): void {
		this.active = false;
		this.target?.dispose();
		this.target = null;
		this.program = null;
		this.programSource = null;
		this.finished();
	}

	private releaseFailedTarget(): void {
		const execution = this.failedExecution;
		if (execution === null) return;
		execution.dispose();
		execution.target.dispose();
		this.failedExecution = null;
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
				this.execution.dispose();
				this.execution = null;
			} else this.results.cancel(this.result.items[this.index], 0);
			this.results.cancelRun(this.result);
			this.finish();
		}
		this.releaseFailedTarget();
	}
}
