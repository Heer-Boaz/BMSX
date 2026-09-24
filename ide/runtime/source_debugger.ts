import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import { ThreadStatus, type Thread } from '../../machine/ts/machine/cpu/thread';
import { ALL_EXECUTION_DOMAINS_MASK, executionDomainBit, type ExecutionDomainId, type ExecutionDomainMask } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { blua32ToolingImageForDomain, type Blua32ToolingMedia } from '../../toolchain/ts/rompack/blua32_media';
import type { SourceLocationPcs } from './source_breakpoints';

export const enum RuntimeDebuggerResumeMode { Continue, StepInto, StepOver, StepOut }
export const enum RuntimeDebuggerStopReason { Breakpoint, Step }
type Suppression = { thread: Thread; frame: CallFrame; depth: number };

/** Physical source stops. Composition owns hook installation, scheduling and suspension lifetime. */
export class SourceDebugger {
	public stopped = false;
	public stopDomain: ExecutionDomainId = -1;
	public stopPc = 0;
	public stopInlineDepth = 0;
	public stopReason = RuntimeDebuggerStopReason.Breakpoint;
	public stopThread: Thread | undefined;
	private mode = RuntimeDebuggerResumeMode.Continue;
	private stepThread: Thread | undefined;
	private stepDepth = 0;
	private stepInlineDepth = 0;
	private stepMedia: Blua32ToolingMedia | undefined;
	private readonly stepPcs = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];
	private readonly suppression: Suppression[] = [];

	public constructor(private readonly cpu: CPU, private media: Blua32ToolingMedia,
		private breakpoints: SourceLocationPcs, private readonly changed: () => void) {}

	public install(media: Blua32ToolingMedia, breakpoints: SourceLocationPcs): void {
		if (this.media !== media) this.stepMedia = undefined;
		this.media = media; this.breakpoints = breakpoints;
		if (this.stepping) this.prepareSteps();
		this.changed();
	}
	public get stepping(): boolean { return this.mode !== RuntimeDebuggerResumeMode.Continue; }
	public get canStepOut(): boolean {
		return this.stopped && (this.stopInlineDepth > 0 || this.stopThread!.frames.length > 1 || this.stopThread!.resumer !== null);
	}
	public get stepThreadFinished(): boolean {
		return this.stepThread !== undefined && (this.stepThread.status === ThreadStatus.Dead || this.stepThread.status === ThreadStatus.Failed);
	}
	public get domainMask(): ExecutionDomainMask {
		// Thread return/failure is a step boundary even when its resumer has no symbols.
		if (this.stopped || this.stepping) return ALL_EXECUTION_DOMAINS_MASK;
		let mask = 0;
		for (let index = 0; index < 3; index++) if (this.breakpoints[index].size !== 0) {
			mask |= executionDomainBit((index - 1) as ExecutionDomainId);
		}
		for (const entry of this.suppression) mask |= executionDomainBit(entry.frame.executionImage.executionDomainId);
		return mask;
	}

	/** Called only by the already instrumented CPU path. No allocation or symbol traversal. */
	public shouldStop(domain: ExecutionDomainId, pc: number, honorStops = true): boolean {
		if (this.stopped) return true;
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
		this.stopped = true; this.stopThread = thread; this.stopDomain = domain; this.stopPc = pc;
		this.stopInlineDepth = inlineDepth; this.stopReason = reason;
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.changed();
		return true;
	}

	public resume(mode: RuntimeDebuggerResumeMode): void {
		this.mode = mode;
		this.stepThread = this.stepping ? this.cpu.activeThread : undefined;
		if (this.stepping) {
			this.stepDepth = this.cpu.getFrameDepth(); this.stepInlineDepth = this.stopInlineDepth;
			this.prepareSteps();
		}
		if (this.stopped && (this.stepping || this.breakpoints[this.stopDomain + 1].has(this.stopPc))) this.suppressCurrentInstruction();
		this.stopped = false; this.stopThread = undefined;
		this.changed();
	}
	private suppressCurrentInstruction(): void {
		const thread = this.cpu.activeThread, depth = thread.frames.length;
		this.suppression.push({ thread, depth, frame: thread.frames[depth - 1] });
	}
	public interrupt(): void {
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined; this.changed();
	}
	public reset(): void {
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.stopped = false; this.stopThread = undefined; this.suppression.length = 0;
		this.changed();
	}
	/** Hot Resume has installed new code; suppression must refer to the relocated activation. */
	public resumeAfterRecompile(wasStopped: boolean): void {
		this.mode = RuntimeDebuggerResumeMode.Continue; this.stepThread = undefined;
		this.stopped = false; this.stopThread = undefined;
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
