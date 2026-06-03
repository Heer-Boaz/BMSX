import { VDP_MFU_WEIGHT_COUNT } from './contracts';

export const VDP_MFU_PACKET_KIND = 0x14000000;

export class VdpMfuUnit {
	public readonly weightWords = new Uint32Array(VDP_MFU_WEIGHT_COUNT);

	public reset(): void {
		for (let index = 0; index < VDP_MFU_WEIGHT_COUNT; index += 1) {
			this.weightWords[index] = 0;
		}
	}
}
