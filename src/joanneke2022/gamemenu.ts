import { Constants, Direction, GameOptions as GO, WorldObject, Input, Msx1Colors, Msx1ExtColors, SM, Size, TextWriter, new_vec2, set_vec2, vec2, vec3 } from '../bmsx/bmsx';
import { AudioId, BitmapId } from './resourceids';

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
    // private static itemVerticalSkipPerEntry: number = GameMenu.cursorVerticalSkipPerEntry;
    private static menuText: string = "- Game Menu -";
    private static loadMenuText: string = "- Load game -";
    private static saveMenuText: string = "- Save game -";
    private static optionMenuText: string = "- Options -";
    private static backText: string = "Back";
    // private static emptySlot: string = "----";
    private static scaleText: string = "Scale: ";
    private static soundVolumeText: string = "Volume: ";
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
    ];
    private static fullscreenOptionsOffsets: number[];
    private static fullscreenOptionsOffsetY: number;
    private static fullscreenOptionsRectangleSize: Size;
    private cursorPos: vec2;
    private selectedItemIndex: number;
    private CurrentScreen: MenuItem;

    constructor() {
        super();
        this.id = 'gamemenu';
        this.z = 900;
        this.visible = false;
        this.cursorPos = new_vec2(0, 0);
        this.x = GameMenu.menuPosX, this.y = GameMenu.menuPosY;
        this.size.x = GameMenu.menuEndX - GameMenu.menuPosX, this.size.y = GameMenu.menuEndY - GameMenu.menuPosY;
        this.selectedItemIndex = 0;
        this.CurrentScreen = MenuItem.Main;
        GameMenu.fullscreenOptionsOffsets = [$.view.default_font.char_width('a') * 12 - 1, $.view.default_font.char_height('a') * 14 - 1];
        GameMenu.fullscreenOptionsOffsetY = -1;
        GameMenu.fullscreenOptionsRectangleSize = new_vec2($.view.default_font.char_width('a') + 2, $.view.default_font.char_height('a') + 2);
    }

    public Open(currentscreen: MenuItem = MenuItem.Main): void {
        this.selectedItemIndex = 0;
        this.visible = true;
        this.CurrentScreen = currentscreen;
        if (this.CurrentScreen == MenuItem.Main)
            SM.play(AudioId.selectie);
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
                    this.changeSelection('up');
                else if (clickRight)
                    this.changeSelection('right');
                else if (clickDown)
                    this.changeSelection('down');
                else if (clickLeft)
                    this.changeSelection('left');
                break;
        }
        if (Input.KC_BTN2) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    break;
                default:
                    this.CurrentScreen = MenuItem.Main;
                    this.selectedItemIndex = 0;
                    SM.play(AudioId.selectie);
                    break;
            }
        }
        if (Input.KC_SPACE || Input.KC_BTN1) {
            switch (this.CurrentScreen) {
                case MenuItem.Main:
                    SM.play(AudioId.selectie);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToGame:
                            $world.sc.machines.gamemenu.pop();
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
                            this.CurrentScreen = MenuItem.Save;
                            this.selectedItemIndex = 0;
                            // }
                            break;
                        case MenuItem.ExitGame:
                            $.stop();
                            break;
                    }
                    break;
                case MenuItem.Load:
                case MenuItem.LoadFromGameOver:
                case MenuItem.LoadFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            SM.play(AudioId.selectie);
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
                            }
                            break;
                    }
                    break;
                case MenuItem.Save:
                    SM.play(AudioId.selectie);
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            this.CurrentScreen = MenuItem.Main;
                            this.selectedItemIndex = 0;
                            break;
                        case MenuItem.SaveSlot:
                            {
                                // let slot = this.selectedItemIndex - 1;
                            }
                            break;
                    }
                    break;
                case MenuItem.Options:
                case MenuItem.OptionsFromMainMenu:
                    switch (this.selectedItem) {
                        case MenuItem.ReturnToMain:
                            SM.play(AudioId.selectie);
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
                            SM.play(AudioId.fout);
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
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if ($.view.isFullscreen) {
                                $.view.ToWindowed();
                            }
                            break;
                        case MenuItem.SoundVolume:
                            if (GO.VolumePercentage < 100) {
                                GO.VolumePercentage += 10;
                                if (GO.VolumePercentage > 100)
                                    GO.VolumePercentage = 100;
                                SM.volume += .1;
                            }
                            break;
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
                            }
                            break;
                        case MenuItem.Fullscreen:
                            if (!$.view.isFullscreen) {
                                $.view.toFullscreen();
                            }
                            break;
                        case MenuItem.SoundVolume:
                            if (GO.VolumePercentage > 0) {
                                GO.VolumePercentage -= 10;
                                if (GO.VolumePercentage < 0)
                                    GO.VolumePercentage = 0;
                                SM.volume -= .1;
                            }
                            break;
                    }
                    break;
            }
        }
        if (selectionChanged) {
            SM.play(AudioId.selectie);
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

    private changeSelection(direction: Direction): void {
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
                // selectionChanged = true;
                break;
            case 'right':
                if (x < maxX) {
                    x++;
                    // selectionChanged = true;
                }
                break;
            case 'down':
                if (y < maxY)
                    y++;
                else y = 0;
                // selectionChanged = true;
                break;
            case 'left':
                if (x > 0) {
                    x--;
                    // selectionChanged = true;
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

    override paint = (_offset?: vec3): void => {
        let scalex = GameMenu.menuEndX - GameMenu.menuPosX;
        let scaley = GameMenu.menuEndY - GameMenu.menuPosY;
        let pos: vec3 = { x: GameMenu.menuPosX, y: GameMenu.menuPosY, z: this.z };
        let scale = { x: scalex, y: scaley };
        $.view.drawImg({ imgid: BitmapId.whitepixel, pos, scale });
        pos = { x: GameMenu.menuPosX + 1, y: GameMenu.menuPosY + 1, z: this.z + 1 };
        scale = { x: scalex - 2, y: scaley - 2 };
        $.view.drawImg({ imgid: BitmapId.blackpixel, pos, scale });

        let titleToDraw: string;
        let titleX: number, titleY: number;
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
        TextWriter.drawText(titleX, titleY, titleToDraw, null, null, Msx1Colors[4]);
        let y = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
        switch (this.CurrentScreen) {
            case MenuItem.Main:
            default:
                {
                    GameMenu.mainItems.forEach(function (item) {
                        switch (item.type) {
                            case MenuItem.SaveGame:
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, undefined, undefined, Msx1ExtColors[0]);
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
                                if (!GO.Fullscreen) {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.scaleText.length * $.view.default_font.char_width('a');
                                    TextWriter.drawText(offsetX, y, `${$.view.canvasScale.toPrecision(2)}X`);
                                }
                                else {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, undefined, undefined, Msx1ExtColors[0]);
                                    offsetX += GameMenu.scaleText.length * $.view.default_font.char_height('a');
                                    TextWriter.drawText(offsetX, y, `${$.view.canvasScale.toPrecision(2)}X`);
                                }
                                break;
                            case MenuItem.Fullscreen:
                                t.printFullscreenOptionRectangle(y);
                                TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                break;
                            case MenuItem.SoundVolume:
                                {
                                    TextWriter.drawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                    offsetX += GameMenu.soundVolumeText.length * $.view.default_font.char_width('a');
                                    GO.VolumePercentage = ~~(SM.volume * 100); // TODO: LELIJK!!!!
                                    let text = GO.VolumePercentage > 0 ? GO.VolumePercentage + "%" : "Off";
                                    TextWriter.drawText(offsetX, y, text);
                                }
                                break;
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
        $.view.drawImg({ pos: { ...this.cursorPos, z: this.z + 10 }, imgid: BitmapId.menucursor });
    };

    private printFullscreenOptionRectangle(y: number): void {
        // let selectedIndex: number = GO.Fullscreen ? 0 : 1;
        let selectedIndex: number = $.view.isFullscreen ? 0 : 1;
        const pos = { x: GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y: y + GameMenu.fullscreenOptionsOffsetY, z: this.z + 2 };
        const scale = { x: GameMenu.fullscreenOptionsRectangleSize.x, y: GameMenu.fullscreenOptionsRectangleSize.y };
        $.view.drawImg({ imgid: BitmapId.redpixel, pos, scale });
    }

    // @ts-ignore
    private printSaveSlot(x: number, y: number, slotIndex: number): void {
    }
}
