import { Chapter, GameState, Model } from "./gamemodel";
import { SM as S } from "../bmsx/soundmaster";
import { Direction } from "../bmsx/common";
import { Controller } from "./gamecontroller";
import { TextWriter } from "./textwriter";
import { view, model, controller } from "../bmsx/engine";
import { Constants as CS } from "../bmsx/engine";
import { Input } from "../bmsx/input";
import { SlotExists } from "../bmsx/gamepersistor";
import { AudioId, BitmapId } from "../bmsx/resourceids";
import { Msx1Colors } from "../bmsx/msx";

export const enum State {
    SelectMain,
    SubMenu,
    SelectChapter
}

export const enum MenuItem {
    NewGame,
    Continue,
    LoadGame,
    Options,
    ToMainMenu,
    Prologue,
    Chapter0,
    Chapter1,
    Debug
}

export class MainMenu {
    private selectedIndex: number;
    private state: State;
    private static items: string[] = new Array("New game", "Continue game", "Load game", "Options");
    private static menuOptions: MenuItem[] = new Array(MenuItem.NewGame, MenuItem.Continue, MenuItem.LoadGame, MenuItem.Options);
    private static chapterItems: string[] = new Array("Debug", "Prologue", "Chapter 0", "Chapter 1", "Back");
    private static chapterOptions: MenuItem[] = new Array(MenuItem.Debug, MenuItem.Prologue, MenuItem.Chapter0, MenuItem.Chapter1, MenuItem.ToMainMenu);
    private static itemYs: number[] = new Array(140, 156, 172, 188, 196, 204);
    private static itemsX: number = 48;
    private static cursorPosX: number = 36;
    private static boxX: number = MainMenu.cursorPosX - 8;
    private static boxY: number = 132;
    private static boxEndX: number = MainMenu.boxX + 176 + 32;
    private static boxEndY: number = MainMenu.boxY + 24 + 48;

    private get cursorX(): number {
        return MainMenu.cursorPosX;
    }

    private get cursorY(): number {
        return MainMenu.itemYs[this.selectedIndex];
    }

    private get selectedItem(): MenuItem {
        switch (this.state) {
            case State.SelectMain:
                return MainMenu.menuOptions[this.selectedIndex];
            case State.SelectChapter:
                return MainMenu.chapterOptions[this.selectedIndex];
            default:
                return MenuItem.ToMainMenu;
        }
    }

    constructor() {
    }

    public Init(): void {
        this.reset();
    }

    private reset(): void {
        this.selectedIndex = 0;
        this.state = State.SelectMain;
    }

    public HandleInput(): void {
        let selectionChanged: boolean = false;
        if (Input.KC_UP)
            this.changeSelection(Direction.Up, selectionChanged);
        else if (Input.KC_RIGHT)
            this.changeSelection(Direction.Right, selectionChanged);
        else if (Input.KC_DOWN)
            this.changeSelection(Direction.Down, selectionChanged);
        else if (Input.KC_LEFT)
            this.changeSelection(Direction.Left, selectionChanged);
        if (selectionChanged)
            S.play(AudioId.Selectie);
        if (Input.KC_SPACE) {
            switch (this.state) {
                case State.SelectMain:
                    S.play(AudioId.Selectie);
                    switch (this.selectedItem) {
                        case MenuItem.NewGame:
                            this.state = State.SelectChapter;
                            this.selectedIndex = 0;
                            break;
                        case MenuItem.Continue:
                            if (SlotExists(CS.SaveSlotCheckpoint))
                                (controller as Controller).LoadCheckpoint();
                            else S.play(AudioId.Fout);
                            break;
                        case MenuItem.LoadGame:
                            Input.reset();
                            (model as Model).GameMenu.Open(MenuItem.LoadFromMainMenu);
                            this.state = State.SubMenu;
                            break;
                        case MenuItem.Options:
                            Input.reset();
                            (model as Model).GameMenu.Open(MenuItem.OptionsFromMainMenu);
                            this.state = State.SubMenu;
                            break;
                    }
                    break;
                case State.SelectChapter:
                    S.play(AudioId.Selectie);
                    switch (this.selectedItem) {
                        case MenuItem.Debug:
                            (model as Model).SelectedChapterToPlay = Chapter.Debug;
                            (controller as Controller).switchState(GameState.Game);
                            break;
                        case MenuItem.Prologue:
                            (model as Model).SelectedChapterToPlay = Chapter.Prologue;
                            (controller as Controller).switchState(GameState.GameStart1);
                            break;
                        case MenuItem.Chapter0:
                            (model as Model).SelectedChapterToPlay = Chapter.Chapter_0;
                            (controller as Controller).switchState(GameState.GameStart1);
                            break;
                        case MenuItem.Chapter1:
                            (model as Model).SelectedChapterToPlay = Chapter.GameStart;
                            (controller as Controller).switchState(GameState.GameStart1);
                            break;
                        case MenuItem.ToMainMenu:
                            this.state = State.SelectMain;
                            this.selectedIndex = 0;
                            break;
                    }
                    break;
                case State.SubMenu:
                    break;
            }
        }
    }

    private changeSelection(dir: Direction, selectionChanged: boolean): void {
        if (this.state == State.SubMenu)
            return
        let currentItems: string[];
        switch (this.state) {
            case State.SelectMain:
            default:
                currentItems = MainMenu.items;
                break;
            case State.SelectChapter:
                currentItems = MainMenu.chapterItems;
                break;
        }
        switch (dir) {
            case Direction.Up:
                if (this.selectedIndex > 0)
                    this.selectedIndex--;
                else this.selectedIndex = currentItems.length - 1;
                selectionChanged = true;
                break;
            case Direction.Down:
                if (this.selectedIndex < currentItems.length - 1)
                    this.selectedIndex++;
                else this.selectedIndex = 0;
                selectionChanged = true;
                break;
        }
    }

    public TakeTurn(): void {
    }

    public Paint(): void {
        view.drawImg(BitmapId.Title, 0, 0);
        view.fillRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, Msx1Colors[4]);
        view.drawRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, Msx1Colors[15]);
        switch (this.state) {
            case State.SubMenu:
            case State.SelectMain:
                for (let i = 0; i < MainMenu.items.length; i++) {
                    switch (MainMenu.menuOptions[i]) {
                        case MenuItem.Continue:
                            if (SlotExists(CS.SaveSlotCheckpoint))
                                TextWriter.drawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                            else TextWriter.drawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i], Msx1Colors[0]);
                            break;
                        default:
                            TextWriter.drawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                            break;
                    }
                }
                break;
            case State.SelectChapter:
                for (let i = 0; i < MainMenu.chapterItems.length; i++) {
                    TextWriter.drawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.chapterItems[i]);
                }
                break;
        }
        view.drawImg(BitmapId.MenuCursor, this.cursorX, this.cursorY);

    }

    public GameMenuClosed(): void {
        this.reset();
    }
}