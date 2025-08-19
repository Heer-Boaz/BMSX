import { AmbientLightObject, BaseModel, build_fsm, CameraObject, Direction, DirectionalLightObject, GameObject, insavegame, new_vec3, PointLightObject, State, StateMachineBlueprint, TransformComponent, V3 } from '../bmsx';
import { bclass } from './bclass';
import { _model } from './bootloader';
import { CameraController } from './camera_controller';
import { AnimatedMorphSphere, Cube3D, SmallCube3D, SparkEmitter } from './objects3d';
import { BitmapId } from './resourceids';

const savestring = Symbol('savestring');
@insavegame
export class gamemodel extends BaseModel {
    public [savestring]: string;

    @build_fsm()
    public static bouw(): StateMachineBlueprint {
        return {
            states: {
                '#game_start': {
                    enter(this: gamemodel) {
                    },
                    run(this: gamemodel, s: State) {
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
        const sparkEmitter = new SparkEmitter(cube.id);
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
        cam1.camera.position = V3.of(0, 0, 5);
        cam1.camera.setAspect(this.gamewidth / this.gameheight);
        // Camera starts looking toward negative Z by default (forward)
        const cam2 = new CameraObject('cam2');
        cam2.camera.position = V3.of(5, 3, 5);
        cam2.camera.setAspect(this.gamewidth / this.gameheight);

        _model.spawn(cam1);
        _model.spawn(cam2);

        _model.activeCameraId = cam1.id;

        const ambient = new AmbientLightObject([1.0, 1.0, 1.0], .2, 'amb');
        const sun = new DirectionalLightObject([0.5, -1.0, -0.5], [1.0, 1.0, 1.0], 1, 'sun');
        const extraSun = new DirectionalLightObject([-0.5, -1.0, 0.5], [1.0, 1.0, 1.0], 1, 'extraSun');
        const lamp = new PointLightObject([2.0, 2.0, 2.0], [1.0, 1.0, 1.0], 6.0, 2, 'lamp');

        _model.spawn(ambient);
        _model.spawn(sun);
        _model.spawn(extraSun);
        _model.spawn(lamp); +
            _model.spawn(sparkEmitter);

        $.view.setSkybox({
            posX: BitmapId.skybox,
            negX: BitmapId.skybox,
            posY: BitmapId.skybox,
            negY: BitmapId.skybox,
            posZ: BitmapId.skybox,
            negZ: BitmapId.skybox,
        });

        _model.spawn(new CameraController(cam1, cam2));

        return this;
    }

    public get gamewidth(): number {
        return 320; // Adjusted for the new view size
    }

    public get gameheight(): number {
        return 240; // Adjusted for the new view size
    }

    public collidesWithTile(_o: GameObject, _dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(_x: number, _y: number): boolean {
        return false;
    }
}
;
