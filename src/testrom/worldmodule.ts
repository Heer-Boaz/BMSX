import { $, World, CameraObject, new_vec3, V3, AmbientLightObject, DirectionalLightObject, PointLightObject, CatmullRomPath, PathRunner, CameraPathBinder, EventTimeline, WaveManager, WorldObject, build_fsm, type StateMachineBlueprint } from 'bmsx';
import { bclass } from './bclass';
import { CameraController } from './camera_controller';
import { AnimatedMorphSphere, Cube3D, PhysDynamicCube, SmallCube3D, spawnSimpleCity } from './objects3d';
import { BitmapId } from './resourceids';
import { PhysicsDescriptorComponent } from 'bmsx/physics/physicsdescriptorcomponent';
import { BulletManager } from './bullets';
import { DamageNumberManager, MuzzleFlash, ExplosionEmitter, ImpactBurst } from './effects';
import { EnemyHealthComponent } from './enemyhealth';
import { RailShooterHUD } from './hud';
import { Reticle } from './reticle';

// --- moved RailDemoDriver to module scope so it can be constructed with injected deps ---
class RailDemoDriver extends WorldObject {
	@build_fsm()
	public static b(): StateMachineBlueprint {
		return {
			initial: 'default',
			states: {
				default: {
					tick(this: RailDemoDriver) { this.run(); }
				},
			},
		};
	}

	runner: PathRunner;
	eventTimeline: EventTimeline;
	camBinder: CameraPathBinder;
	activeCam: CameraObject;
	reticle: Reticle;
	bullets: BulletManager;
	hud: RailShooterHUD;
	dmgNums: DamageNumberManager;
	totalDuration: number;
	elapsedRef: { value: number };

	constructor(opts: {
		id?: string;
		runner: PathRunner;
		eventTimeline: EventTimeline;
		camBinder: CameraPathBinder;
		activeCam: CameraObject;
		reticle: Reticle;
		bullets: BulletManager;
		hud: RailShooterHUD;
		dmgNums: DamageNumberManager;
		totalDuration: number;
		elapsedRef: { value: number };
	}) {
		const { id } = opts;
		super({ id });
		this.runner = opts.runner;
		this.eventTimeline = opts.eventTimeline;
		this.camBinder = opts.camBinder;
		this.activeCam = opts.activeCam;
		this.reticle = opts.reticle;
		this.bullets = opts.bullets;
		this.hud = opts.hud;
		this.dmgNums = opts.dmgNums;
		this.totalDuration = opts.totalDuration;
		this.elapsedRef = opts.elapsedRef;
	}

	run(): void {
		const dtSec = $.deltaTime / 1000;
		this.elapsedRef.value += dtSec;
		const prevParam = this.runner.u;
		const newParam = Math.min(1, this.elapsedRef.value / this.totalDuration);
		if (newParam !== prevParam) this.runner.u = newParam;
		this.eventTimeline.update(dtSec, this.runner);
		this.camBinder.update(dtSec);
		$.view.atmosphere.progressFactor = this.runner.u;

		// Reticle & firing logic
		this.reticle.updateFromInput();
		const camObj = this.activeCam.camera;
		const basis = camObj.basis ? camObj.basis() : undefined;
		const fBasis = basis ? basis.f : { x: 0, y: 0, z: -1 };
		const rBasis = basis ? basis.r : { x: 1, y: 0, z: 0 };
		const uBasis = basis ? basis.u : { x: 0, y: 1, z: 0 };
		const aimDir = {
			x: fBasis.x + rBasis.x * this.reticle.ox + uBasis.x * this.reticle.oy,
			y: fBasis.y + rBasis.y * this.reticle.ox + uBasis.y * this.reticle.oy,
			z: fBasis.z + rBasis.z * this.reticle.ox + uBasis.z * this.reticle.oy
		};
		this.hud.reticle = { ox: this.reticle.ox, oy: this.reticle.oy };
		const aimLen = Math.hypot(aimDir.x, aimDir.y, aimDir.z) || 1;
		aimDir.x /= aimLen; aimDir.y /= aimLen; aimDir.z /= aimLen;
		const dist = 15;
		this.reticle.x = camObj.position.x + aimDir.x * dist;
		this.reticle.y = camObj.position.y + aimDir.y * dist;
		this.reticle.z = camObj.position.z + aimDir.z * dist;

		const input = $.input.getPlayerInput(1);
		if (input.getActionState('fire').justpressed) {
			this.bullets.spawn([camObj.position.x, camObj.position.y, camObj.position.z], [aimDir.x, aimDir.y, aimDir.z]);
			$.spawn(MuzzleFlash.create([camObj.position.x + aimDir.x * 2, camObj.position.y + aimDir.y * 2, camObj.position.z + aimDir.z * 2]));
		}

		for (const impact of this.bullets.popImpacts()) {
			const enemy = $.world.getWorldObject(impact.enemyId);
			if (enemy) {
				const health = enemy.getFirstComponent(EnemyHealthComponent);
				if (health) {
					const now = $.platform.clock.now() / 1000;
					if (health.dead) {
						this.hud.registerHit(now, impact.damage, true, health.scoreValue, this.hud.combo);
						$.spawn(ExplosionEmitter.create([enemy.x, enemy.y, enemy.z]));
					} else {
						this.hud.registerHit(now, impact.damage, false, health.scoreValue, this.hud.combo);
						$.spawn(ImpactBurst.create([enemy.x, enemy.y, enemy.z]));
					}
					this.dmgNums.add([enemy.x, enemy.y + 2, enemy.z], impact.damage);
				}
			}
		}
	}
}

export function createTestromModule() {
	return {
		id: 'testrom',
		onBoot(world: World) {
			// Scene scaffold (ported from previous do_one_time_game_init)
			const cube = new Cube3D();
			const small = new SmallCube3D({ overrideTextureIndex: 1 });
			const small2 = new SmallCube3D({ overrideTextureIndex: 2 });
			const animatedMorphSphere = new AnimatedMorphSphere();
			world.spawn(new bclass(), new_vec3(100, 100, 1000));
			world.spawn(cube, new_vec3(0, 0, 0));
			world.spawn(small, new_vec3(5, 0, 0));
			world.spawn(small2, new_vec3(5, 5, 5));
			world.spawn(animatedMorphSphere, new_vec3(5, 5, 5));

			const cam1 = new CameraObject({ id: 'cam1' });
			cam1.camera.setAspect(world.gamewidth / world.gameheight);
			const cam2 = new CameraObject({ id: 'cam2' });
			cam2.camera.setAspect(world.gamewidth / world.gameheight);

			world.spawn(cam1, V3.of(0, 0, 0));
			// world.spawn(cam1, V3.of(-60, 48, 120));
			// cam1.camera.screenLook(1.7687161091476518, -1.418966871448069, -2.6349415504373304);
			world.spawn(cam2, V3.of(5, 12, 27));
			world.activeCameraId = cam1.id;

			const ambient = new AmbientLightObject({ color: [1.0, 1.0, 1.0], intensity: 0.2, id: 'amb' });
			const sun = new DirectionalLightObject({ color: [0.5, -1.0, -0.5], orientation: [1.0, 1.0, 1.0], intensity: 1, id: 'sun' });
			const extraSun = new DirectionalLightObject({ color: [-0.5, -1.0, 0.5], orientation: [1.0, 1.0, 1.0], intensity: 1, id: 'extraSun' });
			const lamp = new PointLightObject({ light: { pos: [2.0, 2.0, 2.0], color: [1.0, 1.0, 1.0], range: 6.0, intensity: 2, id: 'lamp' } });

			world.spawn(ambient);
			world.spawn(sun);
			world.spawn(extraSun);
			world.spawn(lamp);

			$.view.setSkybox({
				posX: null,
				negX: null,
				posY: null,
				// posX: BitmapId.skybox,
				// negX: BitmapId.skybox,
				// posY: BitmapId.skybox,
				negY: BitmapId.skybox,
				posZ: BitmapId.skybox,
				negZ: BitmapId.skybox,
			});

			world.spawn(new CameraController({ cams: [cam1, cam2] }));

			return;

			// ===== Rail shooter demo scaffold =====
			// Simple S-curve forward rail reminiscent of an urban fly-through
			// Extended weaving rail path: dips between towers then rises above skyline
			const railDef = {
				points: [
					{ x: -40, y: 14, z: 80, t: 0 },
					{ x: -25, y: 10, z: 48 }, // descend into streets
					{ x: -10, y: 12, z: 24 },
					{ x: 0, y: 18, z: 0 }, // climb slightly
					{ x: 18, y: 9, z: -26 }, // dive again between blocks
					{ x: 32, y: 22, z: -52 }, // rapid climb for skyline overview
					{ x: 46, y: 28, z: -78 },
					{ x: 60, y: 18, z: -104 }, // descend
					{ x: 78, y: 24, z: -132 },
					{ x: 92, y: 32, z: -160, t: 1 } // high vantage
				],
				events: [
					{ time: 0.05, name: 'spawn.enemyWave', data: { count: 3, spread: 6 } },
					{ time: 0.12, name: 'camera.fovPulse', data: { delta: 12, duration: 0.6, curve: 'easeOutBack' } },
					{ time: 0.15, name: 'spawn.enemyWave', data: { count: 4, spread: 8 } },
					{ time: 0.25, name: 'camera.shake', data: { amp: 0.4, freq: 22, duration: 0.5 } },
					{ time: 0.32, name: 'spawn.enemyWave', data: { count: 5, spread: 10 } },
					{ time: 0.45, name: 'camera.fovPulse', data: { delta: 8, duration: 0.4, curve: 'easeInOutQuad' } },
					{ time: 0.55, name: 'spawn.enemyBoss', data: { size: 2.5 } },
					{ time: 0.70, name: 'camera.shake', data: { amp: 0.6, freq: 18, duration: 0.6 } },
					{ time: 0.78, name: 'spawn.enemyWave', data: { count: 6, spread: 12 } },
					{ time: 0.90, name: 'camera.fovPulse', data: { delta: 15, duration: 0.5, curve: 'easeOutQuad' } }
				]
			};

			const rail = CatmullRomPath.fromJSON(railDef);
			const runner = new PathRunner(rail, { playback: 'clamp', distanceMode: false });
			// Populate multi-silhouette deterministic cityscape around the rail for motion parallax
			spawnSimpleCity(rail, {
				seed: 'demo-city-v2',
				steps: 240,
				debugLog: false,
				worldScale: 6,
				silhouettes: [
					// Immediate showcase towers right at the start so user always sees scale
					{ uStart: -0.02, uEnd: 0.05, lateralSpan: 90, minHeight: 80, maxHeight: 160, density: 0.75, gridSize: 12, footprintMinFactor: 0.50, footprintMaxFactor: 0.75 },
					// Peripheral sprawl
					{ uStart: 0.0, uEnd: 0.18, lateralSpan: 120, minHeight: 10, maxHeight: 40, density: 0.50, gridSize: 14, footprintMinFactor: 0.55, footprintMaxFactor: 0.85 },
					// Approaching mid-rise
					{ uStart: 0.18, uEnd: 0.42, lateralSpan: 160, minHeight: 18, maxHeight: 70, density: 0.60, gridSize: 14, footprintMinFactor: 0.50, footprintMaxFactor: 0.80 },
					// Dense downtown core
					{ uStart: 0.42, uEnd: 0.75, lateralSpan: 220, minHeight: 30, maxHeight: 140, density: 0.65, gridSize: 16, footprintMinFactor: 0.45, footprintMaxFactor: 0.75 },
					// Transition to high plateau towers
					{ uStart: 0.75, uEnd: 0.90, lateralSpan: 250, minHeight: 50, maxHeight: 180, density: 0.60, gridSize: 18, footprintMinFactor: 0.40, footprintMaxFactor: 0.70 },
					// Outskirts taper
					{ uStart: 0.90, uEnd: 1.05, lateralSpan: 160, minHeight: 15, maxHeight: 60, density: 0.40, gridSize: 14, footprintMinFactor: 0.55, footprintMaxFactor: 0.80 },
				],
			});
			runner.speed = 0.0; // unused in deterministic playback
			const activeCam = cam1; // bind primary camera to rail
			// Deterministic progression (manual) across 24s
			const totalDuration = 24;
			const elapsedRef = { value: 0 };

			// EventTimeline drives events & ranged camera effects keyed to path progress
			const eventTimeline = new EventTimeline({ mode: 'u' });
			for (const ev of railDef.events) eventTimeline.addInstant({ u: ev.time, name: ev.name, data: ev.data });
			const baseFov = activeCam.camera.fovDeg;
			eventTimeline.addRange({ startU: 0, endU: 1, update: (tn) => { const breathe = Math.sin(tn * Math.PI * 2 * 1.2) * 0.5; activeCam.camera.fovDeg = baseFov + breathe; activeCam.camera.markDirty(); }, type: 'camera.fovPulse' });
			// Bind camera to path with look-ahead + auto-rotation
			const camBinder = new CameraPathBinder(runner, activeCam, { autoRotate: true, lookAheadU: 0.02 });
			// Hook timeline camera events
			eventTimeline.on('camera.fovPulse', (_event, _emitter, payload) => camBinder.startFovPulse(payload), this);
			eventTimeline.on('camera.shake', (_event, _emitter, payload) => camBinder.startShake(payload), this);

			// Reticle & bullets setup
			const reticle = new Reticle();
			$.spawn(reticle, new_vec3(0, 0, 0));
			const bullets = new BulletManager();
			const dmgNums = new DamageNumberManager();
			$.spawn(bullets);
			const hud = new RailShooterHUD();
			$.spawn(hud);
			let bossObjId: string | null = null; hud.bossId = bossObjId;

			// Wave manager listens to rail spawn events
			const waves = new WaveManager(eventTimeline);
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
					$.spawn(cube, new_vec3(px, py, pz));
					cube.addComponent(new PhysicsDescriptorComponent({ parentid: cube.id, shape: { kind: 'aabb', halfExtents: new_vec3(0.6, 0.6, 0.6) }, mass: 1, restitution: 0.3, friction: 0.4 }));
					cube.addComponent(new EnemyHealthComponent({ parentid: cube.id, hp: 30, maxHp: 25 }));
				}
			});
			waves.onSpawn('spawn.enemyBoss', (data) => {
				const size = data?.size ?? 3;
				const boss = new PhysDynamicCube(size);
				const s = runner.sample();
				$.spawn(boss, new_vec3(s.p.x, s.p.y + 4, s.p.z));
				boss.addComponent(new PhysicsDescriptorComponent({ parentid: boss.id, shape: { kind: 'aabb', halfExtents: new_vec3(size, size, size) }, mass: 5, restitution: 0.2, friction: 0.5 }));
				boss.addComponent(new EnemyHealthComponent({ parentid: boss.id, hp: 300, maxHp: 1000, boss: true }));
				bossObjId = boss.id; hud.bossId = bossObjId;
			});

			// instantiate the top-level driver and inject runtime dependencies
			$.spawn(new RailDemoDriver({
				id: 'railDriver',
				runner,
				eventTimeline,
				camBinder,
				activeCam,
				reticle,
				bullets,
				hud,
				dmgNums,
				totalDuration,
				elapsedRef
			}));

		} // end onBoot
	}; // end returned module object
} // end createTestromModule
