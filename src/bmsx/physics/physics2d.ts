import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { $ } from '../core/engine_core';
import type { World } from '../core/world';
import { Collision2DSystem } from '../ecs/overlap2d_system';

type PhysicsBodyOptions = {
	mass?: number;
	restitution?: number;
	gravityScale?: number;
	maxSpeed?: number;
	isStatic?: boolean;
};

type PhysicsBodyState = {
	id: string;
	vx: number;
	vy: number;
	invMass: number;
	restitution: number;
	gravityScale: number;
	maxSpeed: number;
	isStatic: boolean;
};

type ColliderState = {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
};

export type Physics2DBodyStateSnapshot = {
	id: string;
	vx: number;
	vy: number;
	invMass: number;
	restitution: number;
	gravityScale: number;
	maxSpeed: number;
	isStatic: boolean;
};

export type Physics2DSerializedState = {
	gravity: number;
	bodies: Physics2DBodyStateSnapshot[];
};

export type Physics2DColliderContact = {
	normalX: number;
	normalY: number;
	depth: number;
};

export type Physics2DColliderAdapter = {
	setPosition(id: string, centerX: number, centerY: number): void;
	contact(aId: string, bId: string): Physics2DColliderContact;
	getState(id: string): { centerX: number; centerY: number; width: number; height: number };
};

export class Physics2DManager {
	private colliders: Physics2DColliderAdapter = null;
	private readonly bodies = new Map<string, PhysicsBodyState>();
	private readonly staticIds: Set<string> = new Set();
	private gravity = 0;

	public bindColliders(colliders: Physics2DColliderAdapter): void {
		this.colliders = colliders;
	}

	public clear(): void {
		this.bodies.clear();
		this.staticIds.clear();
	}

	public setGravity(value: number): void {
		if (!Number.isFinite(value)) {
		throw new Error('[Physics2DManager] Gravity must be a finite number.');
		}
		this.gravity = value;
	}

	public ensureBody(id: string, options: PhysicsBodyOptions = {}): PhysicsBodyState {
		if (!this.colliders) {
			throw new Error('[Physics2DManager] Collider adapter not bound.');
		}
		const isStatic = options.isStatic ?? false;
		const mass = options.mass ?? (isStatic ? Infinity : 1);
		if (mass <= 0) {
			throw new Error('[Physics2DManager] Mass must be positive.');
		}
		const restitution = options.restitution ?? 1;
		if (restitution < 0) {
			throw new Error('[Physics2DManager] Restitution must be non-negative.');
		}
		const gravityScale = options.gravityScale ?? 0;
		if (!Number.isFinite(gravityScale)) {
			throw new Error('[Physics2DManager] Gravity scale must be finite.');
		}
		const maxSpeed = options.maxSpeed ;
		if (maxSpeed !== null && maxSpeed <= 0) {
			throw new Error('[Physics2DManager] Max speed must be positive when provided.');
		}
		let body = this.bodies.get(id);
		if (!body) {
			body = {
				id,
				vx: 0,
				vy: 0,
				invMass: isStatic ? 0 : 1 / mass,
				restitution,
				gravityScale,
				maxSpeed,
				isStatic,
			};
			this.bodies.set(id, body);
		} else {
			body.invMass = isStatic ? 0 : 1 / mass;
			body.restitution = restitution;
			body.gravityScale = gravityScale;
			body.maxSpeed = maxSpeed;
			body.isStatic = isStatic;
		}
		if (isStatic) this.staticIds.add(id);
		else this.staticIds.delete(id);
		return body;
	}

	public removeBody(id: string): void {
		this.bodies.delete(id);
		this.staticIds.delete(id);
	}

	public hasBody(id: string): boolean {
		return this.bodies.has(id);
	}

	public setVelocity(id: string, vx: number, vy: number): void {
		const body = this.bodies.get(id);
		if (!body) {
			throw new Error(`[Physics2DManager] Physics body '${id}' not found.`);
		}
		if (body.isStatic) return;
		if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
			throw new Error('[Physics2DManager] Velocity components must be finite.');
		}
		body.vx = vx;
		body.vy = vy;
	}

	public getVelocity(id: string): { vx: number; vy: number } {
		const body = this.bodies.get(id);
		if (!body) {
			throw new Error(`[Physics2DManager] Physics body '${id}' not found.`);
		}
		return { vx: body.vx, vy: body.vy };
	}

	public setGravityScale(id: string, scale: number): void {
		const body = this.bodies.get(id);
		if (!body) {
			throw new Error(`[Physics2DManager] Physics body '${id}' not found.`);
		}
		if (!Number.isFinite(scale)) {
			throw new Error('[Physics2DManager] Gravity scale must be a finite number.');
		}
		body.gravityScale = scale;
	}

	public step(deltaSeconds: number): void {
		if (!this.colliders) return;
		if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return;
		const bodies = Array.from(this.bodies.values());
		if (bodies.length === 0) return;
		 Collision2DSystem.rebuildIndex($.world);
		// Temporary debug logging for movement investigation
		// if (bodies.length && !this.debugPrinted) {
		// 	console.log('[Physics2D] step', bodies[0]);
		// 	this.debugPrinted = true;
		// }

		for (const body of bodies) {
			if (body.isStatic) continue;
			body.vy += this.gravity * body.gravityScale * deltaSeconds;
			if (body.maxSpeed !== null) {
				const speedSq = body.vx * body.vx + body.vy * body.vy;
				const maxSq = body.maxSpeed * body.maxSpeed;
				if (speedSq > maxSq) {
					const ratio = body.maxSpeed / Math.sqrt(speedSq);
					body.vx *= ratio;
					body.vy *= ratio;
				}
			}
			const state = this.getColliderState(body.id);
			const newCenterX = state.centerX + body.vx * deltaSeconds;
			const newCenterY = state.centerY + body.vy * deltaSeconds;
			this.colliders.setPosition(body.id, newCenterX, newCenterY);
		}

		const staticBodies: PhysicsBodyState[] = bodies.filter(body => body.isStatic);
		const dynamicBodies: PhysicsBodyState[] = bodies.filter(body => !body.isStatic);

		for (const body of dynamicBodies) {
			for (const staticBody of staticBodies) {
				this.resolveCollision(body, staticBody);
			}
		}

		for (let i = 0; i < dynamicBodies.length - 1; i++) {
			const a = dynamicBodies[i];
			for (let j = i + 1; j < dynamicBodies.length; j++) {
				this.resolveCollision(a, dynamicBodies[j]);
			}
		}
	}

	public getCenter(id: string): { x: number; y: number } {
		try {
			const state = this.getColliderState(id);
			return { x: state.centerX, y: state.centerY };
		} catch {
			return null;
		}
	}

	private getColliderState(id: string): ColliderState {
		if (!this.colliders) {
			throw new Error('[Physics2DManager] Collider adapter not bound.');
		}
		return this.colliders.getState(id);
	}

	private resolveCollision(a: PhysicsBodyState, b: PhysicsBodyState): void {
		if (!this.colliders) return;
		let contact = this.colliders.contact(a.id, b.id);
		if (!contact) {
			const fallbackContact = this.computeAabbContact(a.id, b.id);
			if (!fallbackContact) return;
			contact = fallbackContact;
		}
		// debug logging removed
		let nx = contact.normalX;
		let ny = contact.normalY;
		const normalLen = Math.hypot(nx, ny);
		if (normalLen === 0) {
			const fallback = this.normalFromCenters(a.id, b.id);
			if (!fallback) return;
			nx = fallback.x;
			ny = fallback.y;
		} else {
			nx /= normalLen;
			ny /= normalLen;
		}

		const relativeVx = a.vx - (b.isStatic ? 0 : b.vx);
		const relativeVy = a.vy - (b.isStatic ? 0 : b.vy);
		let relVel = relativeVx * nx + relativeVy * ny;
		if (relVel > 0) {
			nx = -nx;
			ny = -ny;
			relVel = relativeVx * nx + relativeVy * ny;
		}
		if (relVel >= 0) return;

		const invMassSum = a.invMass + b.invMass;
		const restitution = Math.min(a.restitution, b.restitution);
		const impulseDenom = invMassSum > 0 ? invMassSum : 1;
		const impulse = -(1 + restitution) * relVel / impulseDenom;

		a.vx += impulse * nx * a.invMass;
		a.vy += impulse * ny * a.invMass;
		if (!b.isStatic) {
			b.vx -= impulse * nx * b.invMass;
			b.vy -= impulse * ny * b.invMass;
		}
		// debug logging removed

		let penetration = contact.depth ?? 0;
		if (!(penetration > 0)) {
			penetration = this.computeAabbPenetration(a.id, b.id, { x: nx, y: ny });
			if (!(penetration > 0)) return;
		}
		const correctionFactor = penetration / impulseDenom;
		this.translateAlongNormal(a.id, -correctionFactor * a.invMass * nx, -correctionFactor * a.invMass * ny);
		if (!b.isStatic) {
			this.translateAlongNormal(b.id, correctionFactor * b.invMass * nx, correctionFactor * b.invMass * ny);
		}
	}

	private computeAabbContact(aId: string, bId: string): Physics2DColliderContact {
		const a = this.getColliderState(aId);
		const b = this.getColliderState(bId);
		const ax0 = a.centerX - a.width / 2;
		const ax1 = a.centerX + a.width / 2;
		const ay0 = a.centerY - a.height / 2;
		const ay1 = a.centerY + a.height / 2;
		const bx0 = b.centerX - b.width / 2;
		const bx1 = b.centerX + b.width / 2;
		const by0 = b.centerY - b.height / 2;
		const by1 = b.centerY + b.height / 2;
		if (ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0) return null;
		const overlapX = Math.min(ax1, bx1) - Math.max(ax0, bx0);
		const overlapY = Math.min(ay1, by1) - Math.max(ay0, by0);
		if (!(overlapX > 0 && overlapY > 0)) return null;
		if (overlapX < overlapY) {
			const dir = a.centerX < b.centerX ? -1 : 1;
			return { normalX: dir, normalY: 0, depth: overlapX };
		}
		const dir = a.centerY < b.centerY ? -1 : 1;
		return { normalX: 0, normalY: dir, depth: overlapY };
	}

	private computeAabbPenetration(aId: string, bId: string, normal: { x: number; y: number }): number {
		const a = this.getColliderState(aId);
		const b = this.getColliderState(bId);
		const ax0 = a.centerX - a.width / 2;
		const ax1 = a.centerX + a.width / 2;
		const ay0 = a.centerY - a.height / 2;
		const ay1 = a.centerY + a.height / 2;
		const bx0 = b.centerX - b.width / 2;
		const bx1 = b.centerX + b.width / 2;
		const by0 = b.centerY - b.height / 2;
		const by1 = b.centerY + b.height / 2;
		if (ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0) return 0;
		const overlapX = Math.min(ax1, bx1) - Math.max(ax0, bx0);
		const overlapY = Math.min(ay1, by1) - Math.max(ay0, by0);
		const absNx = Math.abs(normal.x);
		const absNy = Math.abs(normal.y);
		if (absNx >= absNy) {
			return overlapX;
		}
		return overlapY;
	}

	private translateAlongNormal(id: string, offsetX: number, offsetY: number): void {
		if (!this.colliders) return;
		const state = this.getColliderState(id);
		const newCenterX = state.centerX + offsetX;
		const newCenterY = state.centerY + offsetY;
		this.colliders.setPosition(id, newCenterX, newCenterY);
	}

	private normalFromCenters(aId: string, bId: string): { x: number; y: number } {
		const a = this.getColliderState(aId);
		const b = this.getColliderState(bId);
		const dx = b.centerX - a.centerX;
		const dy = b.centerY - a.centerY;
		const lengthSq = dx * dx + dy * dy;
		if (lengthSq <= 0) return null;
		const invLen = 1 / Math.sqrt(lengthSq);
		return { x: dx * invLen, y: dy * invLen };
	}

	public snapshot(): Physics2DSerializedState {
		const bodies: Physics2DBodyStateSnapshot[] = [];
		for (const body of this.bodies.values()) {
			bodies.push({
				id: body.id,
				vx: body.vx,
				vy: body.vy,
				invMass: body.invMass,
				restitution: body.restitution,
				gravityScale: body.gravityScale,
				maxSpeed: body.maxSpeed ,
				isStatic: body.isStatic,
			});
		}
		return { gravity: this.gravity, bodies };
	}

	public restore(state: Physics2DSerializedState): void {
		this.bodies.clear();
		this.staticIds.clear();
		if (!state) {
			return;
		}
		if (Number.isFinite(state.gravity)) {
			this.gravity = state.gravity;
		}
		for (const body of state.bodies) {
			const entry: PhysicsBodyState = {
				id: body.id,
				vx: body.vx,
				vy: body.vy,
				invMass: body.invMass,
				restitution: body.restitution,
				gravityScale: body.gravityScale,
				maxSpeed: body.maxSpeed ,
				isStatic: body.isStatic,
			};
			this.bodies.set(body.id, entry);
			if (body.isStatic) {
				this.staticIds.add(body.id);
			}
		}
	}
}

export class Physics2DSystem extends ECSystem {
	constructor(private readonly physics: Physics2DManager, priority: number = 18) {
		super(TickGroup.Physics, priority);
	}

	public override update(_world: World): void {
		const deltaMs = $.deltatime;
		if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
		// Debug: confirm physics stepping
		// console.log('[Physics2DSystem] step', deltaMs, this.physics.debugBodyCount?.());
		this.physics.step(deltaMs / 1000);
	}
}
