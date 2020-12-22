import { BStopwatch, model } from '../bmsx/engine';
import { BaseControllerOld } from "../bmsx/basecontroller_old";
import { GameState, GameSubstate, Model } from './gamemodel';
import { SM } from '../bmsx/soundmaster';
import { AudioId } from './resourceids';
import { Input } from '../bmsx/input';
import { waitDuration, Direction, setPoint } from '../bmsx/common';
import { GameConstants } from './gameconstants';
import { WeaponFireHandler } from './weaponfirehandler';
import { Tile } from '../bmsx/msx';
import { Bootloader } from './bootloader';
import { Savegame } from '../bmsx/gamepersistor';
import { Item, ItemType } from './item';
import { WeaponItem } from './weaponitem';
import { Pietula } from './pietula';

export class Controller extends BaseControllerOld {
    public InEventState: boolean;
    private startAfterLoadTimer: BStopwatch;
    public ElapsedMsDelta: number;

    constructor() {
        super();
        this.startAfterLoadTimer = BStopwatch.createWatch();
    }

    public disposeOldState(newState: GameState): void {
        let oldState = (model as Model).state;
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
        this.switchState((model as Model).oldGameState);
    }

    public switchToOldSubstate(): void {
        this.switchSubstate((model as Model).oldGameSubstate);
    }

    protected initNewState(newState: GameState): void {
        switch (newState) {
            case GameState.TitleScreen:
                break;
            case GameState.EndDemo:
                (model as Model).EndDemo.Init();
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
                (model as Model).ItsCurtains.onspawn();
                break;
            case GameSubstate.GameOver:
                SM.play(AudioId.Humiliation);
                (model as Model).GameOverScreen.reset();
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
                if ((model as Model).oldGameSubstate == GameSubstate.IngameMenu || (model as Model).oldGameSubstate == GameSubstate.GameMenu)
                    BStopwatch.resumeAllPausedWatches();
                break;
        }
        (model as Model).substate = newSubstate;
    }

    public takeTurn(elapsedMs: number): void {
        if ((model as Model).paused) {
            this.handlePausedState();
            return
        }
        if ((model as Model).startAfterLoad) {
            this.handleStartAfterLoadState();
            return
        }
        this.ElapsedMsDelta = elapsedMs;
        switch ((model as Model).state) {
            case GameState.TitleScreen:
                if (Input.KC_SPACE || Input.KC_BTN1) {
                    this.switchState(GameState.GameStart1);
                }
                break;
            case GameState.EndDemo:
                (model as Model).EndDemo.TakeTurn();
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
                switch ((model as Model).substate) {
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        (model as Model).GameMenu.run();
                        break;
                    case GameSubstate.BelmontDies:
                        this.handleInputDuringGame();
                        (model as Model).Belmont.run();
                        (model as Model).Hud.takeTurn();
                        break;
                    case GameSubstate.ItsCurtainsForYou:
                    case GameSubstate.ToEndDemo:
                        this.handleInputDuringGame();
                        (model as Model).Belmont.run();
                        (model as Model).Hud.takeTurn();
                        (model as Model).ItsCurtains.run();
                        break;
                    case GameSubstate.GameOver:
                        this.handleInputDuringGame();
                        (model as Model).GameOverScreen.run();
                        (model as Model).GameMenu.run();
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
                        let objects = (model as Model).objects;
                        objects.forEach(o => !o.disposeFlag && o.run());
                        objects.forEach(o => o.disposeFlag && (model as Model).exile(o));
                        (model as Model).currentRoom.run();
                        (model as Model).Hud.takeTurn();
                        break;
                }
                break;
            case GameState.Event:
                if ((model as Model).Belmont.Dying)
                    this.switchToOldState();
                switch ((model as Model).substate) {
                    case GameSubstate.SwitchRoom:
                        if (waitDuration(this.timer, GameConstants.WaitAfterRoomSwitch)) {
                            this.switchToOldSubstate();
                        }
                        break;
                    case GameSubstate.GameMenu:
                        this.handleInputDuringGame();
                        (model as Model).GameMenu.run();
                        break;
                    default:
                        let objects = (model as Model).objects;
                        objects.forEach(o => !o.disposeFlag && o.run());
                        objects.forEach(o => o.disposeFlag && (model as Model).exile(o));
                        (model as Model).currentRoom.run();
                        (model as Model).Hud.takeTurn();
                        if (Input.KD_F5 && !(model as Model).GameMenu.visible)
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
        switch ((model as Model).substate) {
            case GameSubstate.BelmontDies:
            case GameSubstate.ItsCurtainsForYou:
            case GameSubstate.ToEndDemo:
                break;
            case GameSubstate.GameOver:
                (model as Model).GameOverScreen.HandleInput();
                if ((model as Model).GameMenu.visible)
                    this.handleInputDuringGameMenu();
                break;
            case GameSubstate.GameMenu:
                this.handleInputDuringGameMenu();
                break;
            case GameSubstate.Default:
            default:
                if (Input.KC_SPACE || Input.KC_BTN1) {
                    Input.KD_UP ? WeaponFireHandler.HandleFireSecondaryWeapon() : WeaponFireHandler.HandleFireMainWeapon();
                }
                else if (Input.KC_F5 && !(model as Model).GameMenu.visible)
                    this.OpenGameMenu();
                break;
        }
    }

    private handleInputDuringPause(): void {
        if (Input.KC_F1)
            this.UnpauseGame();
    }

    private handleInputDuringGameMenu(): void {
        (model as Model).GameMenu.HandleInput();
        if (Input.KC_F5) {
            this.CloseGameMenu();
        }
    }

    public KillFocus(): void {
        if (!(model as Model).paused && (model as Model).state == GameState.Game && (model as Model).substate == GameSubstate.Default && GameConstants.PauseGameOnKillFocus)
            this.PauseGame();
    }

    public SetFocus(): void {
    }

    private handlePausedState(): void {
        this.handleInputDuringPause();
    }

    private handleStartAfterLoadState(): void {
        if (waitDuration(this.startAfterLoadTimer, GameConstants.WaitAfterLoadGame)) {
            (model as Model).startAfterLoad = false;
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
        if ((model as Model).substate == GameSubstate.ItsCurtainsForYou)
            this.switchSubstate(GameSubstate.GameOver);
        else this.switchState(GameState.EndDemo);
    }

    public BossDefeated(): void {
        this.switchSubstate(GameSubstate.ToEndDemo);
    }

    public HandleRoomExitViaMovement(targetRoom: number, dir: Direction): void {
        let Belmont = (model as Model).Belmont;
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
        (model as Model).LastFoeThatWasHit = null;
        (model as Model).LoadRoom(targetRoom);
        this.switchSubstate(GameSubstate.SwitchRoom);
    }

    private setupGameStart(newState: GameState): void {
        (model as Model).initModelForGameStart();
        Bootloader.Boot((model as Model).SelectedChapterToPlay);
        (model as Model).Hud.SetShownLevelsToProperValues();
        (model as Model).state = newState;
        this.StoreCheckpoint();
    }

    public PauseGame(): void {
        (model as Model).paused = true;
        (model as Model).id2object['pause'].visible = true;
        BStopwatch.pauseAllRunningWatches();
        SM.pause();
    }

    public UnpauseGame(): void {
        (model as Model).paused = false;
        BStopwatch.resumeAllPausedWatches();
        (model as Model).id2object['pause'].visible = false;
        SM.resume();
    }

    public OpenGameMenu(): void {
        (model as Model).GameMenu.Open();
        this.switchSubstate(GameSubstate.GameMenu);
    }

    public CloseGameMenu(): void {
        (model as Model).GameMenu.Close();
        this.switchToOldSubstate();
    }

    public LoadGame(sg: Savegame): void {
        // SM.StopEffect();
        // SM.stopMusic();
        // let oldcheckpoint = (model as Model).Checkpoint;
        // M._ = sg.Model as GameModel;
        // (model as Model).Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // BStopwatch.Watches = sg.RegisteredWatches;
        // (model as Model).InitAfterGameLoad();
        // (model as Model).GameMenu = new GameMenu();
        // (model as Model).startAfterLoad = true;
        // this.startAfterLoadTimer.pauseDuringMenu = false;
        // this.startAfterLoadTimer.restart();
        // BStopwatch.addWatch(this.startAfterLoadTimer);
        // BStopwatch.addWatch(this.timer);
        // SM.MusicBeingPlayed = sg.MusicBeingPlayed;
    }

    public SaveGame(slot: number): void {
        if ((model as Model).substate == GameSubstate.GameMenu)
            this.CloseGameMenu();
        // BStopwatch.removeWatch(this.timer);
        // GameSaver.saveGame(M._, slot);
        // BStopwatch.addWatch(this.timer);
    }

    public StoreCheckpoint(): void {
        // BStopwatch.removeWatch(this.timer);
        // (model as Model).Checkpoint = GameSaver.GetCheckpoint(M._);
        // BStopwatch.addWatch(this.timer);
    }

    public LoadCheckpoint(): void {
        // if ((model as Model).Checkpoint == null)
        //     (model as Model).Checkpoint = LoadGame(CS.SaveSlotCheckpoint);
        // this.LoadGame((model as Model).Checkpoint);
    }

    public PickupItem(source: Item): void {
        if (source.id != null)
            (model as Model).ItemsPickedUp[source.id] = true;
        (model as Model).AddItemToInventory(source.ItsType);
    }

    public UseItem(itemType: ItemType): void {
        let bagitem = (model as Model).ItemsInInventory.find(i => i.Type == itemType);
        if (bagitem.Amount > 0) {
            if (Item.ItemUsable(itemType) != Item.Usable.Infinite)
                --bagitem.Amount;
            this.HandleUseItem(itemType);
        }
    }

    private HandleUseItem(itemType: ItemType): void {
        switch (itemType) {
            case Item.Type.None:
                (model as Model).Belmont.Health = (model as Model).Belmont.MaxHealth;
                break;
        }
    }

    public PickupWeaponItem(source: WeaponItem): void {
        (model as Model).AddWeaponToInventory(source.ItsType);
        if (source.id != null)
            (model as Model).ItemsPickedUp[source.id] = true;
    }

    public startBossFight(baas: Pietula): void {
        SM.play(AudioId.Baas);
        (model as Model).RoomExitsLocked = true;
        (model as Model).BossBattle = true;
        (model as Model).Boss = baas;
    }
}