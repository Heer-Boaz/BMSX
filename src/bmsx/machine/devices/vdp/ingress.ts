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

	public writeBytes(bytes: Uint8Array): number {
		for (let index = 0; index < bytes.byteLength; index += 1) {
			this.fifoWordScratch[this.fifoWordByteCount] = bytes[index]!;
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
		return {
			dmaSubmitActive: this.dmaSubmitActive,
			fifoWordScratch: Array.from(this.fifoWordScratch),
			fifoWordByteCount: this.fifoWordByteCount,
			fifoStreamWords: Array.from(this.fifoStreamWords.subarray(0, this.fifoStreamWordCount)),
			fifoStreamWordCount: this.fifoStreamWordCount,
		};
	}

	public restoreState(state: VdpStreamIngressState): void {
		this.dmaSubmitActive = state.dmaSubmitActive;
		this.fifoWordScratch.set(state.fifoWordScratch);
		this.fifoWordByteCount = state.fifoWordByteCount;
		this.fifoStreamWords.set(state.fifoStreamWords);
		this.fifoStreamWordCount = state.fifoStreamWordCount;
	}
}
