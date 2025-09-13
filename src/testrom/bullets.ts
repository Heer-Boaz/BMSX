import { $, WorldObject, Pool, PhysicsWorld, type StateMachineBlueprint, build_fsm } from 'bmsx';
import { EnemyHealthComponent } from './enemyhealth';

interface Bullet { active: boolean; pos: [number, number, number]; prev: [number, number, number]; dir: [number, number, number]; speed: number; life: number; maxLife: number; damage: number; }

export interface BulletImpact { enemyId: string; damage: number; position: [number, number, number]; }

export class BulletManager extends WorldObject {
	@build_fsm()
	public static blueprint(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: BulletManager) { this.run(); },
				},
			},
		};
	}

	private pool: Pool<Bullet>;
	private impacts: BulletImpact[] = []; // consumed each frame by game logic
	spawn(p: [number, number, number], d: [number, number, number]) {
		const b = this.pool.acquire();
		if (!b) return; // pool exhausted but we keep it silent for now
		b.pos[0] = p[0]; b.pos[1] = p[1]; b.pos[2] = p[2];
		b.prev[0] = p[0]; b.prev[1] = p[1]; b.prev[2] = p[2];
		const L = Math.hypot(d[0], d[1], d[2]) || 1;
		b.dir[0] = d[0] / L; b.dir[1] = d[1] / L; b.dir[2] = d[2] / L;
	}

	popImpacts(): BulletImpact[] {
		const arr = this.impacts;
		this.impacts = [];
		return arr;
	}

	run(): void {
		const dt = $.deltaTime / 1000;
		const phys = $.get<PhysicsWorld>('physics_world');
		this.pool.forEachActive(b => {
			b.life += dt;
			if (b.life >= b.maxLife) { b.active = false; this.pool.release(b); return; }
			b.prev[0] = b.pos[0]; b.prev[1] = b.pos[1]; b.prev[2] = b.pos[2];
			b.pos[0] += b.dir[0] * b.speed * dt; b.pos[1] += b.dir[1] * b.speed * dt; b.pos[2] += b.dir[2] * b.speed * dt;
			if (phys) this.checkHitsSegment(b, phys);
		});
	}
	constructor(size = 64) {
		super({ id: 'bullets' });
		this.pool = new Pool<Bullet>({
			warm: size,
			onCreate: () => ({ active: false, pos: [0, 0, 0], prev: [0, 0, 0], dir: [0, 0, -1], speed: 90, life: 0, maxLife: 0.8, damage: 10 }),
			onReset: (b) => { b.active = true; b.life = 0; b.maxLife = 0.9; b.damage = 10; }
		});
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			this.pool.forEachActive(b => {
				const t = b.life / b.maxLife; const a = 1 - t;
				rc.submitParticle({ position: [b.pos[0], b.pos[1], b.pos[2]], size: 0.25, color: { r: 1, g: 0.9, b: 0.4, a } });
				rc.submitParticle({ position: [b.prev[0], b.prev[1], b.prev[2]], size: 0.15, color: { r: 1, g: 0.6, b: 0.2, a: a * 0.6 } });
			});
		});
	}
	
	private checkHitsSegment(b: Bullet, phys: PhysicsWorld) {
		const segFrom = b.prev, segTo = b.pos;
		const bodies = phys.getBodies();
		for (const body of bodies) {
			if (!body.invMass || body.isTrigger) continue;
			const wo = $.world.getWorldObject(body.userData);
			if (!wo) continue;
			const health = wo.getFirstComponent(EnemyHealthComponent);
			if (!health || health.dead) continue;
			if (this.segmentIntersectsBody(segFrom, segTo, body)) {
				health.applyDamage(b.damage);
				this.impacts.push({ enemyId: wo.id, damage: b.damage, position: [segTo[0], segTo[1], segTo[2]] });
				b.active = false; this.pool.release(b); // bullet consumed
				break;
			}
		}
	}
	private segmentIntersectsBody(a: [number, number, number], b: [number, number, number], body: any): boolean {
		const shape = body.shape; const pos = body.position;
		if (shape.kind === 'aabb') {
			// Ray/segment vs AABB slab method
			const hx = shape.halfExtents.x, hy = shape.halfExtents.y, hz = shape.halfExtents.z;
			const minx = pos.x - hx, maxx = pos.x + hx, miny = pos.y - hy, maxy = pos.y + hy, minz = pos.z - hz, maxz = pos.z + hz;
			const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			let tmin = 0, tmax = 1;
			const ax = (minx - a[0]) / (dx || 1e-9), bx = (maxx - a[0]) / (dx || 1e-9); const txmin = Math.min(ax, bx), txmax = Math.max(ax, bx); tmin = Math.max(tmin, txmin); tmax = Math.min(tmax, txmax); if (tmax < tmin) return false;
			const ay = (miny - a[1]) / (dy || 1e-9), byv = (maxy - a[1]) / (dy || 1e-9); const tymin = Math.min(ay, byv), tymax = Math.max(ay, byv); tmin = Math.max(tmin, tymin); tmax = Math.min(tmax, tymax); if (tmax < tmin) return false;
			const az = (minz - a[2]) / (dz || 1e-9), bzv = (maxz - a[2]) / (dz || 1e-9); const tzmin = Math.min(az, bzv), tzmax = Math.max(az, bzv); tmin = Math.max(tmin, tzmin); tmax = Math.min(tmax, tzmax); if (tmax < tmin) return false;
			return tmin <= 1 && tmax >= 0;
		} else { // sphere
			const r = shape.radius; const ocx = a[0] - pos.x, ocy = a[1] - pos.y, ocz = a[2] - pos.z; const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			const A = dx * dx + dy * dy + dz * dz; const B = 2 * (ocx * dx + ocy * dy + ocz * dz); const C = ocx * ocx + ocy * ocy + ocz * ocz - r * r; const disc = B * B - 4 * A * C; if (disc < 0) return false; const sqrt = Math.sqrt(disc); const t1 = (-B - sqrt) / (2 * A); const t2 = (-B + sqrt) / (2 * A); return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
		}
	}
	forEach(cb: (b: Bullet) => void) { this.pool.forEachActive(cb); }
}
