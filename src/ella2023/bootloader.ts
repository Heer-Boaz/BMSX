import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { new_area, Direction, Game, new_vec2, get_gamemodel } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';
import { Component, componenttag, update_tagged_components } from '../bmsx/component';
import { oneTimeGlobalEventHandler, subscribesToParentScopedEvent as subscribesToParentScopedEvent } from '../bmsx/eventemitter';
import { BehaviorTreeDefinition, Blackboard, BTStatus, build_bt } from '../bmsx/behaviourtree';

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

class enemy extends SpriteObject {
    @build_bt('enemyBehaviorTree')
    public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
        function isPlayerInRange(this: enemy): boolean {
            // Logic to determine if the player is in range
            return false;
        }

        function attackPlayer(this: enemy): BTStatus {
            // Logic to perform an attack
            return 'SUCCESS';
        }

        function isUnderAttack(this: enemy): boolean {
            // Logic to determine if the enemy is under attack
            return false;
        }

        function defend(this: enemy): BTStatus {
            // Logic for defense actions
            return 'SUCCESS';
        }

        // Methods for reposition and idle behaviors

        function isAtDisadvantage(this: enemy): boolean {
            // Example logic: Check if enemy is cornered or too close to the edge
            // This logic will depend on your game's environment and enemy capabilities
            const someThreshold = 10;
            const anotherThreshold = 100;
            return this.pos.x < someThreshold || this.pos.x > anotherThreshold;
        }

        function reposition(this: enemy): BTStatus {
            // Example logic: Move towards the center or a better strategic position
            // Implement movement logic based on your game's mechanics
            // this.moveTo(newPosition); // `moveTo` is a hypothetical method for movement
            return 'SUCCESS';
        }


        function isPlayerIdle(this: enemy): boolean {
            // Example logic: Check if the player hasn't moved or attacked recently
            // This will require tracking the player's activity
            // return model.get('player').lastActionTime > idleThreshold;
            return false;
        }

        function idleBehavior(this: enemy, blackboard: Blackboard): BTStatus {
            // Example logic: Perform a taunt or change stance
            // Implement this based on your game's visual and AI capabilities
            // this.taunt(); // `taunt` is a hypothetical method for taunting
            return 'SUCCESS';
        }

        return {
            type: 'Selector',
            children: [
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isPlayerInRange
                        },
                        {
                            type: 'Action',
                            action: attackPlayer
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isUnderAttack
                        },
                        {
                            type: 'Action',
                            action: defend
                        }
                    ]
                },
                // Additional Sequences for reposition and idle behaviors
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isAtDisadvantage
                        },
                        {
                            type: 'Action',
                            action: reposition
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isPlayerIdle
                        },
                        {
                            type: 'Action',
                            action: idleBehavior
                        }
                    ]
                },
            ]
        };
    }
}

@insavegame
class bclass extends SpriteObject {
    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        // To check if an action is pressed for player 0
        function blarun(this: bclass, s: sstate) {
            const speed = 2;

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
                        global.eventEmitter.emit('testEvent', this.id);
                        this.testmeuk();

                        this.state.to('bla');
                        break;
                    case 'blap':
                        if (consumed) break;
                        Input.consumeAction(0, action);
                        global.eventEmitter.emit('testEventOnce', this.id);

                        this.state.to('#blap');
                        break;
                }
            }
        }

        return {
            states: {
                bla: {
                    run: blarun,
                    enter(this: bclass) { this.imgid = BitmapId.b; },
                },
                '#blap': {
                    run: blarun,
                    enter(this: bclass) { this.imgid = BitmapId.b2; },
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
        this.hitarea = new_area(0, 0, 14, 18);
        this.addComponent(new TestComponent(this.id));
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
};
