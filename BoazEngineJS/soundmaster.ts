import { Song } from "./song";
import { Effect } from "./effect";
import { audio } from "../BoazEngineJS/engine";

// export interface ISoundMaster {
// 	MusicBeingPlayed?: ISong;
// 	EffectBeingPlayed?: IEffect;
// 	OnEffectBufferEnd?(): void;
// 	OnMusicBufferEnd?(): void;
// 	PlayEffect?(effect: IEffect): void;
// 	PlayMusic?(song: ISong, stopCurrent: boolean): void;
// 	ResumeEffect?(): void;
// 	ResumeMusic?(): void;
// 	StopEffect?(): void;
// 	StopMusic?(): void;
// }

export class SoundMaster {
	private static LimitToOneEffect: boolean = true;
	public static MusicBeingPlayed: Song;
	public static EffectBeingPlayed: Effect;
	public static OnMusicBufferEnd(): void {
		if (this.MusicBeingPlayed && this.MusicBeingPlayed.NextSong) {
			let nextSong = this.MusicBeingPlayed.NextSong;
			this.MusicBeingPlayed = nextSong;
			this.PlayMusic(nextSong);
		}
		else this.MusicBeingPlayed = null;
	}

	public static OnEffectBufferEnd(): void {
		this.EffectBeingPlayed = null;
	}

	public static StopEffect(): void {
		if (!this.EffectBeingPlayed.AudioId) return;
		audio[`${this.EffectBeingPlayed.AudioId}`].pause();
		audio[`${this.EffectBeingPlayed.AudioId}`].currentTime = 0;
		this.EffectBeingPlayed = null;
	}

	private static playEffect(audioId: number): void {
		audio[`${audioId}`].pause();
		audio[`${audioId}`].currentTime = 0;
		audio[`${audioId}`].play();
	}

	public static PlayEffect(effect: Effect): void {
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

	public static StopMusic(): void {
		if (!this.MusicBeingPlayed.Music) return;
		audio[`${this.MusicBeingPlayed.Music}`].pause();
		audio[`${this.MusicBeingPlayed.Music}`].currentTime = 0;
		this.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		if (stopCurrent)
			this.StopMusic();
		this.MusicBeingPlayed = song;
		audio[`${song.Music}`].pause();
		audio[`${song.Music}`].currentTime = 0;
		audio[`${song.Music}`].Loop = song.Loop || false;
		audio[`${song.Music}`].play();
	}

	public static ResumeEffect(): void {
		audio[`${this.EffectBeingPlayed.AudioId}`].play();
	}

	public static ResumeMusic(): void {
		audio[`${this.MusicBeingPlayed.Music}`].play();
	}

	public static SetEffectsVolume(volume: number): void {
		throw Error("Implementeer deze meuk!");
	}

	public static SetMusicVolume(volume: number): void {
		throw Error("Implementeer deze meuk!");
	}
}