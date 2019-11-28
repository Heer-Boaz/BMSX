import { AudioId, BitmapId } from "./resourceids";
import { Effect } from "../BoazEngineJS/effect";
import { Song } from "../BoazEngineJS/song";
// import { ResourceType, GameLoader } from '../BoazEngineJS/gameloader';
// import { images } from "../BoazEngineJS/engine";

export var img2src: Map<BitmapId, string> = new Map<BitmapId, string>();
export var snd2src: Map<AudioId, string> = new Map<AudioId, string>();

export class ResourceMaster {
	private static _instance: ResourceMaster;
	public static get _(): ResourceMaster {
		return ResourceMaster._instance != null ? ResourceMaster._instance : (ResourceMaster._instance = new ResourceMaster());
	}

	public static get Sound(): Map<AudioId, Effect> {
		return ResourceMaster._.SoundEffectList;
	}

	public static get Music(): Map<AudioId, Song> {
		return ResourceMaster._.MusicList;
	}

	public static AddImg(key: BitmapId, src: string): void {
		img2src.set(key, src);
	}

	public static AddSnd(key: AudioId, src: string): void {
		snd2src.set(key, src);
	}

	public static reloadImg(key: BitmapId, src: string): void {
		// let replacement = GameLoader.loadresource(src, ResourceType.Image);
		// img2src.set(key, src);
		// images[key] = replacement;
	}

	public SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();

	constructor() {
	}

	public PrepareGameResources(): void {
		this.loadAudioResources();

	}
	private loadAudioResources(): void {
		this.SoundEffectList.set(AudioId.Init, { AudioId: AudioId.Init, Priority: -1 });
		this.SoundEffectList.set(AudioId.Fout, { AudioId: AudioId.Fout, Priority: 0 });
		this.SoundEffectList.set(AudioId.Selectie, { AudioId: AudioId.Selectie, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Heart, "Sound/Heart.wav");
		// this.SoundEffectList.set(AudioId.Heart, { AudioId: AudioId.Heart, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Hit, "Sound/Hit.wav");
		// this.SoundEffectList.set(AudioId.Hit, { AudioId: AudioId.Hit, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.ItemDrop, "Sound/Item_drop.wav");
		// this.SoundEffectList.set(AudioId.ItemDrop, { AudioId: AudioId.ItemDrop, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.ItemPickup, "Sound/Item_pickup.wav");
		// this.SoundEffectList.set(AudioId.ItemPickup, { AudioId: AudioId.ItemPickup, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.KeyGrab, "Sound/Key_grab.wav");
		// this.SoundEffectList.set(AudioId.KeyGrab, { AudioId: AudioId.KeyGrab, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Knife, "Sound/Knife.wav");
		// this.SoundEffectList.set(AudioId.Knife, { AudioId: AudioId.Knife, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Land, "Sound/Land.wav");
		// this.SoundEffectList.set(AudioId.Land, { AudioId: AudioId.Land, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Lightning, "Sound/Lightning.wav");
		// this.SoundEffectList.set(AudioId.Lightning, { AudioId: AudioId.Lightning, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Munnies, "Sound/Munnies.wav");
		// this.SoundEffectList.set(AudioId.Munnies, { AudioId: AudioId.Munnies, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.PlayerDamage, "Sound/Player_damage.wav");
		// this.SoundEffectList.set(AudioId.PlayerDamage, { AudioId: AudioId.PlayerDamage, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Portal, "Sound/Portal.wav");
		// this.SoundEffectList.set(AudioId.Portal, { AudioId: AudioId.Portal, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Wall_break, "Sound/Wall_break.wav");
		// this.SoundEffectList.set(AudioId.Wall_break, { AudioId: AudioId.Wall_break, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Whip, "Sound/Whip.wav");
		// this.SoundEffectList.set(AudioId.Whip, { AudioId: AudioId.Whip, Priority: 0 });
		// ResourceMaster.AddSnd(AudioId.Boss, "Music/Boss.wav");
		// this.MusicList.set(AudioId.Boss, { Music: AudioId.Boss, Loop: true, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Ending, "Music/Ending.wav");
		// this.MusicList.set(AudioId.Ending, { Music: AudioId.Ending, Loop: true, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Humiliation, "Music/Humiliation.wav");
		// this.MusicList.set(AudioId.Humiliation, { Music: AudioId.Humiliation, Loop: false, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Huray, "Music/Huray.wav");
		// this.MusicList.set(AudioId.Huray, { Music: AudioId.Huray, Loop: false, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Ohnoes, "Music/Ohnoes.wav");
		// this.MusicList.set(AudioId.Ohnoes, { Music: AudioId.Ohnoes, Loop: false, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Prologue, "Music/Prologue.wav");
		// this.MusicList.set(AudioId.Prologue, { Music: AudioId.Prologue, Loop: false, NextSong: null });
		// ResourceMaster.AddSnd(AudioId.Stage, "Music/Stage.wav");
		// this.MusicList.set(AudioId.Stage, { Music: AudioId.Stage, Loop: true, NextSong: null });
	}
}