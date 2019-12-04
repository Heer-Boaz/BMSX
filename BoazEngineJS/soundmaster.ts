import { Song } from "./song";
import { Effect } from "./effect";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";

export class SoundMaster {
	public static audio: Map<number, HTMLAudioElement>;

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
		if (!SoundMaster.EffectBeingPlayed || !SoundMaster.EffectBeingPlayed.AudioId) return;
		let audio = SoundMaster.audio.get(SoundMaster.EffectBeingPlayed.AudioId);
		audio.pause();
		audio.currentTime = 0;
		SoundMaster.EffectBeingPlayed = null;
	}

	private static playEffect(audioId: number): void {
		let audio = SoundMaster.audio.get(audioId);
		audio.currentTime = 0;
		audio.volume = GO.EffectsVolumePercentage / 100;
		audio.play();
	}

	public static PlayEffect(effect: Effect): void {
		if (SoundMaster.EffectBeingPlayed) {
			if (SoundMaster.LimitToOneEffect) {
				if (effect.Priority >= SoundMaster.EffectBeingPlayed.Priority) {
					SoundMaster.StopEffect();
					SoundMaster.playEffect(effect.AudioId);
					SoundMaster.EffectBeingPlayed = effect;
					return;
				}
			}
		}
		else {
			SoundMaster.playEffect(effect.AudioId);
			SoundMaster.EffectBeingPlayed = effect;
		}
	}

	public static StopMusic(): void {
		if (!SoundMaster.MusicBeingPlayed || !SoundMaster.MusicBeingPlayed.Music) return;
		let mus = SoundMaster.audio.get(SoundMaster.MusicBeingPlayed.Music);
		mus.pause();
		mus.currentTime = 0;
		SoundMaster.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		if (stopCurrent)
			SoundMaster.StopMusic();
		SoundMaster.MusicBeingPlayed = song;
		let mus = SoundMaster.audio.get(song.Music);
		mus.pause();
		mus.currentTime = 0;
		mus.loop = song.Loop || false;
		mus.volume = GO.MusicVolumePercentage / 100;
		mus.play();
	}

	public static ResumeEffect(): void {
		if (!SoundMaster.EffectBeingPlayed || !SoundMaster.EffectBeingPlayed.AudioId) return;
		SoundMaster.audio.get(SoundMaster.EffectBeingPlayed.AudioId).play();
	}

	public static ResumeMusic(): void {
		if (!SoundMaster.MusicBeingPlayed || !SoundMaster.MusicBeingPlayed.Music) return;
		SoundMaster.audio.get(SoundMaster.MusicBeingPlayed.Music).play();
	}

	public static SetEffectsVolume(volume: number): void {
		if (!SoundMaster.EffectBeingPlayed || !SoundMaster.EffectBeingPlayed.AudioId) return;
		let audio = SoundMaster.audio.get(SoundMaster.EffectBeingPlayed.AudioId);
		SoundMaster.setPlayingAudioVolume(audio, volume);
	}

	public static SetMusicVolume(volume: number): void {
		if (!SoundMaster.MusicBeingPlayed || !SoundMaster.MusicBeingPlayed.Music) return;
		let audio = SoundMaster.audio.get(SoundMaster.MusicBeingPlayed.Music);
		SoundMaster.setPlayingAudioVolume(audio, volume);
	}

	private static setPlayingAudioVolume(audio: HTMLAudioElement, volume: number): void {
		if (!audio.paused) audio.pause();
		audio.volume = volume;
		audio.play();
	}
}