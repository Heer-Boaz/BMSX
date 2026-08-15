import {
	DMA_REQUEST_IMGDEC_READ,
	DMA_REQUEST_IMGDEC_WRITE,
	IO_IMGDEC_CLUT_DESTINATION,
	IO_IMGDEC_CONFIG_ADDRS,
	IO_IMGDEC_CONTROL,
	IO_IMGDEC_DATA,
	IO_IMGDEC_DECODED_WORD_COUNT,
	IO_IMGDEC_INPUT_WORD_COUNT,
	IO_IMGDEC_INPUT_WORDS_RECEIVED,
	IO_IMGDEC_STATUS,
	IO_IMGDEC_TEXTURE_DESTINATION,
	IO_IMGDEC_TEXTURE_SIZE,
	IRQ_IMGDEC,
} from '../../../spec/bmsx/io';
import type { CPU } from '../../cpu/cpu';
import {
	MAPPED_BUS_DMA_BLOCK_END,
	MAPPED_BUS_MASTER_DMA,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { Memory } from '../../memory/memory';
import { DEVICE_SERVICE_IMGDEC, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import { WordFifo } from '../word_fifo';
import {
	GX_GPU_CLUT_4BIT_SIZE_WORD,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
} from '../../../spec/gx/gp0';
import type { IrqController } from '../irq/controller';
import {
	IMGDEC_CONTROL_START,
	IMGDEC_DMA_BLOCK_WORDS,
	IMGDEC_INPUT_FIFO_WORD_CAPACITY,
	IMGDEC_OUTPUT_FIFO_WORD_CAPACITY,
	IMGDEC_STATUS_BUSY,
	IMGDEC_STATUS_DONE,
	IMGDEC_STATUS_FORMAT_FAULT,
	IMGDEC_STATUS_INPUT_REQUEST,
	IMGDEC_STATUS_OUTPUT_REQUEST,
} from '../../../spec/imgdec/registers';
import {
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_HISTORY_WORD_MASK,
	IMGDEC_STREAM_MAGIC,
	IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT,
	IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH,
	IMGDEC_TOKEN_KIND_BACK_REFERENCE,
	IMGDEC_TOKEN_KIND_LITERAL,
	IMGDEC_TOKEN_KIND_REPEAT,
	IMGDEC_TOKEN_KIND_SHIFT,
	IMGDEC_TOKEN_KIND_ZERO,
	IMGDEC_TOKEN_RUN_LENGTH_MASK,
} from '../../../spec/imgdec/stream';

export const IMGDEC_DECODE_BATCH_WORDS = 16;

const DECODE_MAGIC = 0;
const DECODE_TEXTURE_WORD_COUNT = 1;
const DECODE_CLUT_WORD_COUNT = 2;
const DECODE_TOKEN = 3;
const DECODE_LITERAL = 4;
const DECODE_REPEAT_WORD = 5;
const DECODE_REPEAT = 6;
const DECODE_BACK_REFERENCE = 7;
const DECODE_ZERO = 8;

const OUTPUT_TEXTURE_HEADER = 0;
const OUTPUT_TEXTURE_PAYLOAD = 1;
const OUTPUT_CLUT_HEADER = 2;
const OUTPUT_CLUT_PAYLOAD = 3;
const OUTPUT_COMPLETE = 4;

export type ImgDecControllerState = {
	inputWordCountWord: number;
	textureDestinationWord: number;
	textureSizeWord: number;
	clutDestinationWord: number;
	controlWord: number;
	statusWord: number;
	dataWord: number;
	inputWordsReceived: number;
	decodedWordCount: number;
	textureWordCount: number;
	clutWordCount: number;
	outputWordsRead: number;
	decodePhase: number;
	outputStage: number;
	runWordsRemaining: number;
	repeatWord: number;
	backReferenceDistance: number;
	supervisorQuiesceRequested: boolean;
	inputWords: number[];
	outputWords: number[];
	historyWords: number[];
	scheduledDecodeWords: number;
	scheduledDecodeCycles: number;
};

export class ImgDecController {
	private readonly inputFifo = new WordFifo(IMGDEC_INPUT_FIFO_WORD_CAPACITY);
	private readonly outputFifo = new WordFifo(IMGDEC_OUTPUT_FIFO_WORD_CAPACITY);
	private readonly history = new Uint32Array(IMGDEC_HISTORY_WORD_CAPACITY);
	private historyWriteIndex = 0;
	private historyWordCount = 0;
	private active = false;
	private inputWordsReceived = 0;
	private decodedWordCount = 0;
	private textureWordCount = 0;
	private clutWordCount = 0;
	private outputWordCount = 0;
	private outputWordsRead = 0;
	private inputWordCountWord = 0;
	private textureDestinationWord = 0;
	private textureSizeWord = 0;
	private clutDestinationWord = 0;
	private controlWord = 0;
	private statusWord = 0;
	private dataWord = 0;
	private decodePhase = DECODE_MAGIC;
	private outputStage = OUTPUT_TEXTURE_HEADER;
	private runWordsRemaining = 0;
	private repeatWord = 0;
	private backReferenceDistance = 0;
	private supervisorQuiesceRequested = false;
	private scheduledDecodeWords = 0;
	private decodeDeadline = -1;

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
		private readonly dma: DmaController,
		private readonly cyclesPerOutputWord: number,
	) {
		this.memory.mapIoRead(IO_IMGDEC_INPUT_WORDS_RECEIVED, this, ImgDecController.readProgressThunk);
		this.memory.mapIoRead(IO_IMGDEC_DECODED_WORD_COUNT, this, ImgDecController.readProgressThunk);
		for (let index = 0; index < IO_IMGDEC_CONFIG_ADDRS.length; index += 1) {
			const address = IO_IMGDEC_CONFIG_ADDRS[index]!;
			this.memory.mapIoWrite(address, this, ImgDecController.writeConfigThunk);
			this.memory.mapIoWriteReady(address, ImgDecController.configWriteReadyThunk);
		}
		this.memory.mapIoRead(IO_IMGDEC_DATA, this, ImgDecController.readDataThunk);
		this.memory.mapIoWrite(IO_IMGDEC_DATA, this, ImgDecController.writeDataThunk);
		this.memory.mapIoWriteReady(IO_IMGDEC_DATA, ImgDecController.dataWriteReadyThunk);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.dma.setRequestLines((1 << DMA_REQUEST_IMGDEC_WRITE) | (1 << DMA_REQUEST_IMGDEC_READ), 0);
		this.resetStreamState();
		this.supervisorQuiesceRequested = false;
		this.inputWordCountWord = 0;
		this.textureDestinationWord = 0;
		this.textureSizeWord = 0;
		this.clutDestinationWord = 0;
		this.controlWord = 0;
		this.statusWord = 0;
		this.mirrorRegisters();
	}

	private resetStreamState(): void {
		this.inputFifo.reset();
		this.outputFifo.reset();
		this.historyWriteIndex = 0;
		this.historyWordCount = 0;
		this.active = false;
		this.inputWordsReceived = 0;
		this.decodedWordCount = 0;
		this.textureWordCount = 0;
		this.clutWordCount = 0;
		this.outputWordCount = 0;
		this.outputWordsRead = 0;
		this.dataWord = 0;
		this.decodePhase = DECODE_MAGIC;
		this.outputStage = OUTPUT_TEXTURE_HEADER;
		this.runWordsRemaining = 0;
		this.repeatWord = 0;
		this.backReferenceDistance = 0;
		this.scheduledDecodeWords = 0;
		this.decodeDeadline = -1;
	}

	public captureState(): ImgDecControllerState {
		const historyWords = new Array<number>(this.historyWordCount);
		const historyStart = (this.historyWriteIndex - this.historyWordCount) & IMGDEC_HISTORY_WORD_MASK;
		for (let index = 0; index < this.historyWordCount; index += 1) {
			historyWords[index] = this.history[(historyStart + index) & IMGDEC_HISTORY_WORD_MASK]!;
		}
		return {
			inputWordCountWord: this.inputWordCountWord,
			textureDestinationWord: this.textureDestinationWord,
			textureSizeWord: this.textureSizeWord,
			clutDestinationWord: this.clutDestinationWord,
			controlWord: this.controlWord,
			statusWord: this.statusWord,
			dataWord: this.dataWord,
			inputWordsReceived: this.inputWordsReceived,
			decodedWordCount: this.decodedWordCount,
			textureWordCount: this.textureWordCount,
			clutWordCount: this.clutWordCount,
			outputWordsRead: this.outputWordsRead,
			decodePhase: this.decodePhase,
			outputStage: this.outputStage,
			runWordsRemaining: this.runWordsRemaining,
			repeatWord: this.repeatWord,
			backReferenceDistance: this.backReferenceDistance,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			inputWords: this.inputFifo.captureWords(),
			outputWords: this.outputFifo.captureWords(),
			historyWords,
			scheduledDecodeWords: this.scheduledDecodeWords,
			scheduledDecodeCycles: this.scheduledDecodeWords === 0
				? 0
				: this.decodeDeadline - this.scheduler.currentNowCycles(),
		};
	}

	public restoreState(state: ImgDecControllerState): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.inputWordCountWord = state.inputWordCountWord;
		this.textureDestinationWord = state.textureDestinationWord;
		this.textureSizeWord = state.textureSizeWord;
		this.clutDestinationWord = state.clutDestinationWord;
		this.controlWord = state.controlWord;
		this.statusWord = state.statusWord;
		this.dataWord = state.dataWord;
		this.mirrorRegisters();
		this.inputWordsReceived = state.inputWordsReceived;
		this.decodedWordCount = state.decodedWordCount;
		this.textureWordCount = state.textureWordCount;
		this.clutWordCount = state.clutWordCount;
		this.outputWordCount = state.decodePhase <= DECODE_CLUT_WORD_COUNT
			? 0
			: (state.textureWordCount + 3 + (state.clutWordCount === 0 ? 0 : state.clutWordCount + 3)) >>> 0;
		this.outputWordsRead = state.outputWordsRead;
		this.decodePhase = state.decodePhase;
		this.outputStage = state.outputStage;
		this.runWordsRemaining = state.runWordsRemaining;
		this.repeatWord = state.repeatWord >>> 0;
		this.backReferenceDistance = state.backReferenceDistance;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.inputFifo.restoreWords(state.inputWords);
		this.outputFifo.restoreWords(state.outputWords);
		this.historyWriteIndex = state.historyWords.length & IMGDEC_HISTORY_WORD_MASK;
		this.historyWordCount = state.historyWords.length;
		for (let index = 0; index < state.historyWords.length; index += 1) {
			this.history[index] = state.historyWords[index]! >>> 0;
		}
		this.scheduledDecodeWords = state.scheduledDecodeWords;
		this.decodeDeadline = this.scheduledDecodeWords === 0
			? -1
			: this.scheduler.currentNowCycles() + state.scheduledDecodeCycles;
		this.active = (this.statusWord & IMGDEC_STATUS_BUSY) !== 0;
		this.updateDmaRequests();
		if (this.scheduledDecodeWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.decodeDeadline);
		}
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.updateDmaRequests();
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		return this.supervisorQuiesceRequested && this.scheduledDecodeWords === 0;
	}

	public leaveSupervisorContext(): void {
		this.supervisorQuiesceRequested = false;
		if (this.scheduleDecode(this.scheduler.currentNowCycles())) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.decodeDeadline);
		}
		this.updateDmaRequests();
		this.resumeConfigWrites();
	}

	public onService(nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		if (this.scheduledDecodeWords !== 0 && nowCycles >= this.decodeDeadline) {
			this.decodeScheduledWords();
		}
		if (this.active && !this.supervisorQuiesceRequested) {
			this.scheduleDecode(nowCycles);
		}
		this.updateDmaRequests();
		this.notifySupervisorBoundary();
		if (this.scheduledDecodeWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.decodeDeadline);
		}
	}

	private start(): void {
		this.resetStreamState();
		this.active = true;
		this.controlWord = (this.controlWord & ~IMGDEC_CONTROL_START) >>> 0;
		this.statusWord = IMGDEC_STATUS_BUSY;
		this.memory.writeIoU32(IO_IMGDEC_CONTROL, this.controlWord);
		this.memory.writeIoU32(IO_IMGDEC_STATUS, this.statusWord);
		this.memory.writeIoU32(IO_IMGDEC_DATA, this.dataWord);
		this.scheduleDecode(this.scheduler.currentNowCycles());
		this.updateDmaRequests();
	}

	private advanceOutputStage(): void {
		if (this.outputStage === OUTPUT_TEXTURE_PAYLOAD && this.decodedWordCount === this.textureWordCount) {
			this.outputStage = this.clutWordCount === 0 ? OUTPUT_COMPLETE : OUTPUT_CLUT_HEADER;
		}
		if (this.outputStage === OUTPUT_CLUT_PAYLOAD
			&& this.decodedWordCount === ((this.textureWordCount + this.clutWordCount) >>> 0)) {
			this.outputStage = OUTPUT_COMPLETE;
		}
	}

	private prepareDecodeRun(): void {
		while (this.active && (this.decodePhase === DECODE_TOKEN || this.decodePhase === DECODE_REPEAT_WORD)) {
			if (this.inputFifo.empty()) {
				this.failIfInputExhausted();
				return;
			}
			if (this.decodePhase === DECODE_REPEAT_WORD) {
				this.repeatWord = this.inputFifo.pop();
				this.decodePhase = DECODE_REPEAT;
				return;
			}
			const token = this.inputFifo.pop();
			this.runWordsRemaining = (token & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1;
			switch (token >>> IMGDEC_TOKEN_KIND_SHIFT) {
				case IMGDEC_TOKEN_KIND_LITERAL:
					this.decodePhase = DECODE_LITERAL;
					return;
				case IMGDEC_TOKEN_KIND_REPEAT:
					this.decodePhase = DECODE_REPEAT_WORD;
					break;
				case IMGDEC_TOKEN_KIND_BACK_REFERENCE:
					this.runWordsRemaining = ((token >>> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
						& IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK) + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH;
					this.backReferenceDistance = (token & IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK) + 1;
					if (this.backReferenceDistance > this.historyWordCount) {
						this.stop(IMGDEC_STATUS_FORMAT_FAULT);
						return;
					}
					this.decodePhase = DECODE_BACK_REFERENCE;
					return;
				case IMGDEC_TOKEN_KIND_ZERO:
					this.decodePhase = DECODE_ZERO;
					return;
			}
		}
	}

	private scheduleDecode(anchorCycle: number): boolean {
		if (!this.active || this.supervisorQuiesceRequested || this.scheduledDecodeWords !== 0) {
			return false;
		}
		while (this.decodePhase <= DECODE_CLUT_WORD_COUNT && !this.inputFifo.empty()) {
			const word = this.inputFifo.pop();
			if (this.decodePhase === DECODE_MAGIC) {
				if (word !== IMGDEC_STREAM_MAGIC) {
					this.stop(IMGDEC_STATUS_FORMAT_FAULT);
					return false;
				}
				this.decodePhase = DECODE_TEXTURE_WORD_COUNT;
			} else if (this.decodePhase === DECODE_TEXTURE_WORD_COUNT) {
				this.textureWordCount = word;
				this.decodePhase = DECODE_CLUT_WORD_COUNT;
			} else {
				this.clutWordCount = word;
				this.outputWordCount = (this.textureWordCount + 3
					+ (this.clutWordCount === 0 ? 0 : this.clutWordCount + 3)) >>> 0;
				this.decodePhase = DECODE_TOKEN;
			}
		}
		if (this.decodePhase <= DECODE_CLUT_WORD_COUNT) {
			this.failIfInputExhausted();
			return false;
		}
		this.advanceOutputStage();
		const outputFree = this.outputFifo.free();
		if (outputFree === 0) {
			return false;
		}
		if (this.outputStage === OUTPUT_TEXTURE_HEADER || this.outputStage === OUTPUT_CLUT_HEADER) {
			if (outputFree < 3) {
				return false;
			}
			this.scheduledDecodeWords = 3;
		} else if (this.outputStage === OUTPUT_COMPLETE) {
			if (!this.streamComplete()) {
				if (!this.inputFifo.empty() || this.decodePhase !== DECODE_TOKEN) {
					this.stop(IMGDEC_STATUS_FORMAT_FAULT);
				} else {
					this.failIfInputExhausted();
				}
			}
			return false;
		} else {
			this.prepareDecodeRun();
			if (!this.active || this.decodePhase === DECODE_TOKEN || this.decodePhase === DECODE_REPEAT_WORD) {
				return false;
			}
			const stageTarget = this.outputStage === OUTPUT_TEXTURE_PAYLOAD
				? this.textureWordCount
				: (this.textureWordCount + this.clutWordCount) >>> 0;
			const stageWordsRemaining = (stageTarget - this.decodedWordCount) >>> 0;
			let decodeWords = this.runWordsRemaining < stageWordsRemaining
				? this.runWordsRemaining
				: stageWordsRemaining;
			if (decodeWords > outputFree) decodeWords = outputFree;
			if (decodeWords > IMGDEC_DECODE_BATCH_WORDS) decodeWords = IMGDEC_DECODE_BATCH_WORDS;
			if (this.decodePhase === DECODE_LITERAL && decodeWords > this.inputFifo.count()) {
				decodeWords = this.inputFifo.count();
			}
			if (decodeWords === 0) {
				this.failIfInputExhausted();
				return false;
			}
			this.scheduledDecodeWords = decodeWords;
		}
		this.decodeDeadline = anchorCycle + this.scheduledDecodeWords * this.cyclesPerOutputWord;
		return true;
	}

	private decodeScheduledWords(): void {
		const decodeWords = this.scheduledDecodeWords;
		this.scheduledDecodeWords = 0;
		this.decodeDeadline = -1;
		if (this.outputStage === OUTPUT_TEXTURE_HEADER) {
			this.outputFifo.writeWord(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
			this.outputFifo.writeWord(this.textureDestinationWord);
			this.outputFifo.writeWord(this.textureSizeWord);
			this.outputStage = OUTPUT_TEXTURE_PAYLOAD;
			return;
		}
		if (this.outputStage === OUTPUT_CLUT_HEADER) {
			this.outputFifo.writeWord(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
			this.outputFifo.writeWord(this.clutDestinationWord);
			this.outputFifo.writeWord(GX_GPU_CLUT_4BIT_SIZE_WORD);
			this.outputStage = OUTPUT_CLUT_PAYLOAD;
			return;
		}
		switch (this.decodePhase) {
			case DECODE_LITERAL:
				for (let index = 0; index < decodeWords; index += 1) {
					this.emitPayloadWord(this.inputFifo.pop());
				}
				break;
			case DECODE_REPEAT:
				for (let index = 0; index < decodeWords; index += 1) {
					this.emitPayloadWord(this.repeatWord);
				}
				break;
			case DECODE_BACK_REFERENCE:
				for (let index = 0; index < decodeWords; index += 1) {
					this.emitPayloadWord(this.history[(this.historyWriteIndex - this.backReferenceDistance) & IMGDEC_HISTORY_WORD_MASK]!);
				}
				break;
			case DECODE_ZERO:
				for (let index = 0; index < decodeWords; index += 1) {
					this.emitPayloadWord(0);
				}
				break;
		}
		this.runWordsRemaining -= decodeWords;
		if (this.runWordsRemaining === 0) {
			this.decodePhase = DECODE_TOKEN;
		}
		this.advanceOutputStage();
	}

	private emitPayloadWord(word: number): void {
		this.outputFifo.writeWord(word);
		this.history[this.historyWriteIndex] = word >>> 0;
		this.historyWriteIndex = (this.historyWriteIndex + 1) & IMGDEC_HISTORY_WORD_MASK;
		if (this.historyWordCount < IMGDEC_HISTORY_WORD_CAPACITY) {
			this.historyWordCount += 1;
		}
		this.decodedWordCount = (this.decodedWordCount + 1) >>> 0;
	}

	private updateDmaRequests(): void {
		const inputRemaining = (this.inputWordCountWord - this.inputWordsReceived) >>> 0;
		const inputBlockWords = inputRemaining < IMGDEC_DMA_BLOCK_WORDS ? inputRemaining : IMGDEC_DMA_BLOCK_WORDS;
		const inputReady = !this.supervisorQuiesceRequested
			&& this.active && inputRemaining !== 0 && this.inputFifo.free() >= inputBlockWords;
		const outputRemaining = (this.outputWordCount - this.outputWordsRead) >>> 0;
		const outputBlockWords = outputRemaining < IMGDEC_DMA_BLOCK_WORDS ? outputRemaining : IMGDEC_DMA_BLOCK_WORDS;
		const outputReady = !this.supervisorQuiesceRequested
			&& this.active && outputRemaining !== 0 && this.outputFifo.count() >= outputBlockWords;
		const requestMask = (1 << DMA_REQUEST_IMGDEC_WRITE) | (1 << DMA_REQUEST_IMGDEC_READ);
		const assertedRequests = (inputReady ? 1 << DMA_REQUEST_IMGDEC_WRITE : 0)
			| (outputReady ? 1 << DMA_REQUEST_IMGDEC_READ : 0);
		this.dma.setRequestLines(requestMask, assertedRequests);
		const status = this.statusWord;
		const nextStatus = ((status & ~(IMGDEC_STATUS_INPUT_REQUEST | IMGDEC_STATUS_OUTPUT_REQUEST))
			| (inputReady ? IMGDEC_STATUS_INPUT_REQUEST : 0)
			| (outputReady ? IMGDEC_STATUS_OUTPUT_REQUEST : 0)) >>> 0;
		if (nextStatus !== status) {
			this.statusWord = nextStatus;
			this.memory.writeIoU32(IO_IMGDEC_STATUS, nextStatus);
		}
		if (inputReady && !this.dma.ownsWritePort(IO_IMGDEC_DATA)) {
			this.cpu.resumeMemoryWrite(IO_IMGDEC_DATA);
		}
	}

	private streamComplete(): boolean {
		return this.outputStage === OUTPUT_COMPLETE
			&& this.decodePhase === DECODE_TOKEN
			&& this.inputWordsReceived === this.inputWordCountWord
			&& this.inputFifo.empty();
	}

	private failIfInputExhausted(): void {
		if (this.inputWordsReceived === this.inputWordCountWord) {
			this.stop(IMGDEC_STATUS_FORMAT_FAULT);
		}
	}

	private stop(statusWord: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.active = false;
		this.scheduledDecodeWords = 0;
		this.decodeDeadline = -1;
		this.dma.setRequestLines((1 << DMA_REQUEST_IMGDEC_WRITE) | (1 << DMA_REQUEST_IMGDEC_READ), 0);
		this.statusWord = statusWord;
		this.memory.writeIoU32(IO_IMGDEC_STATUS, statusWord);
		this.resumeConfigWrites();
		this.irq.raise(IRQ_IMGDEC);
		this.notifySupervisorBoundary();
	}

	private resumeConfigWrites(): void {
		for (let index = 0; index < IO_IMGDEC_CONFIG_ADDRS.length; index += 1) {
			this.cpu.resumeMemoryWrite(IO_IMGDEC_CONFIG_ADDRS[index]!);
		}
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiescent()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	private static readProgressThunk(context: ImgDecController, address: number): number {
		return address === IO_IMGDEC_INPUT_WORDS_RECEIVED
			? context.inputWordsReceived
			: context.decodedWordCount;
	}

	private static writeConfigThunk(context: ImgDecController, address: number, value: number): void {
		switch (address) {
			case IO_IMGDEC_INPUT_WORD_COUNT:
				context.inputWordCountWord = value;
				return;
			case IO_IMGDEC_TEXTURE_DESTINATION:
				context.textureDestinationWord = value;
				return;
			case IO_IMGDEC_TEXTURE_SIZE:
				context.textureSizeWord = value;
				return;
			case IO_IMGDEC_CLUT_DESTINATION:
				context.clutDestinationWord = value;
				return;
			case IO_IMGDEC_CONTROL:
				context.controlWord = value;
				if ((value & IMGDEC_CONTROL_START) !== 0) {
					context.start();
				}
				return;
		}
	}

	private static configWriteReadyThunk(context: ImgDecController): boolean {
		return !context.active && !context.supervisorQuiesceRequested;
	}

	private static readDataThunk(context: ImgDecController, _address: number, busSignals: MappedBusSignals): number {
		const dmaRead = (busSignals & MAPPED_BUS_MASTER_DMA) !== 0;
		if (!dmaRead && context.dma.ownsReadPort(IO_IMGDEC_DATA)) {
			return context.dataWord;
		}
		if (!context.outputFifo.empty()) {
			context.dataWord = context.outputFifo.pop();
			context.memory.writeIoU32(IO_IMGDEC_DATA, context.dataWord);
			context.outputWordsRead = (context.outputWordsRead + 1) >>> 0;
		}
		if (dmaRead
			&& (busSignals & MAPPED_BUS_DMA_BLOCK_END) === 0) {
			return context.dataWord;
		}
		if (context.outputWordsRead === context.outputWordCount && context.streamComplete()) {
			context.stop(IMGDEC_STATUS_DONE);
			return context.dataWord;
		}
		if (context.scheduleDecode(context.scheduler.currentNowCycles())) {
			context.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, context.decodeDeadline);
		}
		context.updateDmaRequests();
		return context.dataWord;
	}

	private static writeDataThunk(
		context: ImgDecController,
		_address: number,
		value: number,
		busSignals: MappedBusSignals,
	): void {
		context.dataWord = value;
		if (!context.inputFifo.full()) {
			context.inputFifo.writeWord(context.dataWord);
		}
		context.inputWordsReceived = (context.inputWordsReceived + 1) >>> 0;
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0
			&& (busSignals & MAPPED_BUS_DMA_BLOCK_END) === 0) {
			return;
		}
		if (context.scheduleDecode(context.scheduler.currentNowCycles())) {
			context.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, context.decodeDeadline);
		}
		context.updateDmaRequests();
	}

	private static dataWriteReadyThunk(
		context: ImgDecController,
		_addr: number,
		busSignals: MappedBusSignals,
	): boolean {
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0) {
			return true;
		}
		return context.active
			&& !context.supervisorQuiesceRequested
			&& context.inputWordsReceived < context.inputWordCountWord
			&& context.inputFifo.free() !== 0
			&& !context.dma.ownsWritePort(IO_IMGDEC_DATA);
	}

	private mirrorRegisters(): void {
		this.memory.writeIoU32(IO_IMGDEC_INPUT_WORD_COUNT, this.inputWordCountWord);
		this.memory.writeIoU32(IO_IMGDEC_TEXTURE_DESTINATION, this.textureDestinationWord);
		this.memory.writeIoU32(IO_IMGDEC_TEXTURE_SIZE, this.textureSizeWord);
		this.memory.writeIoU32(IO_IMGDEC_CLUT_DESTINATION, this.clutDestinationWord);
		this.memory.writeIoU32(IO_IMGDEC_CONTROL, this.controlWord);
		this.memory.writeIoU32(IO_IMGDEC_STATUS, this.statusWord);
		this.memory.writeIoU32(IO_IMGDEC_DATA, this.dataWord);
	}
}
