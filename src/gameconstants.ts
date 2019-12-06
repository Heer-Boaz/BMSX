import { TileSize, MSX2ScreenWidth, MSX2ScreenHeight } from "../BoazEngineJS/msx";
import { GameState, GameSubstate } from "../BoazEngineJS/model";

export namespace GameConstants {
    export const INITIAL_GAMESTATE: GameState = GameState.GameStart1;
    export const INITIAL_GAMESUBSTATE: GameSubstate = GameSubstate.Default;

    export const SoundEnabled: boolean = false;
    export const InitialFullscreen: boolean = false;
    export const InitialScale: number = 1;
    export const PauseGameOnKillFocus: boolean = false;
    export const AnimateFoeHealthLevel: boolean = false;
    export const EnemiesAfootAsProperty: boolean = false;
    export const Belmont_MaxHealth_AtStart: number = 48;
    export const Belmont_MaxHealth_Increase: number = 2;
    export const Belmont_MaxHearts: number = 99;
    export const Belmont_InitPos_x: number = 100;
    export const Belmont_initPos_y: number = 100;
    export const CheckpointAtRoomEntry: boolean = false;
    export const ManualCheckpoints: boolean = !CheckpointAtRoomEntry;
    export const WindowTitle: string = "";
    export const HUDHeight: number = 36;
    export const ViewportWidth: number = MSX2ScreenWidth;
    export const ViewportHeight: number = MSX2ScreenHeight;
    export const GameScreenWidth: number = MSX2ScreenWidth;
    export const GameScreenHeight: number = MSX2ScreenHeight - HUDHeight;
    export const StageScreenWidthTiles: number = (GameScreenWidth / TileSize);
    export const StageScreenHeightTiles: number = (GameScreenHeight / TileSize);
    export const StageScreenStartHeightTiles: number = (HUDHeight / TileSize);
    export const GameScreenStartX: number = 0;
    export const GameScreenStartY: number = HUDHeight;
    export const ImageBasePath: string = "./Content/Images/";
    export const Extension_PNG: string = ".png";
    export const WaitAfterLoadGame: number = 50;
    export const WaitAfterRoomSwitch: number = 25;
    export const WaitAfterGameStart1: number = 2;
    export const WaitAfterGameStart2: number = 4;

    export const pausePosX: number = 80;
    export const pausePosY: number = 80;
    export const pauseTextPosX: number = 104;
    export const pauseTextPosY: number = 96;
    export const pauseEndX: number = 176;
    export const pauseEndY: number = 120;
    export const pauseText: string = "Paused";

}