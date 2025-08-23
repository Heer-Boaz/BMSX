import { new_vec3 } from '../core/utils';
import type { vec3 } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { BroadphasePair, BroadphaseSAP } from './broadphase';
import { ContactSolver } from './contactsolver';
import { Contact, Narrowphase } from './narrowphase';
import { PhysicsBody, PhysicsBodyDesc } from './physicsbody';

export interface PhysicsWorldOptions {
    gravity?: vec3; // default (0, 300, 0) in screen coords (tune later)
    maxSubSteps?: number;
    fixedTimeStep?: number; // ms - same as game update for now
}

export interface CollisionEvent { a: PhysicsBody; b: PhysicsBody; point: vec3; normal: vec3; type: 'enter' | 'stay' | 'exit'; }

export interface TriggerEvent extends CollisionEvent { }

export interface RaycastHit { body: PhysicsBody; point: vec3; normal: vec3; distance: number; }
export interface ShapeCastHit extends RaycastHit { time: number; }

@excludeclassfromsavegame
export class PhysicsWorld {
    id = 'physics_world';
    registrypersistent: true = true; // kept pattern from existing codebase
    private bodies: PhysicsBody[] = [];
    private broadphase = new BroadphaseSAP();
    private narrow = new Narrowphase();
    public solver = new ContactSolver();
    private pairs: BroadphasePair[] = [];
    private contacts: Contact[] = [];
    private previousFramePairs = new Set<number>();
    // Composite pair storage (sparse) indexed by packed 32-bit id (high 16 = max id, low 16 = min id)
    private pairBodiesA: PhysicsBody[] = [];
    private pairBodiesB: PhysicsBody[] = [];
    private pairActive: boolean[] = [];
    private gravity: vec3;
    // Temp vectors
    private tmpPoint = new_vec3(0, 0, 0);
    // Debug gizmo hook subscribers
    private gizmoDrawers: ((world: PhysicsWorld) => void)[] = [];
    // Event batching
    public lastEnterEvents: CollisionEvent[] = [];
    public lastStayEvents: CollisionEvent[] = [];
    public lastExitEvents: CollisionEvent[] = [];
    // CCD threshold
    fastSphereSpeed = 800;
    // Sleeping params
    sleepVelocityThreshold = 5;
    sleepFramesThreshold = 30;
    private sleepCounters: number[] = []; // index by body.id (sparse) faster than Map
    private firstBroadphaseBuilt = false;
    // Performance instrumentation (lightweight, optional usage)
    metrics = {
        pairs: 0,
        narrowTests: 0,
        contacts: 0,
        solvedContacts: 0,
        sleeping: 0,
        frameMs: 0,
        phase: { integrate: 0, broadphase: 0, narrow: 0, solve: 0, events: 0, ccd: 0 }
    };
    enableMetrics = false;
    private _tIntegrate = 0; private _tBroad = 0; private _tNarrow = 0; private _tSolve = 0; private _tEvents = 0; private _tCCD = 0;
    movementEpsilon = 0.0001; // threshold to mark dirty in broadphase
    autoTuneMovementEpsilon = true;
    autoTuneBroadphase = true;
    private avgSpeedSq = 0; // smoothed running average
    // Simple continuous collision prevention for fast-moving AABBs (thin floor tunneling)
    enableSimpleAABBTunnelingFix = true;
    // Extra safety positional fix pass for static-vs-dynamic after solver
    enablePostSolveStaticSeparation = true;
    // Debug
    logFirstFramesContacts = true;
    private _debugFrameCounter = 0;
    private hudElement?: HTMLElement;
    private hudParent?: HTMLElement;
    private hudLastUpdate = 0;
    private maxBodyId = 0;
    private compactCheckCounter = 0;
    hudAutoHide = true;
    private hudCollapsed = false;

    constructor(opts: PhysicsWorldOptions = {}) {
        this.gravity = opts.gravity ?? new_vec3(0, 300, 0);
    }

    // --- Bootstrap helpers ---
    static ensure(opts: PhysicsWorldOptions = {}): PhysicsWorld {
        let w = $.get<PhysicsWorld>('physics_world');
        if (!w) {
            w = new PhysicsWorld(opts);
            $.register(w);
        }
        return w;
    }

    /** Dispose existing world (if any) and create a fresh one; bodies/components must recreate runtime data afterwards */
    static rebuild(opts: PhysicsWorldOptions = {}): PhysicsWorld {
        let existing = $.get<PhysicsWorld>('physics_world');
        if (existing) existing.dispose();
        const w = new PhysicsWorld(opts);
        $.register(w);
        return w;
    }

    // --- Runtime tuning helpers (debug) ---
    /** Adjust world gravity at runtime (debug / scripting). Referenced externally by design. */
    public setGravity(g: vec3) { this.gravity = g; }
    /** Retrieve current gravity (used in diagnostics & potential gameplay queries). */
    public getGravity(): vec3 { return this.gravity; }
    /** Enable/disable sleeping heuristics quickly for debugging visibility */
    public setSleepingEnabled(on: boolean) {
        if (on) return; // disabling only for now (re-enabling reuses original thresholds)
        this.sleepVelocityThreshold = -1; // negative => never sleeps (speedSq < negative never true)
        for (const b of this.bodies) b.asleep = false;
    }

    dispose(): void {
        this.bodies.length = 0;
        this.previousFramePairs.clear();
        this.pairBodiesA.length = this.pairBodiesB.length = this.pairActive.length = 0;
    }

    addBody(desc: PhysicsBodyDesc): PhysicsBody {
        const b = new PhysicsBody(desc);
        this.bodies.push(b);
        this.broadphase.addBody(b);
        if (b.id > this.maxBodyId) this.maxBodyId = b.id;
        console.log('[PhysicsDebug] Added body:', b.id, 'type:', b.type, 'invMass:', b.invMass, 'shape:', b.shape.kind, 'position:', b.position, 'layer:', b.layer, 'mask:', b.mask);
        return b;
    }

    removeBody(body: PhysicsBody) {
        const idx = this.bodies.indexOf(body);
        if (idx >= 0) this.bodies.splice(idx, 1);
        this.broadphase.removeBody(body);
        if (++this.compactCheckCounter % 120 === 0) { // every ~2s at 60fps
            if (this.maxBodyId > this.bodies.length * 4) {
                this.resetPairTracking();
                this.maxBodyId = 0; for (const b2 of this.bodies) if (b2.id > this.maxBodyId) this.maxBodyId = b2.id;
            }
        }
    }

    applyForce(body: PhysicsBody, fx: number, fy: number, fz: number) {
        if (body.invMass === 0) return;
        body.applyForce({ x: fx, y: fy, z: fz });
        body.asleep = false; // auto-wake
        this.broadphase.markDirty(body);
    }

    /** Mark a body as needing broadphase AABB update (useful for position changes) */
    markBodyDirty(body: PhysicsBody) {
        this.broadphase.markDirty(body);
        if (body.invMass !== 0) {
            body.asleep = false; // wake dynamic bodies
        }
    }

    step(dtMs: number, emitCollision?: (e: CollisionEvent) => void) {
        const startFrame = this.enableMetrics ? performance.now() : 0;
        const dt = dtMs / 1000;
        this.lastEnterEvents.length = 0;
        this.lastStayEvents.length = 0;
        this.lastExitEvents.length = 0;
        if (this.enableMetrics) { this.metrics.sleeping = 0; }

        // Integrate
        const t0 = this.enableMetrics ? performance.now() : 0;
        let sumSpeedSq = 0; let dynCount = 0;
        const bodies = this.bodies;
        for (let i = 0, n = bodies.length; i < n; ++i) {
            const b = bodies[i];
            if (b.type === 'dynamic' && b.invMass !== 0) {
                b.velocity.x += (this.gravity.x + b.forceAccum.x * b.invMass) * dt;
                b.velocity.y += (this.gravity.y + b.forceAccum.y * b.invMass) * dt;
                b.velocity.z += (this.gravity.z + b.forceAccum.z * b.invMass) * dt;
            } else if (b.type === 'kinematic') {
                // Kinematic: user/script drives velocity; ignore gravity but still integrate
                b.velocity.x += (b.forceAccum.x * (b.invMass || 0)) * dt;
                b.velocity.y += (b.forceAccum.y * (b.invMass || 0)) * dt;
                b.velocity.z += (b.forceAccum.z * (b.invMass || 0)) * dt;
            }
            b.previousPosition.x = b.position.x; b.previousPosition.y = b.position.y; b.previousPosition.z = b.position.z;
            if (b.type === 'dynamic' || b.type === 'kinematic') {
                b.position.x += b.velocity.x * dt; b.position.y += b.velocity.y * dt; b.position.z += b.velocity.z * dt;
                // --- Minimal CCD for fast downward moving AABB boxes vs static AABB floors/walls ---
                if (b.type === 'dynamic' && this.enableSimpleAABBTunnelingFix && b.shape.kind === 'aabb' && b.velocity.y < 0) {
                    const bh = b.shape.halfExtents;
                    const newBottom = b.position.y - bh.y;
                    const prevBottom = b.previousPosition.y - bh.y;
                    // Only if we moved a significant distance this frame (potential tunneling)
                    if (newBottom < prevBottom - this.movementEpsilon) {
                        for (let j = 0; j < bodies.length; j++) {
                            if (i === j) continue;
                            const o = bodies[j];
                            if (o.invMass !== 0) continue; // only static surfaces
                            if (o.shape.kind !== 'aabb') continue; // keep it cheap (sphere handled elsewhere)
                            const oh = o.shape.halfExtents;
                            const otherTop = o.position.y + oh.y;
                            // Was above last frame & now penetrated below top plane
                            if (prevBottom >= otherTop && newBottom <= otherTop) {
                                // Check lateral overlap X/Z to confirm we crossed within footprint
                                const overlapX = Math.abs(b.position.x - o.position.x) <= (bh.x + oh.x);
                                const overlapZ = Math.abs(b.position.z - o.position.z) <= (bh.z + oh.z);
                                if (overlapX && overlapZ) {
                                    // Snap to surface & zero vertical velocity
                                    b.position.y = otherTop + bh.y;
                                    b.velocity.y = 0;
                                    // Wake body (it may generate a contact next narrowphase pass)
                                    b.asleep = false;
                                    break; // resolved; stop checking others
                                }
                            }
                        }
                    }
                }
            }
            b.clearForces();
            if (b.type === 'dynamic') {
                const speedSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y + b.velocity.z * b.velocity.z;
                sumSpeedSq += speedSq; dynCount++;
                if (speedSq < this.sleepVelocityThreshold * this.sleepVelocityThreshold) {
                    const next = ((this.sleepCounters[b.id] ?? 0) + 1);
                    this.sleepCounters[b.id] = next;
                    if (next > this.sleepFramesThreshold) { b.asleep = true; if (this.enableMetrics) this.metrics.sleeping++; }
                } else {
                    this.sleepCounters[b.id] = 0;
                    b.asleep = false;
                }
            }
        }
        if (this.enableMetrics) this._tIntegrate = performance.now() - t0;
        if (this.autoTuneMovementEpsilon && dynCount) {
            const avg = sumSpeedSq / dynCount;
            this.avgSpeedSq = this.avgSpeedSq === 0 ? avg : this.avgSpeedSq * 0.9 + avg * 0.1;
            const target = Math.min(Math.max(this.avgSpeedSq * 0.001, 1e-6), 0.05);
            this.movementEpsilon = this.movementEpsilon * 0.9 + target * 0.1;
        }

        // Broadphase incremental update
        const tb0 = this.enableMetrics ? performance.now() : 0;
        if (!this.firstBroadphaseBuilt) {
            this.broadphase.rebuild(this.bodies);
            this.firstBroadphaseBuilt = true;
        } else {
            for (const b of this.bodies) {
                if (!b.asleep) {
                    const vx = b.velocity.x, vy = b.velocity.y, vz = b.velocity.z;
                    // Mark all bodies dirty for first few frames to ensure correct AABB setup
                    if (this._debugFrameCounter < 10 || (vx * vx + vy * vy + vz * vz) > this.movementEpsilon) {
                        this.broadphase.markDirty(b);
                    }
                }
            }
            this.broadphase.update();
        }
        this.broadphase.computePairs(this.pairs);
        if (this.enableMetrics) this._tBroad = performance.now() - tb0;
        if (this.enableMetrics) this.metrics.pairs = this.pairs.length;

        console.log('[PhysicsDebug] Step frame, pairs found:', this.pairs.length);
        if (this.pairs.length > 0 && this._debugFrameCounter < 3) {
            console.log('[PhysicsDebug] Sample pairs:');
            for (let i = 0; i < Math.min(3, this.pairs.length); i++) {
                const p = this.pairs[i];
                console.log('  Pair', i, ':', p.a.id, '(', p.a.type, p.a.shape.kind, ') <->', p.b.id, '(', p.b.type, p.b.shape.kind, ')');
            }
        }

        // Narrowphase
        this.contacts.length = 0;
        // Reset contact pool for reuse (avoid GC churn)
        this.narrow.resetPool();
        const tn0 = this.enableMetrics ? performance.now() : 0;
        let narrowTests = 0;
        const toWake: PhysicsBody[] = [];
        for (const p of this.pairs) {
            const layerMaskCheck = ((p.a.layer & p.b.mask) && (p.b.layer & p.a.mask));
            if (!layerMaskCheck) {
                if (this._debugFrameCounter < 3) {
                    console.log('[PhysicsDebug] Pair filtered out by layer/mask:', p.a.id, '(layer:', p.a.layer, 'mask:', p.a.mask, ') <->', p.b.id, '(layer:', p.b.layer, 'mask:', p.b.mask, ')');
                }
                continue;
            }
            if (p.a.invMass === 0 && p.b.invMass === 0 && !p.a.isTrigger && !p.b.isTrigger) {
                if (this._debugFrameCounter < 3) {
                    console.log('[PhysicsDebug] Pair filtered out (both static):', p.a.id, '<->', p.b.id);
                }
                continue;
            }
            if (p.a.asleep && p.b.asleep) {
                if (this._debugFrameCounter < 3) {
                    console.log('[PhysicsDebug] Pair filtered out (both asleep):', p.a.id, '<->', p.b.id);
                }
                continue;
            }
            if (p.a.asleep && !p.b.asleep) toWake.push(p.a); else if (p.b.asleep && !p.a.asleep) toWake.push(p.b);
            const contactsBefore = this.contacts.length;
            this.narrow.collide(p.a, p.b, this.contacts);
            const contactsAfter = this.contacts.length;
            if (contactsAfter > contactsBefore && this._debugFrameCounter < 3) {
                console.log('[PhysicsDebug] Contact generated between', p.a.id, 'and', p.b.id, 'contacts:', contactsAfter - contactsBefore);
            }
            narrowTests++;
        }
        for (const b of toWake) b.asleep = false;
        if (this.enableMetrics) { this._tNarrow = performance.now() - tn0; this.metrics.narrowTests = narrowTests; }

        // Solve (allow multi-iteration)
        const ts0 = this.enableMetrics ? performance.now() : 0;
        const iters = this.solver.iterations ?? 1;
        if (this.contacts.length > 0) {
            console.log('[PhysicsDebug] Solving', this.contacts.length, 'contacts with', iters, 'iterations');
        }
        for (let i = 0; i < iters; i++) this.solver.solve(this.contacts);
        if (this.enableMetrics) { this._tSolve = performance.now() - ts0; this.metrics.solvedContacts = this.solver.lastSolvedContacts; this.metrics.contacts = this.contacts.length; }

        // Post-solve static separation safety: ensure no lingering penetration for static/dynamic
        if (this.enablePostSolveStaticSeparation && this.contacts.length) {
            for (const c of this.contacts) {
                const a = c.a, b = c.b;
                // If exactly one body is static (invMass==0) and the other dynamic, snap dynamic out along normal if still penetrating
                const onlyAStatic = a.invMass === 0 && b.invMass !== 0;
                const onlyBStatic = b.invMass === 0 && a.invMass !== 0;
                if (c.penetration > 0 && (onlyAStatic || onlyBStatic)) {
                    const dyn = onlyAStatic ? b : a;
                    const normal = c.normal;
                    // If dynamic ended up past the surface, move it back by remaining penetration *along normal*
                    // Recompute relative position along normal quickly
                    const rel = (dyn.position.x - (onlyAStatic ? a.position.x : b.position.x)) * normal.x +
                        (dyn.position.y - (onlyAStatic ? a.position.y : b.position.y)) * normal.y +
                        (dyn.position.z - (onlyAStatic ? a.position.z : b.position.z)) * normal.z;
                    if (rel < 0) { // dynamic is on wrong side
                        dyn.position.x -= normal.x * (c.penetration);
                        dyn.position.y -= normal.y * (c.penetration);
                        dyn.position.z -= normal.z * (c.penetration);
                        // Nullify velocity into surface
                        const vn = dyn.velocity.x * normal.x + dyn.velocity.y * normal.y + dyn.velocity.z * normal.z;
                        if (vn < 0) {
                            dyn.velocity.x -= normal.x * vn;
                            dyn.velocity.y -= normal.y * vn;
                            dyn.velocity.z -= normal.z * vn;
                        }
                    }
                }
            }
        }

        // Events
        if (emitCollision) {
            const te0 = this.enableMetrics ? performance.now() : 0;
            const currentPairs = new Set<number>();
            // Enter / stay
            for (const c of this.contacts) {
                const minId = c.a.id < c.b.id ? c.a.id : c.b.id;
                const maxId = c.a.id ^ minId ? c.a.id : c.b.id; // xor trick to get other id
                const packed = (maxId << 16) | minId;
                currentPairs.add(packed);
                if (!this.pairActive[packed]) {
                    this.pairActive[packed] = true;
                    this.pairBodiesA[packed] = c.a.id === minId ? c.a : c.b;
                    this.pairBodiesB[packed] = c.a.id === minId ? c.b : c.a;
                }
                const existed = this.previousFramePairs.has(packed);
                const type: CollisionEvent['type'] = existed ? 'stay' : 'enter';
                const evt = { a: c.a, b: c.b, point: c.point, normal: c.normal, type };
                if (type === 'enter') this.lastEnterEvents.push(evt); else this.lastStayEvents.push(evt);
                emitCollision(evt);
            }
            // Exits
            for (const prev of this.previousFramePairs) {
                if (!currentPairs.has(prev)) {
                    if (this.pairActive[prev]) {
                        const a = this.pairBodiesA[prev];
                        const b = this.pairBodiesB[prev];
                        if (a && b) {
                            const exitEvt = { a, b, point: a.position, normal: this.tmpPoint, type: 'exit' as const };
                            this.lastExitEvents.push(exitEvt);
                            emitCollision(exitEvt);
                        }
                        this.pairActive[prev] = false;
                        this.pairBodiesA[prev] = this.pairBodiesB[prev] = undefined as any;
                    }
                }
            }
            this.previousFramePairs = currentPairs;
            if (this.enableMetrics) this._tEvents = performance.now() - te0;
        }

        // CCD fast spheres
        const tc0 = this.enableMetrics ? performance.now() : 0;
        for (const b of this.bodies) {
            if (b.shape.kind === 'sphere') {
                const speedSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y + b.velocity.z * b.velocity.z;
                if (speedSq > this.fastSphereSpeed * this.fastSphereSpeed) this.sweepSphere(b, dt);
            }
        }
        if (this.enableMetrics) this._tCCD = performance.now() - tc0;

        // Debug gizmos
        if (this.gizmoDrawers.length) {
            for (const g of this.gizmoDrawers) g(this);
        }
        if (this.enableMetrics) {
            const end = performance.now();
            this.metrics.phase.integrate = this._tIntegrate;
            this.metrics.phase.broadphase = this._tBroad;
            this.metrics.phase.narrow = this._tNarrow;
            this.metrics.phase.solve = this._tSolve;
            this.metrics.phase.events = this._tEvents;
            this.metrics.phase.ccd = this._tCCD;
            this.metrics.frameMs = end - startFrame;
            if (this.autoTuneBroadphase) {
                const ratio = this.metrics.narrowTests / (this.metrics.pairs || 1);
                if (this.broadphase.yzPruneThreshold !== undefined) {
                    if (ratio > 0.85) this.broadphase.yzPruneThreshold = 1e9; else this.broadphase.yzPruneThreshold = 0;
                }
            }
        }
        if (this.logFirstFramesContacts && this._debugFrameCounter < 10) {
            console.log('[PhysDbg]', 'frame', this._debugFrameCounter, 'pairs', this.pairs.length, 'contacts', this.contacts.length);
            if (this.contacts.length) {
                const sample = this.contacts[0];
                console.log('[PhysDbg] sample contact', { pen: sample.penetration, normal: sample.normal, a: sample.a.id, b: sample.b.id });
            }
            this._debugFrameCounter++;
        }
        if (this.hudElement && (performance.now() - this.hudLastUpdate) > 100) {
            this.hudLastUpdate = performance.now();
            const m = this.metrics;
            if (!this.hudCollapsed) {
                this.hudElement.textContent = `Physics\nframe ${m.frameMs.toFixed(2)} ms\nint ${m.phase.integrate.toFixed(2)} | broad ${m.phase.broadphase.toFixed(2)} | nar ${m.phase.narrow.toFixed(2)} | sol ${m.phase.solve.toFixed(2)} | evt ${m.phase.events.toFixed(2)} | ccd ${m.phase.ccd.toFixed(2)}\nPairs ${m.pairs} tests ${m.narrowTests} contacts ${m.contacts} solved ${m.solvedContacts}\nSleeping ${m.sleeping} moveEps ${this.movementEpsilon.toExponential(2)}`;
            } else {
                this.hudElement.textContent = 'Physics (hover)';
            }
        }
    }

    getBodies() { return this.bodies; }
    getContacts(): Contact[] { return this.contacts; }

    // Generic shape cast (swept test) for sphere or AABB shapes moving from 'from' to 'to'. Returns earliest hit.
    shapeCast(shape: { kind: 'sphere'; radius: number } | { kind: 'aabb'; halfExtents: vec3 }, from: vec3, to: vec3, opts?: { layerMask?: number; bodyMask?: number; exclude?: PhysicsBody }): ShapeCastHit | null {
        const layerMask = opts?.layerMask ?? 0xFFFFFFFF;
        const bodyMask = opts?.bodyMask ?? 0xFFFFFFFF;
        const exclude = opts?.exclude;
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
        const velLenSq = dx * dx + dy * dy + dz * dz;
        if (velLenSq === 0) return null;
        let best: ShapeCastHit | null = null;
        const invdx = 1 / (dx || 1e-8);
        const invdy = 1 / (dy || 1e-8);
        const invdz = 1 / (dz || 1e-8);
        let tmpPoint = this.tmpPoint; // reuse temp vec
        for (const b of this.bodies) {
            if (b === exclude) continue;
            if (!((b.layer & bodyMask) && (layerMask & b.mask))) continue;
            // treat triggers same for now
            // Build target AABB
            let minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number;
            if (b.shape.kind === 'aabb') {
                const h = b.shape.halfExtents;
                minx = b.position.x - h.x; miny = b.position.y - h.y; minz = b.position.z - h.z;
                maxx = b.position.x + h.x; maxy = b.position.y + h.y; maxz = b.position.z + h.z;
            } else {
                const r = b.shape.radius;
                minx = b.position.x - r; miny = b.position.y - r; minz = b.position.z - r;
                maxx = b.position.x + r; maxy = b.position.y + r; maxz = b.position.z + r;
            }
            // Expand by moving shape extents (Minkowski sum)
            let ex = 0, ey = 0, ez = 0;
            if (shape.kind === 'aabb') { ex = shape.halfExtents.x; ey = shape.halfExtents.y; ez = shape.halfExtents.z; }
            else { ex = shape.radius; ey = shape.radius; ez = shape.radius; }
            minx -= ex; miny -= ey; minz -= ez; maxx += ex; maxy += ey; maxz += ez;
            // Swept point (from) vs expanded static AABB (min/max)
            let tx1 = (minx - from.x) * invdx, tx2 = (maxx - from.x) * invdx; if (tx1 > tx2) [tx1, tx2] = [tx2, tx1];
            let ty1 = (miny - from.y) * invdy, ty2 = (maxy - from.y) * invdy; if (ty1 > ty2) [ty1, ty2] = [ty2, ty1];
            let tz1 = (minz - from.z) * invdz, tz2 = (maxz - from.z) * invdz; if (tz1 > tz2) [tz1, tz2] = [tz2, tz1];
            const tEnter = Math.max(0, tx1, ty1, tz1);
            const tExit = Math.min(1, tx2, ty2, tz2);
            if (tExit < tEnter) continue; // no overlap
            if (tEnter > 1) continue;
            // earliest hit along motion
            if (!best || tEnter < best.time) {
                // compute hit point & normal (approx: which axis produced tEnter)
                let nx = 0, ny = 0, nz = 0;
                if (tEnter === tx1) nx = -Math.sign(dx || 1); else if (tEnter === ty1) ny = -Math.sign(dy || 1); else nz = -Math.sign(dz || 1);
                const hx = from.x + dx * tEnter;
                const hy = from.y + dy * tEnter;
                const hz = from.z + dz * tEnter;
                tmpPoint.x = hx; tmpPoint.y = hy; tmpPoint.z = hz;
                const dist = Math.sqrt((hx - from.x) ** 2 + (hy - from.y) ** 2 + (hz - from.z) ** 2);
                best = { body: b, point: new_vec3(tmpPoint.x, tmpPoint.y, tmpPoint.z), normal: new_vec3(nx, ny, nz), distance: dist, time: tEnter };
            }
        }
        return best;
    }

    // Basic raycast against all AABBs (expanded spheres). Returns closest hit.
    raycast(origin: vec3, dir: vec3, maxDist: number): RaycastHit | null {
        let closest: RaycastHit | null = null;
        const ox = origin.x, oy = origin.y, oz = origin.z;
        const dx = dir.x, dy = dir.y, dz = dir.z;
        for (const b of this.bodies) {
            // Build AABB
            let minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number;
            if (b.shape.kind === 'aabb') {
                const h = b.shape.halfExtents;
                minx = b.position.x - h.x; miny = b.position.y - h.y; minz = b.position.z - h.z;
                maxx = b.position.x + h.x; maxy = b.position.y + h.y; maxz = b.position.z + h.z;
            } else { // sphere
                const r = b.shape.radius;
                minx = b.position.x - r; miny = b.position.y - r; minz = b.position.z - r;
                maxx = b.position.x + r; maxy = b.position.y + r; maxz = b.position.z + r;
            }
            let tmin = 0, tmax = maxDist;
            const invdx = 1 / (dx || 1e-8);
            const invdy = 1 / (dy || 1e-8);
            const invdz = 1 / (dz || 1e-8);
            let tx1 = (minx - ox) * invdx, tx2 = (maxx - ox) * invdx;
            let ty1 = (miny - oy) * invdy, ty2 = (maxy - oy) * invdy;
            let tz1 = (minz - oz) * invdz, tz2 = (maxz - oz) * invdz;
            if (tx1 > tx2) [tx1, tx2] = [tx2, tx1];
            if (ty1 > ty2) [ty1, ty2] = [ty2, ty1];
            if (tz1 > tz2) [tz1, tz2] = [tz2, tz1];
            tmin = Math.max(tmin, tx1, ty1, tz1);
            tmax = Math.min(tmax, tx2, ty2, tz2);
            if (tmax >= tmin && tmin <= maxDist) {
                if (!closest || tmin < closest.distance) {
                    let nx = 0, ny = 0, nz = 0;
                    if (tmin === tx1) nx = -Math.sign(dx || 1); else if (tmin === ty1) ny = -Math.sign(dy || 1); else nz = -Math.sign(dz || 1);
                    const px = ox + dx * tmin, py = oy + dy * tmin, pz = oz + dz * tmin;
                    closest = { body: b, point: new_vec3(px, py, pz), normal: new_vec3(nx, ny, nz), distance: tmin };
                }
            }
        }
        return closest;
    }

    // --- Continuous collision detection (sphere vs static AABB & sphere) ---
    sweepSphere(body: PhysicsBody, dt: number) {
        if (body.shape.kind !== 'sphere') return; // only spheres for MVP
        if (body.invMass === 0) return; // skip static / kinematic
        const vx = body.velocity.x * dt;
        const vy = body.velocity.y * dt;
        const vz = body.velocity.z * dt;
        const rad = body.shape.radius;
        // Very naive: check against all static bodies (broadphase could be reused)
        for (const other of this.bodies) {
            if (other === body) continue;
            if (other.invMass !== 0) continue; // only static for now
            const ox = other.position.x - body.position.x;
            const oy = other.position.y - body.position.y;
            const oz = other.position.z - body.position.z;
            const relvx = vx;
            const relvy = vy;
            const relvz = vz;
            const radiusSum = rad + (other.shape.kind === 'sphere' ? other.shape.radius : 0);
            // Ray-sphere if other sphere
            if (other.shape.kind === 'sphere') {
                const a = relvx * relvx + relvy * relvy + relvz * relvz;
                const b = 2 * (ox * relvx + oy * relvy + oz * relvz);
                const c = ox * ox + oy * oy + oz * oz - radiusSum * radiusSum;
                const disc = b * b - 4 * a * c;
                if (disc >= 0) {
                    const t = (-b - Math.sqrt(disc)) / (2 * a);
                    if (t >= 0 && t <= 1) {
                        body.position.x += relvx * t; body.position.y += relvy * t; body.position.z += relvz * t;
                        body.velocity.x = body.velocity.y = body.velocity.z = 0; // stop
                        body.asleep = true;
                        return;
                    }
                }
            }
            // Ray-AABB (expanded by sphere radius)
            // Simplified: treat moving sphere as ray + radius expansion of AABB
            if (other.shape.kind === 'aabb') {
                const h = other.shape.halfExtents;
                const minx = other.position.x - h.x - rad;
                const miny = other.position.y - h.y - rad;
                const minz = other.position.z - h.z - rad;
                const maxx = other.position.x + h.x + rad;
                const maxy = other.position.y + h.y + rad;
                const maxz = other.position.z + h.z + rad;
                let tmin = 0, tmax = 1;
                const invx = 1 / (relvx || 1e-8);
                const invy = 1 / (relvy || 1e-8);
                const invz = 1 / (relvz || 1e-8);
                let tx1 = (minx - 0) * invx, tx2 = (maxx - 0) * invx; if (tx1 > tx2) [tx1, tx2] = [tx2, tx1];
                let ty1 = (miny - 0) * invy, ty2 = (maxy - 0) * invy; if (ty1 > ty2) [ty1, ty2] = [ty2, ty1];
                let tz1 = (minz - 0) * invz, tz2 = (maxz - 0) * invz; if (tz1 > tz2) [tz1, tz2] = [tz2, tz1];
                tmin = Math.max(tmin, tx1, ty1, tz1);
                tmax = Math.min(tmax, tx2, ty2, tz2);
                if (tmax >= tmin && tmin <= 1) {
                    body.position.x += relvx * tmin; body.position.y += relvy * tmin; body.position.z += relvz * tmin;
                    body.velocity.x = body.velocity.y = body.velocity.z = 0;
                    body.asleep = true;
                    return;
                }
            }
        }
    }

    /** Register a per-frame gizmo drawer (used by PhysicsDebugComponent). */
    addGizmo(drawer: (world: PhysicsWorld) => void) { this.gizmoDrawers.push(drawer); }
    /** Deregister a previously added gizmo drawer. */
    removeGizmo(drawer: (world: PhysicsWorld) => void) { const i = this.gizmoDrawers.indexOf(drawer); if (i >= 0) this.gizmoDrawers.splice(i, 1); }

    /** Attach an on-screen HUD with lightweight perf metrics (manual opt-in). */
    enableMetricsHUD(parent: HTMLElement = document.body) {
        if (this.hudElement) return;
        this.enableMetrics = true;
        this.hudParent = parent;
        const el = document.createElement('pre');
        el.style.position = 'fixed'; el.style.left = '4px'; el.style.top = '4px';
        el.style.padding = '4px 6px'; el.style.background = 'rgba(0,0,0,0.5)'; el.style.color = '#0f8';
        el.style.font = '12px monospace'; el.style.zIndex = '9999'; el.style.pointerEvents = 'none';
        parent.appendChild(el); this.hudElement = el;
        if (this.hudAutoHide) {
            el.style.pointerEvents = 'auto';
            el.style.cursor = 'default';
            el.onmouseenter = () => { this.hudCollapsed = false; };
            el.onmouseleave = () => { this.hudCollapsed = true; };
            this.hudCollapsed = true; // start collapsed
        }
    }

    /** Remove the on-screen physics HUD. */
    disableMetricsHUD() { if (this.hudElement && this.hudParent) { this.hudParent.removeChild(this.hudElement); } this.hudElement = undefined; }

    private resetPairTracking() {
        this.previousFramePairs.clear();
        this.pairBodiesA.length = this.pairBodiesB.length = this.pairActive.length = 0;
    }

    /** Toggle HUD auto-collapse behavior. */
    setHUDAutoHide(on: boolean) { this.hudAutoHide = on; if (!on && this.hudElement) { this.hudCollapsed = false; } }
}
