import type { DebuggerResumeMode } from 'bmsx/console/ide/ide_debugger';
import { fallbackclamp } from '../utils/clamp';
import type { LuaCallFrame, LuaDebuggerPauseSignal, LuaExceptionResumeStrategy } from './runtime';

export function normalizeLuaChunkName(name: string): string {
	return name;
}

export type LuaDebuggerStepMode = 'none' | 'into' | 'over';
export type LuaDebuggerPauseReason = 'breakpoint' | 'step' | 'exception';
export type LuaDebuggerResumeCommand = DebuggerResumeMode | 'ignore_exception' | 'step_out_exception';

type AsyncCarryContext = {
	readonly parentCallStack: ReadonlyArray<LuaCallFrame>;
	readonly location: { chunk: string; line: number; column: number };
	readonly resumeCommand: LuaDebuggerResumeCommand;
};

type AsyncStepAugmentation = {
	readonly frames: ReadonlyArray<LuaCallFrame>;
};

export type LuaDebuggerSessionMetrics = {
	readonly sessionId: number;
	pauseCount: number;
	exceptionCount: number;
	skippedExceptionCount: number;
	lastExceptionLocation: { chunk: string; line: number };
};

export class LuaDebuggerController {
	private readonly breakpoints = new Map<string, Set<number>>();
	private stepMode: LuaDebuggerStepMode = 'none';
	private stepDepth = 0;
	private readonly suppressedBoundaries = new Set<string>();
	private pendingAsyncStep: AsyncStepAugmentation = null;
	private pendingAsyncAugmentation: ReadonlyArray<LuaCallFrame> = null;
	private sessionMetrics: LuaDebuggerSessionMetrics = this.createSessionMetrics(1);

	public isActive(): boolean {
		return this.breakpoints.size > 0 || this.stepMode !== 'none' || this.pendingAsyncStep !== null;
	}

	public setBreakpoints(entries: ReadonlyMap<string, Iterable<number>>): void {
		this.breakpoints.clear();
		this.clearSuppressedBoundaries();
		this.clearAsyncContinuation();
		for (const [chunkName, lines] of entries) {
			const normalizedChunk = this.normalizeChunkName(chunkName);
			const normalizedLines = new Set<number>();
			for (const rawLine of lines) {
				const resolved = this.normalizeLineNumber(rawLine);
				if (resolved !== null) {
					normalizedLines.add(resolved);
				}
			}
			if (normalizedLines.size > 0) {
				this.breakpoints.set(normalizedChunk, normalizedLines);
			}
		}
	}

	public clearBreakpoints(): void {
		this.breakpoints.clear();
		this.clearSuppressedBoundaries();
		this.clearAsyncContinuation();
	}

	public requestStepInto(): void {
		this.stepMode = 'into';
		this.stepDepth = 0;
		this.clearSuppressedBoundaries();
		this.clearAsyncContinuation();
	}

	public requestStepOver(depth: number): void {
		this.stepMode = 'over';
		this.stepDepth = Math.max(0, depth | 0);
		this.clearSuppressedBoundaries();
		this.clearAsyncContinuation();
	}

	public hasActiveSteppingRequest(): boolean {
		return this.stepMode !== 'none' || this.pendingAsyncStep !== null;
	}

	public clearStepping(): void {
		this.stepMode = 'none';
		this.stepDepth = 0;
		this.clearSuppressedBoundaries();
		this.clearAsyncContinuation();
	}

	public suppressNextAtBoundary(chunk: string, line: number, depth: number): void {
		const normalizedChunk = this.normalizeChunkName(chunk);
		const normalizedLine = this.normalizeLineNumber(line);
		if (normalizedLine === null) {
			return;
		}
		const normalizedDepth = Math.max(0, depth | 0);
		this.suppressedBoundaries.add(this.buildBoundaryKey(normalizedChunk, normalizedLine, normalizedDepth));
	}

	public clearSuppressedBoundaries(): void {
		this.suppressedBoundaries.clear();
	}

	public unsuppressBoundary(chunkName: string, line: number, depth: number): void {
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const resolvedLine = this.normalizeLineNumber(line);
		if (resolvedLine === null) {
			return;
		}
		const normalizedDepth = Math.max(0, depth | 0);
		this.suppressedBoundaries.delete(this.buildBoundaryKey(normalizedChunk, resolvedLine, normalizedDepth));
	}

	public handlePause(signal: LuaDebuggerPauseSignal): LuaDebuggerSessionMetrics {
		this.clearSuppressedBoundaries();
		this.pendingAsyncAugmentation = null;
		this.pendingAsyncStep = null;
		this.sessionMetrics.pauseCount += 1;
		if (signal.reason === 'exception') {
			this.sessionMetrics.exceptionCount += 1;
			this.sessionMetrics.lastExceptionLocation = {
				chunk: this.normalizeChunkName(signal.location.chunk),
				line: signal.location.line,
			};
		}
		return this.getSessionMetrics();
	}

	public prepareResume(
		command: LuaDebuggerResumeCommand,
		suspension: LuaDebuggerPauseSignal,
		options?: { stepDepthOverride?: number },
	): LuaExceptionResumeStrategy {
		const baseDepth = suspension.callStack.length;
		const fallbackDepth =
			command === 'step_out' || command === 'step_out_exception'
				? Math.max(0, baseDepth - 1)
				: baseDepth;
		const targetDepth =
			typeof options?.stepDepthOverride === 'number'
				? Math.max(0, options.stepDepthOverride)
				: fallbackDepth;
		switch (command) {
			case 'continue':
				this.clearStepping();
				break;
			case 'step_into':
				this.requestStepInto();
				break;
			case 'step_over':
			case 'step_out':
			case 'step_out_exception':
				this.requestStepOver(targetDepth);
				break;
			case 'ignore_exception':
				this.sessionMetrics.skippedExceptionCount += 1;
				this.unsuppressBoundary(suspension.location.chunk, suspension.location.line, baseDepth);
				console.warn(
					`[LuaDebugger] Exception at ${suspension.location.chunk}:${suspension.location.line} ignored via debugger command.`,
				);
				return 'skip_statement';
			default:
				this.clearStepping();
				break;
		}

		const exceptionPause = suspension.reason === 'exception';
		switch (command) {
			case 'step_into':
			case 'step_over':
			case 'step_out':
				if (exceptionPause) {
					this.unsuppressBoundary(suspension.location.chunk, suspension.location.line, baseDepth);
					this.sessionMetrics.skippedExceptionCount += 1;
					console.warn(
						`[LuaDebugger] Exception at ${suspension.location.chunk}:${suspension.location.line} skipped automatically because ${command} was issued.`,
					);
					return 'skip_statement';
				}
			case 'step_out_exception':
				return 'propagate';
			default:
				return 'propagate';
		}
	}

	public handleSilentResumeResult(
		command: LuaDebuggerResumeCommand,
		suspension: LuaDebuggerPauseSignal,
	): void {
		if (this.stepMode === 'none') {
			console.log('[LuaDebugger] No active stepping request to carry across async boundary.');
			return;
		}
		if (command === 'continue') {
			console.log('[LuaDebugger] Cannot carry \'continue\' command across async boundary.');
			return;
		}
		if (command === 'ignore_exception') {
			console.log(
				`[LuaDebugger] Cannot carry ${command} command across async boundary at ${suspension.location.chunk}:${suspension.location.line}.`,
			);
			return;
		}
		this.pendingAsyncStep = this.createAsyncAugmentation({
			parentCallStack: suspension.callStack,
			location: suspension.location,
			resumeCommand: command,
		});
		this.pendingAsyncAugmentation = null;
		console.debug(
			`[LuaDebugger] Carrying ${command} command across async boundary from ${suspension.location.chunk}:${suspension.location.line}.`,
		);
		this.stepMode = 'none';
		this.stepDepth = 0;
	}

	public decorateCallStack(
		callStack: ReadonlyArray<LuaCallFrame>,
		options?: { consume?: boolean },
	): ReadonlyArray<LuaCallFrame> {
		const consume = options?.consume !== false;
		const augmentation = this.pendingAsyncAugmentation;
		if (!augmentation || augmentation.length === 0) {
			if (consume) {
				this.pendingAsyncAugmentation = null;
			}
			return callStack;
		}
		const merged: LuaCallFrame[] = [];
		for (let index = 0; index < callStack.length; index += 1) {
			merged.push(callStack[index]);
		}
		for (let index = 0; index < augmentation.length; index += 1) {
			merged.push(augmentation[index]);
		}
		if (consume) {
			this.pendingAsyncAugmentation = null;
		}
		return merged;
	}

	public getSessionMetrics(): LuaDebuggerSessionMetrics {
		return { ...this.sessionMetrics };
	}

	public shouldPause(chunkName: string, line: number, depth: number): LuaDebuggerPauseReason {
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const resolvedLine = this.normalizeLineNumber(line);
		if (resolvedLine === null) {
			console.warn(`[LuaDebugger] Invalid line number encountered: ${line}`);
			return null;
		}
		const normalizedDepth = Math.max(0, depth | 0);
		const boundaryKey = this.buildBoundaryKey(normalizedChunk, resolvedLine, normalizedDepth);
		if (this.suppressedBoundaries.delete(boundaryKey)) {
			console.warn(`[LuaDebugger] Suppressed boundary at ${boundaryKey} was hit.`);
			return null;
		}
		if (this.pendingAsyncStep) {
			this.pendingAsyncAugmentation = this.pendingAsyncStep.frames;
			this.pendingAsyncStep = null;
			return 'step';
		}
		const chunkBreakpoints = this.breakpoints.get(normalizedChunk);
		if (chunkBreakpoints && chunkBreakpoints.has(resolvedLine)) {
			return 'breakpoint';
		}
		if (this.stepMode === 'into') {
			this.stepMode = 'none';
			return 'step';
		}
		if (this.stepMode === 'over' && normalizedDepth <= this.stepDepth) {
			this.stepMode = 'none';
			return 'step';
		}

		return null;
	}

	private buildBoundaryKey(chunk: string, line: number, depth: number): string {
		return `${chunk}:${line}:${depth}`;
	}

	private normalizeChunkName(name: string): string {
		return normalizeLuaChunkName(name);
	}

	private normalizeLineNumber(value: number): number {
		return fallbackclamp(value, 1, Number.MAX_SAFE_INTEGER, null);
	}

	private clearAsyncContinuation(): void {
		this.pendingAsyncStep = null;
		this.pendingAsyncAugmentation = null;
	}

	private createSessionMetrics(id: number): LuaDebuggerSessionMetrics {
		return {
			sessionId: id,
			pauseCount: 0,
			exceptionCount: 0,
			skippedExceptionCount: 0,
			lastExceptionLocation: null,
		};
	}

	private createAsyncAugmentation(context: AsyncCarryContext): AsyncStepAugmentation {
		const frames: LuaCallFrame[] = [];
		const summaryFrame: LuaCallFrame = {
			functionName: `[async resume:${context.resumeCommand}]`,
			source: context.location.chunk,
			line: context.location.line,
			column: context.location.column,
		};
		frames.push(summaryFrame);
		for (let index = 0; index < context.parentCallStack.length; index += 1) {
			const parent = context.parentCallStack[index];
			frames.push({
				functionName: parent.functionName,
				source: parent.source,
				line: parent.line,
				column: parent.column,
			});
		}
		return { frames };
	}
}
