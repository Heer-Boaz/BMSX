import type { LuaDebuggerPauseSignal } from '../lua/runtime.ts';
import type { DebuggerPauseDisplayPayload } from './debugger_lifecycle';

export type DebuggerStepCommand = 'continue' | 'stepInto' | 'stepOut';

export type DebuggerExceptionFrame = {
	chunk: string;
	line: number;
	column: number;
	hint: { assetId: string | null; path?: string | null } | null;
};

type DebuggerExceptionState = {
	frames: ReadonlyArray<DebuggerExceptionFrame>;
	index: number;
};

export type DebuggerExceptionStepResolution =
	| { kind: 'none' }
	| { kind: 'focus'; payload: DebuggerPauseDisplayPayload }
	| { kind: 'resume' };

export class DebuggerSession {
	private suspension: LuaDebuggerPauseSignal | null = null;
	private exceptionState: DebuggerExceptionState | null = null;

	public captureSuspension(signal: LuaDebuggerPauseSignal): void {
		this.suspension = signal;
		if (signal.reason !== 'exception') {
			this.exceptionState = null;
		}
	}

	public captureExceptionPause(signal: LuaDebuggerPauseSignal, frames: ReadonlyArray<DebuggerExceptionFrame>): void {
		this.suspension = signal;
		this.exceptionState = { frames: frames.slice(), index: 0 };
	}

	public clear(): void {
		this.suspension = null;
		this.exceptionState = null;
	}

	public getSuspension(): LuaDebuggerPauseSignal | null {
		return this.suspension;
	}

	public hasExceptionBreak(): boolean {
		return Boolean(this.suspension && this.suspension.reason === 'exception' && this.exceptionState);
	}

	public getCurrentExceptionPayload(): DebuggerPauseDisplayPayload | null {
		if (!this.exceptionState) {
			return null;
		}
		return frameToPayload(this.exceptionState.frames[this.exceptionState.index]);
	}

	public resolveExceptionStep(command: DebuggerStepCommand): DebuggerExceptionStepResolution {
		if (!this.hasExceptionBreak() || !this.exceptionState) {
			return { kind: 'none' };
		}
		if (command === 'continue') {
			this.clear();
			return { kind: 'resume' };
		}
		const direction = command === 'stepInto' ? 1 : -1;
		const frames = this.exceptionState.frames;
		const nextIndex = this.exceptionState.index + direction;
		this.exceptionState.index = clampIndex(nextIndex, 0, frames.length - 1);
		return { kind: 'focus', payload: frameToPayload(frames[this.exceptionState.index]) };
	}
}

function frameToPayload(frame: DebuggerExceptionFrame): DebuggerPauseDisplayPayload {
	return {
		chunk: frame.chunk,
		line: frame.line,
		column: frame.column,
		reason: 'exception',
		hint: frame.hint,
	};
}

function clampIndex(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.max(min, Math.min(max, value));
}
