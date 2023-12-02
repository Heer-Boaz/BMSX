import { base_model_spaces } from './../bmsx/model';
import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states, build_fsm, assign_fsm } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { show_download_savestate_dialog, show_openfile_dialog, show_load_savestate_dialog } from '../bmsx/gamestatedialog';
import { new_area, Direction, Game, new_vec2, get_gamemodel } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';
import { Component, componenttag, update_tagged_components } from '../bmsx/component';
import { oneTimeGlobalEventHandler, subscribesToParentScopedEvent } from '../bmsx/eventemitter';
import { assign_bt, BehaviorTreeDefinition, Blackboard, BTNode, BTStatus, build_bt, SelectorNode, WaitForActionCompletionDecorator } from '../bmsx/behaviourtree';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || global;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode);
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
@assign_fsm('bclass_animation', 'bclass_meuk')
@assign_bt('bclass_tree')
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
                            type: 'Action', action: function(this: bclass, blackboard) {
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
                                type: 'Action', action: function(this: bclass, blackboard)  {
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
                            action: function(this: bclass, blackboard)  {
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
                        action: function(this: bclass, blackboard) {
                            console.log(`Limited action for ${this.id}`);
                            return 'SUCCESS';
                        }
                    }
                },
                {
                    type: 'RandomSelector',
                    children: [
                        {
                            type: 'Action', action: function(this: bclass, blackboard) {
                                console.log(`Random action A for ${this.id}`)
                                return 'SUCCESS';
                            }
                        },
                        {
                            type: 'Action', action: function(this: bclass, blackboard) {
                                console.log(`Random action B for ${this.id}`)
                                return 'SUCCESS';
                            }
                        }
                    ],
                    currentchild_propname: 'randomchild'
                },
                {
                    type: 'Action',
                    action: function(this: bclass, blackboard) {
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
            states: {
                '#meuk1': {
                    run: () => { },
                    enter(this: bclass) { this.pos.x += 10; },
                },
                meuk2: {
                    run: () => { },
                    enter(this: bclass) { this.pos.y += 10; },
                },
            }
        };
    }

    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        function blarun(this: bclass, s: sstate) {
            const speed = 2;
            if (this.state.current.statedef_id === '#blap') {
                this.tickTree('bclass_tree');
            }

            // To check if an action is pressed for player 0
            const pressedActions = Input.getPressedActions(0);

            for (const { action, pressed, consumed } of pressedActions) {
                switch (action as Action) {
                    case 'up':
                        this.pos.y -= speed;
                        break;
                    case 'right':
                        this.pos.x += speed;
                        break;
                    case 'down':
                        this.pos.y += speed;
                        break;
                    case 'left':
                        this.pos.x -= speed;
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

                        this.state.to('bla');
                        this.state.substate.bclass_animation.to('#ani2');
                        this.state.substate.bclass_meuk.to('meuk2');
                        break;
                    case 'blap':
                        if (consumed) break;
                        Input.consumeAction(0, action);
                        global.eventEmitter.emit('testEventOnce', this.id);

                        this.state.substate.bclass_animation.to('ani1');
                        this.state.to('#blap');
                        this.state.substate.bclass_meuk.to('#meuk1');
                        break;
                }
            }
        }

        return {
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

    constructor() {
        super('The B');
        this.imgid = BitmapId.b2;
        this.hitarea = new_area(0, 0, 14, 18);
        this.addComponent(new DerivedTestComponent(this.id));

    }
};

@componenttag('test')
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

    @oneTimeGlobalEventHandler('testEventOnce')
    onTestEvent2() {
        console.log('TestComponent onTestEvent2');
    }

    onTestEvent3() {
        console.log('TestComponent onTestEvent3');
    }
}

class DerivedTestComponent extends TestComponent {
    override update() {
        super.update();
        console.log('DerivedTestComponent update');
    }
}

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
