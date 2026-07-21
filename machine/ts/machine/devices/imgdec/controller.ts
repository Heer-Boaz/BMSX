import {
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
} from '../../bus/io';
import type { CPU, Value } from '../../cpu/cpu';
import {
	MAPPED_BUS_DMA_BLOCK_END,
	MAPPED_BUS_MASTER_DMA,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { Memory } from '../../memory/memory';
import { DEVICE_SERVICE_IMGDEC, DEVICE_SERVICE_SYSTEM, type DeviceScheduler } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import { GX_GPU_GP0_CPU_TO_VRAM_FIRST, type GxGpu } from '../gx/gpu';
import type { IrqController } from '../irq/controller';
import {
	IMGDEC_CONTROL_START,
	IMGDEC_DECODE_BATCH_WORDS,
	IMGDEC_DMA_BLOCK_WORDS,
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_HISTORY_WORD_MASK,
	IMGDEC_INPUT_FIFO_WORD_CAPACITY,
	IMGDEC_OUTPUT_FIFO_WORD_CAPACITY,
	IMGDEC_STATUS_BUSY,
	IMGDEC_STATUS_DONE,
	IMGDEC_STATUS_FORMAT_FAULT,
	IMGDEC_STATUS_INPUT_REQUEST,
	IMGDEC_STATUS_OUTPUT_ABORTED,
	IMGDEC_STATUS_OUTPUT_BLOCKED,
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
} from './contracts';
import { ImgDecWordFifo } from './word_fifo';

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

const CLUT_SIZE_WORD = 16 | (1 << 16);

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
	private readonly inputFifo = new ImgDecWordFifo(IMGDEC_INPUT_FIFO_WORD_CAPACITY);
	private readonly outputFifo = new ImgDecWordFifo(IMGDEC_OUTPUT_FIFO_WORD_CAPACITY);
	private readonly history = new Uint32Array(IMGDEC_HISTORY_WORD_CAPACITY);
	private historyWriteIndex = 0;
	private historyWordCount = 0;
	private active = false;
	private inputWordsReceived = 0;
	private decodedWordCount = 0;
	private textureWordCount = 0;
	private clutWordCount = 0;
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
		private readonly gpu: GxGpu,
		private readonly cyclesPerOutputWord: number,
	) {
		this.memory.mapIoRead(IO_IMGDEC_INPUT_WORDS_RECEIVED, this, ImgDecController.readProgressThunk);
		this.memory.mapIoRead(IO_IMGDEC_DECODED_WORD_COUNT, this, ImgDecController.readProgressThunk);
		for (let index = 0; index < IO_IMGDEC_CONFIG_ADDRS.length; index += 1) {
			const address = IO_IMGDEC_CONFIG_ADDRS[index]!;
			this.memory.mapIoWrite(address, this, ImgDecController.writeConfigThunk);
			this.memory.mapIoWriteReady(address, ImgDecController.configWriteReadyThunk);
		}
		this.memory.mapIoWrite(IO_IMGDEC_DATA, this, ImgDecController.writeDataThunk);
		this.memory.mapIoWriteReady(IO_IMGDEC_DATA, ImgDecController.dataWriteReadyThunk);
	}

	public reset(): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.gpu.setImgDecGp0Request(false);
		this.dma.setImgDecDmaWriteReady(false);
		this.resetStreamState();
		this.supervisorQuiesceRequested = false;
		this.memory.writeIoValue(IO_IMGDEC_INPUT_WORD_COUNT, 0);
		this.memory.writeIoValue(IO_IMGDEC_TEXTURE_DESTINATION, 0);
		this.memory.writeIoValue(IO_IMGDEC_TEXTURE_SIZE, 0);
		this.memory.writeIoValue(IO_IMGDEC_CLUT_DESTINATION, 0);
		this.memory.writeIoValue(IO_IMGDEC_CONTROL, 0);
		this.memory.writeIoValue(IO_IMGDEC_STATUS, 0);
		this.memory.writeIoValue(IO_IMGDEC_DATA, 0);
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
			inputWordCountWord: this.memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT),
			textureDestinationWord: this.memory.readIoU32(IO_IMGDEC_TEXTURE_DESTINATION),
			textureSizeWord: this.memory.readIoU32(IO_IMGDEC_TEXTURE_SIZE),
			clutDestinationWord: this.memory.readIoU32(IO_IMGDEC_CLUT_DESTINATION),
			controlWord: this.memory.readIoU32(IO_IMGDEC_CONTROL),
			statusWord: this.memory.readIoU32(IO_IMGDEC_STATUS),
			dataWord: this.memory.readIoU32(IO_IMGDEC_DATA),
			inputWordsReceived: this.inputWordsReceived,
			decodedWordCount: this.decodedWordCount,
			textureWordCount: this.textureWordCount,
			clutWordCount: this.clutWordCount,
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
		this.memory.writeIoValue(IO_IMGDEC_INPUT_WORD_COUNT, state.inputWordCountWord);
		this.memory.writeIoValue(IO_IMGDEC_TEXTURE_DESTINATION, state.textureDestinationWord);
		this.memory.writeIoValue(IO_IMGDEC_TEXTURE_SIZE, state.textureSizeWord);
		this.memory.writeIoValue(IO_IMGDEC_CLUT_DESTINATION, state.clutDestinationWord);
		this.memory.writeIoValue(IO_IMGDEC_CONTROL, state.controlWord);
		this.memory.writeIoValue(IO_IMGDEC_STATUS, state.statusWord);
		this.memory.writeIoValue(IO_IMGDEC_DATA, state.dataWord);
		this.inputWordsReceived = state.inputWordsReceived;
		this.decodedWordCount = state.decodedWordCount;
		this.textureWordCount = state.textureWordCount;
		this.clutWordCount = state.clutWordCount;
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
		this.active = (state.statusWord & IMGDEC_STATUS_BUSY) !== 0;
		this.gpu.setImgDecGp0Request(this.active);
		this.updateInputRequest();
		if (this.gpu.imgDecGp0AbortPending()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.scheduler.currentNowCycles());
		} else if ((state.statusWord & IMGDEC_STATUS_OUTPUT_BLOCKED) !== 0
			&& this.gpu.armImgDecGp0WritableWake()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.scheduler.currentNowCycles());
		} else if (this.scheduledDecodeWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.decodeDeadline);
		}
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		return !this.active;
	}

	public enterSupervisorFaultContext(): void {
		this.reset();
		this.supervisorQuiesceRequested = true;
	}

	public leaveSupervisorContext(): void {
		this.supervisorQuiesceRequested = false;
		this.resumeConfigWrites();
	}

	public onService(nowCycles: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		if (this.gpu.imgDecGp0AbortPending()) {
			this.fail(IMGDEC_STATUS_OUTPUT_ABORTED);
			return;
		}
		if (this.scheduledDecodeWords !== 0 && nowCycles >= this.decodeDeadline) {
			this.decodeScheduledWords();
		}
		this.drainOutput(nowCycles);
		if (this.active) {
			this.scheduleDecode(nowCycles);
		}
		this.updateInputRequest();
		if (this.scheduledDecodeWords !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, this.decodeDeadline);
		}
	}

	private start(): void {
		this.resetStreamState();
		this.active = true;
		this.memory.writeIoValue(IO_IMGDEC_CONTROL, 0);
		this.memory.writeIoValue(IO_IMGDEC_STATUS, IMGDEC_STATUS_BUSY);
		this.gpu.setImgDecGp0Request(true);
		this.scheduleDecode(this.scheduler.currentNowCycles());
		this.updateInputRequest();
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
						this.fail(IMGDEC_STATUS_FORMAT_FAULT);
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
		if (!this.active || this.scheduledDecodeWords !== 0) {
			return false;
		}
		while (this.decodePhase <= DECODE_CLUT_WORD_COUNT && !this.inputFifo.empty()) {
			const word = this.inputFifo.pop();
			if (this.decodePhase === DECODE_MAGIC) {
				if (word !== IMGDEC_STREAM_MAGIC) {
					this.fail(IMGDEC_STATUS_FORMAT_FAULT);
					return false;
				}
				this.decodePhase = DECODE_TEXTURE_WORD_COUNT;
			} else if (this.decodePhase === DECODE_TEXTURE_WORD_COUNT) {
				this.textureWordCount = word;
				this.decodePhase = DECODE_CLUT_WORD_COUNT;
			} else {
				this.clutWordCount = word;
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
					this.fail(IMGDEC_STATUS_FORMAT_FAULT);
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
			this.outputFifo.writeWord(this.memory.readIoU32(IO_IMGDEC_TEXTURE_DESTINATION));
			this.outputFifo.writeWord(this.memory.readIoU32(IO_IMGDEC_TEXTURE_SIZE));
			this.outputStage = OUTPUT_TEXTURE_PAYLOAD;
			return;
		}
		if (this.outputStage === OUTPUT_CLUT_HEADER) {
			this.outputFifo.writeWord(GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24);
			this.outputFifo.writeWord(this.memory.readIoU32(IO_IMGDEC_CLUT_DESTINATION));
			this.outputFifo.writeWord(CLUT_SIZE_WORD);
			this.outputStage = OUTPUT_CLUT_PAYLOAD;
			return;
		}
		for (let index = 0; index < decodeWords; index += 1) {
			switch (this.decodePhase) {
				case DECODE_LITERAL:
					this.emitPayloadWord(this.inputFifo.pop());
					break;
				case DECODE_REPEAT:
					this.emitPayloadWord(this.repeatWord);
					break;
				case DECODE_BACK_REFERENCE:
					this.emitPayloadWord(this.history[(this.historyWriteIndex - this.backReferenceDistance) & IMGDEC_HISTORY_WORD_MASK]!);
					break;
				case DECODE_ZERO:
					this.emitPayloadWord(0);
					break;
			}
			this.completeRunWord();
		}
		this.advanceOutputStage();
	}

	private drainOutput(nowCycles: number): void {
		while (this.active && !this.outputFifo.empty()) {
			const writableWords = this.gpu.imgDecGp0WritableWordCount(nowCycles);
			if (writableWords === 0) {
				this.setStatusBit(IMGDEC_STATUS_OUTPUT_BLOCKED, true);
				this.gpu.armImgDecGp0WritableWake();
				return;
			}
			const outputWords = this.outputFifo.count() < writableWords
				? this.outputFifo.count()
				: writableWords;
			for (let index = 0; index < outputWords; index += 1) {
				const finalWord = this.outputFifo.count() === 1 && this.streamComplete();
				this.gpu.writeImgDecGp0BlockWord(
					this.outputFifo.pop(),
					index + 1 === outputWords,
					nowCycles,
				);
				if (finalWord) {
					this.finish();
					return;
				}
			}
		}
		this.setStatusBit(IMGDEC_STATUS_OUTPUT_BLOCKED, false);
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

	private completeRunWord(): void {
		this.runWordsRemaining -= 1;
		if (this.runWordsRemaining === 0) {
			this.decodePhase = DECODE_TOKEN;
		}
	}

	private updateInputRequest(): void {
		const inputWordCount = this.memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT);
		const remaining = (inputWordCount - this.inputWordsReceived) >>> 0;
		const blockWords = remaining < IMGDEC_DMA_BLOCK_WORDS ? remaining : IMGDEC_DMA_BLOCK_WORDS;
		const ready = this.active && remaining !== 0 && this.inputFifo.free() >= blockWords;
		this.dma.setImgDecDmaWriteReady(ready);
		this.setStatusBit(IMGDEC_STATUS_INPUT_REQUEST, ready);
		if (ready && !this.dma.ownsImgDecDataPort()) {
			this.cpu.resumeMemoryWrite(IO_IMGDEC_DATA);
		}
	}

	private streamComplete(): boolean {
		return this.outputStage === OUTPUT_COMPLETE
			&& this.decodePhase === DECODE_TOKEN
			&& this.inputWordsReceived === this.memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)
			&& this.inputFifo.empty();
	}

	private failIfInputExhausted(): void {
		if (this.inputWordsReceived === this.memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)) {
			this.fail(IMGDEC_STATUS_FORMAT_FAULT);
		}
	}

	private finish(): void {
		this.active = false;
		this.scheduledDecodeWords = 0;
		this.decodeDeadline = -1;
		this.dma.setImgDecDmaWriteReady(false);
		this.gpu.setImgDecGp0Request(false);
		this.memory.writeIoValue(IO_IMGDEC_STATUS, IMGDEC_STATUS_DONE);
		this.resumeConfigWrites();
		this.irq.raise(IRQ_IMGDEC);
		this.notifySupervisorBoundary();
	}

	private fail(statusWord: number): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_IMGDEC);
		this.active = false;
		this.scheduledDecodeWords = 0;
		this.decodeDeadline = -1;
		this.dma.setImgDecDmaWriteReady(false);
		this.gpu.abortImgDecGp0Packet();
		this.gpu.setImgDecGp0Request(false);
		this.memory.writeIoValue(IO_IMGDEC_STATUS, statusWord);
		this.resumeConfigWrites();
		this.irq.raise(IRQ_IMGDEC);
		this.notifySupervisorBoundary();
	}

	private setStatusBit(bit: number, set: boolean): void {
		const status = this.memory.readIoU32(IO_IMGDEC_STATUS);
		const nextStatus = set ? (status | bit) >>> 0 : (status & ~bit) >>> 0;
		if (nextStatus !== status) {
			this.memory.writeIoValue(IO_IMGDEC_STATUS, nextStatus);
		}
	}

	private resumeConfigWrites(): void {
		for (let index = 0; index < IO_IMGDEC_CONFIG_ADDRS.length; index += 1) {
			this.cpu.resumeMemoryWrite(IO_IMGDEC_CONFIG_ADDRS[index]!);
		}
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorQuiesceRequested && !this.active) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	private static readProgressThunk(context: ImgDecController, address: number): Value {
		return address === IO_IMGDEC_INPUT_WORDS_RECEIVED
			? context.inputWordsReceived
			: context.decodedWordCount;
	}

	private static writeConfigThunk(context: ImgDecController, address: number, value: Value): void {
		if (address === IO_IMGDEC_CONTROL && ((value as number) & IMGDEC_CONTROL_START) !== 0) {
			context.start();
		}
	}

	private static configWriteReadyThunk(context: ImgDecController): boolean {
		return !context.active && !context.supervisorQuiesceRequested;
	}

	private static writeDataThunk(
		context: ImgDecController,
		_address: number,
		value: Value,
		busSignals: MappedBusSignals,
	): void {
		context.inputFifo.writeBusWord(value as number);
		context.inputWordsReceived = (context.inputWordsReceived + 1) >>> 0;
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0
			&& (busSignals & MAPPED_BUS_DMA_BLOCK_END) === 0) {
			return;
		}
		if (context.scheduleDecode(context.scheduler.currentNowCycles())) {
			context.scheduler.scheduleDeviceService(DEVICE_SERVICE_IMGDEC, context.decodeDeadline);
		}
		context.updateInputRequest();
	}

	private static dataWriteReadyThunk(context: ImgDecController): boolean {
		return context.active
			&& context.inputWordsReceived < context.memory.readIoU32(IO_IMGDEC_INPUT_WORD_COUNT)
			&& context.inputFifo.free() !== 0
			&& !context.dma.ownsImgDecDataPort();
	}
}
