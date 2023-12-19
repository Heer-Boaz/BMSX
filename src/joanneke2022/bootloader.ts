import { BFont, new_vec3, trunc_vec3 } from './../bmsx/bmsx';
import { MSX2ScreenHeight, MSX2ScreenWidth } from './../bmsx/msx';
import type { RomPack, vec2 } from '../bmsx/rompack';
import type { Direction } from "../bmsx/bmsx";
import { Game, new_vec2, new_area, randomInt, copy_vec2 } from '../bmsx/bmsx';
import { sdef, sstate, Bla, statedef_builder, build_fsm, statecontext, machine_states } from '../bmsx/bfsm';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { GamepadInputMapping, Input, KeyboardButton, GamepadButton, KeyboardInputMapping, InputMap } from '../bmsx/input';
import { TextWriter } from '../bmsx/textwriter';
import { GameMenu } from './gamemenu';
import { GameObject } from '../bmsx/gameobject';
import { base_model_spaces, BaseModel, spaceid_2_space } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';
import { leavingScreenHandler_prohibit } from '../bmsx/collisioncomponents';

const TIME_TO_SHINE = 90;

type model_spaces = base_model_spaces | 'uitleg' | 'evaluatie' | 'hoera!';
type model_states = Bla<typeof gamemodel.states.states>;

class gamemodel extends BaseModel {
    public time_to_shine!: number;
    public uitleg_tekst_dinges!: number;
    public score: number = 0;

    public get diamant(): diamant {
        return this.get('diamant');
    }
    public get draaischijf(): draaischijf {
        return this.get('draaischijf');
    }

    public get_onvolmaaktheden(): onvolmaaktheid[] {
        return this.filter(o => (o as any).is_onvolmaaktheid) as onvolmaaktheid[];
    }

    public tel_onvolmaaktheden(): number {
        let total = 0;
        this.filter_and_foreach(
            o => (o as any).is_onvolmaaktheid,
            o => {
                let onvolmaaktje = o as onvolmaaktheid;
                if (onvolmaaktje.ben_ik_nog_onvolmaakt === true)
                    ++total;
            }
        );

        return total;
    }

    public static get states(): machine_states {
        return {
            states: {
                game_start: {
                    run(this: gamemodel) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.sc.to('uitleg' satisfies model_states);
                    }
                },
                default: {
                    ticks2move: 50,
                    enter(this: gamemodel) {
                        this.setSpace('default');
                        this.time_to_shine = TIME_TO_SHINE;
                        // this.state.to('evaluatie' satisfies model_states);
                    },
                    next(this: gamemodel) {
                        --this.time_to_shine;
                        if (this.time_to_shine < 0) {
                            this.time_to_shine = 0;
                            this.score = this.tel_onvolmaaktheden();
                            this.sc.to('evaluatie' satisfies model_states);
                        }
                    },
                    run(this: gamemodel, s: sstate<gamemodel>) {
                        BaseModel.defaultrun();
                        this.sc.machines.gamemenu.run();
                        if (!this.paused) ++s.ticks; // Laat timer lopen
                    },
                    process_input: BaseModel.default_input_handler,
                },
                evaluatie: {
                    ticks2move: 50,
                    enter(this: gamemodel) {
                        this.setSpace('evaluatie' satisfies model_spaces);
                        this.time_to_shine = 5;
                    },
                    next(this: gamemodel) {
                        --this.time_to_shine;
                        if (this.time_to_shine < 0) {
                            this.time_to_shine = 0;
                            this.sc.to('hoera' satisfies model_states);
                        }
                    },
                    run(s: sstate) {
                        ++s.ticks;
                    },
                    process_input: BaseModel.default_input_handler,
                },
                hoera: {
                    enter(this: gamemodel) {
                        this.setSpace('hoera!' satisfies model_spaces);
                    },
                },
                uitleg: {
                    enter(this: gamemodel) {
                        this.uitleg_tekst_dinges = 0;
                        this.setSpace('uitleg');
                    },
                    run(this: gamemodel) {
                        BaseModel.defaultrun();
                    },
                    process_input: BaseModel.default_input_handler,
                },
            }
        };
    }

    @build_fsm('model_substate')
    public static substates(): machine_states {
        return {
            parallel: true,
            states: {
                closed: {
                    process_input: BaseModel.default_input_handler_for_allow_open_gamemenu,
                },
                open: {
                    process_input: BaseModel.default_input_handler_for_allow_close_gamemenu,
                    enter(this: gamemodel) {
                        let menu = new GameMenu();
                        this.spawn(menu);
                        menu.Open();

                        this.paused = true;
                    },
                    run(this: gamemodel) {
                        this.get<GameMenu>('gamemenu')?.run();
                    },
                    exit(this: gamemodel) {
                        let menu = this.get<GameMenu>('gamemenu');
                        menu.Close();
                        this.exile(menu);

                        this.paused = false;
                    },
                },
            }
        };
    }

    @statedef_builder
    public static bouw(): machine_states {
        return gamemodel.states;
    }

    constructor() {
        super();
    }

    public override init_model_state_machines(derived_modelclass_constructor_name: string): this {
        super.init_model_state_machines(derived_modelclass_constructor_name);
        this.sc.machines.gamemenu = statecontext.create('model_substate', 'model');
        this.sc.machines.gamemenu.to('closed');
        return this;
    }

    public get constructor_name(): string {
        return this.constructor.name;
    }

    /**
     * Initializes the game state and spawns necessary game objects.
     * This method should only be called once at the beginning of the game.
     * @returns This instance of the game model.
     */
    public do_one_time_game_init(): this {
        // this.state.machines['gamemenu' satisfies model_machines].to('closed' satisfies model_states);
        Input.getPlayerInput(1).setInputMap({
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        this.addSpace('hoera!' satisfies model_spaces);
        this[spaceid_2_space]['hoera!'].spawn(new hoeraStuff());

        this.addSpace('evaluatie' satisfies model_spaces);
        this[spaceid_2_space]['evaluatie'].spawn(new evaluatieStuff());

        this.addSpace('uitleg' satisfies model_spaces);
        this[spaceid_2_space]['uitleg'].spawn(new uitlegStuff());

        let _diamant = new diamant();
        let _draaischijf = new draaischijf();

        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new hud());
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(_diamant);
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(_draaischijf, new_vec2(96, 120));
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new barst(zijde.Voor, new_vec2(_diamant.pos.x + 30, _diamant.pos.y + 10)));
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new barst(zijde.Voor, new_vec2(_diamant.pos.x + 60, _diamant.pos.y + 40)));
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new barst(zijde.Voor, new_vec2(_diamant.pos.x + 110, _diamant.pos.y + 20)));
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new barst(zijde.Voor, new_vec2(_diamant.pos.x + 80, _diamant.pos.y + 60)));
        this[spaceid_2_space]['default' satisfies model_spaces].spawn(new barst(zijde.Boven, new_vec2(_diamant.pos.x + 90, _diamant.pos.y + 100)));

        return this;
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(_o: GameObject, _dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(_x: number, _y: number): boolean {
        return false;
    }
};

class hoeraStuff extends SpriteObject {
    constructor() {
        super();
        this.z = 0;
        this.imgid = BitmapId.sint;
    }

    override paint() {
        let line1: string;
        let line2: string;
        let line3: string;

        let score = _model.score;
        switch (true) {
            case (score == 0):
                line1 = `De diamant is perfect!`;
                line2 = `Redelijk gedaan Joanneke!`;
                line3 = ``;
                break;
            case (score > 0 && score <= 2):
                line1 = `De diamant is imperfect`;
                line2 = `doch erg mooi!`;
                line3 = `Acceptabel gedaan Joanneke!`;
                break;
            case (score > 2):
                line1 = `De diamant is nu`;
                line2 = `een baksteen geworden.`;
                line3 = `Maar toch ok gedaan Joanneke!`;
                break;
            default:
                line1 = line2 = line3 = 'Geen tekst voor de Sint :-(';
                break;
        }

        TextWriter.drawText(16, 160, `${line1}`);
        TextWriter.drawText(16, 168, `${line2}`);
        TextWriter.drawText(16, 176, `${line3}`);

        super.paint.call(this); // .call() nodig, anders "this" undefined
    };
};

class uitlegStuff extends SpriteObject {
    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                uitleg: {
                    ticks2move: 300,
                    tape: <Array<number>>[
                        0,
                        1,
                        2,
                        3,
                        4,
                        5,
                        6,
                    ],
                    enter(this: uitlegStuff, s: sstate<uitlegStuff>) {
                        s.reset();
                        if (_model)
                            _model.uitleg_tekst_dinges = s.current_tape_value;
                    },
                    run(this: uitlegStuff, s: sstate<uitlegStuff>) {
                        if (Input.KC_BTN1) {
                            ++s.head; // Skip to next tape entry. Note that this will reset nudges and stuff
                        }
                    },
                    next(this: uitlegStuff, s: sstate<uitlegStuff>) {
                        if (_model)
                            _model.uitleg_tekst_dinges = s.current_tape_value;
                    },
                    end(this: uitlegStuff) {
                        if (_model)
                            _model.sc.to('default');
                    },
                },
            }
        };
    }

    constructor() {
        super();
        this.imgid = BitmapId.diamond_front;
        this.hitarea = new_area(0, 0, this.sx, this.sy);
        this.pos = trunc_vec3(new_vec3((MSX2ScreenWidth - this.sx) / 2, (MSX2ScreenHeight - this.sy) / 2, 0));
    }

    override paint() {
        let lines: string[];

        if (!_model) return;
        let bla = _model.uitleg_tekst_dinges;
        switch (bla) {
            case 0:
                lines = [`Deze diamant heeft blemishes!`, `Jij moet dit nu fixen!`, ``];
                break;
            case 1:
                lines = [`Gebruik de slijpsteen om`, `de diamant te herstellen!`, ``];
                break;
            case 2:
                lines = [`Bestuur de slijpsteen met`, `de cursortoetsen en zet deze`, `boven de kapotte delen.`];
                break;
            case 3:
                lines = [`Druk op lshift`, `Om de slijpsteen aan te zetten.`, ``];
                break;
            case 4:
                lines = [`Maar pas op!`, `Te lang slijpen maakt`, `nieuwe problemen en`];
                break;
            case 5:
                lines = [`Die moet je dan weer`, `repareren met de slijpsteen`, `Oh en je hebt 1 minuut!`];
                break;
            case 6:
                lines = [`De Sint gaat je beoordelen!`, `Goed geluk!`, ``];
                break;
            default:
                lines = ['Urghh!!'];
                break;
        }

        TextWriter.drawText(16, 160, lines);

        super.paint.call(this); // .call() nodig, anders "this" undefined
    };

    override onspawn(): void {
        this.sc.to('uitleg');
    }
};

class evaluatieStuff extends SpriteObject {
    constructor() {
        super();
        this.z = 0;
        this.imgid = BitmapId.sint_evalueert;
    }

    override paint() {
        TextWriter.drawText(4, 8, `Sinterklaas kijkt nu hoe goed`);
        TextWriter.drawText(4, 16, `je het hebt gedaan Joanneke...`);

        super.paint.call(this); // .call() nodig, anders "this" undefined
    };
};

class hud extends GameObject {
    @build_fsm('test')
    public static bouw() {
        return {
            states: {
                default: new sdef('default', {
                    // ticks2move: 50,
                    enter(this: hud, s: sstate<hud>) {
                        s.reset();
                        this.visible = true;
                    },
                    run(this: hud) {
                        // ++s.nudges;
                    },
                    next(this: hud) {
                    },
                }),
            }
        };
    }

    constructor() {
        super(undefined, 'test');
    }

    override onspawn(): void {
        this.sc.to('default');
    }

    override paint() {
        TextWriter.drawText(0, 0, `Time to shine: ${_model.time_to_shine}`);
    };
}

class stoom extends SpriteObject {
    @statedef_builder
    public static bouw() {
        return {
            states: {
                doepluim: new sdef('doepluim', {
                    tape: [
                        BitmapId.pluim1,
                        BitmapId.pluim2,
                        BitmapId.pluim3,
                        BitmapId.pluim4,
                        BitmapId.pluim5,
                        BitmapId.pluim6,
                        BitmapId.pluim7,
                        BitmapId.pluim8,
                        BitmapId.pluim9,
                        BitmapId.pluimx,
                        BitmapId.pluimx,
                    ],
                    ticks2move: 2,
                    enter(this: stoom, s: sstate<stoom>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                    },
                    run(this: stoom, s: sstate<stoom>) {
                        ++s.ticks;
                    },
                    next(this: stoom, s: sstate<stoom>) {
                        this.imgid = s.current_tape_value;
                    },
                    end(this: stoom) {
                        this.markForDisposal();
                    }
                }),
            }
        };
    }

    constructor() {
        super();
        this.z = 1010;
        this.imgid = BitmapId.None;
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.sc.to('doepluim');
    }
}

class diamant extends SpriteObject {
    public _getoonde_zijde!: zijde;

    public get getoonde_zijde() {
        return this._getoonde_zijde;
    }

    public set getoonde_zijde(_zijde: zijde) {
        this._getoonde_zijde = _zijde;

        switch (this._getoonde_zijde) {
            case zijde.Voor:
                this.imgid = BitmapId.diamond_front;
                this.hitarea = new_area(0, 0, this.sx, this.sy); // ? TODO: Dit nog nodig?
                break;
            case zijde.Zij:
                this.imgid = BitmapId.diamond_front;
                this.hitarea = new_area(0, 0, this.sx, this.sy);
                break;
            case zijde.Boven:
                this.imgid = BitmapId.diamond_top;
                this.hitarea = new_area(0, 0, this.sx, this.sy);
                break;
        }

        this.x = ~~((MSX2ScreenWidth - this.sx) / 2), this.y = ~~((MSX2ScreenHeight - this.sy) / 2);
    }

    constructor() {
        super('diamant');
        this.z = 0;
        this.getoonde_zijde = zijde.Voor;
    }
}

const actions = ['up', 'right', 'down', 'left', 'btn1', 'btn2'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton;
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton;
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': 'ArrowUp',
    'right': 'ArrowRight',
    'down': 'ArrowDown',
    'left': 'ArrowLeft',
    'btn1': 'ShiftLeft',
    'btn2': 'KeyZ',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'up': 'up',
    'right': 'right',
    'down': 'down',
    'left': 'left',
    'btn1': 'a',
    'btn2': 'b',
};

class draaischijf extends SpriteObject {
    @statedef_builder
    public static bouw() {
        return {
            states: {
                idle: new sdef('idle', {
                    enter(this: draaischijf, s: sstate<draaischijf>) {
                        s.reset();
                        this.imgid = BitmapId.slijpschijf1;
                    },
                    run(this: draaischijf) {
                        // this.handle_input_idle_state();
                    },
                    process_input: draaischijf.handle_input_idle_state,
                }),
                slijpen_opstart: new sdef('slijpen_opstart', {
                    ticks2move: 5,
                    auto_rewind_tape_after_end: false,
                    tape: [
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                    ],
                    enter(this: draaischijf, s: sstate<draaischijf>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                    },
                    process_input: draaischijf.handle_input_slijp_opstart_state,
                    run(this: draaischijf, s: sstate<draaischijf>) {
                        ++s.ticks;
                    },
                    end(this: draaischijf) {
                        this.sc.to('slijpen');
                    },
                    next(this: draaischijf, s: sstate<draaischijf>) {
                        this.imgid = s.current_tape_value;
                    },
                }),
                slijpen: new sdef('slijpen', {
                    ticks2move: 10,
                    tape: [
                        BitmapId.slijpschijf3,
                        BitmapId.slijpschijf4,
                    ],
                    enter(this: draaischijf, s: sstate<draaischijf>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                    },
                    process_input: draaischijf.handle_input_slijp_state,
                    run(this: draaischijf, s: sstate<draaischijf>) {
                        ++s.ticks;
                    },
                    next(this: draaischijf, s: sstate<draaischijf>) {
                        this.imgid = s.current_tape_value;
                        if (s.head === 0) ++this.pos.y;
                        else --this.pos.y;
                        _model.spawn(new stoom(), new_vec2(randomInt(this.pos.x, this.pos.x + this.size.x), randomInt(this.pos.y, this.pos.y + this.size.y)));
                    },
                }),
                slijpen_afkoel: new sdef('slijpen_afkoel', {
                    ticks2move: 5,
                    auto_rewind_tape_after_end: false,
                    tape: [
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                        BitmapId.slijpschijf1,
                        BitmapId.slijpschijf2,
                    ],
                    enter(this: draaischijf, s: sstate<draaischijf>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                    },
                    process_input: draaischijf.handle_input_slijp_afkoel_state,
                    run(this: draaischijf, s: sstate<draaischijf>) {
                        ++s.ticks;
                    },
                    end(this: draaischijf) {
                        this.sc.to('idle');
                    },
                    next(this: draaischijf, s: sstate<draaischijf>) {
                        this.imgid = s.current_tape_value;
                    },
                }),
            }
        };
    }

    constructor() {
        super('draaischijf');
        this.imgid = BitmapId.None; // Wordt goed gezet bij ingang start state
        this.onLeavingScreen = (ik, d, old_x_or_y) => leavingScreenHandler_prohibit(ik, d, old_x_or_y);
        this.size = { x: 64, y: 64, z: undefined };
        this.hitarea = new_area(24, 24, 64 - 24, 64 - 24);
        this.z = 20;
    }

    public static handle_input_idle_state(this: draaischijf): void {
        const speed = 1;
        if (Input.KD_LEFT) {
            this.x -= speed;
        }
        if (Input.KD_RIGHT) {
            this.x += speed;
        }
        if (Input.KD_UP) {
            this.y -= speed;
        }
        if (Input.KD_DOWN) {
            this.y += speed;
        }
        if (Input.KD_BTN1) {
            this.sc.to('slijpen_opstart');
        }
        if (Input.KC_BTN2) {
            let getoonde_zijde = _model.diamant.getoonde_zijde;
            switch (getoonde_zijde) {
                case zijde.Voor:
                    _model.diamant.getoonde_zijde = zijde.Boven;
                    break;
                case zijde.Boven:
                    _model.diamant.getoonde_zijde = zijde.Voor;
                    break;
            }
        }
    }

    public static handle_input_slijp_opstart_state(this: draaischijf): void {
        if (!Input.KD_BTN1) {
            this.sc.to('slijpen_afkoel');
        }
    }

    public static handle_input_slijp_afkoel_state(this: draaischijf): void {
        if (Input.KD_BTN1) {
            this.sc.to('slijpen_opstart');
        }
    }

    public static handle_input_slijp_state(this: draaischijf): void {
        if (!Input.KD_BTN1) {
            this.sc.to('slijpen_afkoel');
        }
        else {
            // Slijpen!!
            _model.filter_and_foreach(
                o => (o as any).is_onvolmaaktheid,
                o => {
                    let onvolmaaktje = o as onvolmaaktheid;
                    if (onvolmaaktje.collides(this)) {
                        onvolmaaktje.polijst_nudge();
                    }
                }
            );
        }
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.sc.to('idle');
    }
}

export enum onvolmaaktheid_soort {
    Geen = 0,
    Barst = 1,
    Kras = 2,
    Dof = 3,
    Burn = 4,
}

export enum zijde {
    Voor = 0,
    Zij = 1,
    Boven = 2
}

abstract class onvolmaaktheid extends SpriteObject {
    public is_onvolmaaktheid = true; // Om objecten te filteren
    public ben_ik_nog_onvolmaakt = true; // Overwinningspunten tellen
    public soort: onvolmaaktheid_soort;
    public zijde: zijde;
    public _ernst!: number;

    constructor(_soort: onvolmaaktheid_soort, _zijde: zijde, _plek: vec2, __ernst?: number) {
        super();
        this.soort = _soort;
        this.zijde = _zijde;
        this.x = _plek.x;
        this.y = _plek.y;
        this.z = 10;
        __ernst && (this._ernst = __ernst);
    }

    public polijst_nudge = (): void => {
        ++this.sc.current_state.ticks;
    };

    override paint() {
        // Toon alleen als diamant op zelfde locatie is als dat diamant is weergegeven
        if (_model.diamant.getoonde_zijde === this.zijde)
            super.paint.call(this); // .call() nodig, anders "this" undefined
    }
}

class burn extends onvolmaaktheid {
    @statedef_builder
    public static bouw() {
        return {
            states: {
                wees_een_burn: {
                    ticks2move: 20,
                    auto_rewind_tape_after_end: false,
                    tape: [
                        BitmapId.burn1,
                        BitmapId.burn2,
                        BitmapId.burn3,
                        BitmapId.burn4,
                        BitmapId.burn5,
                    ],
                    onenter(this: burn, s: sstate<burn>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                        this.ben_ik_nog_onvolmaakt = true;
                    },
                    onend(this: burn) {
                        this.sc.to('gepolijst');
                    },
                    onnext(this: burn, s: sstate<burn>) {
                        this.imgid = s.current_tape_value;
                    },
                },
                gepolijst: {
                    ticks2move: 20,
                    tape: [
                        BitmapId.None,
                        BitmapId.None,
                        BitmapId.None,
                    ],
                    auto_tick: false,
                    onenter(this: burn, s: sstate<burn>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                        this.ben_ik_nog_onvolmaakt = false;
                    },
                    onnext(this: burn) {
                        // BURN!!!!
                        this.sc.to('wees_een_burn');
                    }
                },
            }
        };
    }

    override onspawn = (spawningPos?: vec2): void => {
        super.onspawn?.(spawningPos);
        this.sc.to('wees_een_burn');
    };

    constructor(_zijde: zijde, _plek: vec2, __ernst?: number) {
        super(onvolmaaktheid_soort.Burn, _zijde, _plek, __ernst);
        this.imgid = BitmapId.None;
        this.hitarea = new_area(0, 0, this.sx, this.sy);
        // this.size = new_vec2(40, 31);
    }
}

class barst extends onvolmaaktheid {
    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                wees_een_barst: {
                    ticks2move: 20,
                    tape: [
                        BitmapId.break1,
                        BitmapId.break2,
                        BitmapId.break3,
                        BitmapId.break4,
                        BitmapId.break5,
                        BitmapId.break6,
                    ],
                    enter(this: barst, s: sstate<barst>) {
                        s.reset();
                        this.imgid = s.current_tape_value;
                        this.ben_ik_nog_onvolmaakt = true;
                    },
                    end(this: barst) {
                        this.sc.to('gepolijst');
                    },
                    next(this: barst, s: sstate<barst>) {
                        this.imgid = s.current_tape_value;
                    },
                },
                gepolijst: {
                    ticks2move: 40,
                    auto_tick: false,
                    enter(this: barst, s: sstate<barst>) {
                        s.reset();
                        this.imgid = BitmapId.None;
                        this.ben_ik_nog_onvolmaakt = false;
                    },
                    next(this: barst) {
                        // BURN!!!!
                        _model.spawn(new burn(this.zijde, copy_vec2(this.pos)));
                        this.disposeFlag = true; // Vervang met nieuwe soort onvolmaaktheid
                    }
                },
            }
        };
    }

    public get ernst() {
        return this._ernst;
    }

    public set ernst(x) {
        this._ernst = x;
        let s = this.sc.states['wees_een_barst'];
        s.reset();
        s.head = this.max_ernst() - this._ernst;
    }

    private max_ernst() {
        let s = this.sc.states['wees_een_barst'];
        return s.tape.length - 1;
    }

    override onspawn = (spawningPos?: vec2): void => {
        super.onspawn?.(spawningPos);
        this.sc.to('wees_een_barst');
    };

    constructor(_zijde: zijde, _plek: vec2, __ernst?: number) {
        super(onvolmaaktheid_soort.Barst, _zijde, _plek);
        let defaultErnst = this.max_ernst();
        __ernst && (this.ernst = defaultErnst);
        this.hitarea = new_area(0, 0, 40, 31);
        this.size = new_vec3(40, 31, null);
    }
}

class gameview extends GLView {
}

let _game: Game;
let _model: gamemodel;
let _view: gameview;

var _global = globalThis;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _view.default_font = new BFont(BitmapId);
    _game = new Game(rom, _model, _view, sndcontext, gainnode, debug);

    _game.start();
};

// https://www.25karats.com/education/diamonds/features
// Diamond Inclusions
// Inclusions are internal clarity characteristic of a diamond.

// crystal	Sometimes a diamond contains a mineral crystal that looks like a bubble or black spot and this feature is called crystal.
// needle	A long and thin crystal.
// pinpoint	A tiny crystal that appears like a dot.
// cloud	A grayish patch that consists of a group of pinpoints.
// twinning wisp	A ribbon like inclusion on the diamond’s growth plane.
// internal graining	Irregularities in crystal growth may cause some lines or textures that appear like haze on the diamond surface.
// grain center	Although not visible from every angle, grain center looks like a transparent tornado inside the diamond..
// feather	Any break in a diamond.There are two types: cleavage is a break that is in a cleavage plane, and fracture is one that is in any other direction.Feathers can get larger with a hard knock and thus considered more problematic than any other inclusion.
// bearded girdle	Fine feathers scattered around the diamond’s perimeter.If it’s heavy, it can go all the way around the stone.
// bruise	A small tree - root like feather caused by a hard blow.
// knot	A shallow opening on the surface caused by damage after cut and polish.
// chip	A ribbon like inclusion on the diamond’s growth plane.
// cavity	A deep opening with visible drag lines at side.
// indented natural	A part of the rough diamond surface that goes below the polished diamond surface and leaves triangle shaped or parallel grooves.
// laser drill - hole	A tiny tunnel shaped inclusion caused by laser beam process.;

// Diamond Blemishes
// Blemishes are external clarity characteristic of a diamond.

// abrasion	Small nicks on the facet caused by mishandling of the stones.It can happen when diamonds rub against one another.
// pit	A tiny cavity that looks like a white dot.
// nicks	Small surface chips caused by wear.
// lines	Visible lines at surface that run across facet junctions.
// naturals	A part of the rough crystal surface that was not polished on the polished stone.They are usually on or near the girdle.If the term “indented natural” is used, that means the natural extends onto the crown or pavilion.
// scratches and wheel marks	Scratches are caused by improper storage of the diamond in the diamond paper or contact with other diamonds.If diamond is polished without care, grooves called wheel marks can occur.
// extra facets	Facets placed on a diamond to polish out small blemishes like a natural or nick.They may be additional to any facet needed for a specific cut style.Extra facets don’t affect the clarity grade.
// rough girdle	A girdle surface that is irregular, pitted, and sometimes chipped.This can be a sign of weakness.
// burn marks	Marks caused by either too fast polishing or a real heat source.It can be polished out.;