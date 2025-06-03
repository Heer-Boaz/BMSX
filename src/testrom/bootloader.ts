import { BaseModel, BehaviorTreeDefinition, BinaryCompressor, Component, Direction, GLView, Game, GameObject, GamepadButton, GamepadInputMapping, InputMap, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, PSG, ProhibitLeavingScreenComponent, RomPack, SpriteObject, StateMachineBlueprint, WaitForActionCompletionDecorator, assign_bt, assign_fsm, attach_components, build_bt, build_fsm, componenttags_preprocessing, debugPrintBinarySnapshot, insavegame, new_area, new_vec2, snareInstrument, subscribesToParentScopedEvent, subscribesToSelfScopedEvent, update_tagged_components, type State } from '../bmsx/bmsx';
import { BitmapId } from './resourceids';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || global;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode, debug);
    _game.start();
};

const actions = ['up', 'right', 'down', 'left', 'load', 'save', 'bla', 'blap'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton[];
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': ['ArrowUp'],
    'right': ['ArrowRight'],
    'down': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'load': ['ShiftLeft'],
    'save': ['KeyZ'],
    'bla': ['KeyA'],
    'blap': ['KeyS'],
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'up': ['up'],
    'right': ['right'],
    'down': ['down'],
    'left': ['left'],
    'load': ['a'],
    'save': ['b'],
    'bla': ['x'],
    'blap': ['y'],
};

@insavegame
@componenttags_preprocessing('test')
class TestComponent extends Component {
    // Implement virtual methods
    override postprocessingUpdate() {
        console.log('TestComponent update');
    }

    // Implement event handlers
    @subscribesToParentScopedEvent('testEvent')
    onTestEvent() {
        console.log('TestComponent onTestEvent');
    }

    @subscribesToSelfScopedEvent('testEvent2')
    onTestEvent2() {
        console.log('TestComponent onTestEvent2');
    }

    onTestEvent3() {
        console.log('TestComponent onTestEvent3');
    }
}

@insavegame
class DerivedTestComponent extends TestComponent {
    override postprocessingUpdate() {
        super.postprocessingUpdate();
        console.log('DerivedTestComponent update');
    }
}

@insavegame
@assign_fsm('bclass_animation', 'bclass_meuk')
@assign_bt('bclass_tree')
@attach_components(TestComponent, DerivedTestComponent, ProhibitLeavingScreenComponent)
class bclass extends SpriteObject {
    @build_bt('bclass_tree')
    public static buildMyTree(): BehaviorTreeDefinition {
        return {
            type: 'Selector',
            children: [
                {
                    type: 'Sequence',
                    children: [
                        { type: 'Condition', condition: () => Math.random() > .9 },
                        {
                            type: 'Action', action: function (this: bclass, _blackboard) {
                                console.log(`Action 1 executed for ${this.id}`)
                                return 'SUCCESS';
                            }
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        { type: 'Wait', wait_time: 50, wait_propname: 'waiting' },
                        {
                            type: 'Decorator', decorator: WaitForActionCompletionDecorator,
                            child: {
                                type: 'Action', action: function (this: bclass, blackboard) {
                                    console.log(`Sequence action after waiting for ${this.id}`);
                                    let testieblap = blackboard.get<number>('testdieblap') ?? 0;
                                    let success = false;
                                    if (++testieblap > 3) {
                                        testieblap = 0;
                                        success = true;
                                    }
                                    blackboard.set<number>('testdieblap', testieblap);
                                    return success ? 'SUCCESS' : 'RUNNING';
                                }
                            }
                        },
                        {
                            type: 'Action',
                            action: function (this: bclass, _blackboard) {
                                console.log(`Sequence action after decorated action for ${this.id}`);
                                return 'SUCCESS';
                            }
                        },
                    ]
                },
                {
                    type: 'Limit',
                    limit: 3,
                    count_propname: 'counting',
                    child: {
                        type: 'Action',
                        action: function (this: bclass, _blackboard) {
                            console.log(`Limited action for ${this.id}`);
                            return 'SUCCESS';
                        }
                    }
                },
                {
                    type: 'RandomSelector',
                    children: [
                        {
                            type: 'Action', action: function (this: bclass, _blackboard) {
                                console.log(`Random action A for ${this.id}`)
                                return 'SUCCESS';
                            }
                        },
                        {
                            type: 'Action', action: function (this: bclass, _blackboard) {
                                console.log(`Random action B for ${this.id}`)
                                return 'SUCCESS';
                            }
                        }
                    ],
                    currentchild_propname: 'randomchild'
                },
                {
                    type: 'Action',
                    action: function (this: bclass, _blackboard) {
                        console.log(`Fallback action executed for ${this.id}`)
                        return 'SUCCESS';
                    }
                }
            ]
        };
    }

    @build_fsm('bclass_animation')
    public static bouw_testfsm(): StateMachineBlueprint {
        return {
            states: {
                ani1: {
                    run: () => { },
                    enter(this: bclass) { this.imgid = BitmapId.b; },
                },
                '#ani2': {
                    run: () => { },
                    enter(this: bclass) { this.imgid = BitmapId.b2; },
                },
            }
        };
    }

    @build_fsm('bclass_meuk')
    public static bouw_meukfsm(): StateMachineBlueprint {
        return {
            parallel: true,
            states: {
                '#meuk1': {
                    run: () => { },
                    enter(this: bclass) { this.pos.x += 10; },
                    // submachine_id: 'bclass_meuk_submachine',
                    states: {
                        '#blupperblop1': {
                            run(this: bclass) { },
                            enter(this: bclass) { console.log('enter blupperblop1'); },
                        },
                        blupperblop2: {
                            run(this: bclass) { },
                            enter(this: bclass) { console.log('enter blupperblop2'); },
                        },
                    },
                },
                meuk2: {
                    run: () => { },
                    enter(this: bclass) { this.pos.y += 10; },
                },
            }
        };
    }

    // @build_fsm('bclass_meuk_submachine')
    // public static bouw_meuksubfsm(): machine_states {
    //     return {
    //         states: {
    //         }
    //     }
    // }

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        $.input.getPlayerInput(1).setInputMap({
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        function blarun(this: bclass) {
            const speed = 2;
            if (this.sc.current_state.def_id === 'blap') {
                this.tickTree('bclass_tree');
            }

            // To check if an action is pressed for player 0
            const pressedActions = $.input.getPlayerInput(1).getPressedActions();

            for (const { action, consumed } of pressedActions) {
                switch (action as Action) {
                    case 'up':
                        this.y -= speed;
                        break;
                    case 'right':
                        this.x += speed;
                        break;
                    case 'down':
                        this.y += speed;
                        break;
                    case 'left':
                        this.x -= speed;
                        break;
                    case 'load':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);

                        if (_model[savestring]) {
                            // If the save data is a string, convert it to Uint8Array before loading
                            const saveData = _model[savestring];
                            let saveDataUint8: Uint8Array;
                            if (typeof saveData === 'string') {
                                // Convert base64 string to Uint8Array
                                const binaryString = atob(saveData);
                                const len = binaryString.length;
                                const bytes = new Uint8Array(len);
                                for (let i = 0; i < len; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                saveDataUint8 = bytes;
                            } else {
                                saveDataUint8 = saveData;
                            }
                            _model.load(saveDataUint8);
                            _model[savestring] = undefined;
                            delete _model[savestring];
                            console.info(`${new Date().toTimeString()} Game loaded!`);
                            console.info(`${debugPrintBinarySnapshot(BinaryCompressor.decompressBinary(saveDataUint8))}`);
                        }
                        // show_load_savestate_dialog();
                        break;
                    case 'save':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);

                        const savestuff = $.model.save();
                        $.model[savestring] = savestuff;
                        console.info(`${new Date().toTimeString()} Game saved!`);
                        // Convert the Uint8Array to a hexadecimal string and log it
                        if ($.model[savestring] instanceof Uint8Array) {
                            const hexString = Array.from($.model[savestring] as Uint8Array)
                                .map(b => b.toString(16).padStart(2, '0'))
                                .join('');
                            console.info(`Hexadecimal save: ${hexString}`);
                            // Or, to log as base64:
                            const base64String = btoa(String.fromCharCode(...($.model[savestring] as Uint8Array)));
                            console.info(`Base64 save: ${base64String}`);
                        } else {
                            console.info(`${$.model[savestring]}`);
                        }
                        // show_download_savestate_dialog();
                        break;
                    case 'bla':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);
                        this.testmeuk();
                        $.event_emitter.emit('testEvent', this);

                        this.sc.to('bclass.bla');
                        this.sc.machines.bclass_animation.to('ani2');
                        break;
                    case 'blap':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);
                        $.event_emitter.emit('testEventOnce', this);

                        this.sc.machines.bclass_animation.to('ani1');
                        if (this.sc.is('bclass_meuk.meuk1.blupperblop1')) {
                            this.sc.to('bclass_meuk.meuk1.blupperblop2');
                        }
                        else {
                            this.sc.to('bclass_meuk.meuk1.blupperblop1');
                        }
                        this.sc.to('bclass.blap');

                        break;
                }
            }
        }

        return {
            parallel: true,
            states: {
                bla: {
                    on_input: {
                        'bla[j]': {
                            do(this: bclass) {
                                PSG.playCustomInstrument(snareInstrument, 10000);
                            }
                        },
                    },
                    run: blarun,
                },
                '#blap': {
                    run: blarun,
                },
            }
        };
    }

    @update_tagged_components('test')
    testmeuk() {
        console.log('testmeuk');
    }

    // @subscribesToSelfScopedEvent('leavingScreen')
    // testmeuk2(d: Direction, old_x_or_y: number) {
    //     leavingScreenHandler_prohibit(this, d, old_x_or_y);
    // }

    constructor() {
        super('The B');
        this.imgid = BitmapId.b2;
        this.hitarea = new_area(0, 0, 14, 18);
    }
};

const savestring = Symbol('savestring');
@insavegame
class gamemodel extends BaseModel {
    public [savestring]: string;

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        return {
            states: {
                '#game_start': {
                    enter(this: gamemodel) {
                        // Define a simple song as an array of note events.
                        // const simpleSong = [
                        //     { note: "C4", duration: 0.5 },
                        //     { note: "E4", duration: 0.5 },
                        //     { note: "G4", duration: 0.5 },
                        //     { note: "C5", duration: 1.0 }
                        // ];

                        // Play the song using the piano instrument.
                        // PSG.playSong(simpleSong, pianoInstrument);
                    },
                    run(this: gamemodel, s: State) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        s.to('default');
                    }
                },
                default: {
                    run: BaseModel.defaultrun,
                },
            }
        };
    }

    // DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
    // Trying to add logic here will most often result in runtime errors.
    // These runtime errors usually occur because the model was not created and initialized (with states),
    // while creating new game objects that reference the model or the model states
    constructor() {
        super();
    }

    public get constructor_name(): string {
        return this.constructor.name;
    }

    public override do_one_time_game_init(): this {
        _model.spawn(new bclass(), new_vec2(100, 100));
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

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
    }
}
