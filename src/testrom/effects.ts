import { $, WorldObject, Msx1Colors, Pool, PooledWorldObject, build_fsm, type StateMachineBlueprint } from 'bmsx';

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; r: number; g: number; b: number; a: number; size: number; grow: number; }

// === Particle effect pooling ===
// Nu via generieke PooledWorldObject (in core) i.p.v. lokale abstracte klasse.

export class MuzzleFlash extends PooledWorldObject {
	@build_fsm()
	public static blueprint(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: MuzzleFlash) { this.run(); },
				},
			},
		};
	}

	private p: P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 0.12, r: 1, g: 0.9, b: 0.4, a: 1, size: 1.2, grow: 4 };
	private static _pool = Pool.createLazy<MuzzleFlash>({
		onCreate: () => new MuzzleFlash(),
		onAcquire: (inst) => inst.prepareForReuse(),
		onReset: (inst) => inst.markActive(),
		lazyWarm: 12
	});
	private static get pool(): Pool<MuzzleFlash> { return this._pool.get(); }
	static create(pos: [number, number, number]): MuzzleFlash { const inst = this.pool.acquire() ?? new MuzzleFlash(); inst.reset(pos); return inst; }
	protected reset(pos: [number, number, number]): void {
		this.p.x = pos[0]; this.p.y = pos[1]; this.p.z = pos[2]; this.p.life = 0; this.p.max = 0.12; this.p.size = 1.2; this.p.a = 1;
	}
	run(): void { if (!this.active) return; const dt = $.deltatime_seconds; this.p.life += dt; if (this.p.life >= this.p.max) { this.active = false; MuzzleFlash.pool.release(this); return; } this.p.size += this.p.grow * dt; this.p.a = 1 - this.p.life / this.p.max; }
	constructor() { super({ id: 'muzzleFlash' }); this.getOrCreateCustomRenderer().add_producer(({ rc }) => { if (!this.active) return; rc.submit_particle({ position: [this.p.x, this.p.y, this.p.z], size: this.p.size, color: { r: this.p.r, g: this.p.g, b: this.p.b, a: this.p.a } }); }); }
}

export class ImpactBurst extends PooledWorldObject {
	@build_fsm()
	public static blueprint(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: ImpactBurst) { this.run(); },
				},
			},
		};
	}

	private ps: P[] = [];
	private static _pool = Pool.createLazy<ImpactBurst>({
		onCreate: () => new ImpactBurst(),
		onAcquire: (inst) => inst.prepareForReuse(),
		onReset: (inst) => inst.markActive(),
		lazyWarm: 8
	});
	private static get pool(): Pool<ImpactBurst> { return this._pool.get(); }
	static create(pos: [number, number, number]): ImpactBurst { const inst = this.pool.acquire() ?? new ImpactBurst(); inst.reset(pos); return inst; }
	protected reset(pos: [number, number, number]): void { this.ps.length = 0; for (let i = 0; i < 10; i++) { const th = Math.random() * Math.PI * 2; const ph = Math.random() * Math.PI; const sp = 3 + Math.random() * 4; this.ps.push({ x: pos[0], y: pos[1], z: pos[2], vx: Math.cos(th) * Math.sin(ph) * sp, vy: Math.cos(ph) * sp * 0.3, vz: Math.sin(th) * Math.sin(ph) * sp, life: 0, max: 0.5, r: 1, g: 0.6 + Math.random() * 0.3, b: 0.1, a: 1, size: 0.4, grow: -0.4 }); } }
	run(): void { if (!this.active) return; const dt = $.deltatime_seconds; let alive = false; for (const p of this.ps) { p.life += dt; if (p.life < p.max) alive = true; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 4 * dt; p.size = Math.max(0.05, p.size + p.grow * dt); p.a = 1 - p.life / p.max; } if (!alive) { this.active = false; ImpactBurst.pool.release(this); } }
	constructor() { super({ id: 'impactBurst' }); this.getOrCreateCustomRenderer().add_producer(({ rc }) => { if (!this.active) return; for (const p of this.ps) { if (p.life < p.max) rc.submit_particle({ position: [p.x, p.y, p.z], size: p.size, color: { r: p.r, g: p.g, b: p.b, a: p.a } }); } }); }
}

export class ExplosionEmitter extends PooledWorldObject {
		@build_fsm()
	public static blueprint(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: ExplosionEmitter) { this.run(); },
				},
			},
		};
	}

	private ps: P[] = [];
	private static _pool = Pool.createLazy<ExplosionEmitter>({
		onCreate: () => new ExplosionEmitter(),
		onAcquire: (inst) => inst.prepareForReuse(),
		onReset: (inst) => inst.markActive(),
		lazyWarm: 4
	});
	private static get pool(): Pool<ExplosionEmitter> { return this._pool.get(); }
	static create(pos: [number, number, number]): ExplosionEmitter { const inst = this.pool.acquire() ?? new ExplosionEmitter(); inst.reset(pos); return inst; }
	protected reset(pos: [number, number, number]): void { this.ps.length = 0; for (let i = 0; i < 30; i++) { const th = Math.random() * Math.PI * 2; const ph = Math.random() * Math.PI; const sp = 2 + Math.random() * 6; this.ps.push({ x: pos[0], y: pos[1], z: pos[2], vx: Math.cos(th) * Math.sin(ph) * sp, vy: Math.cos(ph) * sp, vz: Math.sin(th) * Math.sin(ph) * sp, life: 0, max: 0.8, r: 1, g: 0.4 + Math.random() * 0.2, b: 0, a: 1, size: 0.6, grow: -0.5 }); } }
	run(): void { if (!this.active) return; const dt = $.deltatime_seconds; let alive = false; for (const p of this.ps) { p.life += dt; if (p.life < p.max) alive = true; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 6 * dt; p.size = Math.max(0.05, p.size + p.grow * dt); p.a = 1 - p.life / p.max; } if (!alive) { this.active = false; ExplosionEmitter.pool.release(this); } }
	constructor() { super({ id: 'explosionEmitter' }); this.getOrCreateCustomRenderer().add_producer(({ rc }) => { if (!this.active) return; for (const p of this.ps) { if (p.life < p.max) rc.submit_particle({ position: [p.x, p.y, p.z], size: p.size, color: { r: p.r, g: p.g, b: p.b, a: p.a } }); } }); }
}

interface DN { active: boolean; txt: string; x: number; y: number; z: number; vy: number; life: number; max: number; }
export class DamageNumberManager extends WorldObject {
		@build_fsm()
	public static blueprint(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: DamageNumberManager) { this.run(); },
				},
			},
		};
	}

	private pool = new Pool<DN>({
		warm: 32,
		onCreate: () => ({ active: false, txt: '', x: 0, y: 0, z: 0, vy: 0, life: 0, max: 0 }),
		onReset: (d) => { d.active = true; d.life = 0; d.max = 0.8; d.vy = 2; }
	});
	add(pos: [number, number, number], dmg: number) {
		const d = this.pool.acquire(); if (!d) return;
		d.txt = `${dmg}`; d.x = pos[0]; d.y = pos[1]; d.z = pos[2];
	}
	run(): void {
		const dt = $.deltatime_seconds;
		this.pool.forEachActive(d => {
			d.life += dt; d.y += d.vy * dt;
			if (d.life >= d.max) { d.active = false; this.pool.release(d); }
		});
	}
	constructor() { super({ id: 'damageNums' }); this.getOrCreateCustomRenderer().add_producer(({ rc }) => {
		const cam = $.world.activeCamera3D; if (!cam) return;
		const m = cam.viewProjection as Float32Array;
		const gw = $.world.gamewidth, gh = $.world.gameheight;
		this.pool.forEachActive(d => {
			const x = d.x, y = d.y, z = d.z;
			const cx = x * m[0] + y * m[4] + z * m[8] + m[12];
			const cy = x * m[1] + y * m[5] + z * m[9] + m[13];
			const cw = x * m[3] + y * m[7] + z * m[11] + m[15];
			if (cw <= 0) return;
			const nx = cx / cw, ny = cy / cw;
			const sx = Math.round((nx * 0.5 + 0.5) * gw);
			const sy = Math.round((-ny * 0.5 + 0.5) * gh);
			rc.submit_glyphs( { x: sx, y: sy, glyphs: d.txt, color: Msx1Colors[8] });
		});
	}); }
}
