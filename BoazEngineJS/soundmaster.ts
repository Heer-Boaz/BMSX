import { Song } from "./song";
import { Effect } from "./effect";

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
		SoundMaster.audio.get(SoundMaster.EffectBeingPlayed.AudioId).pause();
		SoundMaster.audio.get(SoundMaster.EffectBeingPlayed.AudioId).currentTime = 0;
		SoundMaster.EffectBeingPlayed = null;
	}

	private static playEffect(audioId: number): void {
		SoundMaster.audio.get(audioId).pause();
		SoundMaster.audio.get(audioId).currentTime = 0;
		SoundMaster.audio.get(audioId).play();
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
		if (!SoundMaster.MusicBeingPlayed || !SoundMaster.MusicBeingPlayed.Music) return;
		SoundMaster.audio.get(SoundMaster.MusicBeingPlayed.Music).pause();
		SoundMaster.audio.get(SoundMaster.MusicBeingPlayed.Music).currentTime = 0;
		SoundMaster.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		if (stopCurrent)
			SoundMaster.StopMusic();
		SoundMaster.MusicBeingPlayed = song;
		SoundMaster.audio.get(song.Music).pause();
		SoundMaster.audio.get(song.Music).currentTime = 0;
		SoundMaster.audio.get(song.Music).loop = song.Loop || false;
		SoundMaster.audio.get(song.Music).play();
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
		throw Error("Implementeer deze meuk!");
	}

	public static SetMusicVolume(volume: number): void {
		throw Error("Implementeer deze meuk!");
	}
}