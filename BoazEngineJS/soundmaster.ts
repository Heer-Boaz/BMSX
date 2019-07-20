import { ISong } from "./song";
import { IEffect } from "./effect";
import { audio } from "../BoazEngineJS/engine";

export interface ISoundMaster {
	MusicBeingPlayed?: ISong;
	EffectBeingPlayed?: IEffect;
	OnEffectBufferEnd?(): void;
	OnMusicBufferEnd?(): void;
	PlayEffect?(effect: IEffect): void;
	PlayMusic?(song: ISong, stopCurrent: boolean): void;
	ResumeEffect?(): void;
	ResumeMusic?(): void;
	StopEffect?(): void;
	StopMusic?(): void;
}

export class SoundMaster implements ISoundMaster {
	private static LimitToOneEffect: boolean = true;
	public MusicBeingPlayed: ISong;
	public EffectBeingPlayed: IEffect;
	public OnMusicBufferEnd(): void {
		if (this.MusicBeingPlayed != null && this.MusicBeingPlayed.PlayMusicToNext) {
			let nextSong = this.MusicBeingPlayed.NextSong;
			this.MusicBeingPlayed = nextSong;
			this.PlayMusic(nextSong);
		}
		else this.MusicBeingPlayed = null;
	}

	public OnEffectBufferEnd(): void {
		this.EffectBeingPlayed = null;
	}

	public StopEffect(): void {
		if (!this.EffectBeingPlayed.AudioId) return;
		audio[`${this.EffectBeingPlayed.AudioId}`].pause();
		audio[`${this.EffectBeingPlayed.AudioId}`].currentTime = 0;
		this.EffectBeingPlayed = null;
	}

	private playEffect(audioId: number): void {
		audio[`${audioId}`].pause();
		audio[`${audioId}`].currentTime = 0;
		audio[`${audioId}`].play();
	}

	public PlayEffect(effect: IEffect): void {
		if (this.EffectBeingPlayed) {
			if (SoundMaster.LimitToOneEffect) {
				if (effect.Priority >= this.EffectBeingPlayed.Priority) {
					this.StopEffect();
					this.playEffect(effect.AudioId);
					this.EffectBeingPlayed = effect;
					return
				}
			}
		}
		else {
			this.playEffect(effect.AudioId);
			this.EffectBeingPlayed = effect;
		}
	}

	public StopMusic(): void {
		if (!this.MusicBeingPlayed.Music) return;
		audio[`${this.MusicBeingPlayed.Music}`].pause();
		audio[`${this.MusicBeingPlayed.Music}`].currentTime = 0;
		this.MusicBeingPlayed = null;
	}

	public PlayMusic(song: ISong, stopCurrent: boolean = true): void {
		if (stopCurrent)
			this.StopMusic();
		this.MusicBeingPlayed = song;
		audio[`${song.Music}`].pause();
		audio[`${song.Music}`].currentTime = 0;
		audio[`${song.Music}`].Loop = song.Loop || false;
		audio[`${song.Music}`].play();
	}

	public ResumeEffect(): void {
		audio[`${this.EffectBeingPlayed.AudioId}`].play();
	}

	public ResumeMusic(): void {
		audio[`${this.MusicBeingPlayed.Music}`].play();
	}
}