import { MenuItem } from "./mainmenu";
import { GameView as V } from "./gameview";
import { AudioId, BitmapId } from "../BoazEngineJS/resourceids";
import { Direction } from "../BoazEngineJS/direction";
import { TextWriter } from "./textwriter";
import { Size, Point } from "../BoazEngineJS/interfaces";
import { SoundMaster as S } from "../BoazEngineJS/soundmaster";
import { ResourceMaster as RM } from './resourcemaster';
import { GameController as C } from './gamecontroller';
import { GameModel as M } from "./sintervaniamodel";
import { SlotExists, LoadGame } from "../BoazEngineJS/gamestateloader";
import { GameOptions as GO } from "../BoazEngineJS/gameoptions";
import { GameConstants as CS } from "./gameconstants";
import { MSXConstants as MCS } from "../BoazEngineJS/msx";
import { Constants } from "../BoazEngineJS/constants";
import { newSize, setPoint } from "../BoazEngineJS/common";
import { view, game } from "../BoazEngineJS/engine";
import { GameState } from "../BoazEngineJS/model";
import { Input } from "../BoazEngineJS/input";

interface MenuOption {
    type: MenuItem;
    label: string;
}

declare module "./mainmenu" {
    export const enum MenuItem {
        Dummy = -1,
        SaveGame,
        SaveSlot,
        ChangeOptions,
        ReturnToGame,
        ReturnToMain,
        Scale,
        Fullscreen,
        MusicVolume,
        EffectVolume,
        ExitGame,

        // ScreenMenu
        Main,
        Load,
        Save,
        LoadFromGameOver,
        LoadFromMainMenu,
        OptionsFromMainMenu
    }
}

export class GameMenu {
    private static menuPosX: number = 24;
    private static menuPosY: number = 24;
    private static menuEndX: number = 240;
    private static menuEndY: number = 176;
    private static cursorVerticalSkipPerEntry: number = 16;
    private static mainItemsOffsetX: number = 56;
    private static loadsaveItemOffsetX: number = 24;
    private static optionItemsOffsetX: number = 56;
    private static itemOffsetY: number = 16;
    private static itemVerticalSkipPerEntry: number = GameMenu.cursorVerticalSkipPerEntry;
    private static menuText: string = "- Game Menu -";
    private static loadMenuText: string = "- Load game -";
    private static saveMenuText: string = "- Save game -";
    private static optionMenuText: string = "- Options -";
    private static backText: string = "Back";
    private static emptySlot: string = "----";
    private static scaleText: string = "Scale: ";
    private static effectVolumeText: string = "Effects: ";
    private static musicVolumeText: string = "Music: ";
    private static mainMenuTextX: number = GameMenu.menuPosX + 56;
    private static mainMenuTextY: number = GameMenu.menuPosY + 16;
    private static cursorOffsetX: number = -16;
    private static cursorOffsetY: number = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
    private static mainItems: MenuOption[] = [
        { type: MenuItem.ChangeOptions, label: "Options" },
        { type: MenuItem.LoadGame, label: "Load game" },
        { type: MenuItem.SaveGame, label: "Save game" },
        { type: MenuItem.ExitGame, label: "Exit game" },
        { type: MenuItem.ReturnToGame, label: "Return to game" },
    ];
    private static optionsItems: MenuOption[] = [
        { type: MenuItem.ReturnToMain, label: GameMenu.backText },
        { type: MenuItem.Scale, label: GameMenu.scaleText },
        { type: MenuItem.Fullscreen, label: "Fullscreen: y n" },
        { type: MenuItem.MusicVolume, label: GameMenu.musicVolumeText },
        { type: MenuItem.EffectVolume, label: GameMenu.effectVolumeText }
    ];
    private static fullscreenOptionsOffsets: number[] = [TextWriter.FontWidth * 12 - 1, TextWriter.FontWidth * 14 - 1];
    private static fullscreenOptionsOffsetY: number = -1;
    private static fullscreenOptionsRectangleSize: Size = newSize(TextWriter.FontWidth + 2, TextWriter.FontHeight + 2);
    public visible: boolean;
    private cursorPos: Point;
    private selectedItemIndex: number;
    private CurrentScreen: MenuItem;

    constructor() {
        this.visible = false;
        this.cursorPos = <Point>{ x: 0, y: 0 };
        this.selectedItemIndex = 0;
        this.CurrentScreen = MenuItem.Main;
    }

    public Open(currentscreen: MenuItem = MenuItem.Main): void {
        this.selectedItemIndex = 0;
        this.visible = true;
        this.CurrentScreen = currentscreen;
        if (this.CurrentScreen == MenuItem.Main)
            S.PlayEffect(RM.Sound[AudioId.Selectie]);
    }

    public Close(): void {
        this.visible = false;
        this.selectedItemIndex = 0;
        switch (this.CurrentScreen) {
            case MenuItem.LoadFromGameOver:
                V._.MainMenu.GameMenuClosed();
                break;
            case MenuItem.LoadFromMainMenu:
            case MenuItem.OptionsFromMainMenu:
                V._.MainMenu.GameMenuClosed();
                break;
            default:
                M._.ItemsInInventory.filter(i => i.Amount != 0);
                break;
        }
    }

    public TakeTurn(): void {
        if (!this.visible)
            return;
        setPoint(this.cursorPos, this.calculateCursorX(), this.calculateCursorY());
    }

    public HandleInput(): void {
        let selectionChanged: boolean = false;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
            case MenuItem.Load:
            case MenuItem.LoadFromMainMenu:
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
            case MenuItem.Save:
            case MenuItem.LoadFromGameOver:
                if (Input.KC_UP)
                    this.changeSelection(Direction.Up, selectionChanged);
                else if (Input.KC_RIGHT)
                    this.changeSelection(Direction.Right, selectionChanged);
                else if (Input.KC_DOWN)
                    this.changeSelection(Direction.Down, selectionChanged);
                else if (Input.KC_LEFT)
                    this.changeSelection(Direction.Left, selectionChanged);
                break;
        }
        if (Input.KC_SPACE) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    S.PlayEffect(RM.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToGame:
                            C._.CloseGameMenu();
                            break;
                        case MenuItem.ChangeOptions:
                            this.CurrentScreen = MenuItem.Options;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.LoadGame:
                            this.CurrentScreen = MenuItem.Load;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.SaveGame:
                            if (M._.State != GameState.Event) {
                                this.CurrentScreen = MenuItem.Save;
                                this.selectedItemIndex = 0;
                            }
                            else S.PlayEffect(RM.Sound[AudioId.Fout]);
                            break;
                        case MenuItem.ExitGame:
                            throw Error("Game afluiten is niet geimplementeerd :-o");
                            // G._.bxlib.EndGameloop = true;
                            break;
                    }
                    break;
                case MenuItem.Load:
                case MenuItem.LoadFromGameOver:
                case MenuItem.LoadFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            S.PlayEffect(RM.Sound[AudioId.Selectie]);
                            switch (this.CurrentScreen) {
                                case MenuItem.LoadFromGameOver:
                                case MenuItem.LoadFromMainMenu:
                                    this.Close();
                                    break;
                                default:
                                    this.CurrentScreen = MenuItem.Main;
                                    this.selectedItemIndex = 0;
                                    break;
                            }
                            break;
                        case MenuItem.SaveSlot:
                            {
                                let slot = this.selectedItemIndex - 1;
                                if (SlotExists(slot)) {
                                    let sg = LoadGame(slot);
                                    C._.LoadGame(sg);
                                }
                                else S.PlayEffect(RM.Sound[AudioId.Fout]);
                            }
                            break;
                    }
                    break;
                case MenuItem.Save:
                    S.PlayEffect(RM.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            this.CurrentScreen = MenuItem.Main;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.SaveSlot:
                            {
                                let slot = this.selectedItemIndex - 1;
                                C._.SaveGame(slot);
                            }
                            break;
                    }
                    break;
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            S.PlayEffect(RM.Sound[AudioId.Selectie]);
                            switch (this.CurrentScreen) {
                                case MenuItem.OptionsFromMainMenu:
                                    this.Close();
                                    break;
                                default:
                                    this.CurrentScreen = MenuItem.Main;
                                    this.selectedItemIndex = 0;
                                    break;
                            }
                            break;
                        default:
                            S.PlayEffect(RM.Sound[AudioId.Fout]);
                            break;
                    }
                    break;
            }
        }
        if (Input.KC_RIGHT) {
            switch (this.CurrentScreen) {
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO.Fullscreen) {
                                V._.ChangeScale(GO.Scale + 1);
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (GO.Fullscreen) {
                                GO.Fullscreen = false;
                                V._.ToWindowed();
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.EffectVolume:
                            if (GO.EffectsVolumePercentage < 100) {
                                GO.EffectsVolumePercentage += 10;
                                if (GO.EffectsVolumePercentage > 100)
                                    GO.EffectsVolumePercentage = 100;
                                S.SetEffectsVolume(GO.EffectsVolumePercentage / 100);
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.MusicVolume:
                            if (GO.MusicVolumePercentage < 100) {
                                GO.MusicVolumePercentage += 10;
                                if (GO.MusicVolumePercentage > 100)
                                    GO.MusicVolumePercentage = 100;
                                S.SetMusicVolume(GO.MusicVolumePercentage / 100);
                                game.GameOptionsChanged();
                            }
                            break;
                    }
                    break;
            }
        }
        if (Input.KC_LEFT) {
            switch (this.CurrentScreen) {
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO.Fullscreen && GO.Scale > 1) {
                                V._.ChangeScale(GO.Scale - 1);
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (!GO.Fullscreen) {
                                GO.Fullscreen = true;
                                V._.ToFullscreen();
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.EffectVolume:
                            if (GO.EffectsVolumePercentage > 0) {
                                GO.EffectsVolumePercentage -= 10;
                                if (GO.EffectsVolumePercentage < 0)
                                    GO.EffectsVolumePercentage = 0;
                                S.SetEffectsVolume(GO.EffectsVolumePercentage / 100);
                                game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.MusicVolume:
                            if (GO.MusicVolumePercentage > 0) {
                                GO.MusicVolumePercentage -= 10;
                                if (GO.MusicVolumePercentage < 0)
                                    GO.MusicVolumePercentage = 0;
                                S.SetMusicVolume(GO.MusicVolumePercentage / 100);
                                game.GameOptionsChanged();
                            }
                            break;
                    }
                    break;
            }
        }
        if (selectionChanged) {
            S.PlayEffect(RM.Sound[AudioId.Selectie]);
        }
    }

    private calculateCursorX(): number {
        switch (this.CurrentScreen) {
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
            case MenuItem.Main:
                return GameMenu.menuPosX + GameMenu.mainItemsOffsetX + GameMenu.cursorOffsetX;
            case MenuItem.Load:
            case MenuItem.LoadFromGameOver:
            case MenuItem.LoadFromMainMenu:
            case MenuItem.Save:
                return GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX + GameMenu.cursorOffsetX;
        }
        return 0;
    }

    private calculateCursorY(): number {
        switch (this.CurrentScreen) {
            default:
                return GameMenu.cursorOffsetY + GameMenu.cursorVerticalSkipPerEntry * this.selectedItemIndex;
        }
    }

    private changeSelection(direction: Direction, selectionChanged: boolean): void {
        let maxX: number, maxY, x, y;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = GameMenu.mainItems.length - 1;
                break;
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = GameMenu.optionsItems.length - 1;
                break;
            case MenuItem.Load:
            case MenuItem.Save:
            case MenuItem.LoadFromGameOver:
            case MenuItem.LoadFromMainMenu:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = Constants.SaveSlotCount;
                break;
            default:
                maxX = maxY = x = y = 0;
                break;
        }
        switch (direction) {
            case Direction.Up:
                if (y > 0)
                    y--;
                else y = maxY;
                selectionChanged = true;
                break;
            case Direction.Right:
                if (x < maxX) {
                    x++;
                    selectionChanged = true;
                }
                break;
            case Direction.Down:
                if (y < maxY)
                    y++;
                else y = 0;
                selectionChanged = true;
                break;
            case Direction.Left:
                if (x > 0) {
                    x--;
                    selectionChanged = true;
                }
                break;
        }
        this.selectedItemIndex = y;
    }

    private get selectedItem(): MenuItem {
        switch (this.CurrentScreen) {
            case MenuItem.Main:
            default:
                return GameMenu.mainItems[this.selectedItemIndex].type;
            case MenuItem.Load:
            case MenuItem.Save:
            case MenuItem.LoadFromGameOver:
            case MenuItem.LoadFromMainMenu:
                return this.selectedItemIndex > 0 ? MenuItem.SaveSlot : MenuItem.ReturnToMain;
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
                return GameMenu.optionsItems[this.selectedItemIndex].type;
        }
    }

    public Paint(): void {
        if (!this.visible)
            return
        view.FillRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, MCS.Msx1Colors[1]);
        view.DrawRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, MCS.Msx1Colors[15]);
        let titleToDraw: string;
        let titleX: number, titleY;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
                titleToDraw = GameMenu.menuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
                titleToDraw = GameMenu.optionMenuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case MenuItem.Load:
            case MenuItem.LoadFromGameOver:
            case MenuItem.LoadFromMainMenu:
                titleToDraw = GameMenu.loadMenuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case MenuItem.Save:
                titleToDraw = GameMenu.saveMenuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            default:
                titleToDraw = "No title to draw!";
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
        }
        TextWriter.DrawText(titleX, titleY, titleToDraw);
        let y = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
            default:
                {
                    GameMenu.mainItems.forEach(function (item) {
                        switch (item.type) {
                            case MenuItem.SaveGame:
                                if (M._.State != GameState.Event)
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                else TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, MCS.Msx1ExtColors[0]);
                                break;
                            default:
                                TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                break;
                        }
                        y += GameMenu.itemOffsetY;
                    });
                    break;
                }
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
                {
                    GameMenu.optionsItems.forEach(function (item) {
                        let offsetX: number = GameMenu.menuPosX + GameMenu.mainItemsOffsetX;
                        switch (item.type) {
                            case MenuItem.Scale:
                                let textToDisplay: string;
                                if (!GO.Fullscreen) {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    TextWriter.DrawText(offsetX, y, `${GO.Scale}X`);
                                }
                                else {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, MCS.Msx1ExtColors[0]);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    // textToDisplay = BDX._.Zoom.ToString("n2");
                                    TextWriter.DrawText(offsetX, y, `${GO.Scale}X`);
                                }
                                break;
                            case MenuItem.Fullscreen:
                                TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                this.printFullscreenOptionRectangle(y);
                                break;
                            case MenuItem.EffectVolume:
                                {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.effectVolumeText.length * TextWriter.FontWidth;
                                    let text = GO.EffectsVolumePercentage > 0 ? GO.EffectsVolumePercentage + "%" : "Off";
                                    TextWriter.DrawText(offsetX, y, text);
                                }
                                break;
                            case MenuItem.MusicVolume:
                                {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.musicVolumeText.length * TextWriter.FontWidth;
                                    let text = GO.MusicVolumePercentage > 0 ? GO.MusicVolumePercentage + "%" : "Off";
                                    TextWriter.DrawText(offsetX, y, text);
                                }
                                break;
                            default:
                                TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                break;
                        }
                        y += GameMenu.itemOffsetY;
                    });
                    break;
                }
            case MenuItem.Load:
            case MenuItem.LoadFromGameOver:
            case MenuItem.LoadFromMainMenu:
                {
                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < Constants.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
            case MenuItem.Save:
                {
                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < Constants.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
        }
        view.DrawBitmap(<number>BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);
    }

    private printFullscreenOptionRectangle(y: number): void {
        let selectedIndex: number = GO.Fullscreen ? 0 : 1;
        view.DrawRectangle(GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.fullscreenOptionsRectangleSize.x + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY + GameMenu.fullscreenOptionsRectangleSize.y, MCS.Msx1Colors[6]);
    }

    private printSaveSlot(x: number, y: number, slotIndex: number): void {
        let exists = SlotExists(slotIndex);
        if (!exists) {
            TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex} + 1: ${GameMenu.emptySlot}`);
            return;
        }
        let savegame = LoadGame(slotIndex);
        let time = savegame.Timestamp;
        TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex + 1}: ${time.getDay().toFixed(2)}/${time.getMonth().toFixed(2)}/${time.getFullYear().toFixed(2)} - ${time.getHours().toFixed(2)}:${time.getMinutes().toFixed(2)}`);
    }
}
