import { MenuItem } from "./mainmenu";
import { AudioId, BitmapId } from "./bmsx/resourceids";
import { Direction } from "./bmsx/common";
import { TextWriter } from "./textwriter";
import { Size, Point } from "./bmsx/common";
import { SM } from "./bmsx/soundmaster";
import { Controller as C } from "./gamecontroller";
import { GameState, Model } from "./gamemodel";
import { SlotExists, LoadGame } from "./bmsx/gamepersistor";
import { GameOptions as GO, IGameObject, bst, model } from './bmsx/engine';
import { Constants } from "./bmsx/engine";
import { newSize, setPoint } from "./bmsx/common";
import { view, game } from "./bmsx/engine";
import { Input } from "./bmsx/input";
import { Msx1Colors, Msx1ExtColors } from "./bmsx/msx";
import { DrawImgFlags } from './bmsx/view';

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
        // MusicVolume,
        SoundVolume,
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

export class GameMenu extends bst implements IGameObject {
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
    private static soundVolumeText: string = "Volume: ";
    // private static musicVolumeText: string = "Music: ";
    private static mainMenuTextX: number = GameMenu.menuPosX + 56;
    private static mainMenuTextY: number = GameMenu.menuPosY + 16;
    private static cursorOffsetX: number = -16;
    private static cursorOffsetY: number = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
    private static mainItems: MenuOption[] = [
        { type: MenuItem.ChangeOptions, label: "Options" },
        { type: MenuItem.LoadGame, label: "Load game" },
        { type: MenuItem.SaveGame, label: "Save game" },
        { type: MenuItem.ExitGame, label: "Stop game" },
        { type: MenuItem.ReturnToGame, label: "Return to game" },
    ];
    private static optionsItems: MenuOption[] = [
        { type: MenuItem.ReturnToMain, label: GameMenu.backText },
        { type: MenuItem.SoundVolume, label: GameMenu.soundVolumeText },
        { type: MenuItem.Fullscreen, label: "Fullscreen: y n" },
        { type: MenuItem.Scale, label: GameMenu.scaleText },
        // { type: MenuItem.MusicVolume, label: GameMenu.musicVolumeText },
    ];
    private static fullscreenOptionsOffsets: number[] = [TextWriter.FontWidth * 12 - 1, TextWriter.FontWidth * 14 - 1];
    private static fullscreenOptionsOffsetY: number = -1;
    private static fullscreenOptionsRectangleSize: Size = newSize(TextWriter.FontWidth + 2, TextWriter.FontHeight + 2);
    public visible: boolean;
    private cursorPos: Point;
    private selectedItemIndex: number;
    private CurrentScreen: MenuItem;
    id: string = 'gamemenu';
    disposeFlag: boolean = false;
    pos: Point = null;
    priority: number = 5000;

    constructor() {
        super();
        this.visible = false;
        this.cursorPos = { x: 0, y: 0 };
        this.selectedItemIndex = 0;
        this.CurrentScreen = MenuItem.Main;
    }

    public Open(currentscreen: MenuItem = MenuItem.Main): void {
        this.selectedItemIndex = 0;
        this.visible = true;
        this.CurrentScreen = currentscreen;
        if (this.CurrentScreen == MenuItem.Main)
            SM.play(AudioId.Selectie);
    }

    public Close(): void {
        this.visible = false;
        this.selectedItemIndex = 0;
        switch (this.CurrentScreen) {
            case MenuItem.LoadFromGameOver:
                (model as Model).MainMenu.GameMenuClosed();
                break;
            case MenuItem.LoadFromMainMenu:
            case MenuItem.OptionsFromMainMenu:
                (model as Model).MainMenu.GameMenuClosed();
                break;
            default:
                (model as Model).ItemsInInventory.filter(i => i.Amount != 0);
                break;
        }
    }

    public takeTurn(): void {
        if (!this.visible)
            return;
        setPoint(this.cursorPos, this.calculateCursorX(), this.calculateCursorY());
    }

    public HandleInput(): void {
        let selectionChanged: boolean = false;
        let clickUp = Input.KC_UP;
        let clickRight = Input.KC_RIGHT;
        let clickDown = Input.KC_DOWN;
        let clickLeft = Input.KC_LEFT;

        switch (this.CurrentScreen) {
            case MenuItem.Main:
            case MenuItem.Load:
            case MenuItem.LoadFromMainMenu:
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
            case MenuItem.Save:
            case MenuItem.LoadFromGameOver:
                if (clickUp)
                    this.changeSelection(Direction.Up, selectionChanged);
                else if (clickRight)
                    this.changeSelection(Direction.Right, selectionChanged);
                else if (clickDown)
                    this.changeSelection(Direction.Down, selectionChanged);
                else if (clickLeft)
                    this.changeSelection(Direction.Left, selectionChanged);
                break;
        }
        if (Input.KC_BTN2) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    C._.CloseGameMenu();
                    break;
                default:
                    this.CurrentScreen = MenuItem.Main;
                    this.selectedItemIndex = 0;
                    SM.play(AudioId.Selectie);
                    break;
            }
        }
        if (Input.KC_SPACE) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    SM.play(AudioId.Selectie);
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
                            if ((model as Model).state != GameState.Event) {
                                this.CurrentScreen = MenuItem.Save;
                                this.selectedItemIndex = 0;
                            }
                            else SM.play(AudioId.Fout);
                            break;
                        case MenuItem.ExitGame:
                            game.stop();
                            break;
                    }
                    break;
                case MenuItem.Load:
                case MenuItem.LoadFromGameOver:
                case MenuItem.LoadFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            SM.play(AudioId.Selectie);
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
                                else SM.play(AudioId.Fout);
                            }
                            break;
                    }
                    break;
                case MenuItem.Save:
                    SM.play(AudioId.Selectie);
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
                            SM.play(AudioId.Selectie);
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
                            SM.play(AudioId.Fout);
                            break;
                    }
                    break;
            }
        }
        if (clickRight) {
            switch (this.CurrentScreen) {
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO.Fullscreen) {
                                // V._.ChangeScale(GO.Scale + 1);
                                // game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (GO.Fullscreen) {
                                GO.Fullscreen = false;
                                view.ToWindowed();
                                // game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.SoundVolume:
                            if (GO.VolumePercentage < 100) {
                                GO.VolumePercentage += 10;
                                if (GO.VolumePercentage > 100)
                                    GO.VolumePercentage = 100;
                                SM.setVolume(GO.VolumePercentage / 100);
                                // game.GameOptionsChanged();
                            }
                            break;
                        // case MenuItem.MusicVolume:
                        //     if (GO.MusicVolumePercentage < 100) {
                        //         GO.MusicVolumePercentage += 10;
                        //         if (GO.MusicVolumePercentage > 100)
                        //             GO.MusicVolumePercentage = 100;
                        //         SM.setMusicVolume(GO.MusicVolumePercentage / 100);
                        //         game.GameOptionsChanged();
                        //     }
                        //     break;
                    }
                    break;
            }
        }
        if (clickLeft) {
            switch (this.CurrentScreen) {
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO.Fullscreen && GO.Scale > 1) {
                                // V._.ChangeScale(GO.Scale - 1);
                                // game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (!GO.Fullscreen) {
                                GO.Fullscreen = true;
                                view.ToFullscreen();
                                // game.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.SoundVolume:
                            if (GO.VolumePercentage > 0) {
                                GO.VolumePercentage -= 10;
                                if (GO.VolumePercentage < 0)
                                    GO.VolumePercentage = 0;
                                SM.setVolume(GO.VolumePercentage / 100);
                                // game.GameOptionsChanged();
                            }
                            break;
                        // case MenuItem.MusicVolume:
                        //     if (GO.MusicVolumePercentage > 0) {
                        //         GO.MusicVolumePercentage -= 10;
                        //         if (GO.MusicVolumePercentage < 0)
                        //             GO.MusicVolumePercentage = 0;
                        //         SM.setMusicVolume(GO.MusicVolumePercentage / 100);
                        //         game.GameOptionsChanged();
                        //     }
                        //     break;
                    }
                    break;
            }
        }
        if (selectionChanged) {
            SM.play(AudioId.Selectie);
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

    public paint(): void {
        // view.fillRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, Msx1Colors[1]);
        // view.drawRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, Msx1Colors[15]);
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
        TextWriter.drawText(titleX, titleY, titleToDraw);
        let y = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
            default:
                {
                    GameMenu.mainItems.forEach(function (item) {
                        switch (item.type) {
                            case MenuItem.SaveGame:
                                if ((model as Model).state != GameState.Event)
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                else TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, Msx1ExtColors[0]);
                                break;
                            default:
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                break;
                        }
                        y += GameMenu.itemOffsetY;
                    });
                    break;
                }
            case MenuItem.Options:
            case MenuItem.OptionsFromMainMenu:
                {
                    let t = this;
                    GameMenu.optionsItems.forEach(function (item) {
                        let offsetX: number = GameMenu.menuPosX + GameMenu.mainItemsOffsetX;
                        switch (item.type) {
                            case MenuItem.Scale:
                                let textToDisplay: string;
                                if (!GO.Fullscreen) {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    TextWriter.drawText(offsetX, y, `${view.scale.toPrecision(2)}X`);
                                }
                                else {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, Msx1ExtColors[0]);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    // textToDisplay = BDX._.Zoom.ToString("n2");
                                    TextWriter.drawText(offsetX, y, `${view.scale.toPrecision(2)}X`);
                                }
                                break;
                            case MenuItem.Fullscreen:
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                t.printFullscreenOptionRectangle(y);
                                break;
                            case MenuItem.SoundVolume:
                                {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.soundVolumeText.length * TextWriter.FontWidth;
                                    let text = GO.VolumePercentage > 0 ? GO.VolumePercentage + "%" : "Off";
                                    TextWriter.drawText(offsetX, y, text);
                                }
                                break;
                            // case MenuItem.MusicVolume:
                            //     {
                            //         TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                            //         offsetX += GameMenu.musicVolumeText.length * TextWriter.FontWidth;
                            //         let text = GO.MusicVolumePercentage > 0 ? GO.MusicVolumePercentage + "%" : "Off";
                            //         TextWriter.drawText(offsetX, y, text);
                            //     }
                            //     break;
                            default:
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
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
                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < Constants.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
            case MenuItem.Save:
                {
                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < Constants.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
        }
        view.drawImg(BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);

        let scalex = GameMenu.menuEndX - GameMenu.menuPosX;
        let scaley = GameMenu.menuEndY - GameMenu.menuPosY;
        view.drawImg(BitmapId.blackpixel, GameMenu.menuPosX + 1, GameMenu.menuPosY + 1, DrawImgFlags.None, scalex - 2, scaley - 2);
        view.drawImg(BitmapId.whitepixel, GameMenu.menuPosX, GameMenu.menuPosY, DrawImgFlags.None, scalex, scaley);
    }

    private printFullscreenOptionRectangle(y: number): void {
        let selectedIndex: number = GO.Fullscreen ? 0 : 1;
        view.drawImg(BitmapId.redpixel, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX - 1, y + GameMenu.fullscreenOptionsOffsetY - 1, DrawImgFlags.None, GameMenu.fullscreenOptionsRectangleSize.x + 2, GameMenu.fullscreenOptionsRectangleSize.y + 2);
    }

    private printSaveSlot(x: number, y: number, slotIndex: number): void {
        let exists = SlotExists(slotIndex);
        if (!exists) {
            TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex} + 1: ${GameMenu.emptySlot}`);
            return;
        }
        let savegame = LoadGame(slotIndex);
        let time = savegame.Timestamp;
        TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex + 1}: ${time.getDay().toFixed(2)}/${time.getMonth().toFixed(2)}/${time.getFullYear().toFixed(2)} - ${time.getHours().toFixed(2)}:${time.getMinutes().toFixed(2)}`);
    }
}
