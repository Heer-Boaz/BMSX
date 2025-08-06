import { to_vec3 } from '../../core/utils';
import type { vec3, vec3arr } from '../../rompack/rompack';
import { bmat, bquat, bvec3, Mat4 } from './math3d';
import type { quat } from './math3d';

/**
 * Simple camera helper for 3D rendering.
 */
export class Camera3D {
    public position: vec3;
    public target: vec3;
    public up: vec3;
    public orientation: quat;
    public fov: number;
    public near: number;
    public far: number;
    private _aspect: number;
    public projection: 'perspective' | 'orthographic';
    public orthoWidth: number;
    public orthoHeight: number;

    constructor(opts?: {
        position?: vec3 | vec3arr;
        target?: vec3 | vec3arr;
        up?: vec3 | vec3arr;
        fov?: number;
        aspect?: number;
        near?: number;
        far?: number;
    }) {
        this.position = to_vec3(opts?.position ?? [0, 0, 5]);
        this.target = to_vec3(opts?.target ?? [0, 0, 0]);
        this.up = to_vec3(opts?.up ?? [0, 1, 0]);
        this.orientation = bquat.identity();
        this.fov = opts?.fov ?? Math.PI / 4;
        this._aspect = opts?.aspect ?? 1;
        this.near = opts?.near ?? 0.1;
        this.far = opts?.far ?? 100;
        this.projection = 'perspective';
        this.orthoWidth = 10;
        this.orthoHeight = 10;
        this.lookAt(this.target);
    }

    public setAspect(aspect: number): void {
        this._aspect = aspect;
    }

    public setPosition(pos: vec3 | vec3arr): void {
        this.position = to_vec3(pos);
        this.updateDirection();
    }

    public lookAt(target: vec3 | vec3arr): void {
        this.target = to_vec3(target);
        const dir = bvec3.normalize(bvec3.sub(this.target, this.position));
        const yaw = Math.atan2(dir.x, -dir.z);
        const pitch = Math.asin(dir.y);
        this.orientation = bquat.normalize(bquat.fromEuler(pitch, yaw, 0));
        this.updateDirection();
    }

    private getForward(): vec3 {
        return bquat.rotateVec3(bquat.normalize(this.orientation), { x: 0, y: 0, z: -1 });
    }

    private getRight(): vec3 {
        return bquat.rotateVec3(bquat.normalize(this.orientation), { x: 1, y: 0, z: 0 });
    }

    private getUp(): vec3 {
        return bquat.rotateVec3(bquat.normalize(this.orientation), { x: 0, y: 1, z: 0 });
    }

    private updateDirection(): void {
        const forward = bvec3.normalize(this.getForward());
        this.up = bvec3.normalize(this.getUp());
        this.target = bvec3.add(this.position, forward);
    }

    public yawBy(rad: number): void {
        const axis = bvec3.normalize(this.getUp());
        const q = bquat.fromAxisAngle(axis, rad);
        this.orientation = bquat.normalize(bquat.multiply(q, this.orientation));
        this.updateDirection();
    }

    public pitchBy(rad: number): void {
        const axis = bvec3.normalize(this.getRight());
        const q = bquat.fromAxisAngle(axis, rad);
        this.orientation = bquat.normalize(bquat.multiply(q, this.orientation));
        this.updateDirection();
    }

    public setViewDepth(near: number, far: number): void {
        this.near = near;
        this.far = far;
    }

    public rotateX(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 1, y: 0, z: 0 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
        this.lookAt(this.target);
    }

    public rotateY(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 0, y: 1, z: 0 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
        this.lookAt(this.target);
    }

    public rotateZ(rad: number): void {
        const offset = bvec3.sub(this.position, this.target);
        const rotated = bquat.rotateVec3(bquat.fromAxisAngle({ x: 0, y: 0, z: 1 }, rad), offset);
        this.position = bvec3.add(this.target, rotated);
        this.lookAt(this.target);
    }

    public moveForward(dist: number): void {
        const forward = bvec3.normalize(this.getForward());
        const delta = bvec3.scale(forward, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveRight(dist: number): void {
        const right = bvec3.normalize(this.getRight());
        const delta = bvec3.scale(right, dist);
        this.position = bvec3.add(this.position, delta);
        this.target = bvec3.add(this.target, delta);
    }

    public moveUp(dist: number): void {
        const up = bvec3.normalize(this.getUp());
        const delta = bvec3.scale(up, dist);
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
        const rot = bquat.toMat4(bquat.conjugate(this.orientation));
        const trans = bmat.identity();
        trans[12] = -this.position.x;
        trans[13] = -this.position.y;
        trans[14] = -this.position.z;
        return bmat.multiply(rot, trans);
    }

    public get viewProjectionMatrix(): Mat4 {
        return bmat.multiply(this.projectionMatrix, this.viewMatrix);
    }
}
