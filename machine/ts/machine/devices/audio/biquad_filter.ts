import { highSignedHalfword, lowSignedHalfword, shiftRightSigned, wrapI32 } from '../../common/numeric';
import {
	APU_FILTER_COEFFICIENT_FRACTION_BITS,
	APU_FILTER_COEFFICIENT_ONE,
	APU_FILTER_CONTROL_ENABLE,
} from '../../../spec/audio/apu';

function saturateFilterSample(value: number): number {
	if (value < -0x8000) {
		return -0x8000;
	}
	if (value > 0x7fff) {
		return 0x7fff;
	}
	return value;
}

export class BiquadFilterState {
	public enabled = false;
	public b0 = APU_FILTER_COEFFICIENT_ONE;
	public b1 = 0;
	public b2 = 0;
	public a1 = 0;
	public a2 = 0;
	public l1 = 0;
	public l2 = 0;
	public r1 = 0;
	public r2 = 0;
	public outputLeft = 0;
	public outputRight = 0;

	public reset(): void {
		this.enabled = false;
		this.b0 = APU_FILTER_COEFFICIENT_ONE;
		this.b1 = 0;
		this.b2 = 0;
		this.a1 = 0;
		this.a2 = 0;
		this.l1 = 0;
		this.l2 = 0;
		this.r1 = 0;
		this.r2 = 0;
		this.outputLeft = 0;
		this.outputRight = 0;
	}

	public processStereo(left: number, right: number): void {
		const outputL = shiftRightSigned(this.b0 * left + this.l1, APU_FILTER_COEFFICIENT_FRACTION_BITS);
		const outputR = shiftRightSigned(this.b0 * right + this.r1, APU_FILTER_COEFFICIENT_FRACTION_BITS);
		this.l1 = wrapI32(this.b1 * left - this.a1 * outputL + this.l2);
		this.l2 = wrapI32(this.b2 * left - this.a2 * outputL);
		this.r1 = wrapI32(this.b1 * right - this.a1 * outputR + this.r2);
		this.r2 = wrapI32(this.b2 * right - this.a2 * outputR);
		this.outputLeft = saturateFilterSample(outputL);
		this.outputRight = saturateFilterSample(outputR);
	}
}

export function configureBiquadFilter(
	state: BiquadFilterState,
	controlWord: number,
	b0B1Word: number,
	b2A1Word: number,
	a2Word: number,
): void {
	state.enabled = (controlWord & APU_FILTER_CONTROL_ENABLE) !== 0;
	state.b0 = lowSignedHalfword(b0B1Word);
	state.b1 = highSignedHalfword(b0B1Word);
	state.b2 = lowSignedHalfword(b2A1Word);
	state.a1 = highSignedHalfword(b2A1Word);
	state.a2 = lowSignedHalfword(a2Word);
}
