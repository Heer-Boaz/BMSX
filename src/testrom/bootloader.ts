import {
    AmbientLightObject, BGamepadButton, BaseModel, BehaviorTreeDefinition, BootArgs, CameraObject, Component, Direction, DirectionalLightObject, GLView, Game, GameObject, GamepadInputMapping, InputMap, KeyboardButton, KeyboardInputMapping, MeshObject, PointLightObject, ProhibitLeavingScreenComponent, SpriteObject, State, StateMachineBlueprint, TransformComponent, WaitForActionCompletionDecorator, assign_bt,
    assign_fsm,
    attach_components,
    build_bt,
    build_fsm,
    componenttags_preprocessing,
    insavegame,
    new_area,
    new_vec2,
    new_vec3,
    subscribesToParentScopedEvent,
    subscribesToSelfScopedEvent,
    update_tagged_components,
    vec2,
} from '../bmsx/index';
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

const actions = ['up', 'right', 'down', 'left', 'panleft', 'panright', 'load', 'save', 'bla', 'blap'] as const;
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
    'load': ['ShiftLeft'],      // Toggle extra light
    'save': ['KeyZ'],           // Switch camera
    'bla': ['KeyW'],            // Move forward
    'blap': ['KeyS'],           // Move backward
    'panleft': ['KeyA'],       // Pan left
    'panright': ['KeyD'],      // Pan right
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
    'panleft': ['lb'],
    'panright': ['rb']
};

@insavegame
@componenttags_preprocessing('test')
class TestComponent extends Component {
    // Implement virtual methods
    override postprocessingUpdate() {
        // console.log('TestComponent update');
    }

    // Implement event handlers
    @subscribesToParentScopedEvent('testEvent')
    onTestEvent() {
        // console.log('TestComponent onTestEvent');
    }

    @subscribesToSelfScopedEvent('testEvent2')
    onTestEvent2() {
        // console.log('TestComponent onTestEvent2');
    }

    onTestEvent3() {
        // console.log('TestComponent onTestEvent3');
    }
}

@insavegame
class DerivedTestComponent extends TestComponent {
    override postprocessingUpdate() {
        super.postprocessingUpdate();
        // console.log('DerivedTestComponent update');
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
                            enter(this: bclass) { }, //console.log('enter blupperblop1'); },
                        },
                        blupperblop2: {
                            run(this: bclass) { },
                            enter(this: bclass) { }, //console.log('enter blupperblop2'); },
                        },
                    },
                },
                meuk2: {
                    run: () => { },
                    enter(this: bclass) { }, // this.pos.y += 10; },
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
        // console.log('testmeuk');
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
        this.rotation[1] += 0.005; // Slow auto rotation
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
        this.rotation[0] += 0.01;
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
        // this.rotation[1] += 0.01; // Slow auto rotation
        this.updateComponentsWithTag('position_update_axis');
        super.run();
    }
}

class CameraController extends GameObject {
    private cameras: CameraObject[];
    private idx = 0;
    private mouseControlsEnabled = false;

    constructor(...cams: CameraObject[]) {
        super('camctrl');
        this.cameras = cams;
        this.setupMouseControls();
    }

    private setupMouseControls(): void {
        const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
        if (!canvas) return;

        // Zorg dat deze flags bestaan
        this.mouseControlsEnabled = false;

        // Toggle met middle mouse (kan je evt. LMB maken)
        canvas.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button === 1) {
                e.preventDefault();
                this.toggleMouseControls();
            }
        });

        // Rotate alleen wanneer pointer lock actief is
        canvas.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.mouseControlsEnabled) return;

            // Gebruik ALLEEN raw deltas; geen fallback naar clientX/Y bij lock
            const dx = e.movementX || 0;
            const dy = e.movementY || 0;

            const camObj = $.model.activeCameraObject;
            if (!camObj) return;

            // Radians per pixel; 0.002 is ok, maak desnoods runtime-tweakbaar
            const sensitivity = 0.002;

            // mouseLook(yawDelta, pitchDelta) – let op volgorde als jouw API anders is
            camObj.camera.mouseLook(dx * sensitivity, -dy * sensitivity);
        });

        // Pointer lock lifecycle
        const onLockChange = () => {
            const locked = document.pointerLockElement === canvas;
            this.mouseControlsEnabled = locked;

            console.log(locked ? 'Mouse controls enabled' : 'Mouse controls disabled');
        };

        document.addEventListener('pointerlockchange', onLockChange);
        document.addEventListener('pointerlockerror', () => {
            this.mouseControlsEnabled = false;
            console.warn('Pointer lock error');
        });
    }

    private toggleMouseControls(): void {
        const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
        if (!canvas) return;

        if (!this.mouseControlsEnabled) {
            // Raw (unaccelerated) mouse als de browser het toelaat
            const anyCanvas = canvas as any;
            if (anyCanvas.requestPointerLock) {
                try {
                    anyCanvas.requestPointerLock({ unadjustedMovement: true });
                } catch {
                    canvas.requestPointerLock();
                }
            } else {
                canvas.requestPointerLock();
            }
        } else {
            document.exitPointerLock();
        }
    }


    override run(): void {
        const input = $.input.getPlayerInput(1);

        if (input.getActionState('save').justpressed) {
            this.idx = (this.idx + 1) % this.cameras.length;
            $.model.setActiveCamera(this.cameras[this.idx].id);
            console.log(`Switched to camera ${this.cameras[this.idx].id}`);
        }

        if (input.getActionState('load').justpressed) {
            const extra = $.model.getGameObject<DirectionalLightObject>('extraSun');
            if (extra) extra.active = !extra.active;
        }

        const camObj = $.model.activeCameraObject;
        if (!camObj) return;

        const cam = camObj.camera;
        const move = 0.5;
        const rotateSpeed = 0.02; // Reduced from 0.05 for smoother rotation

        // Keyboard camera controls (when mouse is not locked)
        let up_pressed = input.getActionState('up').pressed;
        let down_pressed = input.getActionState('down').pressed;
        let left_pressed = input.getActionState('left').pressed;
        let right_pressed = input.getActionState('right').pressed;
        let moveForward_pressed = input.getActionState('bla').pressed;
        let moveBackward_pressed = input.getActionState('blap').pressed;
        let panLeft_pressed = input.getActionState('panleft').pressed;
        let panRight_pressed = input.getActionState('panright').pressed;

        // Choose control mode based on mouse lock state
        if (!this.mouseControlsEnabled) {
            // Keyboard rotation (when mouse is not locked)
            if (up_pressed) cam.addPitch(rotateSpeed);      // Look up
            if (down_pressed) cam.addPitch(-rotateSpeed);   // Look down
            if (left_pressed) cam.addYaw(-rotateSpeed);     // Turn left
            if (right_pressed) cam.addYaw(rotateSpeed);     // Turn right
        }

        // Movement (works in both modes)
        if (moveForward_pressed) cam.moveFreeform(move);    // Forward movement
        if (moveBackward_pressed) cam.moveFreeform(-move);  // Backward movement
        if (panLeft_pressed) cam.panGround(-move, 0);   // Pan left
        if (panRight_pressed) cam.panGround(move, 0);    // Pan right

        // Additional free-form movement (you can map these to other keys)
        // cam.strafeFreeform() for left/right strafe
        // cam.moveFreeformVertical() for up/down movement
        // cam.flyUpDown() for camera-relative up/down

        // Debug output
        // if (up_pressed || down_pressed || left_pressed || right_pressed || moveForward_pressed || moveBackward_pressed) {
        // Log which actions are pressed and show combos as one string
        // const forward = cam.getForwardVector();
        // console.log('Camera controls:');
        // console.log(`\tCamera - Up: ${up_pressed}, Down: ${down_pressed}, Left: ${left_pressed}, Right: ${right_pressed}`);
        // console.log(`\tCamera - Move Forward: ${moveForward_pressed}, Move Backward: ${moveBackward_pressed}`);
        // console.log(`\tCamera - Yaw: ${(cam.yaw * 180 / Math.PI).toFixed(1)}°, Pitch: ${(cam.pitch * 180 / Math.PI).toFixed(1)}°`);
        // console.log(`\tPosition: [${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)}]`);
        // console.log(`\tForward: [${forward.x.toFixed(2)}, ${forward.y.toFixed(2)}, ${forward.z.toFixed(2)}]`);
        // console.log(`\tFOV: ${cam.fov}°, Aspect: ${cam.aspect.toFixed(2)}`);
        // }
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
        cam1.camera.setAspect(this.gamewidth / this.gameheight);
        // Camera starts looking toward negative Z by default (forward)

        const cam2 = new CameraObject('cam2');
        cam2.camera.setPosition([5, 3, 5]);
        cam2.camera.setAspect(this.gamewidth / this.gameheight);
        cam2.camera.setYaw(-Math.PI * 0.75); // Turn to look roughly toward origin (-135 degrees)
        cam2.camera.setPitch(-0.3); // Slight downward angle

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
