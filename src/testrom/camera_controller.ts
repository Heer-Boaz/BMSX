import { CameraObject, DirectionalLightObject, GameObject, insavegame, onload } from '../bmsx';
import { Action } from './bootloader';

@insavegame
export class CameraController extends GameObject {
	private cameras: CameraObject[];
	private idx = 0;
	private mouseControlsEnabled = false;

	private onLockChange = () => {
		const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
		if (!canvas) return;

		const locked = document.pointerLockElement === canvas;
		this.mouseControlsEnabled = locked;

		console.log(locked ? 'Mouse controls enabled' : 'Mouse controls disabled');
	}

	private onLockError = () => {
		this.mouseControlsEnabled = false;
		console.warn('Pointer lock error');
	}

	private onMouseMove = (e: MouseEvent) => {
		if (!this.mouseControlsEnabled) return;

		// Gebruik ALLEEN raw deltas; geen fallback naar clientX/Y bij lock
		const dx = e.movementX || 0;
		const dy = e.movementY || 0;

		const camObj = $.model.activeCameraObject;
		if (!camObj) {
			console.error('No active camera object found');
			return;
		}

		const cam = camObj.camera;
		const sens = 0.002;
		cam.updateScreenBasedOrientation(-dx * sens, -dy * sens);
	}

	private onMouseDown = (e: MouseEvent) => {
		if (e.button === 0) {
			e.preventDefault();
			this.toggleMouseControls();
		}
	}

	private onMouseUp = (e: MouseEvent) => {
		if (e.button === 0) {
			e.preventDefault();
			this.toggleMouseControls();
		}
	}

	constructor(...cams: CameraObject[]) {
		super('camctrl');
		this.cameras = cams;
		this.setupMouseControls();
	}

	@onload
	private setupMouseControls(): void {
		const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
		this.mouseControlsEnabled = false;

		canvas.addEventListener('mousedown', this.onMouseDown);
		canvas.addEventListener('mouseup', this.onMouseUp);
		canvas.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('pointerlockchange', this.onLockChange);
		document.addEventListener('pointerlockerror', this.onLockError);
	}

	private toggleMouseControls(): void {
		const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
		if (!canvas) return;

		if (!this.mouseControlsEnabled) {
			// Raw (unaccelerated) mouse als de browser het toelaat
			const anyCanvas = canvas as any;
			if (anyCanvas.requestPointerLock) {
				try {
					anyCanvas.requestPointerLock({ unadjustedMovement: true });
				} catch {
					canvas.requestPointerLock();
				}
			} else {
				canvas.requestPointerLock();
			}
		} else {
			document.exitPointerLock();
		}
	}

	override dispose(): void {
		super.dispose();
		// Clear mouse control canvas events
		const canvas = document.querySelector('#gamescreen') as HTMLCanvasElement | null;
		if (!canvas) return;

		canvas.removeEventListener('mousedown', this.onMouseDown);
		canvas.removeEventListener('mouseup', this.onMouseUp);
		canvas.removeEventListener('mousemove', this.onMouseMove);

		document.removeEventListener('pointerlockchange', this.onLockChange);
		document.removeEventListener('pointerlockerror', this.onLockError);
	}

	override run(): void {
		const input = $.input.getPlayerInput(1);

		if (input.getActionState('save').justpressed) {
			this.idx = (this.idx + 1) % this.cameras.length;
			$.model.activeCameraId = this.cameras[this.idx].id;
			console.log(`Switched to camera ${this.cameras[this.idx].id}`);
		}

		if (input.getActionState('load').justpressed) {
			const extra = $.model.getGameObject<DirectionalLightObject>('extraSun');
			if (extra) extra.active = !extra.active;
		}

		const camObj = $.model.activeCameraObject;
		if (!camObj) {
			console.error('No active camera object found');
			return;
		}

		const cam = camObj.camera;
		const move = 0.5;
		const rotateSpeed = 0.02; // Reduced from 0.05 for smoother rotation

		// Keyboard camera controls (when mouse is not locked)
		let moveForward_pressed = input.getActionState('moveforward' satisfies Action).pressed;
		let moveBackward_pressed = input.getActionState('movebackward' satisfies Action).pressed;
		let panLeft_pressed = input.getActionState('panleft' satisfies Action).pressed;
		let panRight_pressed = input.getActionState('panright' satisfies Action).pressed;
		let panUp_pressed = input.getActionState('panup' satisfies Action).pressed;
		let panDown_pressed = input.getActionState('pandown' satisfies Action).pressed;
		let turnLeft_pressed: boolean = input.getActionState('turnleft' satisfies Action).pressed;
		let turnRight_pressed: boolean = input.getActionState('turnright' satisfies Action).pressed;
		let rotateLeft_pressed = input.getActionState('rotateleft' satisfies Action).pressed;
		let rotateRight_pressed = input.getActionState('rotateright' satisfies Action).pressed;
		let pitchUp_pressed = input.getActionState('pitchup' satisfies Action).pressed;
		let pitchDown_pressed = input.getActionState('pitchdown' satisfies Action).pressed;

		// Movement (works in both modes)
		if (moveForward_pressed) cam.moveForward(move);    // Forward movement
		if (moveBackward_pressed) cam.moveForward(-move);  // Backward movement
		if (panUp_pressed) cam.strafeUp(move);
		if (panDown_pressed) cam.strafeUp(-move);
		if (panLeft_pressed) cam.strafeRight(-move);   // Pan left
		if (panRight_pressed) cam.strafeRight(move);    // Pan right
		if (turnLeft_pressed) cam.updateScreenBasedOrientation(rotateSpeed, 0);
		if (turnRight_pressed) cam.updateScreenBasedOrientation(-rotateSpeed, 0);
		if (rotateLeft_pressed) cam.addRoll(-rotateSpeed);
		if (rotateRight_pressed) cam.addRoll(rotateSpeed);
		if (pitchUp_pressed) cam.updateScreenBasedOrientation(0, -rotateSpeed);
		if (pitchDown_pressed) cam.updateScreenBasedOrientation(0, rotateSpeed);
	}
}
