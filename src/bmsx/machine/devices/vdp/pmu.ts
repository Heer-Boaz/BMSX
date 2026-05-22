import {
	type VdpPmuBank,
	VDP_PMU_BANK_CONTROL_WORD,
	VDP_PMU_BANK_COUNT,
	VDP_PMU_BANK_SCALE_X_WORD,
	VDP_PMU_BANK_SCALE_Y_WORD,
	VDP_PMU_BANK_WORD_STRIDE,
	VDP_PMU_BANK_X_WORD,
	VDP_PMU_BANK_Y_WORD,
	VDP_PMU_Q16_ONE,
} from './contracts';

export const enum VdpPmuRegister {
	X,
	Y,
	ScaleX,
	ScaleY,
	Control,
}

export type VdpPmuRegisterWindow = {
	bank: number;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	control: number;
};

function resetPmuBank(bank: VdpPmuBank): void {
	bank.xQ16 = 0;
	bank.yQ16 = 0;
	bank.scaleXQ16 = VDP_PMU_Q16_ONE;
	bank.scaleYQ16 = VDP_PMU_Q16_ONE;
	bank.control = 0;
}

export class VdpPmuUnit {
	private readonly banks: VdpPmuBank[] = [];
	private selectedBank = 0;

	public constructor() {
		for (let index = 0; index < VDP_PMU_BANK_COUNT; index += 1) {
			this.banks[index] = {
				xQ16: 0,
				yQ16: 0,
				scaleXQ16: VDP_PMU_Q16_ONE,
				scaleYQ16: VDP_PMU_Q16_ONE,
				control: 0,
			};
		}
	}

	public reset(): void {
		for (let index = 0; index < this.banks.length; index += 1) {
			resetPmuBank(this.banks[index]!);
		}
		this.selectedBank = 0;
	}

	public get selectedBankIndex(): number {
		return this.selectedBank;
	}

	public selectBank(bank: number): void {
		this.selectedBank = bank & 0xff;
	}

	public writeSelectedBankRegister(pmuRegister: VdpPmuRegister, value: number): void {
		const bank = this.banks[this.selectedBank & 0xff]!;
		const word = value >>> 0;
		switch (pmuRegister) {
			case VdpPmuRegister.X:
				bank.xQ16 = word;
				break;
			case VdpPmuRegister.Y:
				bank.yQ16 = word;
				break;
			case VdpPmuRegister.ScaleX:
				bank.scaleXQ16 = word;
				break;
			case VdpPmuRegister.ScaleY:
				bank.scaleYQ16 = word;
				break;
			case VdpPmuRegister.Control:
				bank.control = word;
				break;
		}
	}

	public writeRegisterWindow(target: VdpPmuRegisterWindow): void {
		const bank = this.banks[this.selectedBank & 0xff]!;
		target.bank = this.selectedBank;
		target.x = bank.xQ16 >>> 0;
		target.y = bank.yQ16 >>> 0;
		target.scaleX = bank.scaleXQ16 >>> 0;
		target.scaleY = bank.scaleYQ16 >>> 0;
		target.control = bank.control >>> 0;
	}

	public captureBankWords(target: number[]): void {
		for (let bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; bankIndex += 1) {
			const bank = this.banks[bankIndex]!;
			const base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
			target[base + VDP_PMU_BANK_X_WORD] = bank.xQ16 >>> 0;
			target[base + VDP_PMU_BANK_Y_WORD] = bank.yQ16 >>> 0;
			target[base + VDP_PMU_BANK_SCALE_X_WORD] = bank.scaleXQ16 >>> 0;
			target[base + VDP_PMU_BANK_SCALE_Y_WORD] = bank.scaleYQ16 >>> 0;
			target[base + VDP_PMU_BANK_CONTROL_WORD] = bank.control >>> 0;
		}
	}

	public restoreBankWords(selectedBank: number, words: ArrayLike<number>): void {
		for (let bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; bankIndex += 1) {
			const bank = this.banks[bankIndex]!;
			const base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
			bank.xQ16 = words[base + VDP_PMU_BANK_X_WORD] >>> 0;
			bank.yQ16 = words[base + VDP_PMU_BANK_Y_WORD] >>> 0;
			bank.scaleXQ16 = words[base + VDP_PMU_BANK_SCALE_X_WORD] >>> 0;
			bank.scaleYQ16 = words[base + VDP_PMU_BANK_SCALE_Y_WORD] >>> 0;
			bank.control = words[base + VDP_PMU_BANK_CONTROL_WORD] >>> 0;
		}
		this.selectBank(selectedBank);
	}
}
