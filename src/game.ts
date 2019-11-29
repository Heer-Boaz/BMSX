import * as engine from "../BoazEngineJS/engine";
import { GameModel, Chapter } from './sintervaniamodel';
import { GameController } from "./gamecontroller";
import { GameView } from './gameview';
import { GameState } from "../BoazEngineJS/model";
import { GameConstants } from './gameconstants';
import { LoadGame } from '../BoazEngineJS/gamestateloader';
import { loadRom } from '../BoazEngineJS/rom';
import { DrawBitmap, View } from '../BoazEngineJS/view';
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

export function Annnndddd___Go(): void {
	loadRom()
		.then(() => {
			new engine.Game({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
			engine.game.setModel(new GameModel());
			engine.game.setController(new GameController());
			let gameview = new GameView();
			engine.game.setGameView(gameview);
			gameview.init();

			GameController._.switchState(GameState.LoadTheGame);

			// engine.game.waitForUserToStart();
			let imgs = View.images;

			GameModel._.SelectedChapterToPlay = Chapter.GameStart;
			GameController._.switchState(GameConstants.INITIAL_GAMESTATE);
			GameController._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
			return engine.game;
		})
		.catch(console.error);
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