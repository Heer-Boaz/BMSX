import type { ActiveVoiceInfo, ModulationParams, SoundMaster } from '../../../audio/soundmaster';
import type { AudioType } from '../../../rompack/format';
import {
	APU_CHANNEL_MUSIC,
	APU_CHANNEL_SFX,
	APU_CHANNEL_UI,
	APU_CMD_NONE,
	APU_CMD_PLAY,
	APU_CMD_STOP_CHANNEL,
	APU_EVENT_NONE,
	APU_EVENT_VOICE_ENDED,
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
	APU_SYNC_LOOP,
	IO_APU_CHANNEL,
	IO_APU_CMD,
	IO_APU_CROSSFADE_MS,
	IO_APU_EVENT_CHANNEL,
	IO_APU_EVENT_HANDLE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_VOICE,
	IO_APU_FADE_MS,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_HANDLE,
	IO_APU_OFFSET_MS,
	IO_APU_PITCH_CENTS,
	IO_APU_PRIORITY,
	IO_APU_RATE_PERMIL,
	IO_APU_START_AT_LOOP,
	IO_APU_START_FRESH,
	IO_APU_STATUS,
	IO_APU_SYNC,
	IO_APU_VOLUME_MILLIDB,
	IRQ_APU,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { IrqController } from '../irq/controller';

function decodeChannel(channel: number): AudioType {
	if (channel === APU_CHANNEL_MUSIC) {
		return 'music';
	}
	if (channel === APU_CHANNEL_UI) {
		return 'ui';
	}
	return 'sfx';
}

function encodeChannel(type: AudioType): number {
	if (type === 'music') {
		return APU_CHANNEL_MUSIC;
	}
	if (type === 'ui') {
		return APU_CHANNEL_UI;
	}
	return APU_CHANNEL_SFX;
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
	private readonly unsubscribeSfx: () => void;
	private readonly unsubscribeMusic: () => void;
	private readonly unsubscribeUi: () => void;

	public constructor(
		private readonly memory: Memory,
		private readonly soundMaster: SoundMaster,
		private readonly irq: IrqController,
	) {
		this.memory.mapIoWrite(IO_APU_CMD, this.onCommandWrite.bind(this));
		this.unsubscribeSfx = this.soundMaster.addEndedListener('sfx', (info) => this.onVoiceEnded('sfx', info));
		this.unsubscribeMusic = this.soundMaster.addEndedListener('music', (info) => this.onVoiceEnded('music', info));
		this.unsubscribeUi = this.soundMaster.addEndedListener('ui', (info) => this.onVoiceEnded('ui', info));
	}

	public dispose(): void {
		this.unsubscribeSfx();
		this.unsubscribeMusic();
		this.unsubscribeUi();
	}

	public reset(): void {
		this.eventSequence = 0;
		this.memory.writeValue(IO_APU_HANDLE, 0);
		this.memory.writeValue(IO_APU_CHANNEL, APU_CHANNEL_SFX);
		this.memory.writeValue(IO_APU_PRIORITY, APU_PRIORITY_AUTO);
		this.memory.writeValue(IO_APU_PITCH_CENTS, 0);
		this.memory.writeValue(IO_APU_VOLUME_MILLIDB, 0);
		this.memory.writeValue(IO_APU_OFFSET_MS, 0);
		this.memory.writeValue(IO_APU_RATE_PERMIL, 1000);
		this.memory.writeValue(IO_APU_FILTER_KIND, APU_FILTER_NONE);
		this.memory.writeValue(IO_APU_FILTER_FREQ_HZ, 0);
		this.memory.writeValue(IO_APU_FILTER_Q_MILLI, 1000);
		this.memory.writeValue(IO_APU_FILTER_GAIN_MILLIDB, 0);
		this.memory.writeValue(IO_APU_FADE_MS, 0);
		this.memory.writeValue(IO_APU_CROSSFADE_MS, 0);
		this.memory.writeValue(IO_APU_SYNC, 0);
		this.memory.writeValue(IO_APU_START_AT_LOOP, 0);
		this.memory.writeValue(IO_APU_START_FRESH, 0);
		this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
		this.memory.writeValue(IO_APU_STATUS, 0);
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_NONE);
		this.memory.writeValue(IO_APU_EVENT_CHANNEL, APU_CHANNEL_SFX);
		this.memory.writeValue(IO_APU_EVENT_HANDLE, 0);
		this.memory.writeValue(IO_APU_EVENT_VOICE, 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, 0);
	}

	public onCommandWrite(): void {
		switch (this.memory.readIoU32(IO_APU_CMD)) {
			case APU_CMD_PLAY:
				this.play();
				this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
				return;
			case APU_CMD_STOP_CHANNEL:
				this.stopChannel();
				this.memory.writeIoValue(IO_APU_CMD, APU_CMD_NONE);
				return;
		}
	}

	private play(): void {
		const handle = this.memory.readIoU32(IO_APU_HANDLE);
		const entry = this.memory.getAssetEntryByHandle(handle);
		if (entry.type !== 'audio') {
			throw new Error(`[APU] asset handle ${handle} is not audio.`);
		}
		if (!this.soundMaster.isRuntimeAudioReady()) {
			throw new Error('[APU] SoundMaster runtime audio is not initialized.');
		}
		if (!this.soundMaster.hasAudio(entry.id)) {
			throw new Error(`[APU] audio asset '${entry.id}' is not loaded in SoundMaster.`);
		}
		const channel = decodeChannel(this.memory.readIoU32(IO_APU_CHANNEL));
		if (channel === 'music') {
			this.playMusic(entry.id);
			return;
		}
		const priority = this.memory.readIoI32(IO_APU_PRIORITY);
		const request = {
			params: this.readModulationParams(),
			priority: priority === APU_PRIORITY_AUTO ? undefined : priority,
		};
		void this.soundMaster.play(entry.id, request);
	}

	private playMusic(id: string): void {
		const fadeMs = this.memory.readIoI32(IO_APU_FADE_MS);
		const crossfadeMs = this.memory.readIoI32(IO_APU_CROSSFADE_MS);
		this.soundMaster.requestMusicTransition({
			to: id,
			sync: this.memory.readIoU32(IO_APU_SYNC) === APU_SYNC_LOOP ? 'loop' : 'immediate',
			fade_ms: fadeMs > 0 ? fadeMs : undefined,
			crossfade_ms: crossfadeMs > 0 ? crossfadeMs : undefined,
			start_at_loop_start: this.memory.readIoU32(IO_APU_START_AT_LOOP) !== 0,
			start_fresh: this.memory.readIoU32(IO_APU_START_FRESH) !== 0,
		});
	}

	private stopChannel(): void {
		const channel = decodeChannel(this.memory.readIoU32(IO_APU_CHANNEL));
		if (channel === 'music') {
			const fadeMs = this.memory.readIoI32(IO_APU_FADE_MS);
			if (fadeMs > 0) {
				this.soundMaster.stopMusic({ fade_ms: fadeMs });
				return;
			}
			this.soundMaster.stopMusic();
			return;
		}
		this.soundMaster.stop(channel, 'all');
	}

	private readModulationParams(): ModulationParams {
		const pitchCents = this.memory.readIoI32(IO_APU_PITCH_CENTS);
		const volumeMilliDb = this.memory.readIoI32(IO_APU_VOLUME_MILLIDB);
		const offsetMs = this.memory.readIoI32(IO_APU_OFFSET_MS);
		const ratePermil = this.memory.readIoI32(IO_APU_RATE_PERMIL);
		const filterKind = this.memory.readIoU32(IO_APU_FILTER_KIND);
		const params: ModulationParams = {};
		if (pitchCents !== 0) {
			params.pitchDelta = pitchCents / 100;
		}
		if (volumeMilliDb !== 0) {
			params.volumeDelta = volumeMilliDb / 1000;
		}
		if (offsetMs !== 0) {
			params.offset = offsetMs / 1000;
		}
		if (ratePermil !== 1000) {
			params.playbackRate = ratePermil / 1000;
		}
		if (filterKind !== APU_FILTER_NONE) {
			params.filter = {
				type: decodeFilterKind(filterKind),
				frequency: this.memory.readIoI32(IO_APU_FILTER_FREQ_HZ),
				q: this.memory.readIoI32(IO_APU_FILTER_Q_MILLI) / 1000,
				gain: this.memory.readIoI32(IO_APU_FILTER_GAIN_MILLIDB) / 1000,
			};
		}
		return params;
	}

	private onVoiceEnded(type: AudioType, info: ActiveVoiceInfo): void {
		this.eventSequence = (this.eventSequence + 1) >>> 0;
		this.memory.writeValue(IO_APU_EVENT_KIND, APU_EVENT_VOICE_ENDED);
		this.memory.writeValue(IO_APU_EVENT_CHANNEL, encodeChannel(type));
		this.memory.writeValue(IO_APU_EVENT_HANDLE, this.memory.resolveAssetHandle(info.id));
		this.memory.writeValue(IO_APU_EVENT_VOICE, info.voiceId >>> 0);
		this.memory.writeValue(IO_APU_EVENT_SEQ, this.eventSequence);
		this.irq.raise(IRQ_APU);
	}

}
