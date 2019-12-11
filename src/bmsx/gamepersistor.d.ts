import { BaseModel, BStopwatch } from "./engine";
export declare class Savegame {
    Model: any;
    Timestamp: Date;
    Slot: number;
    RegisteredWatches: BStopwatch[];
}
export declare namespace GameSaver {
    function saveGame(m: BaseModel, slot: number): void;
    function GetCheckpoint(m: BaseModel): Savegame;
}
export declare function LoadGame(slot: number): Savegame;
export declare function SlotExists(slot: number): boolean;
export declare function GetCheckpoint(m: BaseModel): Savegame;
export declare function GetSavepath(slot: number): string;
//# sourceMappingURL=gamepersistor.d.ts.map