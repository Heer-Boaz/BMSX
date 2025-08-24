import { AmbientLightObject, BaseModel, build_fsm, CameraObject, CameraRailBinder, Direction, DirectionalLightObject, GameObject, InputMap, insavegame, new_vec3, PhysicsWorld, PointLightObject, RailPath, RailRunner, State, StateMachineBlueprint, Timeline, TransformComponent, V3, WaveManager } from '../bmsx';
import { PhysicsDescriptorComponent } from '../bmsx/physics/physicsdescriptorcomponent';
import { bclass } from './bclass';
import { _model, gamepadInputMapping, keyboardInputMapping } from './bootloader';
import { BulletManager } from './bullets';
import { CameraController } from './camera_controller';
import { DamageNumberManager, ExplosionEmitter, ImpactBurst, MuzzleFlash } from './effects';
import { EnemyHealthComponent } from './enemyhealth';
import { RailShooterHUD } from './hud';
import { AnimatedMorphSphere, Cube3D, PhysDynamicCube, SmallCube3D } from './objects3d';
import { BitmapId } from './resourceids';
import { Reticle } from './reticle';

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
		$.input.getPlayerInput(1).setInputMap({
			keyboard: keyboardInputMapping,
			gamepad: gamepadInputMapping,
		} as InputMap);

		// Config: toggle if engine visual up-axis is Z instead of Y
		const USE_Z_UP = false; // set to true if models/camera treat Z as vertical axis
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

		cam1.camera.setAspect(this.gamewidth / this.gameheight);
		// Camera starts looking toward negative Z by default (forward)
		const cam2 = new CameraObject('cam2');
		cam2.camera.setAspect(this.gamewidth / this.gameheight);

		_model.spawn(cam1, V3.of(
			-11.608727323457181,
			75.36972014104992,
			10.01821056934937
		));
		cam1.camera.screenLook(1.7687161091476518, -1.418966871448069, -2.6349415504373304);
		_model.spawn(cam2, V3.of(5, 12, 27));

		_model.activeCameraId = cam1.id;

		const ambient = new AmbientLightObject([1.0, 1.0, 1.0], .2, 'amb');
		const sun = new DirectionalLightObject([0.5, -1.0, -0.5], [1.0, 1.0, 1.0], 1, 'sun');
		const extraSun = new DirectionalLightObject([-0.5, -1.0, 0.5], [1.0, 1.0, 1.0], 1, 'extraSun');
		const lamp = new PointLightObject([2.0, 2.0, 2.0], [1.0, 1.0, 1.0], 6.0, 2, 'lamp');

		_model.spawn(ambient);
		_model.spawn(sun);
		_model.spawn(extraSun);
		_model.spawn(lamp);

		$.view.setSkybox({
			posX: BitmapId.skybox,
			negX: BitmapId.skybox,
			posY: BitmapId.skybox,
			negY: BitmapId.skybox,
			posZ: BitmapId.skybox,
			negZ: BitmapId.skybox,
		});

		_model.spawn(new CameraController(cam1, cam2));

		// ===== Rail shooter demo scaffold =====
		// Simple S-curve forward rail reminiscent of an urban fly-through
		const railDef = {
			points: [
				{ x: -20, y: 10, z: 40, t: 0 },
				{ x: -10, y: 12, z: 20 },
				{ x: 0, y: 14, z: 0 },
				{ x: 15, y: 16, z: -20 },
				{ x: 25, y: 18, z: -40, t: 1 }
			],
			events: [
				{ time: 0.03, name: 'rail.speed', data: { speed: 0.06 } },
				{ time: 0.05, name: 'spawn.enemyWave', data: { count: 3, spread: 6 } },
				{ time: 0.10, name: 'rail.speed', data: { speed: 0.09 } },
				{ time: 0.12, name: 'camera.fovPulse', data: { delta: 12, duration: 0.6, curve: 'easeOutBack' } },
				{ time: 0.15, name: 'spawn.enemyWave', data: { count: 4, spread: 8 } },
				{ time: 0.20, name: 'rail.pause', data: { duration: 1.0 } },
				{ time: 0.25, name: 'camera.shake', data: { amp: 0.4, freq: 22, duration: 0.5 } },
				{ time: 0.32, name: 'spawn.enemyWave', data: { count: 5, spread: 10 } },
				{ time: 0.38, name: 'rail.speed', data: { speed: 0.05 } },
				{ time: 0.45, name: 'camera.fovPulse', data: { delta: 8, duration: 0.4, curve: 'easeInOutQuad' } },
				{ time: 0.50, name: 'rail.speed', data: { speed: 0.1 } },
				{ time: 0.55, name: 'spawn.enemyBoss', data: { size: 2.5 } },
				{ time: 0.70, name: 'camera.shake', data: { amp: 0.6, freq: 18, duration: 0.6 } },
				{ time: 0.78, name: 'spawn.enemyWave', data: { count: 6, spread: 12 } },
				{ time: 0.85, name: 'rail.speed', data: { speed: 0.07 } },
				{ time: 0.90, name: 'camera.fovPulse', data: { delta: 15, duration: 0.5, curve: 'easeOutQuad' } }
			]
		};
		const rail = RailPath.fromJSON(railDef);
		const runner = new RailRunner(rail);
		runner.speed = 0.0; // will be driven by timeline
		const activeCam = cam1; // bind primary camera to rail
		const binder = new CameraRailBinder(runner, activeCam, { autoRotate: true, lookAhead: 0.15 });
		binder.attachRailEvents();

		// Timeline drives runner.u and orchestrates camera pulses beyond discrete events
		const timeline = new Timeline();
		timeline.loop = false;
		// Mirror rail events into timeline for consistency (optional, but shows integration)
		for (const ev of rail.events) timeline.addEvent(ev.time, ev.name, ev.data);
		// Example continuous speed curve (ease in, cruise, ease out)
		timeline.animateNumber(() => runner.speed, v => runner.speed = v, 0.0, 0.12, 0.0, 0.15, { easing: 'easeOutQuad' });
		timeline.animateNumber(() => runner.speed, v => runner.speed = v, 0.12, 0.12, 0.15, 0.55, { easing: 'linear' });
		timeline.animateNumber(() => runner.speed, v => runner.speed = v, 0.12, 0.0, 0.70, 0.20, { easing: 'easeInQuad', clamp: true });
		// Subtle continuous FOV breathing effect (layered with event pulses)
		const baseFov = activeCam.camera.fovDeg;
		timeline.addAction(0, 1, (t) => { const breathe = Math.sin(t * Math.PI * 2 * 1.2) * 0.5; activeCam.camera.fovDeg = baseFov + breathe; activeCam.camera.markDirty(); });
		// Bind timeline to runner: we let runner speed still move u; timeline also advances via runner.u each frame
		// Alternative: we could drive runner.u directly from timeline.u for deterministic playback.
		timeline.play();

		// Reticle & bullets setup
		const reticle = new Reticle();
		_model.spawn(reticle, new_vec3(0, 0, 0));
		const bullets = new BulletManager();
		const dmgNums = new DamageNumberManager();
		_model.spawn(bullets);
		const hud = new RailShooterHUD();
		_model.spawn(hud);
		let bossObjId: string | null = null; hud.bossId = bossObjId;

		// Wave manager listens to rail spawn events
		const waves = new WaveManager(rail);
		waves.onSpawn('spawn.enemyWave', (data) => {
			const count = data?.count ?? 3;
			const spread = data?.spread ?? 5;
			for (let i = 0; i < count; i++) {
				const cube = new PhysDynamicCube(0.6);
				const angle = (i / count) * Math.PI * 2;
				const s = runner.sample();
				const radius = spread;
				const px = s.p.x + Math.cos(angle) * radius;
				const py = s.p.y + (Math.random() * 2 - 1) * 2;
				const pz = s.p.z + Math.sin(angle) * radius;
				_model.spawn(cube, new_vec3(px, py, pz));
				cube.addComponent(new PhysicsDescriptorComponent(cube.id, { shape: { kind: 'aabb', halfExtents: new_vec3(0.6, 0.6, 0.6) }, mass: 1, restitution: 0.3, friction: 0.4 }));
				cube.addComponent(new EnemyHealthComponent(cube.id, 30, 25));
			}
		});
		waves.onSpawn('spawn.enemyBoss', (data) => {
			const size = data?.size ?? 3;
			const boss = new PhysDynamicCube(size);
			const s = runner.sample();
			_model.spawn(boss, new_vec3(s.p.x, s.p.y + 4, s.p.z));
			boss.addComponent(new PhysicsDescriptorComponent(boss.id, { shape: { kind: 'aabb', halfExtents: new_vec3(size, size, size) }, mass: 5, restitution: 0.2, friction: 0.5 }));
			boss.addComponent(new EnemyHealthComponent(boss.id, 300, 1000, { boss: true }));
			bossObjId = boss.id; hud.bossId = bossObjId;
		});

		// Inject runner & binder into update loop via a lightweight GameObject
		class RailDemoDriver extends GameObject {
			override run(): void {
				const dtSec = $.deltaTime / 1000; // game.deltaTime in ms
				// Advance runner first (speed-based) then sync timeline to runner.u
				runner.update(dtSec);
				timeline.advanceTo(runner.u);
				binder.update(dtSec);
				// Update reticle offset & placement
				reticle.updateFromInput();
				const cam = activeCam.camera;
				const basis = cam.basis ? cam.basis() : undefined;
				const f = basis ? basis.f : { x: 0, y: 0, z: -1 };
				const r = basis ? basis.r : { x: 1, y: 0, z: 0 }; const u = basis ? basis.u : { x: 0, y: 1, z: 0 };
				const aimDir = { x: f.x + r.x * reticle.ox + u.x * reticle.oy, y: f.y + r.y * reticle.ox + u.y * reticle.oy, z: f.z + r.z * reticle.ox + u.z * reticle.oy };
				hud.reticle = { ox: reticle.ox, oy: reticle.oy };
				const aimLen = Math.hypot(aimDir.x, aimDir.y, aimDir.z) || 1; aimDir.x /= aimLen; aimDir.y /= aimLen; aimDir.z /= aimLen;
				const dist = 15;
				reticle.x = cam.position.x + aimDir.x * dist;
				reticle.y = cam.position.y + aimDir.y * dist;
				reticle.z = cam.position.z + aimDir.z * dist;
				const input = $.input.getPlayerInput(1);
				if (input.getActionState('fire').justpressed) {
					bullets.spawn([cam.position.x, cam.position.y, cam.position.z], [aimDir.x, aimDir.y, aimDir.z]);
					binder.startFovPulse({ delta: 4, duration: 0.25, curve: 'easeOutQuad' });
					_model.spawn(MuzzleFlash.create([cam.position.x + aimDir.x * 2, cam.position.y + aimDir.y * 2, cam.position.z + aimDir.z * 2]));
				}
				for (const impact of bullets.popImpacts()) {
					const enemy = $.model.getGameObject(impact.enemyId);
					if (enemy) {
						const health = enemy.getComponent?.(EnemyHealthComponent) as EnemyHealthComponent;
						if (health) {
							const now = performance.now() / 1000;
							if (health.dead) { hud.registerHit(now, impact.damage, true, health.scoreValue, hud.combo); _model.spawn(ExplosionEmitter.create([enemy.x, enemy.y, enemy.z])); }
							else { hud.registerHit(now, impact.damage, false, health.scoreValue, hud.combo); _model.spawn(ImpactBurst.create([enemy.x, enemy.y, enemy.z])); }
							dmgNums.add([enemy.x, enemy.y + 2, enemy.z], impact.damage);
						}
					}
				}
			}
		}
		_model.spawn(new RailDemoDriver('railDriver'));
		// ===== End rail shooter demo scaffold =====

		// Physics test setup (visual + physics bound objects)
		// const phys = PhysicsWorld.ensure({ gravity: USE_Z_UP ? new_vec3(0, 0, -300) : new_vec3(0, -300, 0) });
		// phys.setGravity(USE_Z_UP ? new_vec3(0, 0, -300) : new_vec3(0, -300, 0));
		// // For visibility ensure nothing sleeps while diagnosing
		// phys.setSleepingEnabled(false);
		// // Enable metrics HUD (force visible)
		// phys.enableMetricsHUD();
		// phys.setHUDAutoHide(false);

		// // Spawn a debug drawer & overlay GameObject
		// const dbgGO = new GameObject();
		// _model.spawn(dbgGO);
		// dbgGO.addComponent(new PhysicsDebugComponent(dbgGO.id));
		// dbgGO.addComponent(new PhysicsOverlayRenderer(dbgGO.id));

		// // Static floor & small enclosing walls (much smaller test arena)
		// // Floor at Y(or Z)=0 so dynamics clearly drop toward it
		// const staticDefs: { name: string; pos: [number, number, number]; he: [number, number, number]; }[] = USE_Z_UP ? [
		//     { name: 'floor', pos: [0, 0, 0], he: [10, 10, 0.5] }, // thin in Z when Z is up
		//     { name: 'wall_north', pos: [0, 0, -10], he: [10, 10, 0.5] },
		//     { name: 'wall_south', pos: [0, 0, 10], he: [10, 10, 0.5] },
		//     { name: 'wall_west', pos: [-10, 0, 0], he: [0.5, 10, 10] },
		//     { name: 'wall_east', pos: [10, 0, 0], he: [0.5, 10, 10] }
		// ] : [
		//     { name: 'floor', pos: [0, 0, 0], he: [10, 0.5, 10] },
		//     { name: 'wall_north', pos: [0, 0, -10], he: [10, 5, 0.5] },
		//     { name: 'wall_south', pos: [0, 0, 10], he: [10, 5, 0.5] },
		//     { name: 'wall_west', pos: [-10, 0, 0], he: [0.5, 5, 10] },
		//     { name: 'wall_east', pos: [10, 0, 0], he: [0.5, 5, 10] }
		// ];
		// let colorIdx = 0;
		// for (const d of staticDefs) {
		//     // assign cycling albedo index (demo) + distinct color factor to visualize even if atlas identical
		//     const ci = Math.max(colorIdx++ % 4, 1);
		//     const colorVariants: [number, number, number, number][] = [
		//         [1, 0.3, 0.3, 1],
		//         [0.3, 1, 0.3, 1],
		//         [0.3, 0.3, 1, 1],
		//         [1, 1, 0.3, 1],
		//     ];
		//     const box = new PhysStaticBox(d.he, d.name, ci, null, colorVariants[ci]);
		//     _model.spawn(box, new_vec3(d.pos[0], d.pos[1], d.pos[2]));
		//     box.addComponent(new PhysicsDescriptorComponent(box.id, { shape: { kind: 'aabb', halfExtents: new_vec3(d.he[0], d.he[1], d.he[2]) }, mass: 0, restitution: 0.1, friction: 0.8 }));
		// }

		// const DROP_HEIGHT = 150;
		// if (!USE_Z_UP) {
		//     // Dynamic cubes (Y-up)
		//     for (let i = 0; i < 5; i++) {
		//         const dc = new PhysDynamicCube(0.25);
		//         _model.spawn(dc, new_vec3(-4 + i * 1.2, DROP_HEIGHT + i * 0.2, 0));
		//         _model.spawn(new SparkEmitter(dc.id));

		//         dc.addComponent(new PhysicsDescriptorComponent(dc.id, { shape: { kind: 'aabb', halfExtents: new_vec3(0.25, 0.25, 0.25) }, mass: 1, restitution: 0.6, friction: 0.4 }));
		//     }
		//     // Dynamic spheres
		//     for (let i = 0; i < 5; i++) {
		//         const ds = new PhysDynamicSphere(0.25);
		//         _model.spawn(ds, new_vec3(4 - i * 1.2, DROP_HEIGHT + i * 0.2, 0.6)); // slight z offset
		//         ds.addComponent(new PhysicsDescriptorComponent(ds.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.85, friction: 0.25 }));
		//     }
		//     // Fast sphere for CCD test (moving along Z across arena)
		//     const fastSphere = new PhysDynamicSphere(0.25);
		//     _model.spawn(fastSphere, new_vec3(0, DROP_HEIGHT + 1, -12));
		//     fastSphere.addComponent(new PhysicsDescriptorComponent(fastSphere.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.5, friction: 0.15 }));
		//     const fsPhysComp = fastSphere.getComponent(PhysicsComponent);
		//     if (fsPhysComp) fsPhysComp.body.velocity.z = 20;
		//     // Trigger zone centered
		//     const trigger = new PhysTriggerZone([3, 3, 3]);
		//     _model.spawn(trigger, new_vec3(0, DROP_HEIGHT, 0));
		//     trigger.addComponent(new PhysicsDescriptorComponent(trigger.id, { shape: { kind: 'aabb', halfExtents: new_vec3(3, 3, 3) }, mass: 0, restitution: 0, friction: 0, isTrigger: true, layer: 2 }));
		// } else {
		//     // Z-up variant: swap Y/Z usage
		//     for (let i = 0; i < 5; i++) {
		//         const dc = new PhysDynamicCube(0.25);
		//         _model.spawn(dc, new_vec3(-4 + i * 1.2, 0.6, DROP_HEIGHT + i * 0.2));
		//         dc.addComponent(new PhysicsDescriptorComponent(dc.id, { shape: { kind: 'aabb', halfExtents: new_vec3(0.25, 0.25, 0.25) }, mass: 1, restitution: 0.6, friction: 0.4 }));
		//     }
		//     for (let i = 0; i < 5; i++) {
		//         const ds = new PhysDynamicSphere(0.25);
		//         _model.spawn(ds, new_vec3(4 - i * 1.2, 0.6, DROP_HEIGHT + i * 0.2));
		//         ds.addComponent(new PhysicsDescriptorComponent(ds.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.85, friction: 0.25 }));
		//     }
		//     const fastSphere = new PhysDynamicSphere(0.25);
		//     _model.spawn(fastSphere, new_vec3(0, -12, DROP_HEIGHT + 1));
		//     fastSphere.addComponent(new PhysicsDescriptorComponent(fastSphere.id, { shape: { kind: 'sphere', radius: 0.25 }, mass: 1, restitution: 0.5, friction: 0.15 }));
		//     const fsPhysComp2 = fastSphere.getComponent(PhysicsComponent);
		//     if (fsPhysComp2) fsPhysComp2.body.velocity.y = 20;
		//     const trigger = new PhysTriggerZone([3, 3, 3]);
		//     _model.spawn(trigger, new_vec3(0, 0, DROP_HEIGHT));
		//     trigger.addComponent(new PhysicsDescriptorComponent(trigger.id, { shape: { kind: 'aabb', halfExtents: new_vec3(3, 3, 3) }, mass: 0, restitution: 0, friction: 0, isTrigger: true, layer: 2 }));
		// }
		return this;
	}

	private _physicsTestFrame = 0;
	private _enterCount = 0; private _stayCount = 0; private _exitCount = 0;
	private _loggedSummary = false;
	public override run(dt: number): void {
		super.run(dt);
		const phys = $.get<PhysicsWorld>('physics_world');
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
			// Also log the position of the game object that is related to
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
