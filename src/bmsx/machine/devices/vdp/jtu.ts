import {
	VDP_JTU_MATRIX_COUNT,
	VDP_JTU_MATRIX_WORDS,
	VDP_JTU_REGISTER_WORDS,
} from './contracts';
import { setIdentityMatrixWordsAt } from './matrix_words';

export const VDP_JTU_PACKET_KIND = 0x15000000;

export class VdpJtuUnit {
	public readonly matrixWords = new Uint32Array(VDP_JTU_REGISTER_WORDS);

	public constructor() {
		this.reset();
	}

	public reset(): void {
		for (let matrixIndex = 0; matrixIndex < VDP_JTU_MATRIX_COUNT; matrixIndex += 1) {
			setIdentityMatrixWordsAt(this.matrixWords, matrixIndex * VDP_JTU_MATRIX_WORDS);
		}
	}
}
