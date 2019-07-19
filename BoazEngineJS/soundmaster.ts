import { ISong } from "./song";
import { IEffect } from "./effect";
import { Game as BDX } from "../BoazEngineJS/engine";

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
			BDX._.PlayMusic(nextSong.Music, nextSong.Loop);
		}
		else this.MusicBeingPlayed = null;
	}

	public OnEffectBufferEnd(): void {
		this.EffectBeingPlayed = null;
	}

	public StopEffect(): void {
		BDX._.StopEffect();
		this.EffectBeingPlayed = null;
	}

	private playEffect(audioId: number): void {
		BDX._.PlayEffect(audioId);
	}

	public PlayEffect(effect: IEffect): void {
		if (this.EffectBeingPlayed != null) {
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
		BDX._.StopMusic();
		this.MusicBeingPlayed = null;
	}

	public PlayMusic(song: ISong, stopCurrent: boolean = true): void {
		if (stopCurrent)
			this.StopMusic();
		this.MusicBeingPlayed = song;
		BDX._.PlayMusic(song.Music, song.Loop);
	}

	public ResumeEffect(): void {
		BDX._.ResumeEffect();
	}

	public ResumeMusic(): void {
		BDX._.ResumeMusic();
	}
}