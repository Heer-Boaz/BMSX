import type { Input } from '../../../../hosts/common/input/manager';
import { POINTER_HOST_POSITION_CODE } from '../../../../hosts/common/input/pointer';
import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import {
	f32BitsToNumber,
	numberToF32Bits,
} from '../../../../machine/ts/machine/common/numeric';
import { tokenKey } from '../../../../machine/ts/rompack/tokens';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import {
	STUDIO_CHROME_TREE_ROW_HEIGHT,
	writeStudioChromeLayout,
} from './chrome_layout';
import {
	StudioChromeTargetKind,
	type StudioChromeState,
	type StudioChromeTarget,
} from './chrome_state';
import type {
	StudioComponentRecord,
	StudioDescriptorModel,
	StudioObjectRecord,
} from './model';
import {
	STUDIO_COMMAND_SELECT,
	STUDIO_COMMAND_SET_COMPONENT_ENABLED,
	STUDIO_COMMAND_SET_GAMEPLAY_RUNNING,
	STUDIO_COMMAND_SET_POS,
	STUDIO_COMMAND_SET_VISIBLE,
	STUDIO_COMPONENT_FLAG_ENABLED,
	STUDIO_COMPONENT_LOCAL_ID_F32,
	STUDIO_COMPONENT_LOCAL_ID_NONE,
	STUDIO_COMPONENT_LOCAL_ID_TOKEN,
	STUDIO_FLAG_GAMEPLAY_RUNNING,
	STUDIO_OBJECT_FLAG_VISIBLE,
} from './protocol';

const STUDIO_TREE_SCROLL_ROWS = 3;
const STUDIO_POSITION_STEP = 1;

export class StudioChromeController {
	public constructor(
		private readonly model: StudioDescriptorModel,
		private readonly state: StudioChromeState,
		private readonly presenter: VideoPresenter,
		private readonly input: Input,
	) {
	}

	public descriptorPublished(): void {
		this.clampOutlinerScroll();
		const snapshot = this.model.snapshot;
		const state = this.state;
		if (snapshot.selectedObjectHandle !== state.selectedObjectHandle
			|| snapshot.selectedComponentHandle !== state.selectedComponentHandle) {
			state.selectedObjectHandle = snapshot.selectedObjectHandle;
			state.selectedComponentHandle = snapshot.selectedComponentHandle;
			this.revealSelection();
		}
		this.updateDetailsText();
	}

	public tickInput(): void {
		const state = this.state;
		const pointer = this.input.getPlayerInput(1).inputHandlers.pointer!;
		if (pointer.positionValid) {
			const screenPosition = pointer.getButtonState(POINTER_HOST_POSITION_CODE).value2d!;
			if (this.presenter.mapDisplayPointToViewport(
				screenPosition[0],
				screenPosition[1],
				state.pointerPosition,
			)) {
				this.writeTargetAt(
					state.pointerPosition.x,
					state.pointerPosition.y,
					state.hoverTarget,
				);
			} else {
				state.hoverTarget.clear();
			}
		} else {
			state.hoverTarget.clear();
		}

		const wheel = pointer.getButtonState('pointer_wheel');
		if (wheel.pressed
			&& !wheel.consumed
			&& state.hoverTarget.kind !== StudioChromeTargetKind.None) {
			if (point_in_rect(
				state.pointerPosition.x,
				state.pointerPosition.y,
				state.layout.leftPanel,
			)) {
				state.outlinerScroll += wheel.value > 0
					? STUDIO_TREE_SCROLL_ROWS
					: -STUDIO_TREE_SCROLL_ROWS;
				this.clampOutlinerScroll();
			}
			pointer.consumeButton('pointer_wheel');
		}

		const primary = pointer.getButtonState('pointer_primary');
		if (primary.justpressed
			&& !primary.consumed
			&& state.hoverTarget.kind !== StudioChromeTargetKind.None) {
			state.capturedTarget.copyFrom(state.hoverTarget);
		}
		if (state.capturedTarget.kind === StudioChromeTargetKind.None) {
			return;
		}
		pointer.consumeButton('pointer_primary');
		if (!primary.justreleased) {
			return;
		}
		if (state.capturedTarget.equals(state.hoverTarget)) {
			this.activateTarget(state.capturedTarget);
		}
		state.capturedTarget.clear();
	}

	public prepareLayout(): void {
		const viewport = this.presenter.viewportSize;
		const layout = this.state.layout;
		if (layout.viewportWidth === viewport.x
			&& layout.viewportHeight === viewport.y) {
			return;
		}
		writeStudioChromeLayout(layout, viewport.x, viewport.y);
		this.clampOutlinerScroll();
	}

	private clampOutlinerScroll(): void {
		const state = this.state;
		if (!this.model.ready) {
			state.outlinerScroll = 0;
			return;
		}
		const snapshot = this.model.snapshot;
		const maximum = snapshot.objectCount + snapshot.componentCount - state.layout.visibleTreeRows;
		const maximumScroll = maximum > 0 ? maximum : 0;
		if (state.outlinerScroll < 0) {
			state.outlinerScroll = 0;
		} else if (state.outlinerScroll > maximumScroll) {
			state.outlinerScroll = maximumScroll;
		}
	}

	private revealSelection(): void {
		const state = this.state;
		if (!this.model.ready || state.selectedObjectHandle === 0) {
			return;
		}
		const snapshot = this.model.snapshot;
		let flatRow = 0;
		let selectedRow = -1;
		for (let objectIndex = 0; objectIndex < snapshot.objects.size; objectIndex += 1) {
			const object = snapshot.objects.peek(objectIndex);
			if (state.selectedComponentHandle === 0
				&& object.handle === state.selectedObjectHandle) {
				selectedRow = flatRow;
				break;
			}
			flatRow += 1;
			for (let localIndex = 0; localIndex < object.componentCount; localIndex += 1) {
				const component = snapshot.components.peek(object.firstComponent + localIndex);
				if (component.handle === state.selectedComponentHandle) {
					selectedRow = flatRow;
					break;
				}
				flatRow += 1;
			}
			if (selectedRow >= 0) {
				break;
			}
		}
		if (selectedRow < state.outlinerScroll) {
			state.outlinerScroll = selectedRow;
		} else if (selectedRow >= state.outlinerScroll + state.layout.visibleTreeRows) {
			state.outlinerScroll = selectedRow - state.layout.visibleTreeRows + 1;
		}
		this.clampOutlinerScroll();
	}

	private writeTargetAt(x: number, y: number, target: StudioChromeTarget): void {
		target.clear();
		const state = this.state;
		const layout = state.layout;
		const chromeKind = StudioChromeTargetKind.Chrome;
		if (point_in_rect(x, y, layout.topBar)) {
			target.kind = chromeKind;
			if (point_in_rect(x, y, layout.playButton)) {
				target.kind = StudioChromeTargetKind.Play;
			} else if (point_in_rect(x, y, layout.editButton)) {
				target.kind = StudioChromeTargetKind.Edit;
			}
			return;
		}
		if (point_in_rect(x, y, layout.leftPanel)) {
			target.kind = chromeKind;
			if (!this.model.ready || !point_in_rect(x, y, layout.outlinerList)) {
				return;
			}
			let visibleRow = 0;
			let rowTop = layout.outlinerList.top;
			while (visibleRow < layout.visibleTreeRows) {
				if (y >= rowTop && y < rowTop + STUDIO_CHROME_TREE_ROW_HEIGHT) {
					this.writeTreeTarget(state.outlinerScroll + visibleRow, target);
					return;
				}
				visibleRow += 1;
				rowTop += STUDIO_CHROME_TREE_ROW_HEIGHT;
			}
			return;
		}
		if (!point_in_rect(x, y, layout.rightPanel)) {
			return;
		}
		target.kind = chromeKind;
		if (!this.model.ready || this.model.connection.commandPending) {
			return;
		}
		const snapshot = this.model.snapshot;
		const selectedObjectHandle = snapshot.selectedObjectHandle;
		if (snapshot.selectedComponentHandle !== 0) {
			if (point_in_rect(x, y, layout.componentEnabledToggle)) {
				target.kind = StudioChromeTargetKind.ComponentEnabled;
				target.objectHandle = selectedObjectHandle;
				target.componentHandle = snapshot.selectedComponentHandle;
			}
			return;
		}
		if (selectedObjectHandle === 0) {
			return;
		}
		for (let axis = 0; axis < 3; axis += 1) {
			if (point_in_rect(x, y, layout.positionMinus[axis])) {
				target.kind = StudioChromeTargetKind.PositionMinus;
				target.objectHandle = selectedObjectHandle;
				target.axis = axis;
				return;
			}
			if (point_in_rect(x, y, layout.positionPlus[axis])) {
				target.kind = StudioChromeTargetKind.PositionPlus;
				target.objectHandle = selectedObjectHandle;
				target.axis = axis;
				return;
			}
		}
		if (point_in_rect(x, y, layout.visibleToggle)) {
			target.kind = StudioChromeTargetKind.Visible;
			target.objectHandle = selectedObjectHandle;
		}
	}

	private writeTreeTarget(flatTargetRow: number, target: StudioChromeTarget): void {
		const snapshot = this.model.snapshot;
		let flatRow = 0;
		for (let objectIndex = 0; objectIndex < snapshot.objects.size; objectIndex += 1) {
			const object = snapshot.objects.peek(objectIndex);
			if (flatRow === flatTargetRow) {
				target.kind = StudioChromeTargetKind.Object;
				target.objectHandle = object.handle;
				return;
			}
			flatRow += 1;
			for (let localIndex = 0; localIndex < object.componentCount; localIndex += 1) {
				const component = snapshot.components.peek(object.firstComponent + localIndex);
				if (flatRow === flatTargetRow) {
					target.kind = StudioChromeTargetKind.Component;
					target.objectHandle = object.handle;
					target.componentHandle = component.handle;
					return;
				}
				flatRow += 1;
			}
		}
	}

	private activateTarget(target: StudioChromeTarget): void {
		const connection = this.model.connection;
		if (connection.commandPending || !this.model.ready) {
			return;
		}
		const snapshot = this.model.snapshot;
		switch (target.kind) {
			case StudioChromeTargetKind.None:
			case StudioChromeTargetKind.Chrome:
				return;
			case StudioChromeTargetKind.Play:
				if ((snapshot.flags & STUDIO_FLAG_GAMEPLAY_RUNNING) !== 0) {
					return;
				}
				connection.submit(STUDIO_COMMAND_SET_GAMEPLAY_RUNNING, 0, 0, 1, 0, 0, 0, 0, 0);
				return;
			case StudioChromeTargetKind.Edit:
				if ((snapshot.flags & STUDIO_FLAG_GAMEPLAY_RUNNING) === 0) {
					return;
				}
				connection.submit(STUDIO_COMMAND_SET_GAMEPLAY_RUNNING, 0, 0, 0, 0, 0, 0, 0, 0);
				return;
			case StudioChromeTargetKind.Object:
				if (snapshot.selectedObjectHandle === target.objectHandle
					&& snapshot.selectedComponentHandle === 0) {
					return;
				}
				connection.submit(STUDIO_COMMAND_SELECT, target.objectHandle, 0, 0, 0, 0, 0, 0, 0);
				return;
			case StudioChromeTargetKind.Component:
				if (snapshot.selectedComponentHandle === target.componentHandle) {
					return;
				}
				connection.submit(
					STUDIO_COMMAND_SELECT,
					target.objectHandle,
					target.componentHandle,
					0,
					0,
					0,
					0,
					0,
					0,
				);
				return;
			case StudioChromeTargetKind.PositionMinus:
			case StudioChromeTargetKind.PositionPlus: {
				const object = this.model.findObject(target.objectHandle)!;
				const direction = target.kind === StudioChromeTargetKind.PositionPlus ? 1 : -1;
				let xWord = object.xWord;
				let yWord = object.yWord;
				let zWord = object.zWord;
				if (target.axis === 0) {
					xWord = numberToF32Bits(object.x + direction * STUDIO_POSITION_STEP);
				} else if (target.axis === 1) {
					yWord = numberToF32Bits(object.y + direction * STUDIO_POSITION_STEP);
				} else {
					zWord = numberToF32Bits(object.z + direction * STUDIO_POSITION_STEP);
				}
				connection.submit(
					STUDIO_COMMAND_SET_POS,
					object.handle,
					0,
					xWord,
					yWord,
					zWord,
					0,
					0,
					0,
				);
				return;
			}
			case StudioChromeTargetKind.Visible: {
				const object = this.model.findObject(target.objectHandle)!;
				connection.submit(
					STUDIO_COMMAND_SET_VISIBLE,
					object.handle,
					0,
					(object.flags & STUDIO_OBJECT_FLAG_VISIBLE) === 0 ? 1 : 0,
					0,
					0,
					0,
					0,
					0,
				);
				return;
			}
			case StudioChromeTargetKind.ComponentEnabled: {
				const component = this.model.findComponent(target.componentHandle)!;
				connection.submit(
					STUDIO_COMMAND_SET_COMPONENT_ENABLED,
					target.objectHandle,
					component.handle,
					(component.flags & STUDIO_COMPONENT_FLAG_ENABLED) === 0 ? 1 : 0,
					0,
					0,
					0,
					0,
					0,
				);
			}
		}
	}

	private updateDetailsText(): void {
		const snapshot = this.model.snapshot;
		if (snapshot.selectedComponentHandle !== 0) {
			this.updateComponentDetails(
				this.model.findComponent(snapshot.selectedComponentHandle)!,
			);
			return;
		}
		if (snapshot.selectedObjectHandle !== 0) {
			this.updateObjectDetails(
				this.model.findObject(snapshot.selectedObjectHandle)!,
			);
			return;
		}
		const details = this.state.details;
		if (details.kind === 0) {
			return;
		}
		details.kind = 0;
		details.objectHandle = 0;
		details.componentHandle = 0;
		details.title = 'NO SELECTION';
		details.line1 = '';
		details.line2 = '';
		details.line3 = '';
		details.x = '';
		details.y = '';
		details.z = '';
		details.toggle = '';
	}

	private updateObjectDetails(object: StudioObjectRecord): void {
		const details = this.state.details;
		if (details.kind === 1
			&& details.objectHandle === object.handle
			&& details.definitionTokenLo === object.definitionTokenLo
			&& details.definitionTokenHi === object.definitionTokenHi
			&& details.spaceTokenLo === object.spaceTokenLo
			&& details.spaceTokenHi === object.spaceTokenHi
			&& details.xWord === object.xWord
			&& details.yWord === object.yWord
			&& details.zWord === object.zWord
			&& details.flags === object.flags) {
			return;
		}
		details.kind = 1;
		details.objectHandle = object.handle;
		details.componentHandle = 0;
		details.definitionTokenLo = object.definitionTokenLo;
		details.definitionTokenHi = object.definitionTokenHi;
		details.spaceTokenLo = object.spaceTokenLo;
		details.spaceTokenHi = object.spaceTokenHi;
		details.xWord = object.xWord;
		details.yWord = object.yWord;
		details.zWord = object.zWord;
		details.flags = object.flags;
		details.title = object.label;
		details.line1 = `DEFH ${formatNumberAsHex(object.definitionTokenHi, 8)}`;
		details.line2 = `DEFL ${formatNumberAsHex(object.definitionTokenLo, 8)}`;
		details.line3 = `TOK ${tokenKey(object.spaceTokenLo, object.spaceTokenHi).slice(0, 8)}`;
		details.x = `X ${object.x.toFixed(2)}`;
		details.y = `Y ${object.y.toFixed(2)}`;
		details.z = `Z ${object.z.toFixed(2)}`;
		details.toggle = (object.flags & STUDIO_OBJECT_FLAG_VISIBLE) !== 0
			? 'VISIBLE ON'
			: 'VISIBLE OFF';
	}

	private updateComponentDetails(component: StudioComponentRecord): void {
		const details = this.state.details;
		if (details.kind === 2
			&& details.componentHandle === component.handle
			&& details.ownerHandle === component.ownerHandle
			&& details.classWord === component.classWord
			&& details.localIdKind === component.localIdKind
			&& details.localIdLo === component.localIdLo
			&& details.localIdHi === component.localIdHi
			&& details.flags === component.flags) {
			return;
		}
		details.kind = 2;
		details.objectHandle = component.ownerHandle;
		details.componentHandle = component.handle;
		details.ownerHandle = component.ownerHandle;
		details.classWord = component.classWord;
		details.localIdKind = component.localIdKind;
		details.localIdLo = component.localIdLo;
		details.localIdHi = component.localIdHi;
		details.flags = component.flags;
		details.title = component.label;
		details.line1 = `OWNER ${formatNumberAsHex(component.ownerHandle, 8)}`;
		details.line2 = `CLASS ${formatNumberAsHex(component.classWord, 4)}`;
		if (component.localIdKind === STUDIO_COMPONENT_LOCAL_ID_NONE) {
			details.line3 = 'LOCAL NONE';
		} else if (component.localIdKind === STUDIO_COMPONENT_LOCAL_ID_F32) {
			details.line3 = `LOCAL ${f32BitsToNumber(component.localIdLo).toFixed(2)}`;
		} else if (component.localIdKind === STUDIO_COMPONENT_LOCAL_ID_TOKEN) {
			details.line3 = `LOCAL ${tokenKey(component.localIdLo, component.localIdHi).slice(0, 8)}`;
		} else {
			details.line3 = `LOCAL${component.localIdKind} ${formatNumberAsHex(component.localIdLo, 8)}`;
		}
		details.x = '';
		details.y = '';
		details.z = '';
		details.toggle = (component.flags & STUDIO_COMPONENT_FLAG_ENABLED) !== 0
			? 'ENABLED ON'
			: 'ENABLED OFF';
	}
}
