import { Song } from "./song";
import { Effect } from "./effect";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { ImageId2Url } from './interfaces';
import { AudioId } from "../src/resourceids";

type id2source = { [key: number]: MediaElementAudioSourceNode; };
export class SM {
	private static musicContext: AudioContext;
	private static effectContext: AudioContext;
	private static musicSources: id2source;
	private static effectSources: id2source;
	private static audio: Map<number, HTMLAudioElement>;

	private static LimitToOneEffect: boolean = true;
	public static MusicBeingPlayed: Song;
	public static EffectBeingPlayed: Effect;
	// public static OnMusicBufferEnd(): void {
	// 	if (SM.MusicBeingPlayed && SM.MusicBeingPlayed.NextSong) {
	// 		let nextSong = SM.MusicBeingPlayed.NextSong;
	// 		SM.MusicBeingPlayed = nextSong;
	// 		SM.PlayMusic(nextSong);
	// 	}
	// 	else SM.MusicBeingPlayed = null;
	// }

	// public static OnEffectBufferEnd(): void {
	// 	SM.EffectBeingPlayed = null;
	// }

	public static init(audio: Map<number, HTMLAudioElement>, effectList: Map<AudioId, Effect>, musicList: Map<AudioId, Song>) {
		SM.musicContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});
		SM.effectContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});

		SM.audio = audio;
		SM.effectSources = {};
		SM.musicSources = {};
		effectList.forEach((effect, id) => SM.effectSources[id] = SM.effectContext.createMediaElementSource(audio.get(id)));
		musicList.forEach((song, id) => SM.musicSources[id] = SM.musicContext.createMediaElementSource(audio.get(id)));
	}


	public static StopEffect(): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		let audio = SM.audio.get(SM.EffectBeingPlayed.AudioId);
		audio.pause();
		audio.currentTime = 0;
		SM.EffectBeingPlayed = null;
	}

	private static playEffect(audioId: number): void {
		let audio = SM.audio.get(audioId);
		audio.currentTime = 0;
		audio.volume = GO.EffectsVolumePercentage / 100;
		audio.play();
	}

	public static PlayEffect(effect: Effect): void {
		if (SM.EffectBeingPlayed) {
			if (SM.LimitToOneEffect) {
				if (effect.Priority >= SM.EffectBeingPlayed.Priority) {
					SM.StopEffect();
					SM.playEffect(effect.AudioId);
					SM.EffectBeingPlayed = effect;
					return;
				}
			}
		}
		else {
			SM.playEffect(effect.AudioId);
			SM.EffectBeingPlayed = effect;
		}
	}

	public static StopMusic(): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.Music) return;
		let mus = SM.audio.get(SM.MusicBeingPlayed.Music);
		mus.pause();
		mus.currentTime = 0;
		SM.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		if (stopCurrent)
			SM.StopMusic();
		SM.MusicBeingPlayed = song;
		let mus = SM.audio.get(song.Music);
		mus.pause();
		mus.currentTime = 0;
		mus.loop = song.Loop || false;
		mus.volume = GO.MusicVolumePercentage / 100;
		// mus.play();

		SM.musicSources[song.Music].connect(SM.musicContext.destination);
		SM.musicSources[song.Music].mediaElement.;
	}

	public static ResumeEffect(): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		SM.audio.get(SM.EffectBeingPlayed.AudioId).play();
	}

	public static ResumeMusic(): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.Music) return;
		SM.audio.get(SM.MusicBeingPlayed.Music).play();
	}

	public static SetEffectsVolume(volume: number): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		let audio = SM.audio.get(SM.EffectBeingPlayed.AudioId);
		SM.setPlayingAudioVolume(audio, volume);
	}

	public static SetMusicVolume(volume: number): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.Music) return;
		let audio = SM.audio.get(SM.MusicBeingPlayed.Music);
		SM.setPlayingAudioVolume(audio, volume);
	}

	private static setPlayingAudioVolume(audio: HTMLAudioElement, volume: number): void {
		if (!audio.paused) audio.pause();
		audio.volume = volume;
		audio.play();
	}
}