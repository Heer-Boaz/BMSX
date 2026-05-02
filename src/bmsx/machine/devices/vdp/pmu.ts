import {
	type VdpPmuBank,
	VDP_PMU_BANK_CONTROL_WORD,
	VDP_PMU_BANK_COUNT,
	VDP_PMU_BANK_SCALE_X_WORD,
	VDP_PMU_BANK_SCALE_Y_WORD,
	VDP_PMU_BANK_WORD_COUNT,
	VDP_PMU_BANK_WORD_STRIDE,
	VDP_PMU_BANK_X_WORD,
	VDP_PMU_BANK_Y_WORD,
	VDP_PMU_Q16_ONE,
} from './contracts';
import { decodeSignedQ16_16 } from './fixed_point';

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

export type VdpResolvedBlitPmu = {
	dstX: number;
	dstY: number;
	scaleX: number;
	scaleY: number;
};

function createPmuBank(): VdpPmuBank {
	return {
		xQ16: 0,
		yQ16: 0,
		scaleXQ16: VDP_PMU_Q16_ONE,
		scaleYQ16: VDP_PMU_Q16_ONE,
		control: 0,
	};
}

function createPmuBanks(): VdpPmuBank[] {
	const banks = new Array<VdpPmuBank>(VDP_PMU_BANK_COUNT);
	for (let index = 0; index < VDP_PMU_BANK_COUNT; index += 1) {
		banks[index] = createPmuBank();
	}
	return banks;
}

function resetPmuBank(target: VdpPmuBank): void {
	target.xQ16 = 0;
	target.yQ16 = 0;
	target.scaleXQ16 = VDP_PMU_Q16_ONE;
	target.scaleYQ16 = VDP_PMU_Q16_ONE;
	target.control = 0;
}

export class VdpPmuUnit {
	private readonly banks = createPmuBanks();
	private selectedBank = 0;

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

	public writeSelectedBankRegister(register: VdpPmuRegister, value: number): void {
		const bank = this.banks[this.selectedBank & 0xff]!;
		const word = value >>> 0;
		switch (register) {
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

	public registerWindow(): VdpPmuRegisterWindow {
		const bank = this.banks[this.selectedBank & 0xff]!;
		return {
			bank: this.selectedBank,
			x: bank.xQ16 >>> 0,
			y: bank.yQ16 >>> 0,
			scaleX: bank.scaleXQ16 >>> 0,
			scaleY: bank.scaleYQ16 >>> 0,
			control: bank.control >>> 0,
		};
	}

	public captureBankWords(): number[] {
		const words = new Array<number>(VDP_PMU_BANK_WORD_COUNT);
		for (let bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; bankIndex += 1) {
			const bank = this.banks[bankIndex]!;
			const base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
			words[base + VDP_PMU_BANK_X_WORD] = bank.xQ16 >>> 0;
			words[base + VDP_PMU_BANK_Y_WORD] = bank.yQ16 >>> 0;
			words[base + VDP_PMU_BANK_SCALE_X_WORD] = bank.scaleXQ16 >>> 0;
			words[base + VDP_PMU_BANK_SCALE_Y_WORD] = bank.scaleYQ16 >>> 0;
			words[base + VDP_PMU_BANK_CONTROL_WORD] = bank.control >>> 0;
		}
		return words;
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

	public resolveBlit(dstX: number, dstY: number, scaleX: number, scaleY: number, pmuBank: number, parallaxWeight: number): VdpResolvedBlitPmu {
		if (parallaxWeight === 0) {
			return { dstX, dstY, scaleX, scaleY };
		}
		const bank = this.banks[pmuBank & 0xff]!;
		const bankScaleX = decodeSignedQ16_16(bank.scaleXQ16);
		const bankScaleY = decodeSignedQ16_16(bank.scaleYQ16);
		const resolvedScaleFactorX = 1 + (bankScaleX - 1) * parallaxWeight;
		const resolvedScaleFactorY = 1 + (bankScaleY - 1) * parallaxWeight;
		const resolvedScaleX = scaleX * resolvedScaleFactorX;
		const resolvedScaleY = scaleY * resolvedScaleFactorY;
		const resolvedDstX = dstX + decodeSignedQ16_16(bank.xQ16) * parallaxWeight;
		const resolvedDstY = dstY + decodeSignedQ16_16(bank.yQ16) * parallaxWeight;
		return {
			dstX: resolvedDstX,
			dstY: resolvedDstY,
			scaleX: resolvedScaleX,
			scaleY: resolvedScaleY,
		};
	}
}
