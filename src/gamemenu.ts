import { MenuItem } from "./mainmenu";
import { View } from "../BoazEngineJS/view";
import { AudioId, BitmapId } from "./resourceids";
import { Direction } from "../BoazEngineJS/direction";
import { TextWriter } from "./textwriter";
import { KeyState } from "../BoazEngineJS/input";
import { Size, Point } from "../BoazEngineJS/interfaces";

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
    private static mainItems: MenuOption[] = [__init(new MenuOption(), { type: GameMenu.MenuItem.ChangeOptions, label: "Options" }),
    __init(new MenuOption(), { type: MenuItem.LoadGame, label: "Load game" }),
    __init(new MenuOption(), { type: MenuItem.SaveGame, label: "Save game" }),
    __init(new MenuOption(), { type: MenuItem.ExitGame, label: "Exit game" }),
    __init(new MenuOption(), { type: MenuItem.ReturnToGame, label: "Return to game" })];
    private static optionsItems: MenuOption[] = [__init(new MenuOption(), { type: GameMenu.MenuItem.ReturnToMain, label: GameMenu.backText }),
    __init(new MenuOption(), { type: MenuItem.Scale, label: GameMenu.scaleText }),
    __init(new MenuOption(), { type: MenuItem.Fullscreen, label: "Fullscreen: y n" }),
    __init(new MenuOption(), { type: MenuItem.MusicVolume, label: GameMenu.musicVolumeText }),
    __init(new MenuOption(), { type: MenuItem.EffectVolume, label: GameMenu.effectVolumeText })];
    private static fullscreenOptionsOffsets: number[] = [TextWriter.FontWidth * 12 - 1, TextWriter.FontWidth * 14 - 1];
    private static fullscreenOptionsOffsetY: number = -1;
    private static fullscreenOptionsRectangleSize: Size = new Size(TextWriter.FontWidth + 2, TextWriter.FontHeight + 2);
    public visible: boolean;
    private cursorPos: Point;
    private selectedItemIndex: number;
    private CurrentScreen: GameMenu.MenuItem;
    constructor() {
        this.visible = false;
        this.cursorPos = <Point>{ x: 0, y: 0 };
        this.selectedItemIndex = 0;
        this.CurrentScreen = GameMenu.MenuItem.Main;
    }
    public Open(currentscreen: GameMenu.MenuItem = GameMenu.MenuItem.Main): void {
        this.selectedItemIndex = 0;
        this.visible = true;
        this.CurrentScreen = currentscreen;
        if (this.CurrentScreen == GameMenu.MenuItem.Main)
            S.PlayEffect(RM.Sound[AudioId.Selectie]);
    }
    public Close(): void {
        this.visible = false;
        this.selectedItemIndex = 0;
        switch (this.CurrentScreen) {
            case GameMenu.MenuItem.LoadFromGameOver:
                V._.GameOverGameMenu.MenuItem.GameMenuClosed();
                break;
            case GameMenu.MenuItem.LoadFromMainMenu:
            case GameMenu.MenuItem.OptionsFromMainMenu:
                V._.MainMenu.GameMenuClosed();
                break;
            default:
                M._.ItemsInInventory.RemoveAll(i => i.Amount == 0);
                break;
        }
    }
    public TakeTurn(): void {
        if (!this.visible)
            return
        this.cursorPos.Set(this.calculateCursorX(), this.calculateCursorY());
    }
    public HandleInput(): void {
        let selectionChanged: boolean = false;
        switch (this.CurrentScreen) {
            case GameMenu.MenuItem.Main:
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.LoadFromMainMenu:
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
            case GameMenu.MenuItem.Save:
            case GameMenu.MenuItem.LoadFromGameOver:
                if (KeyState.KC_UP)
                    this.changeSelection(Direction.Up, selectionChanged);
                else if (KeyState.KC_RIGHT)
                    this.changeSelection(Direction.Right, selectionChanged);
                else if (KeyState.KC_DOWN)
                    this.changeSelection(Direction.Down, selectionChanged);
                else if (KeyState.KC_LEFT)
                    this.changeSelection(Direction.Left, selectionChanged);
                break;
        }
        if (KeyState.KC_SPACE) {
            switch (this.CurrentScreen) {
                case GameMenu.MenuItem.Main:
                    S.PlayEffect(RM.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case GameMenu.MenuItem.ReturnToGame:
                            C._.CloseGameMenu();
                            break;
                        case GameMenu.MenuItem.ChangeOptions:
                            this.CurrentScreen = GameMenu.MenuItem.Options;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.LoadGame:
                            this.CurrentScreen = GameMenu.MenuItem.Load;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.SaveGame:
                            if (M._.State != M.GameState.Event) {
                                this.CurrentScreen = GameMenu.MenuItem.Save;
                                this.selectedItemIndex = 0;
                            }
                            else S.PlayEffect(RM.Sound[AudioId.Fout]);
                            break;
                        case MenuItem.ExitGame:
                            G._.bxlib.EndGameloop = true;
                            break;
                    }
                    break;
                case GameMenu.MenuItem.Load:
                case GameMenu.MenuItem.LoadFromGameOver:
                case GameMenu.MenuItem.LoadFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            S.PlayEffect(RM.Sound[AudioId.Selectie]);
                            switch (this.CurrentScreen) {
                                case GameMenu.MenuItem.LoadFromGameOver:
                                case GameMenu.MenuItem.LoadFromMainMenu:
                                    this.Close();
                                    break;
                                default:
                                    this.CurrentScreen = GameMenu.MenuItem.Main;
                                    this.selectedItemIndex = 0;
                                    break;
                            }
                            break;
                        case MenuItem.SaveSlot:
                            {
                                let slot = this.selectedItemIndex - 1;
                                if (GameLoader.SlotExists(slot)) {
                                    let sg = GameLoader.LoadGame(slot);
                                    C._.LoadGame(sg);
                                }
                                else S.PlayEffect(RM.Sound[AudioId.Fout]);
                            }
                            break;
                    }
                    break;
                case GameMenu.MenuItem.Save:
                    S.PlayEffect(RM.Sound[AudioId.Selectie]);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            this.CurrentScreen = GameMenu.MenuItem.Main;
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
                case GameMenu.MenuItem.Options:
                case GameMenu.MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case GameMenu.MenuItem.ReturnToMain:
                            S.PlayEffect(RM.Sound[AudioId.Selectie]);
                            switch (this.CurrentScreen) {
                                case GameMenu.MenuItem.OptionsFromMainMenu:
                                    this.Close();
                                    break;
                                default:
                                    this.CurrentScreen = GameMenu.MenuItem.Main;
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
        if (KeyState.KC_RIGHT) {
            switch (this.CurrentScreen) {
                case GameMenu.MenuItem.Options:
                case GameMenu.MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO._.Fullscreen) {
                                let hresult = V._.ChangeScale(GO._.Scale + 1);
                                if (hresult.Succeeded)
                                    G._.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (GO._.Fullscreen) {
                                GO._.Fullscreen = false;
                                let hresult = V._.ToWindowed();
                                if (hresult.Succeeded)
                                    G._.GameOptionsChanged();
                                else GO._.Fullscreen = true;
                            }
                            break;
                        case MenuItem.EffectVolume:
                            if (GO._.EffectsVolumePercentage < 100) {
                                GO._.EffectsVolumePercentage += 10;
                                if (GO._.EffectsVolumePercentage > 100)
                                    GO._.EffectsVolumePercentage = 100;
                                BDX._.SetEffectsVolume(GO._.EffectsVolumePercentage / 100f);
                                G._.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.MusicVolume:
                            if (GO._.MusicVolumePercentage < 100) {
                                GO._.MusicVolumePercentage += 10;
                                if (GO._.MusicVolumePercentage > 100)
                                    GO._.MusicVolumePercentage = 100;
                                BDX._.SetMusicVolume(GO._.MusicVolumePercentage / 100f);
                                G._.GameOptionsChanged();
                            }
                            break;
                    }
                    break;
            }
        }
        if (KeyState.KC_LEFT) {
            switch (this.CurrentScreen) {
                case GameMenu.MenuItem.Options:
                case GameMenu.MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.Scale:
                            if (!GO._.Fullscreen && GO._.Scale > 1) {
                                let hresult: HResult = V._.ChangeScale(GO._.Scale - 1);
                                if (hresult.Succeeded)
                                    G._.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (!GO._.Fullscreen) {
                                GO._.Fullscreen = true;
                                let hresult = V._.ToFullscreen();
                                if (hresult.Succeeded)
                                    G._.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.EffectVolume:
                            if (GO._.EffectsVolumePercentage > 0) {
                                GO._.EffectsVolumePercentage -= 10;
                                if (GO._.EffectsVolumePercentage < 0)
                                    GO._.EffectsVolumePercentage = 0;
                                BDX._.SetEffectsVolume(GO._.EffectsVolumePercentage / 100f);
                                G._.GameOptionsChanged();
                            }
                            break;
                        case MenuItem.MusicVolume:
                            if (GO._.MusicVolumePercentage > 0) {
                                GO._.MusicVolumePercentage -= 10;
                                if (GO._.MusicVolumePercentage < 0)
                                    GO._.MusicVolumePercentage = 0;
                                BDX._.SetMusicVolume(GO._.MusicVolumePercentage / 100f);
                                G._.GameOptionsChanged();
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
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
            case GameMenu.MenuItem.Main:
                return GameMenu.menuPosX + GameMenu.mainItemsOffsetX + GameMenu.cursorOffsetX;
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.LoadFromGameOver:
            case GameMenu.MenuItem.LoadFromMainMenu:
            case GameMenu.MenuItem.Save:
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
            case GameMenu.MenuItem.Main:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = GameMenu.mainItems.length - 1;
                break;
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = GameMenu.optionsItems.length - 1;
                break;
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.Save:
            case GameMenu.MenuItem.LoadFromGameOver:
            case GameMenu.MenuItem.LoadFromMainMenu:
                x = 0;
                y = this.selectedItemIndex;
                maxX = 0;
                maxY = CS.SaveSlotCount;
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
            case GameMenu.MenuItem.Main:
            default:
                return GameMenu.mainItems[this.selectedItemIndex].type;
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.Save:
            case GameMenu.MenuItem.LoadFromGameOver:
            case GameMenu.MenuItem.LoadFromMainMenu:
                return this.selectedItemIndex > 0 ? GameMenu.MenuItem.SaveSlot : GameMenu.MenuItem.ReturnToMain;
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
                return GameMenu.optionsItems[this.selectedItemIndex].type;
        }
    }

    public Paint(): void {
        if (!this.visible)
            return
        BDX._.FillRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, CS.Msx1Colors[1]);
        BDX._.DrawRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, CS.Msx1Colors[15]);
        let titleToDraw: string;
        let titleX: number, titleY;
        switch (this.CurrentScreen) {
            case GameMenu.MenuItem.Main:
                titleToDraw = GameMenu.menuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
                titleToDraw = GameMenu.optionMenuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.LoadFromGameOver:
            case GameMenu.MenuItem.LoadFromMainMenu:
                titleToDraw = GameMenu.loadMenuText;
                titleX = GameMenu.mainMenuTextX;
                titleY = GameMenu.mainMenuTextY;
                break;
            case GameMenu.MenuItem.Save:
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
            case GameMenu.MenuItem.Main:
            default:
                {
                    GameMenu.mainItems.forEach(function (item) {
                        switch (item.type) {
                            case GameMenu.MenuItem.SaveGame:
                                if (M._.State != M.GameState.Event)
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                else TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, CS.Msx1ExtColors[0]);
                                break;
                            default:
                                TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                break;
                        }
                        y += GameMenu.itemOffsetY;
                    });
                    break;
                }
            case GameMenu.MenuItem.Options:
            case GameMenu.MenuItem.OptionsFromMainMenu:
                {
                    GameMenu.optionsItems.forEach(function (item) {
                        let offsetX: number = GameMenu.menuPosX + GameMenu.mainItemsOffsetX;
                        switch (item.type) {
                            case GameMenu.MenuItem.Scale:
                                let textToDisplay: string;
                                if (!GO._.Fullscreen) {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    textToDisplay = GO._.Scale.ToString();
                                    TextWriter.DrawText(offsetX, y, string.Format("{0}X", textToDisplay));
                                }
                                else {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, CS.Msx1ExtColors[0]);
                                    offsetX += GameMenu.scaleText.length * TextWriter.FontWidth;
                                    textToDisplay = BDX._.Zoom.ToString("n2");
                                    TextWriter.DrawText(offsetX, y, string.Format("{0}X", textToDisplay), CS.Msx1ExtColors[0]);
                                }
                                break;
                            case GameMenu.MenuItem.Fullscreen:
                                TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                this.printFullscreenOptionRectangle(y);
                                break;
                            case GameMenu.MenuItem.EffectVolume:
                                {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.effectVolumeText.length * TextWriter.FontWidth;
                                    let text = GO._.EffectsVolumePercentage > 0 ? GO._.EffectsVolumePercentage + "%" : "Off";
                                    TextWriter.DrawText(offsetX, y, text);
                                }
                                break;
                            case GameMenu.MenuItem.MusicVolume:
                                {
                                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.musicVolumeText.length * TextWriter.FontWidth;
                                    let text = GO._.MusicVolumePercentage > 0 ? GO._.MusicVolumePercentage + "%" : "Off";
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
            case GameMenu.MenuItem.Load:
            case GameMenu.MenuItem.LoadFromGameOver:
            case GameMenu.MenuItem.LoadFromMainMenu:
                {
                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < CS.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
            case GameMenu.MenuItem.Save:
                {
                    TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                    y += GameMenu.itemOffsetY;
                    for (let i = 0; i < CS.SaveSlotCount; i++) {
                        this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                        y += GameMenu.itemOffsetY;
                    }
                    break;
                }
        }
        BDX._.DrawBitmap(<number>BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);
    }

    private printFullscreenOptionRectangle(y: number): void {
        let selectedIndex: number = GO._.Fullscreen ? 0 : 1;
        BDX._.DrawRectangle(GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.fullscreenOptionsRectangleSize.x + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY + GameMenu.fullscreenOptionsRectangleSize.y, CS.Msx1Colors[6]);
    }

    private printSaveSlot(x: number, y: number, slotIndex: number): void {
        let exists = GameLoader.SlotExists(slotIndex);
        if (!exists) {
            TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, string.Format("{0}: {1}", slotIndex + 1, GameMenu.emptySlot));
            return
        }
        let savegame = GameLoader.LoadGame(slotIndex);
        let time = savegame.Timestamp;
        TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, string.Format("{0}: {1}/{2}/{3} - {4}:{5}", slotIndex + 1, time.Day.ToString("d2"), time.Month.ToString("d2"), time.Year, time.Hour.ToString("d2"), time.Minute.ToString("d2")));
    }
}

export namespace GameMenu {
    export enum MenuItem {
        Dummy,
        LoadGame,
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
        Options,
        LoadFromGameOver,
        LoadFromMainMenu,
        OptionsFromMainMenu
    }

    export class MenuOption {
        public type: MenuItem;
        public label: string;
    }
}
