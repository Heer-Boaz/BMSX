import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { AudioId } from "../src/resourceids";
import { game, RomResource, id2res } from "./engine";

export interface Effect {
	AudioId: number;
	Priority: number;
	loop?: boolean;
}

export interface Song {
	AudioId: number;
	NextSong: Song;
	loop?: boolean;
}

export class SM {
	private static musicContext: AudioContext;
	private static effectContext: AudioContext;
	private static audioResources: id2res;
	private static currentEffectNode: AudioBufferSourceNode;
	private static currentMusicNode: AudioBufferSourceNode;

	private static LimitToOneEffect: boolean = true;
	public static MusicBeingPlayed: Song;
	public static EffectBeingPlayed: Effect;
	public static SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public static MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();

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

	public static init(_audioResources: { [key: number]: RomResource; }) {
		SM.effectContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});
		SM.musicContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});

		SM.audioResources = _audioResources;
	}

	private static async createNode(id: number, ctx: AudioContext): Promise<AudioBufferSourceNode> {
		let srcnode = ctx.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			ctx.decodeAudioData(game.rom.rom.slice(SM.audioResources[id].start, SM.audioResources[id].end)).then(buffer => srcnode.buffer = buffer).then(() => resolve(srcnode));
		});
	}

	private static playNode(_track: Effect | Song, node: AudioBufferSourceNode, ctx: AudioContext): void {
		SM.currentMusicNode = node;
		node.connect(ctx.destination);
		node.loop = _track.loop || false;
		node.start(0);
	}

	private static _playSong(_track: Song): void {
		if (_track.AudioId !== undefined) {
			SM.stopMusic();

			SM.MusicBeingPlayed = _track as Song;
			let trackid = _track.AudioId;

			SM.createNode(trackid, SM.musicContext).then(node => {
				SM.currentMusicNode = node;
				SM.playNode(_track, node, SM.musicContext);
			});
		}
	}

	public static _playEffect(_track: Effect): void {
		if (_track.AudioId !== undefined) {
			SM.StopEffect();

			SM.EffectBeingPlayed = _track;
			let trackid = _track.AudioId;

			SM.createNode(trackid, SM.effectContext).then(node => {
				SM.currentEffectNode = node;
				SM.playNode(_track, node, SM.effectContext);
			});
		}
	}

	public static StopEffect(): void {
		if (SM.EffectBeingPlayed && SM.EffectBeingPlayed.AudioId) {
			if (SM.currentEffectNode) {
				SM.currentEffectNode.stop();
				SM.currentEffectNode.disconnect();
				SM.currentEffectNode = null;
			}
		}

		SM.EffectBeingPlayed = null;
	}

	public static playEffect(id: AudioId): void {
		let effect = SM.SoundEffectList.get(id);
		if (!SM.LimitToOneEffect || !SM.EffectBeingPlayed || (effect.Priority >= SM.EffectBeingPlayed.Priority)) {
			this._playEffect(effect);
		}
	}

	public static stopMusic(): void {
		if (SM.MusicBeingPlayed && SM.MusicBeingPlayed.AudioId) {
			if (SM.currentMusicNode) {
				SM.currentMusicNode.stop();
				SM.currentMusicNode.disconnect();
				SM.currentMusicNode = null;
			}
		}

		SM.MusicBeingPlayed = null;
	}

	public static playMusic(id: AudioId, stopCurrent: boolean = true): void {
		this._playSong(SM.MusicList.get(id));
	}

	public static resumeEffect(): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		console.warn("ResumeEffect not implemented :-(");
	}

	public static resumeMusic(): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.AudioId) return;
		console.warn("ResumeMusic not implemented :-(");
	}

	public static setEffectsVolume(volume: number): void {
		console.warn("Volume not implemented :-(");
	}

	public static setMusicVolume(volume: number): void {
		console.warn("Volume not implemented :-(");
	}
}