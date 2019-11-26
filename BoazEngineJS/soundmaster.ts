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
		if (SoundMaster.MusicBeingPlayed && SoundMaster.MusicBeingPlayed.NextSong) {
			let nextSong = SoundMaster.MusicBeingPlayed.NextSong;
			SoundMaster.MusicBeingPlayed = nextSong;
			SoundMaster.PlayMusic(nextSong);
		}
		else SoundMaster.MusicBeingPlayed = null;
	}

	public static OnEffectBufferEnd(): void {
		SoundMaster.EffectBeingPlayed = null;
	}

	public static StopEffect(): void {
		if (!SoundMaster.EffectBeingPlayed.AudioId) return;
		audio[`${SoundMaster.EffectBeingPlayed.AudioId}`].pause();
		audio[`${SoundMaster.EffectBeingPlayed.AudioId}`].currentTime = 0;
		SoundMaster.EffectBeingPlayed = null;
	}

	private static playEffect(audioId: number): void {
		audio[`${audioId}`].pause();
		audio[`${audioId}`].currentTime = 0;
		audio[`${audioId}`].play();
	}

	public static PlayEffect(effect: Effect): void {
		if (SoundMaster.EffectBeingPlayed) {
			if (SoundMaster.LimitToOneEffect) {
				if (effect.Priority >= SoundMaster.EffectBeingPlayed.Priority) {
					SoundMaster.StopEffect();
					SoundMaster.playEffect(effect.AudioId);
					SoundMaster.EffectBeingPlayed = effect;
					return
				}
			}
		}
		else {
			SoundMaster.playEffect(effect.AudioId);
			SoundMaster.EffectBeingPlayed = effect;
		}
	}

	public static StopMusic(): void {
		if (!SoundMaster.MusicBeingPlayed) return;
		if (!SoundMaster.MusicBeingPlayed.Music) return;
		audio[`${SoundMaster.MusicBeingPlayed.Music}`].pause();
		audio[`${SoundMaster.MusicBeingPlayed.Music}`].currentTime = 0;
		SoundMaster.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		if (stopCurrent)
			SoundMaster.StopMusic();
		SoundMaster.MusicBeingPlayed = song;
		audio[`${song.Music}`].pause();
		audio[`${song.Music}`].currentTime = 0;
		audio[`${song.Music}`].Loop = song.Loop || false;
		audio[`${song.Music}`].play();
	}

	public static ResumeEffect(): void {
		audio[`${SoundMaster.EffectBeingPlayed.AudioId}`].play();
	}

	public static ResumeMusic(): void {
		audio[`${SoundMaster.MusicBeingPlayed.Music}`].play();
	}

	public static SetEffectsVolume(volume: number): void {
		throw Error("Implementeer deze meuk!");
	}

	public static SetMusicVolume(volume: number): void {
		throw Error("Implementeer deze meuk!");
	}
}