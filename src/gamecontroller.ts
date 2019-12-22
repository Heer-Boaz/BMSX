import { BaseController, BStopwatch } from './bmsx/engine';
import { GameState, GameSubstate, Model } from './gamemodel';
import { SM } from './bmsx/soundmaster';
import { AudioId } from './bmsx/resourceids';
import { Input } from './bmsx/input';
import { waitDuration, Direction, setPoint } from './bmsx/common';
import { GameConstants } from './gameconstants';
import { WeaponFireHandler } from './weaponfirehandler';
import { Tile } from './bmsx/msx';
import { Bootstrapper } from './bootstrapper';
import { Savegame } from './bmsx/gamepersistor';
import { Item, ItemType } from './item';
import { WeaponItem } from './weaponitem';
import { Pietula } from './pietula';

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
        let oldState = Model._.state;
        switch (oldState) {
            case GameState.TitleScreen:
                SM.stopMusic();
                if (newState == GameState.Game)
                    this.setupGameStart(newState);
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

    public switchToOldState(): void {
        this.switchState(Model._.oldGameState);
    }

    public switchToOldSubstate(): void {
        this.switchSubstate(Model._.oldGameSubstate);
    }

    protected initNewState(newState: GameState): void {
        switch (newState) {
            case GameState.TitleScreen:
                break;
            case GameState.EndDemo:
                Model._.EndDemo.Init();
                break;
            case GameState.GameStart1:
                this.timer.restart();
                break;
            case GameState.GameStart2:
                this.timer.restart();
                SM.play(AudioId.VampireKiller);
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
                SM.play(AudioId.OHNOES);
                break;
            case GameSubstate.ItsCurtainsForYou:
            case GameSubstate.ToEndDemo:
                Model._.ItsCurtains.Init();
                break;
            case GameSubstate.GameOver:
                SM.play(AudioId.Humiliation);
                Model._.GameOverScreen.Init();
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
                if (Model._.oldGameSubstate == GameSubstate.IngameMenu || Model._.oldGameSubstate == GameSubstate.GameMenu)
                    BStopwatch.resumeAllPausedWatches();
                break;
        }
        Model._.substate = newSubstate;
    }

    public takeTurn(elapsedMs: number): void {
        if (Model._.paused) {
            this.handlePausedState();
            return
        }
        if (Model._.startAfterLoad) {
            this.handleStartAfterLoadState();
            return
        }
        this.ElapsedMsDelta = elapsedMs;
        switch (Model._.state) {
            case GameState.TitleScreen:
                if (Input.KC_SPACE) {
                    this.switchState(GameState.GameStart1);
                }
                break;
            case GameState.EndDemo:
                Model._.EndDemo.TakeTurn();
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
                switch (Model._.substate) {
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        Model._.GameMenu.takeTurn();
                        break;
                    case GameSubstate.BelmontDies:
                        this.handleInputDuringGame();
                        Model._.Belmont.takeTurn();
                        Model._.Hud.TakeTurn();
                        break;
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                        this.handleInputDuringGame();
                        Model._.Belmont.takeTurn();
                        Model._.Hud.TakeTurn();
                        Model._.ItsCurtains.TakeTurn();
                        break;
                    case GameSubstate.GameOver:
                        this.handleInputDuringGame();
                        Model._.GameOverScreen.TakeTurn();
                        Model._.GameMenu.takeTurn();
                        break;
                    case GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.switchToOldSubstate();
                            if (GameConstants.CheckpointAtRoomEntry)
                                this.StoreCheckpoint();
                        }
                        break;
                    case GameSubstate.Default:
                        this.handleInputDuringGame();
                        let objects = Model._.objects;
                        objects.forEach(o => !o.disposeFlag && o.takeTurn());
                        objects.forEach(o => o.disposeFlag && Model._.remove(o));
                        Model._.currentRoom.takeTurn();
                        Model._.Hud.TakeTurn();
                        break;
                }
                break;
            case GameState.Event:
                if (Model._.Belmont.Dying)
                    this.switchToOldState();
                switch (Model._.substate) {
                    case GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.switchToOldSubstate();
                        }
                        break;
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        Model._.GameMenu.takeTurn();
                        break;
                    default:
                        let objects = Model._.objects;
                        objects.forEach(o => !o.disposeFlag && o.takeTurn());
                        objects.forEach(o => o.disposeFlag && Model._.remove(o));
                        Model._.currentRoom.takeTurn();
                        Model._.Hud.TakeTurn();
                        if (Input.KD_F5 && !Model._.GameMenu.visible)
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
        switch (Model._.substate) {
            case GameSubstate.BelmontDies:
            case GameSubstate.ItsCurtainsForYou:
            case GameSubstate.ToEndDemo:
                break;
            case GameSubstate.GameOver:
                Model._.GameOverScreen.HandleInput();
                if (Model._.GameMenu.visible)
                    this.handleInputDuringGameMenu();
                break;
            case GameSubstate.GameMenu:
                this.handleInputDuringGameMenu();
                break;
            case GameSubstate.Default:
            default:
                if (Input.KC_SPACE) {
                    Input.KD_UP ? WeaponFireHandler.HandleFireSecondaryWeapon() : WeaponFireHandler.HandleFireMainWeapon();
                }
                else if (Input.KC_F5 && !Model._.GameMenu.visible)
                    this.OpenGameMenu();
                break;
        }
    }

    private handleInputDuringPause(): void {
        if (Input.KC_F1)
            this.UnpauseGame();
    }

    private handleInputDuringGameMenu(): void {
        Model._.GameMenu.HandleInput();
        if (Input.KC_F5) {
            this.CloseGameMenu();
        }
    }

    public KillFocus(): void {
        if (!Model._.paused && Model._.state == GameState.Game && Model._.substate == GameSubstate.Default && GameConstants.PauseGameOnKillFocus)
            this.PauseGame();
    }

    public SetFocus(): void {
    }

    private handlePausedState(): void {
        this.handleInputDuringPause();
    }

    private handleStartAfterLoadState(): void {
        if (waitDuration(this.startAfterLoadTimer, GameConstants.WaitAfterLoadGame)) {
            Model._.startAfterLoad = false;
            BStopwatch.removeWatch(this.startAfterLoadTimer);
            // if (SM.currentMusicNode)
            //     SM.play(SM.currentMusicNode.AudioId);
        }
    }

    public BelmontDied(): void {
        this.switchSubstate(GameSubstate.BelmontDies);
    }

    public BelmontDeathAniFinished(): void {
        this.switchSubstate(GameSubstate.ItsCurtainsForYou);
    }

    public ItsCurtainsAniFinished(): void {
        if (Model._.substate == GameSubstate.ItsCurtainsForYou)
            this.switchSubstate(GameSubstate.GameOver);
        else this.switchState(GameState.EndDemo);
    }

    public BossDefeated(): void {
        this.switchSubstate(GameSubstate.ToEndDemo);
    }

    public HandleRoomExitViaMovement(targetRoom: number, dir: Direction): void {
        let Belmont = Model._.Belmont;
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
        Model._.LastFoeThatWasHit = null;
        Model._.LoadRoom(targetRoom);
        this.switchSubstate(GameSubstate.SwitchRoom);
    }

    private setupGameStart(newState: GameState): void {
        Model._.initModelForGameStart();
        Bootstrapper.BootstrapGame(Model._.SelectedChapterToPlay);
        Model._.Hud.SetShownLevelsToProperValues();
        Model._.state = newState;
        this.StoreCheckpoint();
    }

    public PauseGame(): void {
        Model._.paused = true;
        Model._.id2object['pause'].visible = true;
        BStopwatch.pauseAllRunningWatches();
        SM.pause();
    }

    public UnpauseGame(): void {
        Model._.paused = false;
        BStopwatch.resumeAllPausedWatches();
        Model._.id2object['pause'].visible = false;
        SM.resume();
    }

    public OpenGameMenu(): void {
        Model._.GameMenu.Open();
        this.switchSubstate(GameSubstate.GameMenu);
    }

    public CloseGameMenu(): void {
        Model._.GameMenu.Close();
        this.switchToOldSubstate();
    }

    public LoadGame(sg: Savegame): void {
        // SM.StopEffect();
        // SM.stopMusic();
        // let oldcheckpoint = Model._.Checkpoint;
        // M._ = sg.Model as GameModel;
        // Model._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // BStopwatch.Watches = sg.RegisteredWatches;
        // Model._.InitAfterGameLoad();
        // Model._.GameMenu = new GameMenu();
        // Model._.startAfterLoad = true;
        // this.startAfterLoadTimer.pauseDuringMenu = false;
        // this.startAfterLoadTimer.restart();
        // BStopwatch.addWatch(this.startAfterLoadTimer);
        // BStopwatch.addWatch(this.timer);
        // SM.MusicBeingPlayed = sg.MusicBeingPlayed;
    }

    public SaveGame(slot: number): void {
        if (Model._.substate == GameSubstate.GameMenu)
            this.CloseGameMenu();
        // BStopwatch.removeWatch(this.timer);
        // GameSaver.saveGame(M._, slot);
        // BStopwatch.addWatch(this.timer);
    }

    public StoreCheckpoint(): void {
        // BStopwatch.removeWatch(this.timer);
        // Model._.Checkpoint = GameSaver.GetCheckpoint(M._);
        // BStopwatch.addWatch(this.timer);
    }

    public LoadCheckpoint(): void {
        // if (Model._.Checkpoint == null)
        //     Model._.Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // this.LoadGame(Model._.Checkpoint);
    }

    public PickupItem(source: Item): void {
        if (source.id != null)
            Model._.ItemsPickedUp[source.id] = true;
        Model._.AddItemToInventory(source.ItsType);
    }

    public UseItem(itemType: ItemType): void {
        let bagitem = Model._.ItemsInInventory.find(i => i.Type == itemType);
        if (bagitem.Amount > 0) {
            if (Item.ItemUsable(itemType) != Item.Usable.Infinite)
                --bagitem.Amount;
            this.HandleUseItem(itemType);
        }
    }

    private HandleUseItem(itemType: ItemType): void {
        switch (itemType) {
            case Item.Type.None:
                Model._.Belmont.Health = Model._.Belmont.MaxHealth;
                break;
        }
    }

    public PickupWeaponItem(source: WeaponItem): void {
        Model._.AddWeaponToInventory(source.ItsType);
        if (source.id != null)
            Model._.ItemsPickedUp[source.id] = true;
    }

    public startBossFight(baas: Pietula): void {
        SM.play(AudioId.Baas);
        Model._.RoomExitsLocked = true;
        Model._.BossBattle = true;
        Model._.Boss = baas;
    }
}