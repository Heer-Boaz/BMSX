import { ItemType } from './item';
import { WeaponType, WeaponItem } from './weaponitem';
import { Point, Direction } from '../bmsx/common';
import { BStopwatch, WorldObject, view } from '../bmsx/bmsx';
import { BaseModelOld } from "../bmsx/basemodel_old";
import { Savegame } from '../bmsx/gamepersistor';
import { Foe } from './foe';
import { Belmont } from './belmont';
import { Room } from './room';
import { GameMenu } from './gamemenu';
import { HUD } from './hud';
import { ItsCurtainsForYou } from './itscurtainsforyou';
import { GameOver } from './gameover';
import { MainMenu } from './mainmenu';
import { Title } from './title';
import { EndDemo } from './enddemo';
import { GameConstants } from './gameconstants';
import { RoomFactory } from './RoomFactory';
import { TextWriter } from './textwriter';
import { DrawImgFlags } from '../bmsx/view';
import { BitmapId } from './resourceids';

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

export const enum Switch {
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

export var belmont: Belmont;

export class Model extends BaseModelOld {
    public Checkpoint: Savegame;
    public SelectedChapterToPlay: Chapter;
    public static PROPERTY_KEEP_AT_ROOMSWITCH: string = "p_rs";
    public static PROPERTY_ACT_AS_WALL: string = "p_wall";

    public foes: Foe[];
    public ItemsInInventory: BagItem[];
    public WeaponsInInventory: BagWeapon[];

    protected _hearts: number;
    public get hearts(): number {
        return this._hearts;
    }
    public set hearts(value: number) {
        if (value > GameConstants.Belmont_MaxHearts)
            this._hearts = GameConstants.Belmont_MaxHearts;
        else if (value < 0)
            this._hearts = 0;
        else this._hearts = value;
    }

    public Belmont: Belmont;
    public Boss: Foe;
    public currentRoom: Room;
    public GameMenu: GameMenu;
    public Switches: { [key: number]: boolean; };
    public EventTriggered: { [key: string]: boolean; };
    public EventFinished: { [key: string]: boolean; };
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
    public PauseObject: WorldObject;

    public get ShowFoeBar(): boolean {
        return this.BossBattle;
    }

    public get FoeHealthPercentage(): number {
        return this.Boss?.healthPercentage ?? 100;
        // let foe = this.LastFoeThatWasHit;
        // if (foe == null) {
        //     if (!this.BossBattle)
        //         return -1;
        //     else foe = this.Boss;
        // }
        // if (foe.disposeFlag)
        //     return 0;
        // return foe.healthPercentage;
    }

    public get FoeForWhichHealthPercentageIsGiven(): Foe {
        return this.LastFoeThatWasHit != null ? this.LastFoeThatWasHit : this.Boss;
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
        return this.WeaponsInInventory[index];
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
        this.Initialize();
    }

    public Initialize(): void {
        this.objects = new Array<WorldObject>();
        this.foes = new Array<Foe>();
        this.ItemsInInventory = new Array<BagItem>();
        this.WeaponsInInventory = new Array<BagWeapon>();
        this.Switches = {};
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
        this.GameMenu = new GameMenu();
        this.spawn(this.GameMenu);
        this.MainMenu = new MainMenu();
        this.Title = new Title();
        this.EndDemo = new EndDemo();

        RoomFactory.PrepareData();
    }

    public initModelForGameStart(): void {
        this.BossBattle = false;
        this.RoomExitsLocked = false;
        delete this.Switches;
        this.Switches = {};
        // this.Switches.clear();
        // Object.keys(Switch).forEach(t => this.Switches.set(Switch[t], false));
        this.ItemsInInventory.length = 0;
        this.WeaponsInInventory.length = 0;
        this.FoesDefeated.clear();
        this.ItemsPickedUp.clear();
        this.WeaponItemsPickedUp.clear();
        if (!this.PauseObject) {
            this.PauseObject = {
                z: 5000,
                disposeFlag: false,
                id: 'pause',
                pos: { x: GameConstants.pausePosX, y: GameConstants.pausePosY },
                visible: false,
                paint() {
                    // view.fillRectangle(GameConstants.pausePosX, GameConstants.pausePosY, GameConstants.pauseEndX, GameConstants.pauseEndY, Msx1Colors[1]);
                    // view.drawRectangle(GameConstants.pausePosX, GameConstants.pausePosY, GameConstants.pauseEndX, GameConstants.pauseEndY, Msx1Colors[15]);
                    TextWriter.drawText(GameConstants.pauseTextPosX, GameConstants.pauseTextPosY, GameConstants.pauseText);
                    let scalex = GameConstants.pauseEndX - GameConstants.pausePosX;
                    let scaley = GameConstants.pauseEndY - GameConstants.pausePosY;
                    view.drawImg(BitmapId.blackpixel, GameConstants.pausePosX + 1, GameConstants.pausePosY + 1, DrawImgFlags.None, scalex - 2, scaley - 2);
                    view.drawImg(BitmapId.whitepixel, GameConstants.pausePosX, GameConstants.pausePosY, DrawImgFlags.None, scalex, scaley);
                },
                run() { }
            };
            if (!this.exists(this.PauseObject.id)) { this.spawn(this.PauseObject, null); }
        }

        this._hearts = GameConstants.Belmont_InitHearts;
        this.spawn(new Belmont());
    }

    public InitAfterGameLoad(): void {
    }

    public spawn(o: WorldObject, spawnpos?: Point): void {
        if (o instanceof Belmont) {
            if (this.objects.findIndex(ob => ob instanceof Belmont) > -1)
                throw Error("There is already a Belmont in the game! \"There can be only one!\"");
            else {
                this.Belmont = <Belmont>o;
                belmont = this.Belmont;
            }
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
                    this.foes.push(f);
                else return;
            }
            else this.foes.push(f);
        }

        super.spawn(o, spawnpos);
    }

    public exile(o: WorldObject): void {
        if (o instanceof Belmont) {
            this.Belmont = null;
            belmont = null;
        }

        if (o instanceof Foe) {
            let index = this.foes.indexOf(o);
            if (index > -1) {
                delete this.foes[index];
                this.foes.splice(index, 1);
            }
        }

        super.exile(o);
    }

    public get gamewidth(): number {
        return GameConstants.GameScreenWidth;
    }
    public get gameheight(): number {
        return GameConstants.GameScreenHeight;
    }

    public collidesWithTile = (o: WorldObject, dir: Direction): boolean => this.currentRoom.collidesWithTile(o, dir);

    public isCollisionTile = (x: number, y: number): boolean => this.currentRoom.isCollisionTile(x, y);

    public foeDefeated(f: Foe): void {
        if (f.respawnOnRoomEntry) return;
        if (this.FoesDefeated.has(f.id) && this.FoesDefeated.get(f.id) === true)
            this.FoesDefeated.set(f.id, true);
        else this.FoesDefeated.set(f.id, true);
    }

    public GetFoeDefeated(id: string): boolean {
        return this.FoesDefeated.has(id) ? this.FoesDefeated[id] : false;
    }

    public get FoesPresentInCurrentRoom(): boolean {
        return this.foes.length > 0;
    }

    public GetSwitchState(s: Switch): boolean {
        return this.Switches[s] === true;
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
        if (!itemInInventory) throw Error (`Item is not in inventory while trying to remove an item: ${itemType}`;
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
        objectsToRemove.forEach(o => this.exile(o));
        this.currentRoom = RoomFactory.load(id);
        this.spawn(this.currentRoom);
    }
}
