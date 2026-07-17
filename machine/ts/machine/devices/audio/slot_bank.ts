import {
	APU_PARAMETER_REGISTER_COUNT,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_SLOT_COUNT,
	APU_SLOT_PHASE_IDLE,
	APU_SLOT_PHASE_PLAYING,
	APU_SLOT_REGISTER_WORD_COUNT,
	apuSlotRegisterWordIndex,
	type ApuAudioSlot,
	type ApuParameterRegisterWords,
	type ApuSlotPhase,
} from './contracts';

export class ApuSlotBank {
	private activeMaskWord = 0;
	private readonly slotPhases = new Uint32Array(APU_SLOT_COUNT);
	private readonly slotRegisterWords = new Uint32Array(APU_SLOT_REGISTER_WORD_COUNT);

	public get activeMask(): number {
		return this.activeMaskWord;
	}

	public reset(): void {
		this.activeMaskWord = 0;
		this.slotPhases.fill(APU_SLOT_PHASE_IDLE);
		this.slotRegisterWords.fill(0);
	}

	public phase(slot: ApuAudioSlot): ApuSlotPhase {
		return this.slotPhases[slot]!;
	}

	public setPhase(slot: ApuAudioSlot, phase: ApuSlotPhase): void {
		this.slotPhases[slot] = phase;
		const bit = 1 << slot;
		if (phase === APU_SLOT_PHASE_IDLE) {
			this.activeMaskWord = (this.activeMaskWord & ~bit) >>> 0;
		} else {
			this.activeMaskWord = (this.activeMaskWord | bit) >>> 0;
		}
	}

	public setActive(slot: ApuAudioSlot, registerWords: ApuParameterRegisterWords): void {
		this.setPhase(slot, APU_SLOT_PHASE_PLAYING);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = registerWords[index] >>> 0;
		}
	}

	public clearSlot(slot: ApuAudioSlot): void {
		this.setPhase(slot, APU_SLOT_PHASE_IDLE);
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			this.slotRegisterWords[base + index] = 0;
		}
	}

	public registerWord(slot: ApuAudioSlot, parameterIndex: number): number {
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)]!;
	}

	public writeRegisterWord(slot: ApuAudioSlot, parameterIndex: number, word: number): void {
		this.slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)] = word >>> 0;
	}

	public loadRegisterWords(slot: ApuAudioSlot, out: Uint32Array): void {
		const base = apuSlotRegisterWordIndex(slot, 0);
		for (let index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1) {
			out[index] = this.slotRegisterWords[base + index]!;
		}
	}

	public sourceAddr(slot: ApuAudioSlot): number {
		return this.slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)]!;
	}

	public captureSlotPhases(): number[] {
		return Array.from(this.slotPhases);
	}

	public captureSlotRegisterWords(): number[] {
		return Array.from(this.slotRegisterWords);
	}

	public restore(slotPhases: ArrayLike<number>, slotRegisterWords: ArrayLike<number>): void {
		this.activeMaskWord = 0;
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const phase = slotPhases[slot]!;
			this.slotPhases[slot] = phase;
			if (phase !== APU_SLOT_PHASE_IDLE) {
				this.activeMaskWord = (this.activeMaskWord | (1 << slot)) >>> 0;
			}
		}
		for (let index = 0; index < APU_SLOT_REGISTER_WORD_COUNT; index += 1) {
			this.slotRegisterWords[index] = slotRegisterWords[index] >>> 0;
		}
	}
}
