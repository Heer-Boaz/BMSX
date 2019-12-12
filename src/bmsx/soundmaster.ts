import { game } from "./engine";
import { id2res, AudioMeta, AudioType } from "./rompack";

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

		SM.gainNode = SM.sndContext.createGain();
		SM.gainNode.connect(SM.sndContext.destination);
		SM.setVolume(.5);

		SM.tracks = _audioResources;
	}

	private static async createNode(id: number): Promise<AudioBufferSourceNode> {
		let srcnode = SM.sndContext.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			SM.sndContext.decodeAudioData(game.rom.rom.slice(SM.tracks[id].start, SM.tracks[id].end)).then(buffer => srcnode.buffer = buffer).then(() => resolve(srcnode));
		});
	}

	private static playNode(_track: AudioMeta, node: AudioBufferSourceNode): void {
		try {
			node.connect(SM.gainNode);
			if (_track.loop !== null) {
				node.loop = true;
				node.loopStart = _track.loop;
			}
			else node.loop = false;
			node.start(0);
		} catch {
		}
	}

	public static play(id: number): void {
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

	private static stop(id: number): void {
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

	public static setVolume(volume: number): void {
		SM.gainNode.gain.setValueAtTime(SM.gainNode.gain.defaultValue * volume, SM.sndContext.currentTime + .1);
	}

	// public static setMusicVolume(volume: number): void {
	// 	SM.gainNode.gain.setValueAtTime(volume / 10, SM.sndContext.currentTime + .1);
	// }
}