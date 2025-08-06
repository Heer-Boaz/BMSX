import { to_vec3 } from '../../core/utils';
import type { vec3, vec3arr } from '../../rompack/rompack';
import { bmat, bquat, bvec3, Mat4 } from './math3d';

export class Camera3D {
    public position: vec3;
    public target: vec3;
    public readonly up: vec3 = { x: 0, y: 1, z: 0 }; // Fixed world-up to prevent roll
    public fov: number;
    public near: number;
    public far: number;
    private _aspect: number;
    public projection: 'perspective' | 'orthographic';
    public orthoWidth: number;
    public orthoHeight: number;
    private yaw: number = 0;
    private pitch: number = 0;

    constructor(opts?: {
        position?: vec3 | vec3arr;
        target?: vec3 | vec3arr;
        fov?: number;
        aspect?: number;
        near?: number;
        far?: number;
    }) {
        this.position = to_vec3(opts?.position ?? [0, 0, 5]);
        this.target = to_vec3(opts?.target ?? [0, 0, 0]);
        this.fov = opts?.fov ?? Math.PI / 4;
        this._aspect = opts?.aspect ?? 1;
        this.near = opts?.near ?? 0.1;
        this.far = opts?.far ?? 100;
        this.projection = 'perspective';
        this.orthoWidth = 10;
        this.orthoHeight = 10;
        this.syncAngles(); // Initialize yaw/pitch from initial position/target
    }

    public setAspect(aspect: number): void {
        this._aspect = aspect;
    }

    public setPosition(pos: vec3 | vec3arr): void {
        const delta = bvec3.sub(to_vec3(pos), this.position);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta); // Preserve direction (parallel shift)
    }

    public lookAt(target: vec3 | vec3arr): void {
        this.target = to_vec3(target);
        this.syncAngles();
    }

    private syncAngles(): void {
        const dir = bvec3.normalize(bvec3.sub(this.target, this.position));
        this.yaw = Math.atan2(dir.x, dir.z);
        this.pitch = Math.asin(dir.y);
        this.clampPitch();
    }

    private clampPitch(): void {
        const maxPitch = Math.PI / 2 - 0.01;
        this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    }

    private computeDirection(): vec3 {
        return {
            x: Math.cos(this.pitch) * Math.sin(this.yaw),
            y: Math.sin(this.pitch),
            z: Math.cos(this.pitch) * Math.cos(this.yaw),
        };
    }

    public yawBy(rad: number): void {
        this.yaw += rad;
        // Optional: Wrap yaw to [0, 2π)
        this.yaw = (this.yaw + 2 * Math.PI) % (2 * Math.PI);
        const dist = bvec3.length(bvec3.sub(this.target, this.position));
        const dir = this.computeDirection();
        this.target = bvec3.add(this.position, bvec3.scale(dir, dist));
    }

    public pitchBy(rad: number): void {
        this.pitch += rad;
        this.clampPitch();
        const dist = bvec3.length(bvec3.sub(this.target, this.position));
        const dir = this.computeDirection();
        this.target = bvec3.add(this.position, bvec3.scale(dir, dist));
    }

    public setViewDepth(near: number, far: number): void {
        this.near = near;
        this.far = far;
    }

    public rotateX(rad: number): void {
        // Orbit around target (preserves distance)
        const offset = bvec3.sub(this.position, this.target);
        const axis = bvec3.normalize(bvec3.cross(bvec3.normalize(bvec3.sub(this.target, this.position)), this.up));
        const q = bquat.fromAxisAngle(axis, rad);
        const rotated = bquat.rotateVec3(q, offset);
        this.position = bvec3.add(this.target, rotated);
        this.syncAngles();
    }

    public rotateY(rad: number): void {
        // Orbit around target (preserves distance)
        const offset = bvec3.sub(this.position, this.target);
        const q = bquat.fromAxisAngle(this.up, rad);
        const rotated = bquat.rotateVec3(q, offset);
        this.position = bvec3.add(this.target, rotated);
        this.syncAngles();
    }

    public rotateZ(rad: number): void {
        // Orbit around target (preserves distance)
        const offset = bvec3.sub(this.position, this.target);
        const axis = bvec3.normalize(bvec3.sub(this.target, this.position));
        const q = bquat.fromAxisAngle(axis, rad);
        const rotated = bquat.rotateVec3(q, offset);
        this.position = bvec3.add(this.target, rotated);
        this.syncAngles();
    }

    public moveForward(dist: number): void {
        const dir = bvec3.normalize(bvec3.sub(this.target, this.position));
        const delta = bvec3.scale(dir, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveRight(dist: number): void {
        const dir = bvec3.normalize(bvec3.sub(this.target, this.position));
        const right = bvec3.normalize(bvec3.cross(this.up, dir)); // Cross(up, forward) for right
        const delta = bvec3.scale(right, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveUp(dist: number): void {
        const delta = bvec3.scale(this.up, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public usePerspective(fov?: number): void {
        this.projection = 'perspective';
        if (fov !== undefined) this.fov = fov;
    }

    public useOrthographic(width: number, height: number): void {
        this.projection = 'orthographic';
        this.orthoWidth = width;
        this.orthoHeight = height;
    }

    public setFov(fov: number): void {
        this.fov = fov;
    }

    public get projectionMatrix(): Mat4 {
        if (this.projection === 'orthographic') {
            return bmat.orthographic(-this.orthoWidth / 2, this.orthoWidth / 2, -this.orthoHeight / 2, this.orthoHeight / 2, this.near, this.far);
        }
        return bmat.perspective(this.fov, this._aspect, this.near, this.far);
    }

    public get viewMatrix(): Mat4 {
        return bmat.lookAt(
            [this.position.x, this.position.y, this.position.z],
            [this.target.x, this.target.y, this.target.z],
            [this.up.x, this.up.y, this.up.z]
        );
    }

    public get viewProjectionMatrix(): Mat4 {
        return bmat.multiply(this.projectionMatrix, this.viewMatrix);
    }
}