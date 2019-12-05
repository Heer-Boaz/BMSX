import { Song } from "./song";
import { Effect } from "./effect";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { AudioId } from "../src/resourceids";

type id2track = { [key: number]: ArrayBuffer; };
export class SM {
	private static musicContext: AudioContext;
	private static effectContext: AudioContext;
	private static audioTracks: id2track;
	private static currentEffectNode: AudioBufferSourceNode;
	private static currentMusicNode: AudioBufferSourceNode;
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

	public static init(_audio: Map<number, HTMLAudioElement>, _audiobuffers: { [key: number]: ArrayBuffer; }, _effectList: Map<AudioId, Effect>, _musicList: Map<AudioId, Song>) {
		SM.effectContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});
		SM.musicContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});

		SM.audio = _audio;
		SM.audioTracks = {};
		_effectList.forEach((_, id) => {
			let srcnode = SM.effectContext.createBufferSource();
			SM.effectContext.decodeAudioData(_audiobuffers[id]).then(buffer => srcnode.buffer = buffer).then(() => {
				SM.audioTracks[id].connect(SM.effectContext.destination);
			});
		});
		_musicList.forEach((_, id) => {
			let srcnode = SM.musicContext.createBufferSource();
			SM.musicContext.decodeAudioData(_audiobuffers[id]).then(buffer => srcnode.buffer = buffer).then(() => {
				SM.audioTracks[id].connect(SM.musicContext.destination);
			});
		});
	}

	private static createNode(id: number, ctx: AudioContext): Promise<AudioBufferSourceNode> {
		let srcnode = ctx.createBufferSource();
		return new Promise<AudioBufferSourceNode>(() => {
			ctx.decodeAudioData(SM[id]).then(buffer => srcnode.buffer = buffer).then(() => Promise.resolve(srcnode));
		});
	}

	public static play(_track: Effect | Song): void {
		let trackid: number;
		let loop = false;
		if ((_track as Song).Music) {
			SM.StopMusic();

			SM.MusicBeingPlayed = <Song>_track;
			trackid = (<Song>_track).Music;

			SM.createNode(trackid, SM.musicContext).then(node => {
				node.connect(SM.musicContext.destination);
				node.loop = (<Song>_track).Loop || false;
				node.start(0);
			}
		}
		else {
			SM.StopEffect();
			SM.EffectBeingPlayed = <Effect>_track;
			trackid = (<Effect>_track).AudioId;
		}


		SM.audioTracks[trackid].loop = loop;
		SM.audioTracks[trackid].start(0);
	}

	public static StopEffect(): void {
		if (SM.EffectBeingPlayed && SM.EffectBeingPlayed.AudioId) {
			SM.audioTracks[SM.EffectBeingPlayed.AudioId].stop();
		}

		SM.EffectBeingPlayed = null;
	}

	public static PlayEffect(effect: Effect): void {
		if (!SM.LimitToOneEffect || !SM.EffectBeingPlayed || (effect.Priority >= SM.EffectBeingPlayed.Priority)) {
			this.play(effect);
		}
	}

	public static StopMusic(): void {
		if (SM.MusicBeingPlayed && SM.MusicBeingPlayed.Music) {
			SM.audioTracks[SM.MusicBeingPlayed.Music].stop();
		}
		SM.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		this.play(song);
	}

	public static ResumeEffect(): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		SM.audioTracks[SM.EffectBeingPlayed.AudioId].start();
	}

	public static ResumeMusic(): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.Music) return;
		SM.audioTracks[SM.MusicBeingPlayed.Music].start();
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