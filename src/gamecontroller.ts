import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item, ItemType } from "./item";
import { AudioId, BitmapId } from "./resourceids";
import { Direction } from "../BoazEngineJS/direction";
import { Bootstrapper } from "./bootstrapper";
import { Savegame } from "../BoazEngineJS/savegame";
import { WeaponItem } from "./weaponitem";
import { Model as M, Model, GameState, GameSubstate } from "./gamemodel"
import { WeaponFireHandler } from "./weaponfirehandler";
import { Room } from "./room";
import { GameMenu } from "./gamemenu";
import { waitDuration, setPoint } from '../BoazEngineJS/common';
import { SM } from "../BoazEngineJS/soundmaster";
import { Constants as CS } from "../BoazEngineJS/constants";
import { GameView as V } from './gameview';
import { GameConstants } from "./gameconstants";
import { LoadGame } from '../BoazEngineJS/gamestateloader';
import { GameSaver } from "../BoazEngineJS/gamesaver";
import { BaseController } from '../BoazEngineJS/controller';
import { Input } from "../BoazEngineJS/input";
import { TileSize, Tile } from "../BoazEngineJS/msx";
import { Pietula } from "./pietula";

export class Controller extends BaseController {
    private static _instance: Controller;
    public static get _(): Controller {
        return Controller._instance != null ? Controller._instance : (Controller._instance = new Controller());
    }

    public InEventState: boolean;
    private startAfterLoadTimer: BStopwatch;
    public ElapsedMsDelta: number;

    constructor() {
        super();
        this.startAfterLoadTimer = BStopwatch.createWatch();
    }

    public disposeOldState(newState: GameState): void {
        let oldState = M._.State;
        switch (oldState) {
            case GameState.TitleScreen:
                // SM.stopMusic();
                // if (newState == GameState.Game)
                //     this.setupGameStart(newState);
                break;
            case GameState.GameStart2:
                this.setupGameStart(newState);
                break;
            case GameState.Game:
                break;
            default:
                break;
        }
    }

    protected disposeOldSubstate(newsubstate: GameSubstate): void {
    }

    public SwitchToOldState(): void {
        this.switchState(M._.OldState);
    }

    public SwitchToOldSubstate(): void {
        this.switchSubstate(M._.OldSubstate);
    }

    protected initNewState(newState: GameState): void {
        switch (newState) {
            case GameState.TitleScreen:
                break;
            case GameState.EndDemo:
                M._.EndDemo.Init();
                break;
            case GameState.GameStart1:
                this.timer.restart();
                break;
            case GameState.GameStart2:
                this.timer.restart();
                SM.playMusic(AudioId.VampireKiller);
                break;
            case GameState.Game:
                break;
            default:
                break;
        }
    }

    protected initNewSubstate(newsubstate: GameSubstate): void {
    }

    public switchSubstate(newSubstate: GameSubstate): void {
        super.switchSubstate(newSubstate);
        switch (newSubstate) {
            case GameSubstate.Conversation:
                break;
            case GameSubstate.BelmontDies:
                SM.playMusic(AudioId.OHNOES);
                break;
            case GameSubstate.ItsCurtainsForYou:
            case GameSubstate.ToEndDemo:
                M._.ItsCurtains.Init();
                break;
            case GameSubstate.GameOver:
                SM.playMusic(AudioId.Humiliation);
                M._.GameOverScreen.Init();
                break;
            case GameSubstate.IngameMenu:
                BStopwatch.pauseAllRunningWatches(true);
                break;
            case GameSubstate.GameMenu:
                BStopwatch.pauseAllRunningWatches(true);
                break;
            case GameSubstate.SwitchRoom:
                this.timer.restart();
                break;
            case GameSubstate.Default:
                if (M._.OldSubstate == GameSubstate.IngameMenu || M._.OldSubstate == GameSubstate.GameMenu)
                    BStopwatch.resumeAllPausedWatches();
                break;
        }
        M._.Substate = newSubstate;
    }

    public takeTurn(elapsedMs: number): void {
        if (M._.paused) {
            this.handlePausedState();
            return
        }
        if (M._.startAfterLoad) {
            this.handleStartAfterLoadState();
            return
        }
        this.ElapsedMsDelta = elapsedMs;
        switch (M._.State) {
            case GameState.TitleScreen:
                if (Input.KC_SPACE) {
                    this.switchState(GameState.GameStart1);
                }
                break;
            case GameState.EndDemo:
                M._.EndDemo.TakeTurn();
                break;
            case GameState.GameStart1:
                if (waitDuration(this.timer, GameConstants.WaitAfterGameStart1)) {
                    this.switchState(GameState.GameStart2);
                }
                break;
            case GameState.GameStart2:
                if (waitDuration(this.timer, GameConstants.WaitAfterGameStart2)) {
                    this.switchState(GameState.Game);
                }
                break;
            case GameState.Game:
                switch (M._.Substate) {
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        M._.GameMenu.TakeTurn();
                        break;
                    case GameSubstate.BelmontDies:
                        this.handleInputDuringGame();
                        M._.Belmont.takeTurn();
                        M._.Hud.TakeTurn();
                        break;
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                        this.handleInputDuringGame();
                        M._.Belmont.takeTurn();
                        M._.Hud.TakeTurn();
                        M._.ItsCurtains.TakeTurn();
                        break;
                    case GameSubstate.GameOver:
                        this.handleInputDuringGame();
                        M._.GameOverScreen.TakeTurn();
                        M._.GameMenu.TakeTurn();
                        break;
                    case GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                            if (GameConstants.CheckpointAtRoomEntry)
                                this.StoreCheckpoint();
                        }
                        break;
                    case GameSubstate.Default:
                        this.handleInputDuringGame();
                        let objects = M._.objects;
                        let foes = M._.Foes;
                        objects.forEach(o => o.takeTurn());
                        objects.filter(o => o.disposeFlag === true).forEach(o => M._.remove(o));
                        M._.currentRoom.TakeTurn();
                        M._.Hud.TakeTurn();
                        break;
                }
                break;
            case GameState.Event:
                if (M._.Belmont.Dying)
                    this.SwitchToOldState();
                switch (M._.Substate) {
                    case GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.SwitchToOldSubstate();
                        }
                        break;
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        M._.GameMenu.TakeTurn();
                        break;
                    default:
                        let objects = M._.objects;
                        objects.forEach(o => o.takeTurn());
                        objects.filter(o => o.disposeFlag === true).forEach(o => M._.remove(o));
                        M._.currentRoom.TakeTurn();
                        M._.Hud.TakeTurn();
                        if (Input.KD_F5 && !M._.GameMenu.visible)
                            this.OpenGameMenu();
                        break;
                }
                break;
            case GameState.LoadTheGame:
                break; // Do nothing
            default:
                break;
        }
    }

    private handleInputDuringGame(): void {
        if (Input.KC_F1)
            this.PauseGame();
        switch (M._.Substate) {
            case GameSubstate.BelmontDies:
            case GameSubstate.ItsCurtainsForYou:
            case GameSubstate.ToEndDemo:
                break;
            case GameSubstate.GameOver:
                M._.GameOverScreen.HandleInput();
                if (M._.GameMenu.visible)
                    this.handleInputDuringGameMenu();
                break;
            case GameSubstate.GameMenu:
                this.handleInputDuringGameMenu();
                break;
            case GameSubstate.Default:
            default:
                if (Input.KC_SPACE) {
                    WeaponFireHandler.HandleFireMainWeapon();
                }
                if (Input.KC_M) {
                    WeaponFireHandler.HandleFireSecondaryWeapon();
                }
                else if (Input.KC_F5 && !M._.GameMenu.visible)
                    this.OpenGameMenu();
                break;
        }
    }

    private handleInputDuringPause(): void {
        if (Input.KC_F1)
            this.UnpauseGame();
    }

    private handleInputDuringGameMenu(): void {
        M._.GameMenu.HandleInput();
        if (Input.KC_F5) {
            this.CloseGameMenu();
        }
    }

    public KillFocus(): void {
        if (!M._.paused && M._.State == GameState.Game && M._.Substate == GameSubstate.Default && GameConstants.PauseGameOnKillFocus)
            this.PauseGame();
    }

    public SetFocus(): void {
    }

    private handlePausedState(): void {
        this.handleInputDuringPause();
    }

    private handleStartAfterLoadState(): void {
        if (waitDuration(this.startAfterLoadTimer, GameConstants.WaitAfterLoadGame)) {
            M._.startAfterLoad = false;
            BStopwatch.removeWatch(this.startAfterLoadTimer);
            if (SM.MusicBeingPlayed)
                SM.playMusic(SM.MusicBeingPlayed.AudioId);
        }
    }

    public BelmontDied(): void {
        this.switchSubstate(GameSubstate.BelmontDies);
    }

    public BelmontDeathAniFinished(): void {
        this.switchSubstate(GameSubstate.ItsCurtainsForYou);
    }

    public ItsCurtainsAniFinished(): void {
        if (M._.Substate == GameSubstate.ItsCurtainsForYou)
            this.switchSubstate(GameSubstate.GameOver);
        else this.switchState(GameState.EndDemo);
    }

    public BossDefeated(): void {
        this.switchSubstate(GameSubstate.ToEndDemo);
    }

    public HandleRoomExitViaMovement(targetRoom: number, dir: Direction): void {
        let Belmont = M._.Belmont;
        switch (dir) {
            case Direction.Up:
                setPoint(Belmont.pos, Belmont.pos.x, Tile.toStageCoord(GameConstants.StageScreenHeightTiles) - (Belmont.size.y + 4));
                break;
            case Direction.Right:
                setPoint(Belmont.pos, 4, Belmont.pos.y);
                break;
            case Direction.Down:
                setPoint(Belmont.pos, Belmont.pos.x, 4);
                break;
            case Direction.Left:
                setPoint(Belmont.pos, Tile.toStageCoord(GameConstants.StageScreenWidthTiles) - (Belmont.size.x + 4), Belmont.pos.y);
                break;
        }
        this.DoRoomExit(targetRoom);
    }

    public DoRoomExit(targetRoom: number): void {
        M._.LastFoeThatWasHit = null;
        M._.LoadRoom(targetRoom);
        this.switchSubstate(GameSubstate.SwitchRoom);
    }

    private setupGameStart(newState: GameState): void {
        M._.InitModelForGameStart();
        Bootstrapper.BootstrapGame(M._.SelectedChapterToPlay);
        M._.Hud.SetShownLevelsToProperValues();
        M._.State = newState;
        this.StoreCheckpoint();
    }

    public PauseGame(): void {
        M._.paused = true;
        BStopwatch.pauseAllRunningWatches();
        // SM.StopEffect();
        // SM.stopMusic();
    }

    public UnpauseGame(): void {
        M._.paused = false;
        BStopwatch.resumeAllPausedWatches();
        // SM.resumeEffect();
        // SM.resumeMusic();
    }

    public OpenGameMenu(): void {
        M._.GameMenu.Open();
        this.switchSubstate(GameSubstate.GameMenu);
    }

    public CloseGameMenu(): void {
        M._.GameMenu.Close();
        this.SwitchToOldSubstate();
    }

    public LoadGame(sg: Savegame): void {
        // SM.StopEffect();
        // SM.stopMusic();
        // let oldcheckpoint = M._.Checkpoint;
        // M._ = sg.Model as GameModel;
        // M._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // BStopwatch.Watches = sg.RegisteredWatches;
        // M._.InitAfterGameLoad();
        // M._.GameMenu = new GameMenu();
        // M._.startAfterLoad = true;
        // this.startAfterLoadTimer.pauseDuringMenu = false;
        // this.startAfterLoadTimer.restart();
        // BStopwatch.addWatch(this.startAfterLoadTimer);
        // BStopwatch.addWatch(this.timer);
        // SM.MusicBeingPlayed = sg.MusicBeingPlayed;
    }

    public SaveGame(slot: number): void {
        if (M._.Substate == GameSubstate.GameMenu)
            this.CloseGameMenu();
        // BStopwatch.removeWatch(this.timer);
        // GameSaver.saveGame(M._, slot);
        // BStopwatch.addWatch(this.timer);
    }

    public StoreCheckpoint(): void {
        // BStopwatch.removeWatch(this.timer);
        // M._.Checkpoint = GameSaver.GetCheckpoint(M._);
        // BStopwatch.addWatch(this.timer);
    }

    public LoadCheckpoint(): void {
        // if (M._.Checkpoint == null)
        //     M._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // this.LoadGame(M._.Checkpoint);
    }

    public PickupItem(source: Item): void {
        if (source.id != null)
            M._.ItemsPickedUp[source.id] = true;
        M._.AddItemToInventory(source.ItsType);
    }

    public UseItem(itemType: ItemType): void {
        let bagitem = M._.ItemsInInventory.find(i => i.Type == itemType);
        if (bagitem.Amount > 0) {
            if (Item.ItemUsable(itemType) != Item.Usable.Infinite)
                --bagitem.Amount;
            this.HandleUseItem(itemType);
        }
    }

    private HandleUseItem(itemType: ItemType): void {
        switch (itemType) {
            case Item.Type.None:
                M._.Belmont.Health = M._.Belmont.MaxHealth;
                break;
        }
    }

    public PickupWeaponItem(source: WeaponItem): void {
        M._.AddWeaponToInventory(source.ItsType);
        if (source.id != null)
            M._.ItemsPickedUp[source.id] = true;
    }

    public startBossFight(baas: Pietula): void {
        SM.playMusic(AudioId.Baas);
        M._.RoomExitsLocked = true;
        M._.BossBattle = true;
        M._.Boss = baas;
    }
}