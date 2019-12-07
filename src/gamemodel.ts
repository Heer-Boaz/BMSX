import { Foe } from "./foe";
import { Belmont } from "./belmont";
import { Savegame } from "../BoazEngineJS/savegame";
import { BaseModel } from "../BoazEngineJS/model";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { BossFoe } from "./bossfoe";
import { WeaponItem, WeaponType } from "./weaponitem";
import { GameConstants as CS, GameConstants } from "./gameconstants";
import { ItemType } from "./item";
import { GameMenu } from "./gamemenu";
import { Point, IGameObject } from "../BoazEngineJS/interfaces";
import { Room } from "./room";
import { RoomFactory } from "./RoomFactory";
import { HUD } from "./hud";
import { ItsCurtainsForYou } from "./itscurtainsforyou";
import { GameOver } from "./gameover";
import { MainMenu } from "./mainmenu";
import { Title } from "./title";
import { EndDemo } from "./enddemo";
import { view } from "../BoazEngineJS/engine";
import { TextWriter } from "./textwriter";
import { Msx1Colors } from "../BoazEngineJS/msx";

export const enum GameState {
    None = 0,
    Editor,
    TitleScreen,
    Tutorial,
    GameStart1,
    GameStart2,
    GameStartFromGameOver,
    Game,
    Event,
    F1,
    EndDemo,
    GameOver,
    LoadTheGame,
}

export const enum GameSubstate {
    Default = 0,
    Conversation,
    BelmontDies,
    ItsCurtainsForYou,
    ToEndDemo,
    GameOver,
    IngameMenu,
    GameMenu,
    SwitchRoom
}

export const enum Chapter {
    Debug = 0,
    Prologue,
    Chapter_0,
    GameStart
}

export class BagItem {
    public Type: ItemType;
    public Amount: number;
}

export class BagWeapon {
    public Type: WeaponType;
}

export class Location {
    public RoomID: number;
    public Pos: Point;
}

export enum Switch {
    None = 0,
    Dummy,
    GameStart,
    Room1Aanloop,
    Room1GebouwUitleg,
    VijandenUitRaam,
    SchuurSleutelGevonden,
    PraatOverTroep,
    NaarEindbaas,
    WaterEnBroodGevonden,
    WaterEnBroodGegeven,
    VillaSleutelGevonden,

    Ch0_Chapter0Intro,
    Ch0_LigpietOnderzocht,
    Ch0_SpeelgoedOntdekt,
    Ch0_KruidnootschieterGevonden,
    Ch0_SleutelGevonden,
    Ch0_SpeelgoedOntdekt2,
    Ch0_BossIntro,
    Ch0_LangVerhaal
}

export const enum CombatType {
    Encounter,
    Boss
}

export const enum MainWeaponType {
    None = 0,
    TriRoe
}

export const enum SecWeaponType {
    None = 0,
    Cross
}

export class Model extends BaseModel {
    public Checkpoint: Savegame;
    public SelectedChapterToPlay: Chapter;
    public static PROPERTY_KEEP_AT_ROOMSWITCH: string = "p_rs";
    public static PROPERTY_ACT_AS_WALL: string = "p_wall";

    private static _instance: Model;
    public static get _(): Model {
        return Model._instance;
    }

    public static set _(value: Model) {
        Model._instance = value;
    }

    public Foes: Foe[];
    public ItemsInInventory: BagItem[];
    public WeaponsInInventory: BagWeapon[];

    protected _hearts: number;
    public get Hearts(): number {
        return this._hearts;
    }
    public set Hearts(value: number) {
        if (value > CS.Belmont_MaxHearts)
            this._hearts = CS.Belmont_MaxHearts;
        else if (value < 0)
            this._hearts = 0;
        else this._hearts = value;
    }

    public Belmont: Belmont;
    public Boss: BossFoe;
    public currentRoom: Room;
    public GameMenu: GameMenu;
    public Switches: Map<Switch, boolean>;
    public EventTriggered: Map<number, boolean>;
    public EventFinished: Map<number, boolean>;
    public FoesDefeated: Map<string, boolean>;
    public ItemsPickedUp: Map<string, boolean>;
    public WeaponItemsPickedUp: Map<string, boolean>;
    public DoorsOpened: Map<string, boolean>;
    public BossBattle: boolean;
    public RoomExitsLocked: boolean;
    public MainWeaponCooldownTimer: BStopwatch;
    public SecWeaponCooldownTimer: BStopwatch;
    public Hud: HUD;
    public ItsCurtains: ItsCurtainsForYou;
    public GameOverScreen: GameOver;
    public MainMenu: MainMenu;
    public Title: Title;
    public EndDemo: EndDemo;
    public PauseObject: IGameObject;

    public get ShowFoeBar(): boolean {
        return Model._.BossBattle;
    }

    public get FoeHealthPercentage(): number {
        return Model._.Boss?.healthPercentage ?? 100;
        // let foe = Model._.LastFoeThatWasHit;
        // if (foe == null) {
        //     if (!Model._.BossBattle)
        //         return -1;
        //     else foe = Model._.Boss;
        // }
        // if (foe.disposeFlag)
        //     return 0;
        // return foe.healthPercentage;
    }

    public get FoeForWhichHealthPercentageIsGiven(): Foe {
        return Model._.LastFoeThatWasHit != null ? Model._.LastFoeThatWasHit : Model._.Boss;
    }

    private _selectedMainWeapon: MainWeaponType;
    public get SelectedMainWeapon(): MainWeaponType {
        return MainWeaponType.TriRoe;
    }

    private _selectedSecondaryWeapon: SecWeaponType;
    public get SelectedSecondaryWeapon(): SecWeaponType {
        return this._selectedSecondaryWeapon;
    }
    public set SelectedSecondaryWeapon(value: SecWeaponType) {
        this._selectedSecondaryWeapon = value;
    }

    public get SelectedSecBagWeapon(): BagWeapon {
        let weaponItemInBagType = WeaponItem.SecWeaponType2WeaponItemType(this.SelectedSecondaryWeapon);
        let index = this.WeaponsInInventory.findIndex(bw => bw.Type == weaponItemInBagType);
        if (index == -1)
            return null;
        return Model._.WeaponsInInventory[index];
    }

    private _lastFoeThatWasHit: Foe;
    public get LastFoeThatWasHit(): Foe {
        if (!this._lastFoeThatWasHit)
            return null;
        if (this._lastFoeThatWasHit.disposeFlag)
            return null;
        return this._lastFoeThatWasHit;
    }

    public set LastFoeThatWasHit(value: Foe) {
        this._lastFoeThatWasHit = value;
    }
    private _selectedItem: BagItem;

    public get SelectedItem(): BagItem {
        return this._selectedItem;
    }
    public set SelectedItem(value: BagItem) {
        this._selectedItem = value;
    }

    public constructor() {
        super();
        Model._instance = this;
        this.Initialize();
    }

    public Initialize(): void {
        this.objects = new Array<IGameObject>();
        this.Foes = new Array<Foe>();
        this.ItemsInInventory = new Array<BagItem>();
        this.WeaponsInInventory = new Array<BagWeapon>();
        this.Switches = new Map<Switch, boolean>();
        this.GameMenu = new GameMenu();
        this.id2object = new Map<string, IGameObject>();
        this.FoesDefeated = new Map<string, boolean>();
        this.ItemsPickedUp = new Map<string, boolean>();
        this.WeaponItemsPickedUp = new Map<string, boolean>();
        this.DoorsOpened = new Map<string, boolean>();
        this.MainWeaponCooldownTimer = BStopwatch.createWatch();
        this.SecWeaponCooldownTimer = BStopwatch.createWatch();
        this._hearts = GameConstants.Belmont_InitHearts;

        this.Hud = new HUD();
        this.ItsCurtains = new ItsCurtainsForYou();
        this.GameOverScreen = new GameOver();
        this.MainMenu = new MainMenu();
        this.Title = new Title();
        this.EndDemo = new EndDemo();

        RoomFactory.PrepareData();
    }

    public InitModelForGameStart(): void {
        Model._.BossBattle = false;
        Model._.RoomExitsLocked = false;
        Model._.Switches.clear();
        Object.keys(Switch).forEach(t => Model._.Switches.set(Switch[t], false));
        Model._.ItemsInInventory.length = 0;
        Model._.WeaponsInInventory.length = 0;
        Model._.FoesDefeated.clear();
        Model._.ItemsPickedUp.clear();
        Model._.WeaponItemsPickedUp.clear();
        if (!this.PauseObject)
            this.PauseObject = {
                priority: 5000,
                dispose() { },
                disposeFlag: false,
                id: 'pause',
                pos: { x: GameConstants.pausePosX, y: GameConstants.pausePosY },
                spawn() { },
                paint() {
                    view.fillRectangle(GameConstants.pausePosX, GameConstants.pausePosY, GameConstants.pauseEndX, GameConstants.pauseEndY, Msx1Colors[1]);
                    view.drawRectangle(GameConstants.pausePosX, GameConstants.pausePosY, GameConstants.pauseEndX, GameConstants.pauseEndY, Msx1Colors[15]);
                    TextWriter.drawText(GameConstants.pauseTextPosX, GameConstants.pauseTextPosY, GameConstants.pauseText);
                },
                takeTurn() { }
            };
        // this.spawn(this.PauseObject, null, true);

        this._hearts = GameConstants.Belmont_InitHearts;;
        Model._.spawn(new Belmont());
    }

    public InitAfterGameLoad(): void {
    }

    public spawn(o: IGameObject, spawnpos?: Point, ifnotexists: boolean = false): void {
        if (ifnotexists && this.id2object.has(o.id)) return; // Don't add objects that already exist

        if (o instanceof Belmont) {
            if (this.objects.findIndex(ob => ob instanceof Belmont) > -1)
                throw Error("There is already a Belmont in the game! \"There can be only one!\"");
            else Model._.Belmont = <Belmont>o;
        }

        if (o instanceof Foe) {
            let f: Foe = o as Foe;
            if (!f.respawnOnRoomEntry) {
                let wasDefeated: boolean;
                let exists: boolean = this.FoesDefeated.has(f.id) && this.FoesDefeated.get(f.id);
                if (!exists) {
                    this.FoesDefeated.set(f.id, false);
                    wasDefeated = false;
                }
                if (!wasDefeated)
                    this.Foes.push(f);
                else return;
            }
            else this.Foes.push(f);
        }

        super.spawn(o, spawnpos, ifnotexists);
    }

    public remove(o: IGameObject): void {
        if (o instanceof Belmont) {
            Model._.Belmont = null;
        }

        if (o instanceof Foe) {
            let index = this.Foes.indexOf(o);
            if (index > -1) {
                delete this.Foes[index];
                this.Foes.splice(index, 1);
            }
        }

        super.remove(o);
    }

    public FoeDefeated(f: Foe): void {
        if (f.respawnOnRoomEntry) return;
        if (this.FoesDefeated.has(f.id) && this.FoesDefeated.get(f.id) === true)
            this.FoesDefeated.set(f.id, true);
        else this.FoesDefeated.set(f.id, true);
    }

    public GetFoeDefeated(id: string): boolean {
        return this.FoesDefeated.has(id) ? this.FoesDefeated[id] : false;
    }

    public get FoesPresentInCurrentRoom(): boolean {
        return this.Foes.length > 0;
    }

    public GetSwitchState(s: Switch): boolean {
        return this.Switches.has(s) ? this.Switches.get(s) : false;
    }

    public GetItemPickedUp(id: string): boolean {
        return this.ItemsPickedUp.has(id);
    }

    public DoorOpened(id: string): boolean {
        return this.DoorsOpened.has(id) ? true : false;
    }

    public AddItemToInventory(itemType: ItemType): void {
        let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory) {
            let newBagItem = new BagItem();
            newBagItem.Amount = 1;
            newBagItem.Type = itemType;
            this.ItemsInInventory.push(newBagItem);
        }
    }

    public AddWeaponToInventory(itemType: WeaponType): void {
        let itemInInventory = this.WeaponsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory == null) {
            let newWeapon = new BagWeapon();
            newWeapon.Type = itemType;
            this.WeaponsInInventory.push(newWeapon);
        }
    }

    public RemoveItemFromInventory(itemType: ItemType, removeAll: boolean = false): void {
        let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
        if (!itemInInventory) throw `Item is not in inventory while trying to remove an item: ${itemType}`;
        if (itemInInventory.Amount > 1 && !removeAll)
            itemInInventory.Amount--;
        else {
            if (this.SelectedItem.Type == itemType)
                this.SelectedItem = null;

            let index = this.ItemsInInventory.indexOf(itemInInventory);
            if (index > -1) {
                delete this.ItemsInInventory[index];
                this.ItemsInInventory.splice(index, 1);
            }
        }
    }

    public LoadRoom(id: number): void {
        let objectsToRemove = this.objects.filter(o => o.disposeOnSwitchRoom);
        objectsToRemove.forEach(o => this.remove(o));
        this.currentRoom = RoomFactory.load(id);
        this.currentRoom.init();
    }
}
