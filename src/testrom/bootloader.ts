import { MeshObject, new_vec3, BGamepadButton, BaseModel, BehaviorTreeDefinition, BinaryCompressor, BootArgs, Component, Direction, GLView, Game, GameObject, GamepadInputMapping, InputMap, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, PSG, ProhibitLeavingScreenComponent, SpriteObject, StateMachineBlueprint, WaitForActionCompletionDecorator, assign_bt, assign_fsm, attach_components, build_bt, build_fsm, componenttags_preprocessing, debugPrintBinarySnapshot, insavegame, new_area, new_vec2, snareInstrument, subscribesToParentScopedEvent, subscribesToSelfScopedEvent, update_tagged_components, CameraObject, AmbientLightObject, DirectionalLightObject, PointLightObject, Camera3D, type State } from '../bmsx/bmsx';
import { BitmapId } from './resourceids';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || globalThis;

_global['h406A'] = (args: BootArgs): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game();
    _game.init({ ...args, model: _model, view: _view }).then(() => {
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

@insavegame
class Cube3D extends MeshObject {
    constructor() {
        super('cube');
        const cubeObj = `
v -1 -1 -1
v 1 -1 -1
v 1 1 -1
v -1 1 -1
v -1 -1 1
v 1 -1 1
v 1 1 1
v -1 1 1
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 -1
vn 0 0 1
vn 0 -1 0
vn 0 1 0
vn -1 0 0
vn 1 0 0
f 1/1/1 2/2/1 3/3/1
f 1/1/1 3/3/1 4/4/1
f 5/1/2 8/4/2 7/3/2
f 5/1/2 7/3/2 6/2/2
f 1/1/3 5/2/3 6/3/3
f 1/1/3 6/3/3 2/4/3
f 2/1/6 6/2/6 7/3/6
f 2/1/6 7/3/6 3/4/6
f 3/1/4 7/2/4 8/3/4
f 3/1/4 8/3/4 4/4/4
f 5/1/5 1/2/5 4/3/5
f 5/1/5 4/3/5 8/4/5
`;
        const model = _view.loadOBJ(cubeObj);
        this.mesh.positions = model.positions;
        this.mesh.normals = model.normals;
        this.mesh.texcoords = new Float32Array(model.positions.length / 3 * 2);
        this.mesh.color = { r: 0.7, g: 0.2, b: 0.2, a: 1.0 };
        this.mesh.atlasId = 255; // render without texture
        this.pos = new_vec3(0, 0, 0);
    }

    override run(): void {
        const input = $.input.getPlayerInput(1);
        const rotSpeed = 0.05;
        if (input.getActionState('left').pressed) this.rotation[1] -= rotSpeed;
        if (input.getActionState('right').pressed) this.rotation[1] += rotSpeed;
        if (input.getActionState('up').pressed) this.rotation[0] -= rotSpeed;
        if (input.getActionState('down').pressed) this.rotation[0] += rotSpeed;
        if (input.getActionState('bla').justPressed) {
            const cam = _view.getCamera();
            if (cam.projection === 'perspective') {
                _view.useOrthographicCamera(10, 10);
            } else {
                _view.usePerspectiveCamera();
            }
        }
        this.rotation[1] += 0.01; // Slow auto rotation
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

        if (input.getActionState('save').justPressed) {
            this.idx = (this.idx + 1) % this.cameras.length;
            $.model.setActiveCamera(this.cameras[this.idx].id);
        }

        if (input.getActionState('load').justPressed) {
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
        _model.spawn(new bclass(), new_vec2(100, 100));
        _model.spawn(cube, new_vec3(0, 0, 0));

        const cam1 = new CameraObject('cam1');
        cam1.camera.setPosition([0, 0, 5]);
        cam1.camera.lookAt([cube.x, cube.y, cube.z]);

        const cam2 = new CameraObject('cam2');
        cam2.camera.setPosition([5, 3, 5]);
        cam2.camera.lookAt([cube.x, cube.y, cube.z]);

        _model.spawn(cam1);
        _model.spawn(cam2);

        const ambient = new AmbientLightObject('amb', [1.0, 1.0, 1.0], 0.2);
        const sun = new DirectionalLightObject('sun', [0.5, -1.0, -0.5], [1.0, 1.0, 1.0]);
        const extraSun = new DirectionalLightObject('extraSun', [-0.5, -1.0, 0.5], [0.8, 0.8, 1.0]);
        const lamp = new PointLightObject('lamp', [2.0, 2.0, 2.0], [1.0, 0.8, 0.8], 6.0);

        _model.spawn(ambient);
        _model.spawn(sun);
        _model.spawn(extraSun);
        _model.spawn(lamp);

        _model.spawn(new CameraController(cam1, cam2));

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
