import { VDP_STREAM_CAPACITY_WORDS } from '../../memory/map';

export type VdpStreamIngressState = {
	dmaSubmitActive: boolean;
	fifoWordScratch: number[];
	fifoWordByteCount: number;
	fifoStreamWords: number[];
	fifoStreamWordCount: number;
};

export class VdpStreamIngressUnit {
	public dmaSubmitActive = false;
	public readonly fifoWordScratch = new Uint8Array(4);
	public fifoWordByteCount = 0;
	public readonly fifoStreamWords = new Uint32Array(VDP_STREAM_CAPACITY_WORDS);
	public fifoStreamWordCount = 0;

	public reset(): void {
		this.fifoWordByteCount = 0;
		this.fifoStreamWordCount = 0;
		this.dmaSubmitActive = false;
	}

	public beginDmaSubmit(): void {
		this.dmaSubmitActive = true;
	}

	public endDmaSubmit(): void {
		this.dmaSubmitActive = false;
	}

	public hasOpenDirectFifoIngress(): boolean {
		return this.fifoWordByteCount !== 0 || this.fifoStreamWordCount !== 0;
	}

	public pushWord(word: number): number {
		if (this.fifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
			return this.fifoStreamWordCount + 1;
		}
		this.fifoStreamWords[this.fifoStreamWordCount] = word >>> 0;
		this.fifoStreamWordCount += 1;
		return 0;
	}

	public writeBytes(data: Uint8Array, length = data.byteLength): number {
		for (let index = 0; index < length; index += 1) {
			this.fifoWordScratch[this.fifoWordByteCount] = data[index]!;
			this.fifoWordByteCount += 1;
			if (this.fifoWordByteCount !== 4) {
				continue;
			}
			const word = (
				this.fifoWordScratch[0]
				| (this.fifoWordScratch[1] << 8)
				| (this.fifoWordScratch[2] << 16)
				| (this.fifoWordScratch[3] << 24)
			) >>> 0;
			this.fifoWordByteCount = 0;
			const overflowDetail = this.pushWord(word);
			if (overflowDetail !== 0) {
				return overflowDetail;
			}
		}
		return 0;
	}

	public captureState(): VdpStreamIngressState {
		const fifoWordScratch = [0, 0, 0, 0];
		for (let index = 0; index < this.fifoWordScratch.length; index += 1) {
			fifoWordScratch[index] = this.fifoWordScratch[index]!;
		}
		const fifoStreamWords: number[] = [];
		for (let index = 0; index < this.fifoStreamWordCount; index += 1) {
			fifoStreamWords[index] = this.fifoStreamWords[index]!;
		}
		return {
			dmaSubmitActive: this.dmaSubmitActive,
			fifoWordScratch,
			fifoWordByteCount: this.fifoWordByteCount,
			fifoStreamWords,
			fifoStreamWordCount: this.fifoStreamWordCount,
		};
	}

	public restoreState(state: VdpStreamIngressState): void {
		this.dmaSubmitActive = state.dmaSubmitActive;
		for (let index = 0; index < this.fifoWordScratch.length; index += 1) {
			this.fifoWordScratch[index] = state.fifoWordScratch[index]!;
		}
		this.fifoWordByteCount = state.fifoWordByteCount;
		for (let index = 0; index < state.fifoStreamWordCount; index += 1) {
			this.fifoStreamWords[index] = state.fifoStreamWords[index]!;
		}
		this.fifoStreamWordCount = state.fifoStreamWordCount;
	}
}
