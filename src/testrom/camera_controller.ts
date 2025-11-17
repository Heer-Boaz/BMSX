import { $, build_fsm, CameraObject, CameraProjectionType, WorldObject, insavegame, onload, StateMachineBlueprint, type RevivableObjectArgs } from 'bmsx';
import type { InputAction } from './bootloader';

@insavegame
export class CameraController extends WorldObject {
	@build_fsm()
	public static buildFsm(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					tick(this: CameraController) {
						this.stuff();
					},
				},
			},
		};
	}

	private cameras: CameraObject[];
	private idx = 0;
	private mouseControlsEnabled = false;
	private delta = { yaw: 0, pitch: 0, roll: 0 };

	constructor(opts: RevivableObjectArgs & { cams: CameraObject[] }) {
		super({ ...opts, id: 'camctrl' });
		this.cameras = opts.cams;
		this.setupMouseControls();
	}

	@onload
	private setupMouseControls(): void {
		this.mouseControlsEnabled = false;
	}

	stuff(): void {
		const input = $.input.getPlayerInput(1);

		if (input.getActionState('save').justpressed) {
			this.idx = (this.idx + 1) % this.cameras.length;
			$.world.activeCameraId = this.cameras[this.idx].id;
			console.log(`Switched to camera ${this.cameras[this.idx].id}`);
		}

		// if (input.getActionState('load').justpressed) {
		// 	const extra = $world.getWorldObject<DirectionalLightObject>('extraSun');
		// 	if (extra) extra.active = !extra.active;
		// }

		const camObj = $.world.activeCameraObject;
		if (!camObj) {
			console.error('No active camera object found');
			return;
		}

		const cam = camObj.camera;
		const move = 2.0;
		const rotateSpeed = 0.1; // Reduced from 0.05 for smoother rotation
		let screenBasedOrFlight: 'screen' | 'flight' = 'screen';

		// Voor debug: log de camera rotatie
		// console.log(`Camera rotation updated: yaw=${cam.yaw}, pitch=${cam.pitch}, roll=${cam.roll}`);

		// Keyboard camera controls (when mouse is not locked)
		const moveForward_pressed = input.getActionState('moveforward' satisfies InputAction).pressed;
		const moveBackward_pressed = input.getActionState('movebackward' satisfies InputAction).pressed;
		const panLeft_pressed = input.getActionState('panleft' satisfies InputAction).pressed;
		const panRight_pressed = input.getActionState('panright' satisfies InputAction).pressed;
		const panUp_pressed = input.getActionState('panup' satisfies InputAction).pressed;
		const panDown_pressed = input.getActionState('pandown' satisfies InputAction).pressed;
		const turnLeft_pressed = input.getActionState('turnleft' satisfies InputAction).pressed;
		const turnRight_pressed = input.getActionState('turnright' satisfies InputAction).pressed;
		const rotateLeft_pressed = input.getActionState('rotateleft' satisfies InputAction).pressed;
		const rotateRight_pressed = input.getActionState('rotateright' satisfies InputAction).pressed;
		const pitchUp_pressed = input.getActionState('pitchup' satisfies InputAction).pressed;
		const pitchDown_pressed = input.getActionState('pitchdown' satisfies InputAction).pressed;
		const toggleProjection_pressed = input.getActionState('toggleprojection' satisfies InputAction).justpressed;

		// Movement (works in both modes)
		if (moveForward_pressed) cam.moveForward(move);    // Forward movement
		if (moveBackward_pressed) cam.moveForward(-move);  // Backward movement
		if (panUp_pressed) cam.strafeUp(move);
		if (panDown_pressed) cam.strafeUp(-move);
		if (panLeft_pressed) cam.strafeRight(-move);   // Pan left
		if (panRight_pressed) cam.strafeRight(move);    // Pan right

		if (turnLeft_pressed) this.delta.yaw += rotateSpeed;
		if (turnRight_pressed) this.delta.yaw -= rotateSpeed;
		if (rotateLeft_pressed) this.delta.roll -= rotateSpeed;
		if (rotateRight_pressed) this.delta.roll += rotateSpeed;
		if (pitchUp_pressed) this.delta.pitch += rotateSpeed;
		if (pitchDown_pressed) this.delta.pitch -= rotateSpeed;

		const pointerPrimary = input.getActionState('pointer_primary');
		this.mouseControlsEnabled = pointerPrimary?.pressed ?? false;

		const pointerDelta = input.getActionState('pointer_delta');
		if (this.mouseControlsEnabled && pointerDelta?.value2d) {
			const [dx, dy] = pointerDelta.value2d;
			const sens = 0.004;
			this.delta.yaw += -dx * sens;
			this.delta.pitch += -dy * sens;
		}

		const projectTypes: CameraProjectionType[] = ['perspective', 'orthographic', 'fisheye', 'panorama', 'oblique', 'asymmetricFrustum', 'isometric', 'infinitePerspective', 'viewFromBasis'];

		if (toggleProjection_pressed) {
			const currentIndex = projectTypes.indexOf(cam.projectionType);
			const nextIndex = (currentIndex + 1) % projectTypes.length;
			cam.projectionType = projectTypes[nextIndex];
			console.log(`Camera projection switched to ${cam.projectionType}`);
		}

		// Process mouse movements
		// Pas de camera aan met de delta
		switch (screenBasedOrFlight) {
			// @ts-ignore
			case 'flight':
				cam.flightLook(this.delta.yaw, this.delta.pitch, this.delta.roll);
				break;
			// @ts-ignore
			case 'screen':
				cam.screenLook(this.delta.yaw, this.delta.pitch, this.delta.roll);
				break;
		}
		this.delta.yaw = 0; // Reset delta na verwerking
		this.delta.pitch = 0;
		this.delta.roll = 0;
	}
}
