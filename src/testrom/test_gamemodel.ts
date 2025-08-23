import { AmbientLightObject, BaseModel, build_fsm, CameraObject, Direction, DirectionalLightObject, GameObject, insavegame, new_vec3, PhysicsComponent, PhysicsDebugComponent, PointLightObject, State, StateMachineBlueprint, TransformComponent, V3 } from '../bmsx';
import { PhysicsOverlayRenderer } from '../bmsx/debugger/bmsxdebugger';
import { PhysicsWorld } from '../bmsx/physics/physicsworld';
import { bclass } from './bclass';
import { _model } from './bootloader';
import { CameraController } from './camera_controller';
import { AnimatedMorphSphere, Cube3D, PhysDynamicCube, PhysDynamicSphere, PhysStaticBox, PhysTriggerZone, SmallCube3D, SparkEmitter } from './objects3d';
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
        // Config: toggle if engine visual up-axis is Z instead of Y
        const USE_Z_UP = false; // set to true if models/camera treat Z as vertical axis
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
        cam1.camera.position = V3.of(0, 10, 25); // elevated & pulled back
        cam1.camera.setAspect(this.gamewidth / this.gameheight);
        // Camera starts looking toward negative Z by default (forward)
        const cam2 = new CameraObject('cam2');
        cam2.camera.position = V3.of(5, 12, 27);
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

        // Physics test setup (visual + physics bound objects)
        let phys = $.registry.get<PhysicsWorld>('physics_world');
        if (!phys) {
            phys = new PhysicsWorld({ gravity: USE_Z_UP ? new_vec3(0, 0, -300) : new_vec3(0, -300, 0) });
            $.registry.register(phys);
        } else {
            // Force gravity downward along selected up-axis for visibility
            phys.setGravity(USE_Z_UP ? new_vec3(0, 0, -300) : new_vec3(0, -300, 0));
        }
        // For visibility ensure nothing sleeps while diagnosing
        phys.setSleepingEnabled(false);
        // Enable metrics HUD (force visible)
        phys.enableMetricsHUD();
        phys.setHUDAutoHide(false);

        // Spawn a debug drawer & overlay GameObject
        const dbgGO = new GameObject();
        _model.spawn(dbgGO);
        dbgGO.addComponent(new PhysicsDebugComponent(dbgGO.id));
        dbgGO.addComponent(new PhysicsOverlayRenderer(dbgGO.id));

        // Static floor & small enclosing walls (much smaller test arena)
        // Floor at Y(or Z)=0 so dynamics clearly drop toward it
        const staticDefs: { name: string; pos: [number, number, number]; he: [number, number, number]; }[] = USE_Z_UP ? [
            { name: 'floor', pos: [0, 0, 0], he: [10, 10, 0.5] }, // thin in Z when Z is up
            { name: 'wall_north', pos: [0, 0, -10], he: [10, 10, 0.5] },
            { name: 'wall_south', pos: [0, 0, 10], he: [10, 10, 0.5] },
            { name: 'wall_west', pos: [-10, 0, 0], he: [0.5, 10, 10] },
            { name: 'wall_east', pos: [10, 0, 0], he: [0.5, 10, 10] }
        ] : [
            { name: 'floor', pos: [0, 0, 0], he: [10, 0.5, 10] },
            { name: 'wall_north', pos: [0, 0, -10], he: [10, 5, 0.5] },
            { name: 'wall_south', pos: [0, 0, 10], he: [10, 5, 0.5] },
            { name: 'wall_west', pos: [-10, 0, 0], he: [0.5, 5, 10] },
            { name: 'wall_east', pos: [10, 0, 0], he: [0.5, 5, 10] }
        ];
        for (const d of staticDefs) {
            const box = new PhysStaticBox(d.he, d.name);
            _model.spawn(box, new_vec3(d.pos[0], d.pos[1], d.pos[2]));
            box.addComponent(new PhysicsComponent(box.id, { shape: { kind: 'aabb', halfExtents: new_vec3(d.he[0], d.he[1], d.he[2]) }, mass: 0, restitution: 0.1, friction: 0.8 }));
        }

        const DROP_HEIGHT = 5;
        if (!USE_Z_UP) {
            // Dynamic cubes (Y-up)
            for (let i = 0; i < 5; i++) {
                const dc = new PhysDynamicCube(0.25);
                _model.spawn(dc, new_vec3(-4 + i * 1.2, DROP_HEIGHT + i * 0.2, 0));
                dc.addComponent(new PhysicsComponent(dc.id, { shape: { kind: 'aabb', halfExtents: new_vec3(0.25, 0.25, 0.25) }, mass: 1, restitution: 0.6, friction: 0.4 }));
            }
            // Dynamic spheres
            for (let i = 0; i < 5; i++) {
                const ds = new PhysDynamicSphere(0.25);
                _model.spawn(ds, new_vec3(4 - i * 1.2, DROP_HEIGHT + i * 0.2, 0.6)); // slight z offset
                ds.addComponent(new PhysicsComponent(ds.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.85, friction: 0.25 }));
            }
            // Fast sphere for CCD test (moving along Z across arena)
            const fastSphere = new PhysDynamicSphere(0.25);
            _model.spawn(fastSphere, new_vec3(0, DROP_HEIGHT + 1, -12));
            fastSphere.addComponent(new PhysicsComponent(fastSphere.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.5, friction: 0.15 }));
            fastSphere.getComponent(PhysicsComponent)!.body.velocity.z = 120; // lower due to smaller arena
            // Trigger zone centered
            const trigger = new PhysTriggerZone([3, 3, 3]);
            _model.spawn(trigger, new_vec3(0, DROP_HEIGHT, 0));
            trigger.addComponent(new PhysicsComponent(trigger.id, { shape: { kind: 'aabb', halfExtents: new_vec3(3, 3, 3) }, mass: 0, restitution: 0, friction: 0, isTrigger: true, layer: 2 }));
        } else {
            // Z-up variant: swap Y/Z usage
            for (let i = 0; i < 5; i++) {
                const dc = new PhysDynamicCube(0.25);
                _model.spawn(dc, new_vec3(-4 + i * 1.2, 0.6, DROP_HEIGHT + i * 0.2));
                dc.addComponent(new PhysicsComponent(dc.id, { shape: { kind: 'aabb', halfExtents: new_vec3(0.25, 0.25, 0.25) }, mass: 1, restitution: 0.6, friction: 0.4 }));
            }
            for (let i = 0; i < 5; i++) {
                const ds = new PhysDynamicSphere(0.25);
                _model.spawn(ds, new_vec3(4 - i * 1.2, 0.6, DROP_HEIGHT + i * 0.2));
                ds.addComponent(new PhysicsComponent(ds.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.85, friction: 0.25 }));
            }
            const fastSphere = new PhysDynamicSphere(0.25);
            _model.spawn(fastSphere, new_vec3(0, -12, DROP_HEIGHT + 1));
            fastSphere.addComponent(new PhysicsComponent(fastSphere.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.5, friction: 0.15 }));
            fastSphere.getComponent(PhysicsComponent)!.body.velocity.y = 120; // sweep across Y axis now
            const trigger = new PhysTriggerZone([3, 3, 3]);
            _model.spawn(trigger, new_vec3(0, 0, DROP_HEIGHT));
            trigger.addComponent(new PhysicsComponent(trigger.id, { shape: { kind: 'aabb', halfExtents: new_vec3(3, 3, 3) }, mass: 0, restitution: 0, friction: 0, isTrigger: true, layer: 2 }));
        }
        return this;
    }

    private _physicsTestFrame = 0;
    private _enterCount = 0; private _stayCount = 0; private _exitCount = 0;
    private _loggedSummary = false;
    public override run(dt: number): void {
        super.run(dt);
        const phys = $.registry.get<any>('physics_world');
        if (!phys) return;
        // Capture events counts
        this._enterCount += phys.lastEnterEvents.length;
        this._stayCount += phys.lastStayEvents.length;
        this._exitCount += phys.lastExitEvents.length;
        // Scripted deterministic motion: every 60 frames apply alternating impulses to first few dynamic bodies
        const bodies = phys.getBodies();
        if (bodies.length) {
            if ((this._physicsTestFrame % 60) === 0) {
                let applied = 0;
                for (const b of bodies) {
                    if (b.invMass && !b.isTrigger) {
                        const dir = ((this._physicsTestFrame / 60) & 1) === 0 ? 1 : -1;
                        phys.applyForce(b, 50 * dir, -30, 0);
                        if (++applied >= 5) break;
                    }
                }
            }
        }
        this._physicsTestFrame++;
        if (this._physicsTestFrame % 60 === 0) {
            // Log position of first dynamic body to confirm motion & gravity application
            const firstDyn = phys.getBodies().find((b: any) => b.invMass && !b.isTrigger);
            if (firstDyn) console.log('[PhysDiag] t=', this._physicsTestFrame, 'posY=', firstDyn.position.y.toFixed(2), 'velY=', firstDyn.velocity.y.toFixed(2), 'gravY=', phys.getGravity().y);
        }
        // After some frames, log summary once for regression visibility
        if (this._physicsTestFrame === 600 && !this._loggedSummary) {
            this._loggedSummary = true;
            console.log('[PhysicsTest] enter:', this._enterCount, 'stay:', this._stayCount, 'exit:', this._exitCount, 'contactsLastFrame:', phys.lastStayEvents.length + phys.lastEnterEvents.length);
        }
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
