import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { AudioId } from "../src/resourceids";
import { game } from "./engine";
import { id2res, AudioMeta, AudioType } from "../lib/rompack";

export class SM {
	private static limitToOneEffect: boolean = true;

	private static tracks: id2res;
	private static sndContext: AudioContext;

	private static currentMusicNode: AudioBufferSourceNode;
	private static currentEffectNode: AudioBufferSourceNode;
	public static currentEffectAudio: AudioMeta;
	public static currentMusicAudio: AudioMeta;
	private static gainNode: GainNode;

	public static init(_audioResources: id2res) {
		SM.sndContext = new AudioContext({
			latencyHint: 'interactive',
			sampleRate: 44100,
		});

		SM.tracks = _audioResources;
		// SM.gainNode = new GainNode(this.sndContext);
	}

	private static async createNode(id: number): Promise<AudioBufferSourceNode> {
		let srcnode = SM.sndContext.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			SM.sndContext.decodeAudioData(game.rom.rom.slice(SM.tracks[id].start, SM.tracks[id].end)).then(buffer => srcnode.buffer = buffer).then(() => resolve(srcnode));
		});
	}

	private static playNode(_track: AudioMeta, node: AudioBufferSourceNode): void {
		try {
			node.connect(SM.sndContext.destination);
			if (_track.loop !== null) {
				node.loop = true;
				node.loopStart = _track.loop;
			}
			else node.loop = false;
			node.start(0);
		} catch {
		}
	}

	public static play(id: AudioId): void {
		let track = SM.tracks[id]?.audiometa;
		if (!track) return;

		switch (track.audiotype) {
			case AudioType.effect:
				if (SM.limitToOneEffect && SM.currentEffectAudio && track.priority < SM.currentEffectAudio.priority) return;
				SM.stopEffect();
				SM.createNode(id).then(node => {
					SM.currentEffectNode = node;
					node.onended = (ev) => SM.currentEffectAudio = null;
					SM.playNode(track, node);
				});
				break;
			case AudioType.music:
				SM.stopMusic();
				SM.createNode(id).then(node => {
					SM.currentMusicNode = node;
					node.onended = (ev) => SM.currentMusicAudio = null;
					SM.playNode(track, node);
				});
				break;
		}
	}

	private static stop(id: AudioId): void {
		switch (SM.tracks[id].audiometa.audiotype) {
			case AudioType.effect: SM.stopEffect(); break;
			case AudioType.music: SM.stopMusic(); break;
		}
	}

	public static stopEffect(): void {
		SM.currentEffectNode?.disconnect();
		SM.currentEffectNode?.stop();
		SM.currentEffectNode = null;
	}

	public static stopMusic(): void {
		SM.currentMusicNode?.stop();
		SM.currentMusicNode?.disconnect();
		SM.currentMusicNode = null;
	}

	public static resumeEffect(): void {
		console.warn("ResumeEffect not implemented :-(");
	}

	public static resumeMusic(): void {
		console.warn("ResumeMusic not implemented :-(");
	}

	public static setEffectsVolume(volume: number): void {
		console.warn("Volume not implemented :-(");
	}

	public static setMusicVolume(volume: number): void {
		console.warn("Volume not implemented :-(");
	}
}