import { readI16LE } from '../../../common/endian';

export const APU_PCM_SAMPLE_SCALE = 1 / 32768;

export function readApuPcmSample(bytes: Uint8Array, dataOffset: number, is16Bit: boolean, sampleIndex: number): number {
	if (is16Bit) {
		return readI16LE(bytes, dataOffset + sampleIndex * 2);
	}
	return (bytes[dataOffset + sampleIndex]! - 128) << 8;
}
