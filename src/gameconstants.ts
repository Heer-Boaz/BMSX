import { MSXConstants } from "../BoazEngineJS/msx";

export namespace GameConstants {
    export const SoundEnabled: boolean = false;
    export const InitialFullscreen: boolean = false;
    export const InitialScale: number = 1;
    export const PauseGameOnKillFocus: boolean = false;
    export const AnimateFoeHealthLevel: boolean = false;
    export const EnemiesAfootAsProperty: boolean = false;
    export const Belmont_MaxHealth_AtStart: number = 48;
    export const Belmont_MaxHealth_Increase: number = 2;
    export const Belmont_MaxHearts: number = 99;
    export const CheckpointAtRoomEntry: boolean = false;
    export const ManualCheckpoints: boolean = !CheckpointAtRoomEntry;
    export const WindowTitle: string = "";
    export const HUDHeight: number = 36;
    export const StageScreenWidthTiles: number = (GameScreenWidth / MSXConstants.TileSize);
    export const StageScreenHeightTiles: number = (GameScreenHeight / MSXConstants.TileSize);
    export const GameScreenWidth: number = MSX2ScreenWidth;
    export const GameScreenHeight: number = MSX2ScreenHeight - HUDHeight;
    export const GameScreenStartX: number = 0;
    export const GameScreenStartY: number = 36;
    export const ImageBasePath: string = "./Content/Images/";
    export const Extension_PNG: string = ".png";
    export const SaveGamePath: string = "./Saves/sintervania.sa{0}";
    export const CheckpointGamePath: string = "./Saves/sintervania.chk";
    export const OptionsPath: string = "./sintervania.ini";
    export const SaveSlotCount: number = 6;
    export const SaveSlotCheckpoint: number = -1;
    export const WaitAfterLoadGame: number = 1000;
    export const WaitAfterRoomSwitch: number = 500;
    export const WaitAfterGameStart1: number = 2;
    export const WaitAfterGameStart2: number = 4;
}