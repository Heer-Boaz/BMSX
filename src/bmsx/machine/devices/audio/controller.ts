import type { ActiveVoiceInfo, AudioSlot, SoundMaster, SoundMasterAudioSource, SoundMasterResolvedPlayRequest } from '../../../audio/soundmaster';
import {
	APU_GAIN_Q12_ONE,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_RAMP_SLOT,
	APU_CMD_STOP_SLOT,
	APU_EVENT_NONE,
	APU_EVENT_SLOT_ENDED,
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_SLOT_COUNT,
	IO_APU_CMD,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_FADE_SAMPLES,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SLOT,
	IO_APU_START_SAMPLE,
	IO_APU_STATUS,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_APU_TARGET_GAIN_Q12,
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';

function apuSamplesToMilliseconds(samples: number): number {
	return Math.floor((samples * 1000) / APU_SAMPLE_RATE_HZ);
}

function decodeFilterKind(kind: number): BiquadFilterType {
	switch (kind) {
		case APU_FILTER_HIGHPASS:
			return 'highpass';
		case APU_FILTER_BANDPASS:
			return 'bandpass';
		case APU_FILTER_NOTCH:
			return 'notch';
		case APU_FILTER_ALLPASS:
			return 'allpass';
		case APU_FILTER_PEAKING:
			return 'peaking';
		case APU_FILTER_LOWSHELF:
			return 'lowshelf';
		case APU_FILTER_HIGHSHELF:
			return 'highshelf';
		case APU_FILTER_LOWPASS:
		default:
			return 'lowpass';
	}
}

export class AudioController {
	private eventSequence = 0;
	private readonly unsubscribeEnded: () => void;

	public constructor(
		private readonly memory: Memory,
		private readonly soundMaster: SoundMaster,
		private readonly irq: IrqController,
	) {
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.unsubscribeEnded = this.soundMaster.addEndedListener((info) => this.onVoiceEnded(info));
	}

	public dispose(): void {
		this.unsubscribeEnded();
	}

	public reset(): void {
		this.eventSequence = 0;
		this.clearCommandLatch();
		this.memory.writeValue(IO_APU_STATUS, 0);
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	private resetCommandLatch(): void {
		this.memory.writeValue(IO_APU_SOURCE_ADDR, 0);
		this.memory.writeValue(IO_APU_SOURCE_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_SAMPLE_RATE_HZ, 0);
		this.memory.writeValue(IO_APU_SOURCE_CHANNELS, 0);
		this.memory.writeValue(IO_APU_SOURCE_BITS_PER_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_FRAME_COUNT, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_OFFSET, 0);
		this.memory.writeValue(IO_APU_SOURCE_DATA_BYTES, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SOURCE_LOOP_END_SAMPLE, 0);
		this.memory.writeValue(IO_APU_SLOT, 0);
		this.memory.writeValue(IO_APU_RATE_STEP_Q16, APU_RATE_STEP_Q16_ONE);
		this.memory.writeValue(IO_APU_GAIN_Q12, APU_GAIN_Q12_ONE);
		this.memory.writeValue(IO_APU_START_SAMPLE, 0);
		this.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
		this.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
		this.memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
		this.memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
		this.memory.writeValue(IO_APU_FADE_SAMPLES, 0);
		this.memory.writeValue(IO_APU_TARGET_GAIN_Q12, APU_GAIN_Q12_ONE);
	}

	private clearCommandLatch(): void {
		this.resetCommandLatch();
		this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
	}

	public onCommandWrite(): void {
		switch (this.memory.readIoU32(IO_APU_CMD)) {
			case APU_CMD_PLAY:
				this.play();
				this.clearCommandLatch();
				return;
			case APU_CMD_STOP_SLOT:
				this.stopSlot();
				this.clearCommandLatch();
				return;
			case APU_CMD_RAMP_SLOT:
				this.rampSlot();
				this.clearCommandLatch();
				return;
		}
	}

	private readSlot(): AudioSlot {
		const slot = this.memory.readIoU32(IO_APU_SLOT);
		if (slot >= APU_SLOT_COUNT) {
			throw new Error(`[APU] slot ${slot} is outside 0..${APU_SLOT_COUNT - 1}.`);
		}
		return slot;
	}

	private play(): void {
		const source = this.readAudioSource();
		this.startPlay(source, this.readSlot(), this.readResolvedPlayRequest(source));
	}

	private readAudioSource(): SoundMasterAudioSource {
		const source: SoundMasterAudioSource = {
			sourceAddr: this.memory.readIoU32(IO_APU_SOURCE_ADDR),
			sourceBytes: this.memory.readIoU32(IO_APU_SOURCE_BYTES),
			sampleRateHz: this.memory.readIoU32(IO_APU_SOURCE_SAMPLE_RATE_HZ),
			channels: this.memory.readIoU32(IO_APU_SOURCE_CHANNELS),
			bitsPerSample: this.memory.readIoU32(IO_APU_SOURCE_BITS_PER_SAMPLE),
			frameCount: this.memory.readIoU32(IO_APU_SOURCE_FRAME_COUNT),
			dataOffset: this.memory.readIoU32(IO_APU_SOURCE_DATA_OFFSET),
			dataBytes: this.memory.readIoU32(IO_APU_SOURCE_DATA_BYTES),
			loopStartSample: this.memory.readIoU32(IO_APU_SOURCE_LOOP_START_SAMPLE),
			loopEndSample: this.memory.readIoU32(IO_APU_SOURCE_LOOP_END_SAMPLE),
		};
		this.requireAudioSource(source);
		return source;
	}

	private requireAudioSource(source: SoundMasterAudioSource): void {
		if (source.sourceBytes === 0) {
			throw new Error('[APU] source byte length must be positive.');
		}
		if (!this.memory.isReadableMainMemoryRange(source.sourceAddr, source.sourceBytes)) {
			throw new Error(`[APU] source range ${source.sourceAddr}..${source.sourceAddr + source.sourceBytes} is not readable main memory.`);
		}
		if (source.sampleRateHz === 0) {
			throw new Error('[APU] source sample rate must be positive.');
		}
		if (source.channels < 1 || source.channels > 2) {
			throw new Error(`[APU] source channel count ${source.channels} is invalid.`);
		}
		if (source.frameCount === 0) {
			throw new Error('[APU] source frame count must be positive.');
		}
		if (source.dataBytes === 0 || source.dataOffset + source.dataBytes > source.sourceBytes) {
			throw new Error('[APU] source data range exceeds source bytes.');
		}
		switch (source.bitsPerSample) {
			case 4:
			case 8:
			case 16:
				return;
		}
		throw new Error(`[APU] source bit depth ${source.bitsPerSample} is unsupported.`);
	}

	private startPlay(source: SoundMasterAudioSource, slot: AudioSlot, request: SoundMasterResolvedPlayRequest): void {
		if (!this.soundMaster.isRuntimeAudioReady()) {
			throw new Error('[APU] SoundMaster runtime audio is not initialized.');
		}
		const bytes = new Uint8Array(source.sourceBytes);
		this.memory.readBytesInto(source.sourceAddr, bytes, bytes.byteLength);
		void this.soundMaster.playResolvedSourceOnSlot(slot, source, bytes, request).catch(error => {
			console.error(error);
		});
	}

	private stopSlot(): void {
		const slot = this.readSlot();
		const fadeSamples = this.memory.readIoU32(IO_APU_FADE_SAMPLES);
		this.soundMaster.stopSlot(slot, fadeSamples > 0 ? apuSamplesToMilliseconds(fadeSamples) : undefined);
	}

	private rampSlot(): void {
		const slot = this.readSlot();
		const targetGain = this.memory.readIoI32(IO_APU_TARGET_GAIN_Q12) / APU_GAIN_Q12_ONE;
		const fadeSamples = this.memory.readIoU32(IO_APU_FADE_SAMPLES);
		if (fadeSamples > 0) {
			this.soundMaster.rampSlotGainLinear(slot, targetGain, fadeSamples / APU_SAMPLE_RATE_HZ);
			return;
		}
		this.soundMaster.setSlotGainLinear(slot, targetGain);
	}

	private readResolvedPlayRequest(source: SoundMasterAudioSource): SoundMasterResolvedPlayRequest {
		const rateStepQ16 = this.memory.readIoI32(IO_APU_RATE_STEP_Q16);
		const gainQ12 = this.memory.readIoI32(IO_APU_GAIN_Q12);
		const startSample = this.memory.readIoU32(IO_APU_START_SAMPLE);
		const filterKind = this.memory.readIoU32(IO_APU_FILTER_KIND);
		const request: SoundMasterResolvedPlayRequest = {
			playbackRate: rateStepQ16 / APU_RATE_STEP_Q16_ONE,
			gainLinear: gainQ12 / APU_GAIN_Q12_ONE,
			offsetSeconds: startSample / source.sampleRateHz,
			filter: null,
		};
		if (filterKind !== APU_FILTER_NONE) {
			request.filter = {
				type: decodeFilterKind(filterKind),
				frequency: this.memory.readIoI32(IO_APU_FILTER_FREQ_HZ),
				q: this.memory.readIoI32(IO_APU_FILTER_Q_MILLI) / 1000,
				gain: this.memory.readIoI32(IO_APU_FILTER_GAIN_MILLIDB) / 1000,
			};
		}
		return request;
	}

	private emitSlotEvent(kind: number, slot: AudioSlot, sourceAddr: number): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

	private onVoiceEnded(info: ActiveVoiceInfo): void {
		this.emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, info.sourceAddr);
	}
}
