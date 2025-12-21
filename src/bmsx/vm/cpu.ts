export type VmSourcePosition = {
	readonly line: number;
	readonly column: number;
};

export type VmSourceRange = {
	readonly path: string;
	readonly start: VmSourcePosition;
	readonly end: VmSourcePosition;
};

export type VmInstructionSignal =
	| null
	| { readonly kind: 'return' }
	| { readonly kind: 'break'; readonly originRange: VmSourceRange }
	| { readonly kind: 'goto'; readonly label: string; readonly originRange: VmSourceRange };

export type VmLabelMetadata = {
	readonly index: number;
	readonly range: VmSourceRange;
};

export type VmLabelScope = {
	readonly labels: Map<string, VmLabelMetadata>;
	readonly parent: VmLabelScope;
};

export type FrameBoundary = 'path' | 'function' | 'block';

export type VmInstruction<TEnv, TValue> =
	| {
		readonly kind: 'label';
		readonly label: string;
		readonly range: VmSourceRange;
	}
	| {
		readonly kind: 'op';
		readonly range: VmSourceRange;
		readonly execute: (frame: VmInstructionFrame<TEnv, TValue>, cpu: VMCPU<TEnv, TValue>) => VmInstructionSignal;
	};

export type VmInstructionFrame<TEnv, TValue> = {
	readonly kind: 'instructions';
	readonly instructions: ReadonlyArray<VmInstruction<TEnv, TValue>>;
	index: number;
	environment: TEnv;
	varargs: ReadonlyArray<TValue>;
	scope: VmLabelScope;
	boundary: FrameBoundary;
	breakable: boolean;
	callFramePushed: boolean;
	callRange: VmSourceRange;
};

export type VmCustomFrame<TEnv, TValue> = {
	readonly kind: 'custom';
	environment: TEnv;
	varargs: ReadonlyArray<TValue>;
	scope: VmLabelScope;
	boundary: FrameBoundary;
	breakable: boolean;
	callFramePushed: boolean;
	callRange: VmSourceRange;
	step: (cpu: VMCPU<TEnv, TValue>, frame: VmCustomFrame<TEnv, TValue>) => VmInstructionSignal;
};

export type VmExecutionFrame<TEnv, TValue> = VmInstructionFrame<TEnv, TValue> | VmCustomFrame<TEnv, TValue>;

export type VmCallFrame = {
	readonly functionName: string;
	readonly source: string;
	readonly line: number;
	readonly column: number;
};

export class VMCPU<TEnv, TValue> {
	public programCounter = 0;
	public readonly programCounterStack: number[] = [];
	public instructionBudgetRemaining: number | null = null;
	public readonly frameStack: VmExecutionFrame<TEnv, TValue>[] = [];
	public readonly envStack: TEnv[] = [];
	public readonly callStack: VmCallFrame[] = [];
	public activeInstructionRange: VmSourceRange = null;
	public activeInstructionFrame: VmInstructionFrame<TEnv, TValue> = null;
	public lastInstructionRange: VmSourceRange = null;

	public advanceProgramCounter(): number {
		this.programCounter += 1;
		if (this.instructionBudgetRemaining !== null) {
			this.instructionBudgetRemaining -= 1;
		}
		return this.programCounter;
	}

	public pushProgramCounter(): number {
		this.programCounterStack.push(this.programCounter);
		return this.programCounter;
	}

	public popProgramCounter(): number {
		const restored = this.programCounterStack.pop()!;
		this.programCounter = restored;
		return restored;
	}

	public pushFrame(frame: VmExecutionFrame<TEnv, TValue>): void {
		this.frameStack.push(frame);
		this.envStack.push(frame.environment);
	}

	public popFrame(): VmExecutionFrame<TEnv, TValue> {
		const frame = this.frameStack.pop()!;
		this.envStack.pop();
		if (frame.callFramePushed) {
			this.callStack.pop();
		}
		return frame;
	}

	public pushInstructionFrame(config: {
		readonly instructions: ReadonlyArray<VmInstruction<TEnv, TValue>>;
		readonly environment: TEnv;
		readonly varargs: ReadonlyArray<TValue>;
		readonly scope: VmLabelScope;
		readonly boundary: FrameBoundary;
		readonly callRange: VmSourceRange;
		readonly breakable: boolean;
		readonly callName?: string;
	}): void {
		const callRange = config.callRange;
		let callFramePushed = false;
		if (config.boundary !== 'block') {
			this.callStack.push({
				functionName: config.callName && config.callName.length > 0 ? config.callName : null,
				source: callRange.path,
				line: callRange.start.line,
				column: callRange.start.column,
			});
			callFramePushed = true;
		}
		const frame: VmInstructionFrame<TEnv, TValue> = {
			kind: 'instructions',
			instructions: config.instructions,
			index: 0,
			environment: config.environment,
			varargs: config.varargs,
			scope: config.scope,
			boundary: config.boundary,
			breakable: config.breakable,
			callFramePushed,
			callRange,
		};
		this.pushFrame(frame);
	}

	public stepFrame(frame: VmExecutionFrame<TEnv, TValue>): VmInstructionSignal {
		if (frame.kind === 'instructions') {
			return this.stepInstructionFrame(frame);
		}
		return frame.step(this, frame);
	}

	public tryConsumeBreak(): boolean {
		for (let index = this.frameStack.length - 1; index >= 0; index -= 1) {
			const frame = this.frameStack[index];
			if (frame.breakable) {
				while (this.frameStack.length > index + 1) {
					this.popFrame();
				}
				this.popFrame();
				return true;
			}
			if (frame.boundary !== 'block') {
				break;
			}
		}
		return false;
	}

	public tryConsumeGoto(signal: Extract<VmInstructionSignal, { kind: 'goto' }>): boolean {
		for (let index = this.frameStack.length - 1; index >= 0; index -= 1) {
			const frame = this.frameStack[index];
			if (frame.kind === 'instructions') {
				const metadata = this.resolveLabel(frame.scope, signal.label);
				if (metadata !== null) {
					while (this.frameStack.length > index + 1) {
						this.popFrame();
					}
					frame.index = metadata.index;
					return true;
				}
			}
			if (frame.boundary !== 'block') {
				break;
			}
		}
		return false;
	}

	public popUntilBoundary(): void {
		while (this.frameStack.length > 0) {
			const frame = this.popFrame();
			if (frame.boundary !== 'block') {
				return;
			}
		}
	}

	public createLabelScope(instructions: ReadonlyArray<VmInstruction<TEnv, TValue>>, parent: VmLabelScope): VmLabelScope {
		return { labels: this.buildLabelMap(instructions), parent };
	}

	private stepInstructionFrame(frame: VmInstructionFrame<TEnv, TValue>): VmInstructionSignal {
		while (frame.index < frame.instructions.length && frame.instructions[frame.index].kind === 'label') {
			frame.index += 1;
		}
		if (frame.index >= frame.instructions.length) {
			this.popFrame();
			return null;
		}
		const instruction = frame.instructions[frame.index] as Extract<VmInstruction<TEnv, TValue>, { kind: 'op' }>;
		this.activeInstructionRange = instruction.range;
		this.activeInstructionFrame = frame;
		this.advanceProgramCounter();
		let clearActiveInstruction = true;
		try {
			return instruction.execute(frame, this);
		} catch (error) {
			clearActiveInstruction = false;
			throw error;
		} finally {
			this.lastInstructionRange = this.activeInstructionRange ?? this.lastInstructionRange;
			if (clearActiveInstruction) {
				this.activeInstructionRange = null;
				this.activeInstructionFrame = null;
			}
		}
	}

	private resolveLabel(scope: VmLabelScope, label: string): VmLabelMetadata {
		let current: VmLabelScope = scope;
		while (current !== null) {
			const metadata = current.labels.get(label);
			if (metadata !== undefined) {
				return metadata;
			}
			current = current.parent;
		}
		return null;
	}

	private buildLabelMap(instructions: ReadonlyArray<VmInstruction<TEnv, TValue>>): Map<string, VmLabelMetadata> {
		const labels = new Map<string, VmLabelMetadata>();
		for (let index = 0; index < instructions.length; index += 1) {
			const instruction = instructions[index];
			if (instruction.kind === 'label') {
				if (labels.has(instruction.label)) {
					throw new Error(`Duplicate label '${instruction.label}'.`);
				}
				labels.set(instruction.label, { index, range: instruction.range });
			}
		}
		return labels;
	}
}
