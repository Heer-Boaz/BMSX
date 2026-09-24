import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { ThreadStatus, type Thread } from '../../machine/ts/machine/cpu/thread';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit, type ExecutionDomainId, type ExecutionDomainMask } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { blua32ToolingImageForDomain, type Blua32ToolingMedia } from '../../toolchain/ts/rompack/blua32_media';
import type { SourceLocationPcs } from './source_breakpoints';

export const enum RuntimeDebuggerResumeMode { Continue, StepInto, StepOver, StepOut }
export const SOURCE_EXECUTION_MODES = { continue: RuntimeDebuggerResumeMode.Continue, into: RuntimeDebuggerResumeMode.StepInto,
	over: RuntimeDebuggerResumeMode.StepOver, out: RuntimeDebuggerResumeMode.StepOut };
export type SourceExecutionMode = keyof typeof SOURCE_EXECUTION_MODES;
export const enum RuntimeDebuggerStopReason { Breakpoint, Step }
/** A source stop retained while a completion call owns execution above it. */
export type RuntimeDebuggerSourceStop = {
	readonly id: number;
	readonly thread: Thread;
	readonly media: Blua32ToolingMedia;
	readonly domain: ExecutionDomainId;
	readonly pc: number;
	readonly inlineDepth: number;
	readonly reason: RuntimeDebuggerStopReason;
};
type Suppression = { thread: Thread; frame: CallFrame; depth: number };

/** Physical source stops. Composition owns hook installation, scheduling and suspension lifetime. */
export class SourceDebugger {
	public stop: RuntimeDebuggerSourceStop | undefined;
	// Host suspension identities are never recycled, including after machine reset.
	private stopSerial = 0;
	private retiredStopId = 0;
	private mode = RuntimeDebuggerResumeMode.Continue;
	public stepThread: Thread | undefined;
	private stepDepth = 0;
	private stepInlineDepth = 0;
	private stepMedia: Blua32ToolingMedia | undefined;
	private readonly stepPcs = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
	private readonly suppression: Suppression[] = [];

	public constructor(private readonly cpu: CPU, private media: Blua32ToolingMedia,
		private breakpoints: SourceLocationPcs, private readonly changed: () => void) {}

	public install(media: Blua32ToolingMedia, breakpoints: SourceLocationPcs): void {
		if (this.media !== media) { this.stepMedia = undefined; this.stop = undefined; this.retiredStopId = this.stopSerial; }
		this.media = media; this.breakpoints = breakpoints;
		if (this.stepping) this.prepareSteps();
		this.changed();
	}
	public get stepping(): boolean { return this.mode !== RuntimeDebuggerResumeMode.Continue; }
	public get canStepOut(): boolean {
		return this.stop !== undefined && (this.stop.inlineDepth > 0 || this.stop.thread.frames.length > 1 || this.stop.thread.resumer !== null);
	}
	public get stepThreadFinished(): boolean {
		return this.stepThread !== undefined && (this.stepThread.status === ThreadStatus.Dead || this.stepThread.status === ThreadStatus.Failed);
	}
	public get domainMask(): ExecutionDomainMask {
		// Thread return/failure is a step boundary even when its resumer has no symbols.
		if (this.stop !== undefined || this.stepping) return ALL_EXECUTION_DOMAINS_MASK;
		let mask = 0;
		for (let index = 0; index < 3; index++) if (this.breakpoints[index].size !== 0) {
			mask |= executionDomainBit((index - 1) as ExecutionDomainId);
		}
		for (const entry of this.suppression) mask |= executionDomainBit(entry.frame.executionImage.executionDomainId);
		return mask;
	}

	/** Instrumented path only. Misses allocate nothing; a real hit owns one stop record. */
	public shouldStop(domain: ExecutionDomainId, pc: number, honorStops = true): boolean {
		if (this.stop !== undefined) return true;
		const thread = this.cpu.activeThread, depth = thread.frames.length;
		for (let index = this.suppression.length - 1; index >= 0; index--) {
			const entry = this.suppression[index];
			if (entry.thread !== thread || entry.depth !== depth || entry.frame !== thread.frames[depth - 1]) continue;
			this.suppression.copyWithin(index, index + 1); this.suppression.length--;
			this.changed(); return false;
		}
		if (!honorStops) return false;
		const index = domain + 1;
		let inlineDepth: number | undefined;
		let reason = RuntimeDebuggerStopReason.Breakpoint;
		if (this.stepping && this.stepThread === thread) {
			const point = this.stepPcs[index].get(pc);
			if (point !== undefined && (this.mode === RuntimeDebuggerResumeMode.StepInto || depth < this.stepDepth
				|| depth === this.stepDepth && (this.mode === RuntimeDebuggerResumeMode.StepOver ? point <= this.stepInlineDepth : point < this.stepInlineDepth))) {
				inlineDepth = point; reason = RuntimeDebuggerStopReason.Step;
			}
		}
		// A selected-thread step never suppresses a breakpoint in another thread or domain.
		if (inlineDepth === undefined) inlineDepth = this.breakpoints[index].get(pc);
		if (inlineDepth === undefined) return false;
		this.stop = { id: ++this.stopSerial, thread, media: this.media, domain, pc, inlineDepth, reason };
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.changed();
		return true;
	}

	public resume(mode: RuntimeDebuggerResumeMode): void {
		this.mode = mode;
		this.stepThread = this.stepping ? this.cpu.activeThread : undefined;
		if (this.stepping) {
			this.stepDepth = this.cpu.getFrameDepth(); this.stepInlineDepth = this.stop === undefined ? 0 : this.stop.inlineDepth;
			this.prepareSteps();
		}
		if (this.stop !== undefined && (this.stepping || this.breakpoints[this.stop.domain + 1].has(this.stop.pc))) this.suppressCurrentInstruction();
		this.stop = undefined;
		this.changed();
	}

	/** Unlike Continue, the call will not execute the stopped instruction. */
	public suspendStopForCall(): RuntimeDebuggerSourceStop {
		const stop = this.stop!;
		this.stop = undefined;
		this.interrupt();
		return stop;
	}

	/** The completion boundary has stopped before the retained caller can run. */
	public returnToStop(stop: RuntimeDebuggerSourceStop): boolean {
		if (stop.id <= this.retiredStopId) return false;
		this.stop = stop;
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.changed();
		return true;
	}
	private suppressCurrentInstruction(): void {
		const thread = this.cpu.activeThread, depth = thread.frames.length;
		this.suppression.push({ thread, depth, frame: thread.frames[depth - 1] });
	}
	public interrupt(): void {
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined; this.changed();
	}
	public reset(): void {
		this.retiredStopId = this.stopSerial;
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.stop = undefined; this.suppression.length = 0;
		this.changed();
	}
	/** Hot Resume has installed new code; suppression must refer to the relocated activation. */
	public resumeAfterRecompile(wasStopped: boolean): void {
		this.retiredStopId = this.stopSerial;
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.stop = undefined;
		// Relocation preserves actual activations. Pending parent suppressions survive nested init calls.
		this.didExecute();
		const depth = this.cpu.getFrameDepth();
		if (wasStopped && this.breakpoints[this.cpu.readFrameExecutionDomain(depth - 1) + 1].has(this.cpu.readFramePc(depth - 1))) {
			this.suppressCurrentInstruction();
		}
		this.changed();
	}
	public discardFrames(thread: Thread, firstFrame: number): void {
		for (let index = this.suppression.length - 1; index >= 0; index--) {
			const entry = this.suppression[index];
			if (entry.thread === thread && entry.depth > firstFrame) {
				this.suppression.copyWithin(index, index + 1); this.suppression.length--;
			}
		}
		this.changed();
	}
	/** Closed/unwound activations cannot keep the instrumentation port enabled indefinitely. */
	public didExecute(): void {
		let changed = false;
		for (let index = this.suppression.length - 1; index >= 0; index--) {
			const entry = this.suppression[index];
			if (entry.thread.frames[entry.depth - 1] === entry.frame) continue;
			this.suppression.copyWithin(index, index + 1); this.suppression.length--; changed = true;
		}
		if (changed) this.changed();
	}
	private prepareSteps(): void {
		if (this.stepMedia === this.media) return;
		this.stepMedia = this.media;
		for (let index = 0; index < 3; index++) {
			const target = this.stepPcs[index]; target.clear();
			const image = blua32ToolingImageForDomain(this.media, (index - 1) as ExecutionDomainId);
			if (image === null || image.symbols === null) continue;
			for (let fn = 0; fn < image.layout.functions.length; fn++) {
				const address = image.layout.functions[fn].codeAddress;
				for (const point of image.symbols.metadata.statementPointsByFunction[fn]) target.set(address + point.wordOffset * INSTRUCTION_BYTES, point.inlineCallSites.length);
			}
		}
	}
}
