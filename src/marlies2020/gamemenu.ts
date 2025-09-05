import { AudioId, BitmapId } from "./resourceids";
import { TextWriter } from "../bmsx/textwriter";
import { SM } from "../bmsx/soundmaster";
// import { SlotExists, LoadGame } from "../bmsx/gamepersistor";
import { GameOptions as GO, WorldObject, Direction, Size, vec3, new_vec2, set_vec2 } from '../bmsx/bmsx';
import { Constants } from "../bmsx/bmsx";
import { Input } from "../bmsx/input";
import { Msx1ExtColors } from "../bmsx/msx";
import { DrawImgFlags } from '../bmsx/view';

interface MenuOption {
    type: MenuItem;
    label: string;
}

export const enum MenuItem {
    Dummy = -1,
    LoadGame,
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
    Options,

    // ScreenMenu
    Main,
    Load,
    Save,
    LoadFromGameOver,
    LoadFromMainMenu,
    OptionsFromMainMenu
}

export class GameMenu extends WorldObject {
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
    private static fullscreenOptionsOffsets: number[];
    private static fullscreenOptionsOffsetY: number;
    private static fullscreenOptionsRectangleSize: Size;
    private cursorPos: vec3;
    private selectedItemIndex: number;
    private CurrentScreen: MenuItem;

    constructor() {
        super();
        this.id = 'gamemenu';
        this.z = 5000;
        this.visible = false;
        this.cursorPos = { x: 0, y: 0 };
        this.selectedItemIndex = 0;
        this.CurrentScreen = MenuItem.Main;
        GameMenu.fullscreenOptionsOffsets = [game.view.default_font.char_width * 12 - 1, game.view.default_font.char_height * 14 - 1];
        GameMenu.fullscreenOptionsOffsetY  = -1;
        GameMenu.fullscreenOptionsRectangleSize = new_vec2(game.view.default_font.char_width + 2, game.view.default_font.char_height + 2);
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
                // model.MainMenu.GameMenuClosed();
                break;
            case MenuItem.LoadFromMainMenu:
            case MenuItem.OptionsFromMainMenu:
                // model.MainMenu.GameMenuClosed();
                break;
            default:
                break;
        }
    }

    override run(): void {
        if (!this.visible)
            return;
        this.HandleInput();
        set_vec2(this.cursorPos, this.calculateCursorX(), this.calculateCursorY());
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
                    this.changeSelection('up', selectionChanged);
                else if (clickRight)
                    this.changeSelection('right', selectionChanged);
                else if (clickDown)
                    this.changeSelection('down', selectionChanged);
                else if (clickLeft)
                    this.changeSelection('left', selectionChanged);
                break;
        }
        if (Input.KC_BTN2) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    // (controller as Controller).CloseGameMenu();
                    break;
                default:
                    this.CurrentScreen = MenuItem.Main;
                    this.selectedItemIndex = 0;
                    SM.play(AudioId.Selectie);
                    break;
            }
        }
        if (Input.KC_SPACE || Input.KC_BTN1) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    SM.play(AudioId.Selectie);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToGame:
                            game.model.state.pop();
                            // (controller as Controller).CloseGameMenu();
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
                            // if ((model as Model).state != GameState.Event) {
                                this.CurrentScreen = MenuItem.Save;
                                this.selectedItemIndex = 0;
                            // }
                            // else SM.play(AudioId.Fout);
                            break;
                        case MenuItem.ExitGame:
                            global.game.stop();
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
                                // let slot = this.selectedItemIndex - 1;
                                // if (SlotExists(slot)) {
                                //     let sg = LoadGame(slot);
                                //     // (controller as Controller).LoadGame(sg);
                                // }
                                // else SM.play(AudioId.Fout);
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
                                // (controller as Controller).SaveGame(slot);
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
                                game.view.ToWindowed();
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
                                game.view.toFullscreen();
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
            case 'up':
                if (y > 0)
                    y--;
                else y = maxY;
                selectionChanged = true;
                break;
            case 'right':
                if (x < maxX) {
                    x++;
                    selectionChanged = true;
                }
                break;
            case 'down':
                if (y < maxY)
                    y++;
                else y = 0;
                selectionChanged = true;
                break;
            case 'left':
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

    override paint = (offset?: vec3):void => {
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
                                // if ((model as Model).state != GameState.Event)
                                    // TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                // else
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, null, Msx1ExtColors[0]);
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
                                    offsetX += GameMenu.scaleText.length * game.view.default_font.char_width;
                                    TextWriter.drawText(offsetX, y, `${game.view.scale.toPrecision(2)}X`);
                                }
                                else {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, null, Msx1ExtColors[0]);
                                    offsetX += GameMenu.scaleText.length * game.view.default_font.char_height;
                                    // textToDisplay = BDX._.Zoom.ToString("n2");
                                    TextWriter.drawText(offsetX, y, `${game.view.scale.toPrecision(2)}X`);
                                }
                                break;
                            case MenuItem.Fullscreen:
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                t.printFullscreenOptionRectangle(y);
                                break;
                            case MenuItem.SoundVolume:
                                {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.soundVolumeText.length * game.view.default_font.char_width;
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
        game.view.drawImg(BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);

        let scalex = GameMenu.menuEndX - GameMenu.menuPosX;
        let scaley = GameMenu.menuEndY - GameMenu.menuPosY;
        game.view.drawImg(BitmapId.blackpixel, GameMenu.menuPosX + 1, GameMenu.menuPosY + 1, DrawImgFlags.None, scalex - 2, scaley - 2);
        game.view.drawImg(BitmapId.whitepixel, GameMenu.menuPosX, GameMenu.menuPosY, DrawImgFlags.None, scalex, scaley);
    }

    private printFullscreenOptionRectangle(y: number): void {
        let selectedIndex: number = GO.Fullscreen ? 0 : 1;
        game.view.drawImg(BitmapId.redpixel, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY, DrawImgFlags.None, GameMenu.fullscreenOptionsRectangleSize.x, GameMenu.fullscreenOptionsRectangleSize.y);
    }

    private printSaveSlot(x: number, y: number, slotIndex: number): void {
        // let exists = SlotExists(slotIndex);
        // if (!exists) {
        //     TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex} + 1: ${GameMenu.emptySlot}`);
        //     return;
        // }
        // let savegame = LoadGame(slotIndex);
        // let time = savegame.Timestamp;
        // TextWriter.drawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex + 1}: ${time.getDay().toFixed(2)}/${time.getMonth().toFixed(2)}/${time.getFullYear().toFixed(2)} - ${time.getHours().toFixed(2)}:${time.getMinutes().toFixed(2)}`);
    }
}
