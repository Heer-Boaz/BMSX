// import { BStopwatch } from "../BoazEngineJS/btimer";
// import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
// import { GameController as C, GameController } from './gamecontroller';

import * as engine from "../BoazEngineJS/engine";
import { GameModel, Chapter } from './sintervaniamodel';
import { GameController } from "./gamecontroller";
import { GameView } from './gameview';
import { GameState } from "../BoazEngineJS/model";
import { GameConstants } from './gameconstants';
import { LoadGame } from '../BoazEngineJS/gamestateloader';
import { RomResource } from '../BoazEngineJS/rom';
import { DrawBitmap } from '../BoazEngineJS/view';
import { resolve } from "dns";

// function readStream(stream: ReadableStream): Uint8Array {
// 	const reader = stream.getReader();
// 	let result = new Uint8Array();
// 	let charsReceived = 0;

// 	// read() returns a promise that resolves
// 	// when a value has been received
// 	reader.read().then(function processText({ done, value }) {
// 		// Result objects contain two properties:
// 		// done  - true if the stream has already given you all its data.
// 		// value - some data. Always undefined when done is true.
// 		if (done) {
// 			console.log("Stream complete");
// 			return;
// 		}

// 		charsReceived += value.length;
// 		const chunk = value;
// 		console.log('Read ' + charsReceived + ' characters so far. Current chunk = ' + chunk);

// 		result. += chunk;

// 		// Read some more, and call this function again
// 		return reader.read().then(processText);
// 	});
// }

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		let img = new Image();
		img.onload = (e => resolve(img));
		img.onerror = (e => {
			reject(new Error(`Failed to load image's URL: ${url}`));
		});
		img.src = url;
	});
}

async function loadRom(): Promise<ArrayBuffer> {
	return fetch("http://127.0.0.1:8887/rom/packed.rom")
		.then(response => response.arrayBuffer())
		.catch(e => { console.error(e); return null; });
}

async function loadResourceList(): Promise<RomResource[]> {
	return fetch("http://127.0.0.1:8887/rom/romtable.json")
		.then(response => response.json())
		.catch(e => { console.error(e); return null; });
}

function loadResources(rom: ArrayBuffer) {
	loadResourceList()
		.then(list => list.forEach(x => load(rom, x)));
}

function load(rom: ArrayBuffer, res: RomResource) {
	if (res.type !== 'image') return;
	let bytearray = new Uint8Array(rom);

	let sliced = bytearray.slice(res.start, res.end);
	let blub = new Blob([sliced], { type: 'image/png' });
	let url = URL.createObjectURL(blub);
	new engine.Game({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
	loadImage(url).then(img => engine.view.drawDebug(img, { x: 0, y: res.start / 100 }));
	console.log(url);
}

export function Annnndddd___Go(): engine.Game {
	// let d = Uint8Array.from(readFileSync("../rom/packed.rom")).buffer;
	loadRom()
		.then(rom => loadResources(rom))
		.catch(console.error);

	return null;

	new engine.Game({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
	engine.game.setModel(new GameModel());
	engine.game.setController(new GameController());
	let gameview = new GameView();
	engine.game.setGameView(gameview);
	gameview.init();

	GameController._.switchState(GameState.LoadTheGame);

	engine.game.start();

	GameModel._.SelectedChapterToPlay = Chapter.GameStart;
	GameController._.switchState(GameConstants.INITIAL_GAMESTATE);
	GameController._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);

	return engine.game;
}

// module Sintervania {
//     export class Game {
//         public bxlib: IBXLib;
//         public gameTimer: BStopwatch;
//         private static _instance: Game;
//         public static get _(): Game {
//             return Game._instance != null ? Game._instance : (Game._instance = new Game());
//         }
//         constructor() {
//             Toolbox.Init();
//             this.bxlib = Toolbox.BXLib;
//             this.bxlib.SoundEnabled = CS.SoundEnabled;
//             this.loadGameOptions();
//             let hresult: HResult = HResult.S_OK;
//             hresult = this.bxlib.CreateGameWindow(CS.MSX2ScreenWidth, CS.MSX2ScreenHeight, CS.MSX2ScreenWidth, CS.MSX2ScreenHeight, GO.Fullscreen, CS.WindowTitle);
//             if (hresult.Succeeded) {
//                 if (GO.Fullscreen)
//                     V._.ToFullscreen();
//                 else V._.ToWindowed();
//             }
//             if (hresult.Failed && !GO.Fullscreen && GO.Scale > 1) {
//                 GO.Scale = 1;
//                 hresult = this.bxlib.CreateGameWindow(GO.WindowWidth, GO.WindowHeight, GO.BufferWidth, GO.BufferHeight, GO.Fullscreen, CS.WindowTitle);
//             }
//             if (hresult.Failed && GO.Fullscreen) {
//                 GO.Fullscreen = true;
//                 GO.Scale = 1;
//                 hresult = this.bxlib.CreateGameWindow(GO.WindowWidth, GO.WindowHeight, GO.BufferWidth, GO.BufferHeight, true, CS.WindowTitle);
//             }
//             if (hresult.Failed) {
//                 Environment.Exit(<number>ExitCodes.CouldNotCreateGameWindow);
//             }
//             if (!GO.Fullscreen)
//                 BDX._.Zoom = GO.Scale;
//             this.bxlib.InitializeGame();
//             (<BXLib>this.bxlib).bdx.SetGlobalInterpolationMode(<number>BitmapInterpolationMode.D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);
//             BDX._.SetMusicVolume(GO.MusicVolumePercentage / 100f);
//             BDX._.SetEffectsVolume(GO.EffectsVolumePercentage / 100f);
//             I.KeyDown += (key, click) => {
//                 if (key == Key.F12)
//                     this.bxlib.EndGameloop = true;
//             };
//         }
//         public Start(): void {
//             this.bxlib.GameUpdate += UpdateGame;
//             this.bxlib.OnPaintEvent += PaintGame;
//             this.bxlib.SetFocus += SetFocus;
//             this.bxlib.KillFocus += KillFocus;
//             this.bxlib.EndOfGameloop += EndOfGameloop;
//             this.bxlib.EndOfMusic += EndOfMusic;
//             this.bxlib.AltEnter += AltEnterPressed;
//             ResourceMaster._.LoadGameResources();
//             S.PlayEffect(ResourceMaster.Sound[AudioId.Init]);
//             M._ = new M();
//             M._.Initialize();
//             C._.Initialize();
//             C._.SwitchToState(CS.InitialGameState);
//             this.bxlib.StartGameloop(50, 10);
//         }
//         public SetFocus(): void {
//             C._.SetFocus();
//         }
//         public KillFocus(): void {
//             C._.KillFocus();
//         }
//         public UpdateGame(elapsedTicks: number): void {
//             C._.TakeTurn(elapsedTicks);
//         }
//         public PaintGame(): void {
//             (<BXLib>this.bxlib).bdx.BeginDraw();
//             (<BXLib>this.bxlib).bdx.ClearScreen();
//             V._.Paint();
//             (<BXLib>this.bxlib).bdx.EndDraw();
//         }
//         public EndOfMusic(): void {

//         }
//         public EndOfGameloop(): void {

//         }
//         public GameOptionsChanged(): void {
//             GameOptionsPersistor.SaveOptions(GO._);
//         }
//         private loadGameOptions(): void {
//             let result = GameOptionsPersistor.LoadOptions();
//             if (result != null)
//                 GO._ = result;
//         }
//         public AltEnterPressed(): void {
//             let hresult: HResult;
//             if (GO.Fullscreen) {
//                 hresult = V._.ToWindowed();
//                 if (hresult.Succeeded) {
//                     GO.Fullscreen = false;
//                     this.GameOptionsChanged();
//                 }
//             }
//             else {
//                 hresult = V._.ToFullscreen();
//                 if (hresult.Succeeded) {
//                     GO.Fullscreen = true;
//                     this.GameOptionsChanged();
//                 }
//             }
//         }
//     }
// }