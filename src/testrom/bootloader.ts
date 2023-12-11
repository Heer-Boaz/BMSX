import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { new_area, Direction, Game, new_vec2, get_gamemodel } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';
import { attach_components, Component, componenttags_preprocessing, update_tagged_components } from '../bmsx/component';
import { subscribesToParentScopedEvent, subscribesToSelfScopedEvent } from '../bmsx/eventemitter';
import { assign_bt, BehaviorTreeDefinition, build_bt, WaitForActionCompletionDecorator } from '../bmsx/behaviourtree';
import { ProhibitLeavingScreenComponent } from './../bmsx/collisioncomponents';

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

const get_model = get_gamemodel<gamemodel>;

const actions = ['up', 'right', 'down', 'left', 'load', 'save', 'bla', 'blap'] as const;
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
    'load': 'ShiftLeft',
    'save': 'KeyZ',
    'bla': 'KeyA',
    'blap': 'KeyS',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'up': 'up',
    'right': 'right',
    'down': 'down',
    'left': 'left',
    'load': 'a',
    'save': 'b',
    'bla': 'x',
    'blap': 'y',
};

@insavegame
@componenttags_preprocessing('test')
class TestComponent extends Component {
    // Implement virtual methods
    override update() {
        console.log('TestComponent update');
    }

    // Implement event handlers
    @subscribesToParentScopedEvent('testEvent')
    onTestEvent() {
        console.log('TestComponent onTestEvent');
    }

    // @oneTimeGlobalEventHandler('testEventOnce')
    onTestEvent2() {
        console.log('TestComponent onTestEvent2');
    }

    onTestEvent3() {
        console.log('TestComponent onTestEvent3');
    }
}

@insavegame
class DerivedTestComponent extends TestComponent {
    override update() {
        super.update();
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
                            type: 'Action', action: function (this: bclass, blackboard) {
                                console.log(`Action 1 executed for ${this.id}`)
                                return 'SUCCESS';
                            }
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        { type: 'Wait', waitTime: 50, wait_propname: 'waiting' },
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
                            action: function (this: bclass, blackboard) {
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
                        action: function (this: bclass, blackboard) {
                            console.log(`Limited action for ${this.id}`);
                            return 'SUCCESS';
                        }
                    }
                },
                {
                    type: 'RandomSelector',
                    children: [
                        {
                            type: 'Action', action: function (this: bclass, blackboard) {
                                console.log(`Random action A for ${this.id}`)
                                return 'SUCCESS';
                            }
                        },
                        {
                            type: 'Action', action: function (this: bclass, blackboard) {
                                console.log(`Random action B for ${this.id}`)
                                return 'SUCCESS';
                            }
                        }
                    ],
                    currentchild_propname: 'randomchild'
                },
                {
                    type: 'Action',
                    action: function (this: bclass, blackboard) {
                        console.log(`Fallback action executed for ${this.id}`)
                        return 'SUCCESS';
                    }
                }
            ]
        };
    }

    @build_fsm('bclass_animation')
    public static bouw_testfsm(): machine_states {
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
    public static bouw_meukfsm(): machine_states {
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

    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        function blarun(this: bclass, s: sstate) {
            const speed = 2;
            if (this.state.current_state.statedef_id === 'blap') {
                this.tickTree('bclass_tree');
            }

            // To check if an action is pressed for player 0
            const pressedActions = Input.getPressedActions(0);

            for (const { action, pressed, consumed } of pressedActions) {
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
                        Input.consumeAction(0, action);

                        if (_model[savestring]) {
                            _model.load(_model[savestring]);
                            _model[savestring] = undefined;
                            delete _model[savestring];
                            console.info(`${new Date().toTimeString()} Game loaded!`);
                        }
                        // show_load_savestate_dialog();
                        break;
                    case 'save':
                        if (consumed) break;
                        Input.consumeAction(0, action);

                        get_model()[savestring] = get_model().save();
                        console.info(`${new Date().toTimeString()} Game saved!`);
                        console.info(`${_model[savestring]}`);
                        // show_download_savestate_dialog();
                        break;
                    case 'bla':
                        if (consumed) break;
                        Input.consumeAction(0, action);
                        this.testmeuk();
                        global.eventEmitter.emit('testEvent', this);

                        this.state.to('bclass.bla');
                        this.state.machines.bclass_animation.to('ani2');
                        break;
                    case 'blap':
                        if (consumed) break;
                        Input.consumeAction(0, action);
                        global.eventEmitter.emit('testEventOnce', this);

                        this.state.machines.bclass_animation.to('ani1');
                        if (this.state.is('bclass_meuk.meuk1.blupperblop1')) {
                            this.state.to('bclass_meuk.meuk1.blupperblop2');
                        }
                        else {
                            this.state.to('bclass_meuk.meuk1.blupperblop1');
                        }
                        this.state.to('bclass.blap');

                        break;
                }
            }
        }

        return {
            parallel: true,
            states: {
                bla: {
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

    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                '#game_start': {
                    run(this: gamemodel, s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.state.to('default');
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

    public collidesWithTile(o: GameObject, dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(x: number, y: number): boolean {
        return false;
    }
};

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
        super.drawSprites();
    }
}
