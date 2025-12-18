import { LuaSourceLocation } from './lua_ast';
import type { LuaCallFrame } from './luaruntime';
import type { LuaDebuggerPauseSignal } from './luavalue';

export type LuaDebuggerPauseReason = 'breakpoint' | 'step' | 'exception';

export type LuaDebuggerSessionMetrics = {
	pauseCount: number;
	breakpointCount: number;
	stepCount: number;
	exceptionCount: number;
	skippedExceptionCount: number;
	lastExceptionLocation?: LuaSourceLocation;
};

type StepMode = 'none' | 'into' | 'out';
type PauseLocation = { path: string; line: number; depth: number };
type StepRequest = {
	mode: StepMode;
	targetDepth: number;
	origin: PauseLocation | null;
	originConsumed: boolean;
};

export class LuaDebuggerController {
	private breakpoints: Map<string, Set<number>> = new Map();
	private stepRequest: StepRequest = null;
	private lastPauseLocation: PauseLocation = null;
	private readonly metrics: LuaDebuggerSessionMetrics = {
		pauseCount: 0,
		breakpointCount: 0,
		stepCount: 0,
		exceptionCount: 0,
		skippedExceptionCount: 0,
		lastExceptionLocation: null,
	};

	public setBreakpoints(breakpoints: Map<string, Set<number>>): void {
		this.breakpoints = new Map();
		for (const [path, lines] of breakpoints.entries()) {
			this.breakpoints.set(path, new Set(lines));
		}
	}

	public requestStepInto(origin: PauseLocation = null): void {
		this.beginStep('into', origin ? origin.depth : 0, origin);
	}

	/**
	 * Step-over is not supported: the interpreter only pauses at statement boundaries and executes nested
	 * calls synchronously inside that same statement. Without instrumentation to re-enter after the current
	 * statement finishes, we cannot skip breakpoints inside child calls, so we fall back to step-into.
	 */
	public requestStepOver(_currentDepth: number, origin: PauseLocation = null): void {
		this.beginStep('into', origin ? origin.depth : 0, origin);
	}

	public requestStepOut(currentDepth: number, origin: PauseLocation = null): void {
		this.beginStep('out', Math.max(0, currentDepth - 1), origin);
	}

	public clearStepRequest(): void {
		this.stepRequest = null;
	}

	public clearPauseContext(): void {
		this.lastPauseLocation = null;
	}

	private beginStep(mode: StepMode, targetDepth: number, origin: PauseLocation | null): void {
		const resolvedOrigin = origin ?? this.lastPauseLocation;
		this.stepRequest = {
			mode,
			targetDepth,
			origin: resolvedOrigin,
			originConsumed: resolvedOrigin === null,
		};
	}

	public shouldPause(path: string, line: number, callDepth: number): LuaDebuggerPauseReason {
		const stepReason = this.shouldPauseForStep(path, line, callDepth);
		if (stepReason !== null) {
			return stepReason;
		}
		const lines = this.breakpoints.get(path);
		if (lines && lines.has(line)) {
			return 'breakpoint';
		}
		return null;
	}

	private shouldPauseForStep(path: string, line: number, callDepth: number): LuaDebuggerPauseReason {
		const step = this.stepRequest;
		if (!step || step.mode === 'none') {
			return null;
		}
		if (!step.originConsumed) {
			if (step.origin && step.origin.path === path && step.origin.line === line && step.origin.depth === callDepth) {
				step.originConsumed = true;
				return null;
			}
			step.originConsumed = true;
		}
		if (step.mode === 'into') {
			return 'step';
		}
		if (step.mode === 'out' && callDepth <= step.targetDepth) {
			return 'step';
		}
		return null;
	}

	public decorateCallStack(stack: ReadonlyArray<LuaCallFrame>, _options: { consume: boolean }): ReadonlyArray<LuaCallFrame> {
		const copy: LuaCallFrame[] = [];
		for (let index = 0; index < stack.length; index += 1) {
			const frame = stack[index];
			copy.push({ functionName: frame.functionName, source: frame.source, line: frame.line, column: frame.column });
		}
		return copy;
	}

	public handlePause(signal: LuaDebuggerPauseSignal): void {
		this.metrics.pauseCount += 1;
		if (signal.reason === 'breakpoint') {
			this.metrics.breakpointCount += 1;
		}
		if (signal.reason === 'step') {
			this.metrics.stepCount += 1;
		}
		if (signal.reason === 'exception') {
			this.metrics.exceptionCount += 1;
			this.metrics.lastExceptionLocation = {
				path: signal.location.path,
				line: signal.location.line,
				column: signal.location.column,
			};
		}
		this.lastPauseLocation = { path: signal.location.path, line: signal.location.line, depth: signal.callStack.length };
		this.clearStepRequest();
	}

	public markSkippedException(): void {
		this.metrics.skippedExceptionCount += 1;
	}

	public getSessionMetrics(): LuaDebuggerSessionMetrics {
		return {
			pauseCount: this.metrics.pauseCount,
			breakpointCount: this.metrics.breakpointCount,
			stepCount: this.metrics.stepCount,
			exceptionCount: this.metrics.exceptionCount,
			skippedExceptionCount: this.metrics.skippedExceptionCount,
			lastExceptionLocation: this.metrics.lastExceptionLocation,
		};
	}
}
