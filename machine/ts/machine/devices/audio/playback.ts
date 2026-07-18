import { toSignedWord } from '../../common/numeric';
import { APU_SAMPLE_RATE_HZ } from './contracts';

const U16_BASE = 0x1_0000;
const U16_BASE_SQUARED = 0x1_0000_0000;
const U16_BASE_CUBED = 0x1_0000_0000_0000;

export interface ApuPhaseStep {
	wholeQ16: number;
	remainder: number;
}

export function resolveApuPhaseStep(out: ApuPhaseStep, rateStepQ16Word: number, sourceSampleRateHz: number): void {
	const signedRateStep = toSignedWord(rateStepQ16Word);
	const negative = signedRateStep < 0;
	const magnitude = negative ? -signedRateStep : signedRateStep;
	const sampleRate = sourceSampleRateHz >>> 0;
	const lhsLow = magnitude % U16_BASE;
	const lhsHigh = (magnitude - lhsLow) / U16_BASE;
	const rhsLow = sampleRate % U16_BASE;
	const rhsHigh = (sampleRate - rhsLow) / U16_BASE;

	let product = lhsLow * rhsLow;
	const limb0 = product % U16_BASE;
	let carry = (product - limb0) / U16_BASE;
	product = lhsLow * rhsHigh + lhsHigh * rhsLow + carry;
	const limb1 = product % U16_BASE;
	carry = (product - limb1) / U16_BASE;
	product = lhsHigh * rhsHigh + carry;
	const limb2 = product % U16_BASE;
	const limb3 = (product - limb2) / U16_BASE;

	let dividend = limb3;
	const quotient3 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	let remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb2;
	const quotient2 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb1;
	const quotient1 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb0;
	const quotient0 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;

	const wholeQ16 = quotient0 + quotient1 * U16_BASE + quotient2 * U16_BASE_SQUARED + quotient3 * U16_BASE_CUBED;
	out.wholeQ16 = negative ? -wholeQ16 : wholeQ16;
	out.remainder = negative ? -remainder : remainder;
}
