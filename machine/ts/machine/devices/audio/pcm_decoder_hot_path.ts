import { readI16LE } from '../../../common/endian';
import { APU_RATE_STEP_Q16_ONE } from '../../../spec/audio/apu';

export function readApuPcmSample(bytes: Uint8Array, dataOffset: number, is16Bit: boolean, sampleIndex: number): number {
	if (is16Bit) {
		return readI16LE(bytes, dataOffset + sampleIndex * 2);
	}
	return (bytes[dataOffset + sampleIndex]! - 128) << 8;
}

export function interpolateApuPcmSample(first: number, second: number, fractionQ16: number): number {
	const deltaQ16 = (second - first) * fractionQ16;
	const remainderQ16 = deltaQ16 % APU_RATE_STEP_Q16_ONE;
	const scaledDelta = (deltaQ16 - remainderQ16) / APU_RATE_STEP_Q16_ONE;
	return first + (remainderQ16 < 0 ? scaledDelta - 1 : scaledDelta);
}
