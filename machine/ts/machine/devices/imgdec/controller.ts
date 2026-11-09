import {
	DMA_REQUEST_IMGDEC_READ, DMA_REQUEST_IMGDEC_WRITE, IO_IMGDEC_CONFIG_ADDRS,
	IO_IMGDEC_CONTROL, IO_IMGDEC_DATA, IO_IMGDEC_DECODED_WORD_COUNT,
	IO_IMGDEC_INPUT_WORD_COUNT, IO_IMGDEC_INPUT_WORDS_RECEIVED,
	IO_IMGDEC_OUTPUT_WORD_COUNT, IO_IMGDEC_STATUS, IRQ_IMGDEC,
} from '../../../spec/bmsx/io';
import {
	IMGDEC_CONTROL_START, IMGDEC_INPUT_FIFO_WORD_CAPACITY, IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY,
	IMGDEC_STATUS_BUSY, IMGDEC_STATUS_DONE, IMGDEC_STATUS_FORMAT_FAULT,
	IMGDEC_STATUS_INPUT_REQUEST, IMGDEC_STATUS_OUTPUT_REQUEST,
} from '../../../spec/imgdec/registers';
import {
	IMGDEC_HISTORY_WORD_CAPACITY, IMGDEC_HISTORY_WORD_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK, IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT, IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH,
	IMGDEC_TOKEN_KIND_BACK_REFERENCE, IMGDEC_TOKEN_KIND_LITERAL, IMGDEC_TOKEN_KIND_REPEAT,
	IMGDEC_TOKEN_KIND_SHIFT, IMGDEC_TOKEN_KIND_ZERO, IMGDEC_TOKEN_RUN_LENGTH_MASK,
} from '../../../spec/imgdec/stream';
import type { CPU } from '../../cpu/cpu';
import type { Memory } from '../../memory/memory';
import { MAPPED_BUS_DMA_BLOCK_END, MAPPED_BUS_MASTER_DMA, type MappedBusSignals } from '../../memory/bus_signals';
import { DEVICE_SERVICE_IMGDEC, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import type { IrqController } from '../irq/controller';
import { WordFifo } from '../word_fifo';

const DECODE_TOKEN = 0;
const DECODE_LITERAL = 1;
const DECODE_REPEAT_WORD = 2;
const DECODE_REPEAT = 3;
const DECODE_BACK_REFERENCE = 4;
const DECODE_ZERO = 5;
const BLOCK_FILLING = 0;
const BLOCK_DECODING = 1;
const BLOCK_READY = 2;

export type ImgDecControllerState = {
	inputWordCountWord: number;
	outputWordCountWord: number;
	controlWord: number;
	statusWord: number;
	dataWord: number;
	inputWordsReceived: number;
	decodedWordCount: number;
	outputWordsRead: number;
	decodePhase: number;
	runWordsRemaining: number;
	repeatWord: number;
	backReferenceDistance: number;
	blockPhase: number;
	blockReadIndex: number;
	blockCyclesRemaining: number;
	supervisorQuiesceRequested: boolean;
	inputWords: number[];
	blockWords: number[];
	historyWords: number[];
};

export class ImgDecController {
	private readonly inputFifo = new WordFifo(IMGDEC_INPUT_FIFO_WORD_CAPACITY);
	private readonly block = new Uint32Array(IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY);
	private readonly history = new Uint32Array(IMGDEC_HISTORY_WORD_CAPACITY);
	private historyWriteIndex = 0;
	private historyWordCount = 0;
	private inputWordCountWord = 0;
	private outputWordCountWord = 0;
	private controlWord = 0;
	private statusWord = 0;
	private dataWord = 0;
	private inputWordsReceived = 0;
	private decodedWordCount = 0;
	private outputWordsRead = 0;
	private decodePhase = DECODE_TOKEN;
	private runWordsRemaining = 0;
	private repeatWord = 0;
	private backReferenceDistance = 0;
	private blockPhase = BLOCK_FILLING;
	private blockWordCount = 0;
	private blockReadIndex = 0;
	private blockDeadline = -1;
	private supervisorQuiesceRequested = false;

	public constructor(private readonly memory: Memory, private readonly cpu: CPU,
		private readonly irq: IrqController, private readonly scheduler: DeviceScheduler,
		private readonly dma: DmaController, private readonly cyclesPerOutputWord: number) {
		memory.mapIoRead(IO_IMGDEC_INPUT_WORDS_RECEIVED, this, ImgDecController.readProgressThunk);
		memory.mapIoRead(IO_IMGDEC_DECODED_WORD_COUNT, this, ImgDecController.readProgressThunk);
		for (const address of IO_IMGDEC_CONFIG_ADDRS) {
			memory.mapIoWrite(address, this, ImgDecController.writeConfigThunk);
			memory.mapIoWriteReady(address, ImgDecController.configWriteReadyThunk);
		}
		memory.mapIoRead(IO_IMGDEC_DATA, this, ImgDecController.readDataThunk);
		memory.mapIoWrite(IO_IMGDEC_DATA, this, ImgDecController.writeDataThunk);
		memory.mapIoWriteReady(IO_IMGDEC_DATA, ImgDecController.dataWriteReadyThunk);
		memory.mapIoDmaReadPrefix(IO_IMGDEC_DATA, ImgDecController.readDataPrefixThunk);
		memory.mapIoDmaWritePrefix(IO_IMGDEC_DATA, ImgDecController.writeDataPrefixThunk);
	}

	private resetStreamState(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.inputFifo.reset();
		this.historyWriteIndex = this.historyWordCount = 0;
		this.inputWordsReceived = this.decodedWordCount = this.outputWordsRead = 0;
		this.decodePhase = DECODE_TOKEN;
		this.runWordsRemaining = this.repeatWord = this.backReferenceDistance = 0;
		this.blockPhase = BLOCK_FILLING;
		this.blockWordCount = this.blockReadIndex = 0;
		this.blockDeadline = -1;
		this.dataWord = 0;
	}

	public reset(): void {
		this.resetStreamState();
		this.supervisorQuiesceRequested = false;
		this.inputWordCountWord = this.outputWordCountWord = 0;
		this.controlWord = this.statusWord = 0;
		this.mirrorRegisters();
		this.updateDmaRequests();
	}

	public captureState(): ImgDecControllerState {
		const historyWords = new Array<number>(this.historyWordCount);
		const start = (this.historyWriteIndex - this.historyWordCount) & IMGDEC_HISTORY_WORD_MASK;
		for (let i = 0; i < this.historyWordCount; ++i) historyWords[i] = this.history[(start + i) & IMGDEC_HISTORY_WORD_MASK];
		return {
			inputWordCountWord: this.inputWordCountWord, outputWordCountWord: this.outputWordCountWord,
			controlWord: this.controlWord, statusWord: this.statusWord, dataWord: this.dataWord,
			inputWordsReceived: this.inputWordsReceived, decodedWordCount: this.decodedWordCount,
			outputWordsRead: this.outputWordsRead, decodePhase: this.decodePhase,
			runWordsRemaining: this.runWordsRemaining, repeatWord: this.repeatWord,
			backReferenceDistance: this.backReferenceDistance, blockPhase: this.blockPhase,
			blockReadIndex: this.blockReadIndex,
			blockCyclesRemaining: this.blockPhase === BLOCK_DECODING ? this.blockDeadline - this.scheduler.currentNowCycles() : 0,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			inputWords: this.inputFifo.captureWords(), blockWords: Array.from(this.block.subarray(0, this.blockWordCount)), historyWords,
		};
	}

	public restoreState(state: ImgDecControllerState): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.inputWordCountWord = state.inputWordCountWord;
		this.outputWordCountWord = state.outputWordCountWord;
		this.controlWord = state.controlWord;
		this.statusWord = state.statusWord;
		this.dataWord = state.dataWord;
		this.inputWordsReceived = state.inputWordsReceived;
		this.decodedWordCount = state.decodedWordCount;
		this.outputWordsRead = state.outputWordsRead;
		this.decodePhase = state.decodePhase;
		this.runWordsRemaining = state.runWordsRemaining;
		this.repeatWord = state.repeatWord;
		this.backReferenceDistance = state.backReferenceDistance;
		this.blockPhase = state.blockPhase;
		this.blockReadIndex = state.blockReadIndex;
		this.blockWordCount = state.blockWords.length;
		this.block.set(state.blockWords);
		this.inputFifo.restoreWords(state.inputWords);
		this.historyWordCount = state.historyWords.length;
		this.historyWriteIndex = this.historyWordCount & IMGDEC_HISTORY_WORD_MASK;
		this.history.set(state.historyWords);
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.blockDeadline = this.blockPhase === BLOCK_DECODING ? this.scheduler.currentNowCycles() + state.blockCyclesRemaining : -1;
		this.mirrorRegisters();
		this.updateDmaRequests();
		if (this.blockPhase === BLOCK_DECODING) this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.blockDeadline);
	}

	public supervisorQuiescent(): boolean {
		return this.supervisorQuiesceRequested && this.blockPhase !== BLOCK_DECODING;
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.updateDmaRequests();
		this.notifySupervisorBoundary();
	}

	public leaveSupervisorContext(): void {
		this.supervisorQuiesceRequested = false;
		this.execute(this.scheduler.currentNowCycles());
		this.updateDmaRequests();
		this.resumeConfigWrites();
	}

	private start(): void {
		this.resetStreamState();
		this.controlWord = (this.controlWord & ~IMGDEC_CONTROL_START) >>> 0;
		this.statusWord = IMGDEC_STATUS_BUSY;
		this.mirrorRegisters();
		this.execute(this.scheduler.currentNowCycles());
		this.updateDmaRequests();
	}

	public onService(nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		if (this.blockPhase === BLOCK_DECODING && nowCycles >= this.blockDeadline) {
			this.blockPhase = BLOCK_READY;
			this.blockDeadline = -1;
			this.decodedWordCount = (this.decodedWordCount + this.blockWordCount) >>> 0;
		}
		this.updateDmaRequests();
		this.notifySupervisorBoundary();
	}

	private execute(nowCycles: number): void {
		if ((this.statusWord & IMGDEC_STATUS_BUSY) === 0 || this.supervisorQuiesceRequested || this.blockPhase === BLOCK_DECODING) return;
		if (this.blockPhase === BLOCK_READY) {
			if (this.blockReadIndex !== this.blockWordCount) return;
			this.blockPhase = BLOCK_FILLING;
			this.blockWordCount = this.blockReadIndex = 0;
		}
		const remaining = (this.outputWordCountWord - this.decodedWordCount) >>> 0;
		if (remaining === 0) {
			if (!this.inputFifo.empty() || this.decodePhase !== DECODE_TOKEN) this.stop(IMGDEC_STATUS_FORMAT_FAULT);
			else if (this.inputWordsReceived === this.inputWordCountWord) this.stop(IMGDEC_STATUS_DONE);
			return;
		}
		const target = Math.min(remaining, IMGDEC_OUTPUT_BLOCK_WORD_CAPACITY);
		while (this.blockWordCount < target) {
			if (this.decodePhase === DECODE_TOKEN || this.decodePhase === DECODE_REPEAT_WORD) {
				if (this.inputFifo.empty()) break;
				const word = this.inputFifo.pop();
				if (this.decodePhase === DECODE_REPEAT_WORD) {
					this.repeatWord = word;
					this.decodePhase = DECODE_REPEAT;
					continue;
				}
				this.runWordsRemaining = (word & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1;
				switch (word >>> IMGDEC_TOKEN_KIND_SHIFT) {
					case IMGDEC_TOKEN_KIND_LITERAL: this.decodePhase = DECODE_LITERAL; break;
					case IMGDEC_TOKEN_KIND_REPEAT: this.decodePhase = DECODE_REPEAT_WORD; break;
					case IMGDEC_TOKEN_KIND_ZERO: this.decodePhase = DECODE_ZERO; break;
					case IMGDEC_TOKEN_KIND_BACK_REFERENCE:
						this.runWordsRemaining = ((word >>> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT) & IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK) + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH;
						this.backReferenceDistance = (word & IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK) + 1;
						if (this.backReferenceDistance > this.historyWordCount) { this.stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
						this.decodePhase = DECODE_BACK_REFERENCE;
						break;
				}
				if (this.runWordsRemaining > remaining - this.blockWordCount) { this.stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
				continue;
			}
			let words = Math.min(this.runWordsRemaining, target - this.blockWordCount);
			if (this.decodePhase === DECODE_LITERAL) words = Math.min(words, this.inputFifo.count());
			if (words === 0) break;
			this.preparePayloadWords(words);
			this.runWordsRemaining -= words;
			if (this.runWordsRemaining === 0) this.decodePhase = DECODE_TOKEN;
		}
		if (this.blockWordCount !== target) {
			if (this.inputWordsReceived === this.inputWordCountWord) this.stop(IMGDEC_STATUS_FORMAT_FAULT);
			return;
		}
		// The last block is published only after the complete input is accounted for.
		if (target === remaining) {
			if (!this.inputFifo.empty() || this.decodePhase !== DECODE_TOKEN) { this.stop(IMGDEC_STATUS_FORMAT_FAULT); return; }
			if (this.inputWordsReceived !== this.inputWordCountWord) return;
		}
		this.blockPhase = BLOCK_DECODING;
		this.blockDeadline = nowCycles + target * this.cyclesPerOutputWord;
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.blockDeadline);
	}

	private preparePayloadWords(count: number): void {
		let remaining = count;
		const history = this.history;
		while (remaining !== 0) {
			const start = this.historyWriteIndex;
			const words = Math.min(remaining, IMGDEC_HISTORY_WORD_CAPACITY - start);
			switch (this.decodePhase) {
				case DECODE_LITERAL: this.inputFifo.readWords(history, start, words); break;
				case DECODE_REPEAT: history.fill(this.repeatWord, start, start + words); break;
				case DECODE_ZERO: history.fill(0, start, start + words); break;
				case DECODE_BACK_REFERENCE:
					for (let i = 0; i < words; ++i) history[start + i] = history[(start + i - this.backReferenceDistance) & IMGDEC_HISTORY_WORD_MASK];
					break;
			}
			for (let i = 0; i < words; ++i) this.block[this.blockWordCount + i] = history[start + i];
			this.blockWordCount += words;
			this.historyWriteIndex = (start + words) & IMGDEC_HISTORY_WORD_MASK;
			remaining -= words;
		}
		this.historyWordCount = Math.min(IMGDEC_HISTORY_WORD_CAPACITY, this.historyWordCount + count);
	}

	private updateDmaRequests(): void {
		const running = (this.statusWord & IMGDEC_STATUS_BUSY) !== 0 && !this.supervisorQuiesceRequested;
		const inputRemaining = (this.inputWordCountWord - this.inputWordsReceived) >>> 0;
		const inputWords = running ? Math.min(inputRemaining, this.inputFifo.free()) : 0;
		const outputWords = running && this.blockPhase === BLOCK_READY ? this.blockWordCount - this.blockReadIndex : 0;
		this.dma.setRequestWordCapacity(DMA_REQUEST_IMGDEC_WRITE, inputWords);
		this.dma.setRequestWordCapacity(DMA_REQUEST_IMGDEC_READ, outputWords);
		const status = (this.statusWord & ~(IMGDEC_STATUS_INPUT_REQUEST | IMGDEC_STATUS_OUTPUT_REQUEST))
			| (inputWords !== 0 ? IMGDEC_STATUS_INPUT_REQUEST : 0) | (outputWords !== 0 ? IMGDEC_STATUS_OUTPUT_REQUEST : 0);
		if (status !== this.statusWord) { this.statusWord = status; this.memory.writeIoU32(IO_IMGDEC_STATUS, status); }
		if (inputWords !== 0 && !this.dma.ownsWritePort(IO_IMGDEC_DATA)) this.cpu.resumeMemoryWrite(IO_IMGDEC_DATA);
	}

	private stop(status: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.statusWord = status;
		this.blockPhase = BLOCK_FILLING;
		this.blockWordCount = this.blockReadIndex = 0;
		this.blockDeadline = -1;
		this.memory.writeIoU32(IO_IMGDEC_STATUS, status);
		this.updateDmaRequests();
		this.resumeConfigWrites();
		this.irq.raise(IRQ_IMGDEC);
		this.notifySupervisorBoundary();
	}

	private resumeConfigWrites(): void {
		for (const address of IO_IMGDEC_CONFIG_ADDRS) this.cpu.resumeMemoryWrite(address);
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiescent()) this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
	}

	private static readProgressThunk(c: ImgDecController, address: number): number {
		return address === IO_IMGDEC_INPUT_WORDS_RECEIVED ? c.inputWordsReceived : c.decodedWordCount;
	}

	private static writeConfigThunk(c: ImgDecController, address: number, value: number): void {
		switch (address) {
			case IO_IMGDEC_INPUT_WORD_COUNT: c.inputWordCountWord = value; break;
			case IO_IMGDEC_OUTPUT_WORD_COUNT: c.outputWordCountWord = value; break;
			case IO_IMGDEC_CONTROL:
				c.controlWord = value;
				if ((value & IMGDEC_CONTROL_START) !== 0) c.start();
				break;
		}
	}

	private static configWriteReadyThunk(c: ImgDecController): boolean {
		return (c.statusWord & IMGDEC_STATUS_BUSY) === 0 && !c.supervisorQuiesceRequested;
	}

	private static readDataPrefixThunk(c: ImgDecController, _address: number, words: Uint32Array, count: number): void {
		const available = c.blockPhase === BLOCK_READY ? Math.min(count, c.blockWordCount - c.blockReadIndex) : 0;
		for (let i = 0; i < available; ++i) words[i] = c.block[c.blockReadIndex + i];
		c.blockReadIndex += available;
		c.outputWordsRead = (c.outputWordsRead + available) >>> 0;
		if (available !== 0) { c.dataWord = words[available - 1]; c.memory.writeIoU32(IO_IMGDEC_DATA, c.dataWord); }
		words.fill(c.dataWord, available, count);
	}

	private static writeDataPrefixThunk(c: ImgDecController, _address: number, words: Uint32Array, count: number): void {
		c.inputFifo.writeWords(words, 0, Math.min(count, c.inputFifo.free()));
		c.dataWord = words[count - 1];
		c.inputWordsReceived = (c.inputWordsReceived + count) >>> 0;
		c.memory.writeIoU32(IO_IMGDEC_DATA, c.dataWord);
	}

	private static readDataThunk(c: ImgDecController, _address: number, signals: MappedBusSignals): number {
		const dmaRead = (signals & MAPPED_BUS_MASTER_DMA) !== 0;
		if (!dmaRead && c.dma.ownsReadPort(IO_IMGDEC_DATA)) return c.dataWord;
		if (c.blockPhase === BLOCK_READY && c.blockReadIndex !== c.blockWordCount) {
			c.dataWord = c.block[c.blockReadIndex++];
			c.outputWordsRead = (c.outputWordsRead + 1) >>> 0;
			c.memory.writeIoU32(IO_IMGDEC_DATA, c.dataWord);
		}
		const word = c.dataWord;
		if (!dmaRead || (signals & MAPPED_BUS_DMA_BLOCK_END) !== 0) { c.execute(c.scheduler.currentNowCycles()); c.updateDmaRequests(); }
		return word;
	}

	private static writeDataThunk(c: ImgDecController, _address: number, word: number, signals: MappedBusSignals): void {
		c.dataWord = word;
		if (!c.inputFifo.full()) c.inputFifo.writeWord(word);
		c.inputWordsReceived = (c.inputWordsReceived + 1) >>> 0;
		if ((signals & MAPPED_BUS_MASTER_DMA) === 0 || (signals & MAPPED_BUS_DMA_BLOCK_END) !== 0) { c.execute(c.scheduler.currentNowCycles()); c.updateDmaRequests(); }
	}

	private static dataWriteReadyThunk(c: ImgDecController, _address: number, signals: MappedBusSignals): boolean {
		if ((signals & MAPPED_BUS_MASTER_DMA) !== 0) return true;
		return (c.statusWord & IMGDEC_STATUS_BUSY) !== 0 && !c.supervisorQuiesceRequested
			&& c.inputWordsReceived < c.inputWordCountWord && !c.inputFifo.full() && !c.dma.ownsWritePort(IO_IMGDEC_DATA);
	}

	private mirrorRegisters(): void {
		this.memory.writeIoU32(IO_IMGDEC_INPUT_WORD_COUNT, this.inputWordCountWord);
		this.memory.writeIoU32(IO_IMGDEC_OUTPUT_WORD_COUNT, this.outputWordCountWord);
		this.memory.writeIoU32(IO_IMGDEC_CONTROL, this.controlWord);
		this.memory.writeIoU32(IO_IMGDEC_STATUS, this.statusWord);
		this.memory.writeIoU32(IO_IMGDEC_DATA, this.dataWord);
	}
}
