import { AmbientLightObject, BGamepadButton, BaseModel, BehaviorTreeDefinition, BootArgs, CameraObject, Component, Direction, DirectionalLightObject, GLView, Game, GameObject, GamepadInputMapping, InputMap, KeyboardButton, KeyboardInputMapping, MeshObject, PointLightObject, ProhibitLeavingScreenComponent, SpriteObject, StateMachineBlueprint, TransformComponent, WaitForActionCompletionDecorator, assign_bt, assign_fsm, attach_components, build_bt, build_fsm, componenttags_preprocessing, insavegame, new_area, new_vec2, new_vec3, subscribesToParentScopedEvent, subscribesToSelfScopedEvent, update_tagged_components, vec2, type State } from '../bmsx/index';
import { BitmapId, ModelId } from './resourceids';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || globalThis;

_global['h406A'] = (args: BootArgs): Promise<any> => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(_model.gamewidth, _model.gameheight));
    _game = new Game();
    return _game.init({ ...args, model: _model, view: _view }).then(() => {
        _game.start();
    });
};

const actions = ['up', 'right', 'down', 'left', 'load', 'save', 'bla', 'blap'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: BGamepadButton[];
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
                        break;
                    case 'save':
                        if (consumed) break;
                        $.input.getPlayerInput(1).consumeAction(action);
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
                                // PSG.playCustomInstrument(snareInstrument, 10000);
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

    constructor() {
        super('The B');
        this.imgid = BitmapId.b2;
        this.hitarea = new_area(0, 0, 14, 18);
    }

    override onspawn(spawningPos?: vec2): void {
        super.onspawn(spawningPos);
        this.btreecontexts['bclass_tree'].running = false; // Stop the behavior tree by default and this cannot happen in the constructor!
    }

};

@insavegame
@attach_components(TransformComponent)
class Cube3D extends MeshObject {
    constructor() {
        super('cube');
        this.model_id = ModelId.cube;
    }

    override run(): void {
        this.rotation[1] += 0.01; // Slow auto rotation
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

@insavegame
@attach_components(TransformComponent)
class SmallCube3D extends MeshObject {
    constructor(overrideTextureIndex?: number) {
        super(`smallCube${overrideTextureIndex ?? ''}`);
        this.model_id = ModelId.cube;
        if (overrideTextureIndex !== undefined) {
            const mesh = this.meshes[0];
            if (mesh?.material) {
                mesh.material.textures.albedo = overrideTextureIndex;
                $.texmanager.fetchModelTextures(this.meshModel).then(tex => {
                    mesh.material.gpuTextures.albedo = tex[overrideTextureIndex];
                });
            }
        }
        this.scale = [0.5, 0.5, 0.5];
    }

    override run(): void {
        this.rotation[0] += 0.02;
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

@insavegame
@attach_components(TransformComponent)
class AnimatedMorphSphere extends MeshObject {
    constructor() {
        super('animatedSphere');
        this.model_id = ModelId.animatedmorphsphere;
    }

    override run(): void {
        this.rotation[1] += 0.01; // Slow auto rotation
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

class CameraController extends GameObject {
    private cameras: CameraObject[];
    private idx = 0;

    constructor(...cams: CameraObject[]) {
        super('camctrl');
        this.cameras = cams;
    }

    override run(): void {
        const input = $.input.getPlayerInput(1);

        if (input.getActionState('save').justpressed) {
            this.idx = (this.idx + 1) % this.cameras.length;
            $.model.setActiveCamera(this.cameras[this.idx].id);
        }

        if (input.getActionState('load').justpressed) {
            const extra = $.model.getGameObject<DirectionalLightObject>('extraSun');
            if (extra) extra.active = !extra.active;
        }

        const camObj = $.model.getActiveCamera();
        if (!camObj) return;

        const cam = camObj.camera;
        const move = 0.1;

        if (input.getActionState('left').pressed) cam.moveRight(-move);
        if (input.getActionState('right').pressed) cam.moveRight(move);
        if (input.getActionState('up').pressed) cam.moveUp(move);
        if (input.getActionState('down').pressed) cam.moveUp(-move);
        if (input.getActionState('bla').pressed) cam.moveForward(move);
        if (input.getActionState('blap').pressed) cam.moveForward(-move);
    }
}

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
        const cube = new Cube3D();
        const small = new SmallCube3D(1);
        const small2 = new SmallCube3D(2);
        const animatedMorphSphere = new AnimatedMorphSphere();
        _model.spawn(new bclass(), new_vec3(100, 100, 1000));
        _model.spawn(cube, new_vec3(0, 0, 0));
        _model.spawn(small, new_vec3(5, 0, 0));
        _model.spawn(small2, new_vec3(5, 5, 5));
        _model.spawn(animatedMorphSphere, new_vec3(5, 5, 5));

        const parentTf = cube.getComponent(TransformComponent);
        const childTf = small.getComponent(TransformComponent);
        const childTf2 = small2.getComponent(TransformComponent);
        const childTf3 = animatedMorphSphere.getComponent(TransformComponent);
        if (parentTf && childTf) {
            childTf.parentNode = parentTf;
            childTf.position = [1, 0, 0];
            if (childTf2) {
                childTf2.parentNode = childTf;
                childTf2.position = [0, 1, 0];
                if (childTf3) {
                    childTf3.parentNode = childTf2;
                    childTf3.position = [0, 0, 1];
                }
            }
        }

        const cam1 = new CameraObject('cam1');
        cam1.camera.setPosition([0, 0, 5]);
        cam1.camera.lookAt(cube.pos);

        const cam2 = new CameraObject('cam2');
        cam2.camera.setPosition([5, 3, 5]);
        cam2.camera.lookAt(cube.pos);

        _model.spawn(cam1);
        _model.spawn(cam2);

        const ambient = new AmbientLightObject([1.0, 1.0, 1.0], .2, 'amb');
        const sun = new DirectionalLightObject([0.5, -1.0, -0.5], [1.0, 1.0, 1.0], 1, 'sun');
        const extraSun = new DirectionalLightObject([-0.5, -1.0, 0.5], [1.0, 1.0, 1.0], 1, 'extraSun');
        const lamp = new PointLightObject([2.0, 2.0, 2.0], [1.0, 1.0, 1.0], 6.0, 2, 'lamp');

        _model.spawn(ambient);
        _model.spawn(sun);
        _model.spawn(extraSun);
        _model.spawn(lamp);

        $.view.setSkybox({
            posX: BitmapId.b2,
            negX: BitmapId.b,
            posY: BitmapId.b2,
            negY: BitmapId.b,
            posZ: BitmapId.b2,
            negZ: BitmapId.b,
        });

        _model.spawn(new CameraController(cam1, cam2));

        return this;
    }

    public get gamewidth(): number {
        // return MSX1ScreenWidth;
        return 320; // Adjusted for the new view size
    }

    public get gameheight(): number {
        // return MSX1ScreenHeight;
        return 240; // Adjusted for the new view size
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
