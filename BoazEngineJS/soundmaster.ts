import { Song } from "./song";
import { Effect } from "./effect";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { AudioId } from "../src/resourceids";
import { game, RomResource, id2res } from "./engine";

export class SM {
	private static musicContext: AudioContext;
	private static effectContext: AudioContext;
	private static audioResources: id2res;
	private static currentEffectNode: AudioBufferSourceNode;
	private static currentMusicNode: AudioBufferSourceNode;

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

	public static init(_audioResources: { [key: number]: RomResource; }, _effectList: Map<AudioId, Effect>, _musicList: Map<AudioId, Song>) {
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

	public static play(_track: Effect | Song): void {
		let trackid: number;
		if ((_track as Song).Music !== undefined) {
			SM.StopMusic();

			SM.MusicBeingPlayed = <Song>_track;
			trackid = (<Song>_track).Music;

			SM.createNode(trackid, SM.musicContext).then(node => {
				SM.currentMusicNode = node;
				node.connect(SM.musicContext.destination);
				node.loop = (<Song>_track).Loop || false;
				node.start(0);
			});
		}
		else {
			SM.StopEffect();

			SM.EffectBeingPlayed = <Effect>_track;
			trackid = (<Effect>_track).AudioId;

			SM.createNode(trackid, SM.effectContext).then(node => {
				SM.currentEffectNode = node;
				node.connect(SM.effectContext.destination);
				node.loop = false;
				node.start(0);
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

	public static PlayEffect(effect: Effect): void {
		if (!SM.LimitToOneEffect || !SM.EffectBeingPlayed || (effect.Priority >= SM.EffectBeingPlayed.Priority)) {
			this.play(effect);
		}
	}

	public static StopMusic(): void {
		if (SM.MusicBeingPlayed && SM.MusicBeingPlayed.Music) {
			if (SM.currentMusicNode) {
				SM.currentMusicNode.stop();
				SM.currentMusicNode.disconnect();
				SM.currentMusicNode = null;
			}
		}

		SM.MusicBeingPlayed = null;
	}

	public static PlayMusic(song: Song, stopCurrent: boolean = true): void {
		this.play(song);
	}

	public static ResumeEffect(): void {
		if (!SM.EffectBeingPlayed || !SM.EffectBeingPlayed.AudioId) return;
		console.warn("ResumeEffect not implemented :-(");
	}

	public static ResumeMusic(): void {
		if (!SM.MusicBeingPlayed || !SM.MusicBeingPlayed.Music) return;
		console.warn("ResumeMusic not implemented :-(");
	}

	public static SetEffectsVolume(volume: number): void {
	}

	public static SetMusicVolume(volume: number): void {
	}
}