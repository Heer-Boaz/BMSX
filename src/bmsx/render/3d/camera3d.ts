import type { vec3, vec3arr } from '../../rompack/rompack';
import { bmat, bvec3 } from './math3d';

/**
 * Camera3D provides a 3D camera for rendering scenes in the BMSX engine.
 *
 * ## Coordinate System
 * - **Right-handed Y-up**: The engine uses a right-handed coordinate system where:
 *   - The **Y axis** points up.
 *   - The **Z axis** points forward/backward (with negative Z being the default forward direction).
 *   - The **X axis** points right.
 * - **Yaw**: 0 radians means looking toward -Z (forward), positive yaw rotates to the right (toward +X).
 * - **Pitch**: 0 radians is level, positive pitch looks upward.
 * - All rotations are in radians.
 *
 * The camera supports both free-form (FPS/Unreal style) and orbit (Blender style) controls,
 * and can switch between perspective and orthographic projections.
 */
export class Camera3D {
    private _position: vec3 = { x: 0, y: 0, z: 5 };
    private _yaw: number = 0; // Look along -Z axis (0 radians = looking toward -Z)
    private _pitch: number = 0;
    private _fov: number = 45; // Store in degrees, convert when needed
    private _aspect: number = 1; // Will be set by the view system
    private _near: number = 0.1;
    private _far: number = 1000;
    private _isPerspective: boolean = true;
    private _viewMatrix = bmat.identity();
    private _projectionMatrix = bmat.identity();
    private _viewProjectionMatrix = bmat.identity();
    private _matricesNeedUpdate: boolean = true;
    private static readonly MAX_PITCH = Math.PI / 2 - 0.01;
    private _orbitTarget: vec3 = { x: 0, y: 0, z: 0 }; // Default orbit target
    private _frustumPlanes: [number, number, number, number][] = [];

    constructor() {
        this._matricesNeedUpdate = true;
        this.updateMatrices();
    }

    setPosition(pos: vec3 | vec3arr): void {
        const p = Array.isArray(pos) ? { x: pos[0], y: pos[1], z: pos[2] } : pos;
        this._position.x = p.x;
        this._position.y = p.y;
        this._position.z = p.z;
        this._matricesNeedUpdate = true;
    }
    get position(): vec3 { return { ...this._position }; }
    get yaw(): number { return this._yaw; }
    get pitch(): number { return this._pitch; }
    get fov(): number { return this._fov; }
    get aspect(): number { return this._aspect; }
    get near(): number { return this._near; }
    get far(): number { return this._far; }
    get orbitTarget(): vec3 { return { ...this._orbitTarget }; }

    setOrbitTarget(target: vec3 | vec3arr): void {
        const t = Array.isArray(target) ? { x: target[0], y: target[1], z: target[2] } : target;
        this._orbitTarget.x = t.x;
        this._orbitTarget.y = t.y;
        this._orbitTarget.z = t.z;
    }

    setYaw(yaw: number): void { this._yaw = yaw; this._matricesNeedUpdate = true; }
    setPitch(pitch: number): void {
        this._pitch = Math.max(-Camera3D.MAX_PITCH, Math.min(Camera3D.MAX_PITCH, pitch));
        this._matricesNeedUpdate = true;
    }
    addYaw(deltaYaw: number): void { this._yaw += deltaYaw; this._matricesNeedUpdate = true; }
    addPitch(deltaPitch: number): void { this.setPitch(this._pitch + deltaPitch); }

    /**
     * Ground-style yaw rotation around the world Y-axis.
     * This is the same as the regular addYaw method.
     */
    addYawGround(deltaYaw: number): void {
        this.addYaw(deltaYaw);
    }

    /**
     * Ground-style pitch rotation.
     * This is the same as the regular addPitch method.
     */
    addPitchGround(deltaPitch: number): void {
        this.addPitch(deltaPitch);
    }

    /**
     * Blender-style orbit around a target point.
     * @param target The point to orbit around
     * @param deltaYaw Horizontal rotation (left/right)
     * @param deltaPitch Vertical rotation (up/down)
     */
    orbitAroundTarget(target: vec3, deltaYaw: number, deltaPitch: number): void {
        // Get current offset from target
        const offset = bvec3.sub(this._position, target);
        const distance = bvec3.length(offset);
        if (distance < 1e-8) return; // Too close to target

        // Convert current position to spherical coordinates relative to target
        const currentYaw = Math.atan2(offset.x, -offset.z);
        const currentPitch = Math.asin(offset.y / distance);

        // Apply deltas
        const newYaw = currentYaw + deltaYaw;
        const newPitch = Math.max(-Camera3D.MAX_PITCH, Math.min(Camera3D.MAX_PITCH, currentPitch + deltaPitch));

        // Convert back to cartesian and set new position
        const cosPitch = Math.cos(newPitch);
        const newOffset = {
            x: Math.sin(newYaw) * cosPitch * distance,
            y: Math.sin(newPitch) * distance,
            z: Math.cos(newYaw) * cosPitch * distance
        };

        this._position = bvec3.add(target, newOffset);

        // Look at the target
        this.lookAt(target);

        this._matricesNeedUpdate = true;
    }

    /**
     * Blender-style pan (move camera parallel to view plane).
     * @param deltaX Horizontal pan amount
     * @param deltaY Vertical pan amount
     */
    pan(deltaX: number, deltaY: number): void {
        const right = this.getRightVector();
        const up = this.getUpVector();

        // Move along right and up vectors
        this._position.x += right.x * deltaX + up.x * deltaY;
        this._position.y += right.y * deltaX + up.y * deltaY;
        this._position.z += right.z * deltaX + up.z * deltaY;

        this._matricesNeedUpdate = true;
    }

    panGround(dx, dy) {
        const right = this.getRightVector();
        const up = { x: 0, y: 1, z: 0 };
        this._position.x += right.x * dx + up.x * dy;
        this._position.y += right.y * dx + up.y * dy;
        this._position.z += right.z * dx + up.z * dy;
        this._matricesNeedUpdate = true;
    }


    /**
     * Blender-style zoom (move camera forward/backward along view direction).
     * @param deltaZoom Zoom amount (positive = zoom in, negative = zoom out)
     */
    zoom(deltaZoom: number): void {
        const forward = this.getForwardVector();
        this._position.x += forward.x * deltaZoom;
        this._position.y += forward.y * deltaZoom;
        this._position.z += forward.z * deltaZoom;

        this._matricesNeedUpdate = true;
    }

    /**
     * Orbit around the current orbit target.
     * @param deltaYaw Horizontal rotation
     * @param deltaPitch Vertical rotation
     */
    orbit(deltaYaw: number, deltaPitch: number): void {
        this.orbitAroundTarget(this._orbitTarget, deltaYaw, deltaPitch);
    }

    // ======== FREE-FORM CAMERA CONTROLS (Blender/Unreal style) ========

    /**
     * Free-form mouse look - direct camera rotation like FPS games.
     * This is the primary way to look around in free-form mode.
     * @param deltaYaw Horizontal mouse movement (left/right)
     * @param deltaPitch Vertical mouse movement (up/down)
     */
    mouseLook(deltaYaw: number, deltaPitch: number): void {
        this.addYaw(deltaYaw);
        this.addPitch(deltaPitch);
    }

    /**
     * Free-form movement forward/backward (like 'W' and 'S' keys).
     * Moves along the camera's current view direction.
     * @param distance Distance to move (positive = forward, negative = backward)
     */
    moveFreeform(distance: number): void {
        this.moveForward(distance);
    }

    /**
     * Free-form strafe left/right (like 'A' and 'D' keys).
     * Moves perpendicular to the camera's view direction.
     * @param distance Distance to strafe (positive = right, negative = left)
     */
    strafeFreeform(distance: number): void {
        this.strafeRight(distance);
    }

    /**
     * Free-form vertical movement (like 'Q' and 'E' keys or Space/Shift).
     * Moves up/down in world space, regardless of camera orientation.
     * @param distance Distance to move (positive = up, negative = down)
     */
    moveFreeformVertical(distance: number): void {
        this.moveUp(distance);
    }

    /**
     * Free-form fly mode - moves up/down relative to camera's local up vector.
     * This is different from moveFreeformVertical which always moves in world Y.
     * @param distance Distance to move along camera's up vector
     */
    flyUpDown(distance: number): void {
        const up = this.getUpVector();
        this._position.x += up.x * distance;
        this._position.y += up.y * distance;
        this._position.z += up.z * distance;
        this._matricesNeedUpdate = true;
    }

    moveForward(distance: number): void {
        const f = this.getForwardVector();
        this._position.x += f.x * distance;
        this._position.y += f.y * distance;
        this._position.z += f.z * distance;
        this._matricesNeedUpdate = true;
    }
    moveBackward(distance: number): void { this.moveForward(-distance); }
    strafeRight(distance: number): void {
        const r = this.getRightVector();
        this._position.x += r.x * distance;
        this._position.y += r.y * distance;
        this._position.z += r.z * distance;
        this._matricesNeedUpdate = true;
    }
    strafeLeft(distance: number): void { this.strafeRight(-distance); }
    moveUp(distance: number): void { this._position.y += distance; this._matricesNeedUpdate = true; }
    moveDown(distance: number): void { this.moveUp(-distance); }

    /**
     * Returns the forward direction in the ground plane (ignoring pitch).
     */
    getGroundForwardVector(): vec3 {
        return {
            x: Math.sin(this._yaw),
            y: 0,
            z: -Math.cos(this._yaw)
        };
    }

    /**
     * Moves the camera along the ground forward vector (XZ plane).
     */
    moveForwardGround(distance: number): void {
        const gf = this.getGroundForwardVector();
        this._position.x += gf.x * distance;
        this._position.z += gf.z * distance;
        this._matricesNeedUpdate = true;
    }

    /**
     * Moves the camera backward along the ground forward vector.
     */
    moveBackwardGround(distance: number): void {
        this.moveForwardGround(-distance);
    }

    /**
     * Alias for flight-forward movement (including pitch).
     */
    moveForwardFlight(distance: number): void {
        this.moveForward(distance);
    }

    /**
     * Alias for flight-backward movement (including pitch).
     */
    moveBackwardFlight(distance: number): void {
        this.moveBackward(distance);
    }

    getForwardVector(): vec3 {
        // Right-handed Y-up: yaw=0 looks toward -Z, yaw=90° looks toward +X
        const cosPitch = Math.cos(this._pitch);
        return {
            x: Math.sin(this._yaw) * cosPitch,
            y: Math.sin(this._pitch),           // positive sin for pitch (Y up)
            z: -Math.cos(this._yaw) * cosPitch  // negative cos (looking toward -Z at yaw=0)
        };
    }
    getRightVector(): vec3 {
        // Right = 90° clockwise from forward in XZ plane
        return {
            x: Math.cos(this._yaw),    // right = 90° from forward
            y: 0,                      // right is always horizontal
            z: Math.sin(this._yaw)     // perpendicular to forward
        };
    }
    getUpVector(): vec3 {
        // Up = cross(right, forward)
        const right = this.getRightVector();
        const forward = this.getForwardVector();
        return bvec3.cross(right, forward);
    }

    lookAt(target: vec3 | vec3arr): void {
        const t = Array.isArray(target) ? { x: target[0], y: target[1], z: target[2] } : target;
        const dir = bvec3.normalize({
            x: t.x - this._position.x,
            y: t.y - this._position.y,
            z: t.z - this._position.z
        });
        this._pitch = Math.asin(dir.y);
        // For right-handed Y-up looking toward -Z at yaw=0
        this._yaw = Math.atan2(dir.x, -dir.z);
        this._matricesNeedUpdate = true;
    }

    setFov(fovInDegrees: number): void {
        this._fov = fovInDegrees;
        this._matricesNeedUpdate = true;
    }
    setAspect(aspect: number): void { this._aspect = aspect; this._matricesNeedUpdate = true; }
    setViewDepth(near: number, far: number): void { this._near = near; this._far = far; this._matricesNeedUpdate = true; }
    usePerspective(fovInDegrees?: number): void {
        if (fovInDegrees !== undefined) this.setFov(fovInDegrees);
        this._isPerspective = true;
        this._matricesNeedUpdate = true;
    }
    useOrthographic(width: number, height: number): void {
        this._fov = width;
        this._aspect = width / height;
        this._isPerspective = false;
        this._matricesNeedUpdate = true;
    }

    get viewMatrix(): Float32Array { if (this._matricesNeedUpdate) this.updateMatrices(); return this._viewMatrix; }
    get projectionMatrix(): Float32Array { if (this._matricesNeedUpdate) this.updateMatrices(); return this._projectionMatrix; }
    get viewProjectionMatrix(): Float32Array { if (this._matricesNeedUpdate) this.updateMatrices(); return this._viewProjectionMatrix; }

    private updateMatrices(): void {
        const pos: [number, number, number] = [this._position.x, this._position.y, this._position.z];
        const forward = this.getForwardVector();
        const target: [number, number, number] = [pos[0] + forward.x, pos[1] + forward.y, pos[2] + forward.z];
        const up = this.getUpVector();
        const upArr: [number, number, number] = [up.x, up.y, up.z];
        this._viewMatrix = bmat.lookAt(pos, target, upArr);
        if (this._isPerspective) {
            const fovRadians = this._fov * Math.PI / 180; // Convert degrees to radians here
            this._projectionMatrix = bmat.perspective(fovRadians, this._aspect, this._near, this._far);
        } else {
            const width = this._fov;
            const height = width / this._aspect;
            this._projectionMatrix = bmat.orthographic(-width / 2, width / 2, -height / 2, height / 2, this._near, this._far);
        }
        this._viewProjectionMatrix = bmat.multiply(this._projectionMatrix, this._viewMatrix);
        this.extractFrustumPlanes();
        this._matricesNeedUpdate = false;
    }

    private extractFrustumPlanes(): void {
        const m = this._viewProjectionMatrix;
        this._frustumPlanes = [
            [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]], // left
            [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]], // right
            [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], // bottom
            [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]], // top
            [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]], // near
            [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]], // far
        ];
        for (const p of this._frustumPlanes) {
            const invLen = 1 / Math.hypot(p[0], p[1], p[2]);
            p[0] *= invLen; p[1] *= invLen; p[2] *= invLen; p[3] *= invLen;
        }
    }

    public isSphereInFrustum(center: vec3arr, radius: number): boolean {
        if (this._matricesNeedUpdate) this.updateMatrices();
        const bias = radius * 0.01; // small tolerance to avoid flicker at frustum edges
        for (const p of this._frustumPlanes) {
            const d = p[0] * center[0] + p[1] * center[1] + p[2] * center[2] + p[3];
            if (d < -(radius + bias)) {
                return false;
            }
        }
        return true;
    }
}
