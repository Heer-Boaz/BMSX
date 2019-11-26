import { AudioId, BitmapId } from "../BoazEngineJS/resourceids";
import { Effect } from "../BoazEngineJS/effect";
import { Song } from "../BoazEngineJS/song";
import { ResourceType, GameLoader } from '../BoazEngineJS/gameloader';
import { images } from "../BoazEngineJS/engine";

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
		let replacement = GameLoader.loadresource(src, ResourceType.Image);
		img2src.set(key, src);
		images[key] = replacement;
	}

	public SoundEffectList: Map<AudioId, Effect> = new Map<AudioId, Effect>();
	public MusicList: Map<AudioId, Song> = new Map<AudioId, Song>();

	constructor() {
	}

	public PrepareGameResources(): void {
		this.loadViewResources();
		this.loadAudioResources();

	}

	private loadViewResources(): void {
		ResourceMaster.AddImg(BitmapId.Titel, "Belmont/Belmont_l1.png");
		this.loadBelmontResources();
		this.loadFXResources();
		this.loadMiscResources();
		this.loadFontResources();
		this.loadItemResources();
		this.loadFoeResources();
		this.loadNPCResources();
		this.loadDecorResources();
	}

	private loadFXResources(): void {
		ResourceMaster.AddImg(BitmapId.FoeKill_1, "FX/Foekill_1.png");
		ResourceMaster.AddImg(BitmapId.FoeKill_2, "FX/Foekill_2.png");
	}

	private loadDecorResources(): void {
		ResourceMaster.AddImg(BitmapId.Candle_1, "Decor/Candle_1.png");
		ResourceMaster.AddImg(BitmapId.Candle_2, "Decor/Candle_2.png");
		ResourceMaster.AddImg(BitmapId.GCandle_1, "Decor/GCandle_1.png");
		ResourceMaster.AddImg(BitmapId.GCandle_2, "Decor/GCandle_2.png");
		ResourceMaster.AddImg(BitmapId.Door, "Decor/Door.png");
	}

	private loadBelmontResources(): void {
		ResourceMaster.AddImg(BitmapId.Belmont_l1, "Belmont/Belmont_l1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_l2, "Belmont/Belmont_l2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_l3, "Belmont/Belmont_l3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_ld, "Belmont/Belmont_ld.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw1, "Belmont/Belmont_lw1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw2, "Belmont/Belmont_lw2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lw3, "Belmont/Belmont_lw3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd1, "Belmont/Belmont_lwd1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd2, "Belmont/Belmont_lwd2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lwd3, "Belmont/Belmont_lwd3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_ldead, "Belmont/Belmont_ldead.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lhitdown, "Belmont/Belmont_lhitdown.png");
		ResourceMaster.AddImg(BitmapId.Belmont_lhitfly, "Belmont/Belmont_lhitfly.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r1, "Belmont/Belmont_r1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r2, "Belmont/Belmont_r2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_r3, "Belmont/Belmont_r3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rd, "Belmont/Belmont_rd.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw1, "Belmont/Belmont_rw1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw2, "Belmont/Belmont_rw2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rw3, "Belmont/Belmont_rw3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd1, "Belmont/Belmont_rwd1.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd2, "Belmont/Belmont_rwd2.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rwd3, "Belmont/Belmont_rwd3.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rdead, "Belmont/Belmont_rdead.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rhitdown, "Belmont/Belmont_rhitdown.png");
		ResourceMaster.AddImg(BitmapId.Belmont_rhitfly, "Belmont/Belmont_rhitfly.png");
	}

	private loadMiscResources(): void {
		ResourceMaster.AddImg(BitmapId.HUD, "HUD/HUD.png");
		ResourceMaster.AddImg(BitmapId.HUD_EnergyStripe_belmont, "HUD/Energybarstripe_Belmont.png");
		ResourceMaster.AddImg(BitmapId.HUD_EnergyStripe_boss, "HUD/EnergybarStripe_Boss.png");
		ResourceMaster.AddImg(BitmapId.CurtainPart, "Misc/CurtainPart.png");
		ResourceMaster.AddImg(BitmapId.MenuCursor, "Menu/MenuCursor.png");
	}

	private loadFontResources(): void {
		ResourceMaster.AddImg(BitmapId.Font_A, "Font/Letter_A.png");
		ResourceMaster.AddImg(BitmapId.Font_B, "Font/Letter_B.png");
		ResourceMaster.AddImg(BitmapId.Font_C, "Font/Letter_C.png");
		ResourceMaster.AddImg(BitmapId.Font_D, "Font/Letter_D.png");
		ResourceMaster.AddImg(BitmapId.Font_E, "Font/Letter_E.png");
		ResourceMaster.AddImg(BitmapId.Font_F, "Font/Letter_F.png");
		ResourceMaster.AddImg(BitmapId.Font_G, "Font/Letter_G.png");
		ResourceMaster.AddImg(BitmapId.Font_H, "Font/Letter_H.png");
		ResourceMaster.AddImg(BitmapId.Font_I, "Font/Letter_I.png");
		ResourceMaster.AddImg(BitmapId.Font_J, "Font/Letter_J.png");
		ResourceMaster.AddImg(BitmapId.Font_K, "Font/Letter_K.png");
		ResourceMaster.AddImg(BitmapId.Font_L, "Font/Letter_L.png");
		ResourceMaster.AddImg(BitmapId.Font_M, "Font/Letter_M.png");
		ResourceMaster.AddImg(BitmapId.Font_N, "Font/Letter_N.png");
		ResourceMaster.AddImg(BitmapId.Font_O, "Font/Letter_O.png");
		ResourceMaster.AddImg(BitmapId.Font_P, "Font/Letter_P.png");
		ResourceMaster.AddImg(BitmapId.Font_Q, "Font/Letter_Q.png");
		ResourceMaster.AddImg(BitmapId.Font_R, "Font/Letter_R.png");
		ResourceMaster.AddImg(BitmapId.Font_S, "Font/Letter_S.png");
		ResourceMaster.AddImg(BitmapId.Font_T, "Font/Letter_T.png");
		ResourceMaster.AddImg(BitmapId.Font_U, "Font/Letter_U.png");
		ResourceMaster.AddImg(BitmapId.Font_V, "Font/Letter_V.png");
		ResourceMaster.AddImg(BitmapId.Font_W, "Font/Letter_W.png");
		ResourceMaster.AddImg(BitmapId.Font_X, "Font/Letter_X.png");
		ResourceMaster.AddImg(BitmapId.Font_IJ, "Font/Letter_IJ.png");
		ResourceMaster.AddImg(BitmapId.Font_Y, "Font/Letter_Y.png");
		ResourceMaster.AddImg(BitmapId.Font_Z, "Font/Letter_Z.png");
		ResourceMaster.AddImg(BitmapId.Font_0, "Font/Letter_0.png");
		ResourceMaster.AddImg(BitmapId.Font_1, "Font/Letter_1.png");
		ResourceMaster.AddImg(BitmapId.Font_2, "Font/Letter_2.png");
		ResourceMaster.AddImg(BitmapId.Font_3, "Font/Letter_3.png");
		ResourceMaster.AddImg(BitmapId.Font_4, "Font/Letter_4.png");
		ResourceMaster.AddImg(BitmapId.Font_5, "Font/Letter_5.png");
		ResourceMaster.AddImg(BitmapId.Font_6, "Font/Letter_6.png");
		ResourceMaster.AddImg(BitmapId.Font_7, "Font/Letter_7.png");
		ResourceMaster.AddImg(BitmapId.Font_8, "Font/Letter_8.png");
		ResourceMaster.AddImg(BitmapId.Font_9, "Font/Letter_9.png");
		ResourceMaster.AddImg(BitmapId.Font_Comma, "Font/Letter_Comma.png");
		ResourceMaster.AddImg(BitmapId.Font_Dot, "Font/Letter_Dot.png");
		ResourceMaster.AddImg(BitmapId.Font_Exclamation, "Font/Letter_Exclamation.png");
		ResourceMaster.AddImg(BitmapId.Font_QuestionMark, "Font/Letter_Question.png");
		ResourceMaster.AddImg(BitmapId.Font_Line, "Font/Letter_Line.png");
		ResourceMaster.AddImg(BitmapId.Font_Apostroph, "Font/Letter_Apostroph.png");
		ResourceMaster.AddImg(BitmapId.Font_Space, "Font/Letter_Space.png");
		ResourceMaster.AddImg(BitmapId.Font_Continue, "Font/Letter_Continue.png");
		ResourceMaster.AddImg(BitmapId.Font_Colon, "Font/Letter_Colon.png");
		ResourceMaster.AddImg(BitmapId.Font_Streep, "Font/Letter_Streep.png");
		ResourceMaster.AddImg(BitmapId.Font_Slash, "Font/Letter_Slash.png");
		ResourceMaster.AddImg(BitmapId.Font_Percent, "Font/Letter_Percent.png");
		ResourceMaster.AddImg(BitmapId.Font_SpeakStart, "Font/Letter_SpeakStart.png");
		ResourceMaster.AddImg(BitmapId.Font_SpeakEnd, "Font/Letter_SpeakEnd.png");
	}

	private loadItemResources(): void {
		ResourceMaster.AddImg(BitmapId.Chest, "Item/Chest.png");
		ResourceMaster.AddImg(BitmapId.Heart_big, "Item/Heart_big.png");
		ResourceMaster.AddImg(BitmapId.Heart_small, "Item/Heart_small.png");
		ResourceMaster.AddImg(BitmapId.Heart_fly, "Item/Heart_fly.png");
		ResourceMaster.AddImg(BitmapId.Key_big, "Item/Key_big.png");
		ResourceMaster.AddImg(BitmapId.Key_small, "Item/Key_small.png");
	}

	private loadFoeResources(): void {
		// ResourceMaster.AddImg(BitmapId.ZakFoe_1, "Foe/ZakFoe1.png");
		// ResourceMaster.AddImg(BitmapId.ZakFoe_2, "Foe/ZakFoe2.png");
		// ResourceMaster.AddImg(BitmapId.ZakFoe_3, "Foe/ZakFoe3.png");
		// ResourceMaster.AddImg(BitmapId.Chandelier_1, "Foe/chandelier.png");
		// ResourceMaster.AddImg(BitmapId.Hag_1, "Foe/Hag_1.png");
		// ResourceMaster.AddImg(BitmapId.Hag_2, "Foe/Hag_2.png");
	}

	private loadNPCResources(): void {
	}

	private loadAudioResources(): void {
		ResourceMaster.AddSnd(AudioId.Init, "Sound/Init.wav");
		ResourceMaster.AddSnd(AudioId.Fout, "Sound/Fout.wav");
		ResourceMaster.AddSnd(AudioId.Selectie, "Sound/Selectie.wav");
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