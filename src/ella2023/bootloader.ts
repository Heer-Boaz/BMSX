import { BTStatus } from './../bmsx/behaviourtree';
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
import { subscribesToParentScopedEvent as subscribesToParentScopedEvent } from '../bmsx/eventemitter';
import { BehaviorTreeDefinition, build_bt } from '../bmsx/behaviourtree';

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

const actions = ['jump', 'right', 'duck', 'left', 'punch', 'kick', 'block' ] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton;
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton;
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'jump': 'ArrowUp',
    'right': 'ArrowRight',
    'duck': 'ArrowDown',
    'left': 'ArrowLeft',
    'punch': 'ShiftLeft',
    'kick': 'KeyZ',
    'block': 'KeyA',
    // 'blap': 'KeyS',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'jump': 'up',
    'right': 'right',
    'duck': 'down',
    'left': 'left',
    'punch': 'a',
    'kick': 'b',
    'block': 'x',
    // 'blap': 'y',
};

@insavegame
class enemy extends SpriteObject {
    @build_bt('enemyBehaviorTree')
    public static buildEnemyBehaviorTree(): BehaviorTreeDefinition {
        function isPlayerInRange(this: enemy): boolean {
            // Logic to determine if the player is in range
            return false; // Placeholder logic
        }

        function isPlayerAttacking(this: enemy): boolean {
            // Logic to check if the player is attacking
            return false; // Placeholder logic
        }

        function performAttackMove1(this: enemy): BTStatus {
            // Logic for attack move 1
            return 'SUCCESS';
        }

        function performAttackMove2(this: enemy): BTStatus {
            // Logic for attack move 2
            return 'SUCCESS';
        }

        function performSpecialMove(this: enemy): BTStatus {
            // Logic for special move
            return 'SUCCESS';
        }

        function block(this: enemy): BTStatus {
            // Logic for block action
            return 'SUCCESS';
        }

        function dodge(this: enemy): BTStatus {
            // Logic for dodge action
            return 'SUCCESS';
        }

        function counter(this: enemy): BTStatus {
            // Logic for counter action
            return 'SUCCESS';
        }

        function idle(this: enemy): BTStatus {
            // Logic for idle behavior
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
                            type: 'RandomSelector',
                            currentchild_propname: 'currentAttackMove',
                            children: [
                                { type: 'Action', action: performAttackMove1 },
                                { type: 'Action', action: performAttackMove2 },
                                { type: 'Action', action: performSpecialMove }
                            ]
                        }
                    ]
                },
                {
                    type: 'Sequence',
                    children: [
                        {
                            type: 'Condition',
                            condition: isPlayerAttacking
                        },
                        {
                            type: 'RandomSelector',
                            currentchild_propname: 'currentDefenseMove',
                            children: [
                                { type: 'Action', action: block },
                                { type: 'Action', action: dodge },
                                { type: 'Action', action: counter }
                            ]
                        }
                    ]
                },
                {
                    type: 'Action',
                    action: idle
                }
            ]
        };
    }
}

@insavegame
class player extends SpriteObject {
    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        // To check if an action is pressed for player 0
        function defaultrun(this: player, s: sstate) {
            const speed = 2;

            const pressedActions = Input.getPressedActions(0);

            for (const { action, pressed, consumed } of pressedActions) {
                switch (action as Action) {
                    case 'right':
                        this.pos.x += speed;
                        break;
                    case 'left':
                        this.pos.x -= speed;
                        break;
                }
            }
        }

        return {
            states: {
                '#idle': {
                    run: defaultrun,
                    enter(this: player) { },
                },
            }
        };
    }

    constructor() {
        super('player');
        this.hitarea = new_area(0, 0, 14, 18);
    }
};

@insavegame
class gamemodel extends BaseModel {
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
        _model.spawn(new player(), new_vec2(100, 100));
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
