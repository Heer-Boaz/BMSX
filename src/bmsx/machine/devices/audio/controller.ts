import type { ActiveVoiceInfo, AudioSlot, SoundMaster, SoundMasterResolvedPlayRequest } from '../../../audio/soundmaster';
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
	APU_PRIORITY_AUTO,
	APU_SLOT_COUNT,
	IO_APU_CMD,
	IO_APU_EVENT_HANDLE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_FADE_SAMPLES,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_HANDLE,
	IO_APU_PRIORITY,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SLOT,
	IO_APU_START_SAMPLE,
	IO_APU_STATUS,
	IO_APU_TARGET_GAIN_Q12,
	IRQ_APU,
} from '../../bus/io';
import { Memory, type AssetEntry } from '../../memory/memory';
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
	private readonly playSequenceBySlot: number[] = Array.from({ length: APU_SLOT_COUNT }, () => 0);
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
		this.playSequenceBySlot.fill(0);
		this.clearCommandLatch();
		this.memory.writeValue(IO_APU_STATUS, 0);
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_SLOT, 0);
		this.memory.writeValue(IO_APU_EVENT_HANDLE, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	private resetCommandLatch(): void {
		this.memory.writeValue(IO_APU_HANDLE, 0);
		this.memory.writeValue(IO_APU_SLOT, 0);
		this.memory.writeValue(IO_APU_PRIORITY, APU_PRIORITY_AUTO);
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
		const handle = this.memory.readIoU32(IO_APU_HANDLE);
		const entry = this.requireAudioEntry(handle);
		this.startPlay(entry.id, this.readSlot(), this.readResolvedPlayRequest());
	}

	private requireAudioEntry(handle: number): AssetEntry {
		const entry = this.memory.getAssetEntryByHandle(handle);
		if (entry.type !== 'audio') {
			throw new Error(`[APU] asset handle ${handle} is not audio.`);
		}
		return entry;
	}

	private startPlay(id: string, slot: AudioSlot, request: SoundMasterResolvedPlayRequest): void {
		if (!this.soundMaster.isRuntimeAudioReady()) {
			throw new Error('[APU] SoundMaster runtime audio is not initialized.');
		}
		if (!this.soundMaster.hasAudio(id)) {
			throw new Error(`[APU] audio asset '${id}' is not loaded in SoundMaster.`);
		}
		this.playSequenceBySlot[slot] = (this.playSequenceBySlot[slot] + 1) >>> 0;
		const playSequence = this.playSequenceBySlot[slot];
		void this.soundMaster.playResolvedOnSlot(slot, id, request).then((voiceId) => {
			if (this.playSequenceBySlot[slot] !== playSequence && voiceId) {
				this.soundMaster.stopVoiceById(voiceId);
			}
		}, error => {
			if (this.playSequenceBySlot[slot] !== playSequence) {
				return;
			}
			console.error(error);
		});
	}

	private stopSlot(): void {
		const slot = this.readSlot();
		this.playSequenceBySlot[slot] = (this.playSequenceBySlot[slot] + 1) >>> 0;
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

	private readResolvedPlayRequest(): SoundMasterResolvedPlayRequest {
		const priority = this.memory.readIoI32(IO_APU_PRIORITY);
		const rateStepQ16 = this.memory.readIoI32(IO_APU_RATE_STEP_Q16);
		const gainQ12 = this.memory.readIoI32(IO_APU_GAIN_Q12);
		const startSample = this.memory.readIoU32(IO_APU_START_SAMPLE);
		const filterKind = this.memory.readIoU32(IO_APU_FILTER_KIND);
		const request: SoundMasterResolvedPlayRequest = {
			playbackRate: rateStepQ16 / APU_RATE_STEP_Q16_ONE,
			gainLinear: gainQ12 / APU_GAIN_Q12_ONE,
			offsetSeconds: startSample / APU_SAMPLE_RATE_HZ,
			filter: null,
		};
		if (priority !== APU_PRIORITY_AUTO) {
			request.priority = priority;
		}
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

	private emitSlotEvent(kind: number, slot: AudioSlot, handle: number): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, kind);
		this.memory.writeValue(IO_APU_EVENT_SLOT, slot);
		this.memory.writeValue(IO_APU_EVENT_HANDLE, handle);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

	private onVoiceEnded(info: ActiveVoiceInfo): void {
		this.emitSlotEvent(APU_EVENT_SLOT_ENDED, info.slot, this.memory.resolveAssetHandle(info.id));
	}
}
