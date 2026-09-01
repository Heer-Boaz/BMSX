import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { f32BitsToNumber } from '../../../../machine/ts/machine/common/numeric';
import { StudioBoardConnection } from './connection';
import {
	STUDIO_COMPONENT_CLASS_WORD,
	STUDIO_COMPONENT_FLAGS,
	STUDIO_COMPONENT_HANDLE,
	STUDIO_COMPONENT_LOCAL_ID_HI,
	STUDIO_COMPONENT_LOCAL_ID_KIND,
	STUDIO_COMPONENT_LOCAL_ID_LO,
	STUDIO_COMPONENT_OWNER_HANDLE,
	STUDIO_COMPONENT_PICK_BOTTOM,
	STUDIO_COMPONENT_PICK_LEFT,
	STUDIO_COMPONENT_PICK_RIGHT,
	STUDIO_COMPONENT_PICK_TOP,
	STUDIO_COMPONENT_VISUAL_ORDER,
	STUDIO_DESCRIPTOR_MAGIC,
	STUDIO_DESCRIPTOR_VERSION,
	STUDIO_HEADER_ACTIVE_SPACE_TOKEN_HI,
	STUDIO_HEADER_ACTIVE_SPACE_TOKEN_LO,
	STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE,
	STUDIO_HEADER_BOARD_SLOT,
	STUDIO_HEADER_COMMAND_WORD_COUNT,
	STUDIO_HEADER_COMMAND_WORD_OFFSET,
	STUDIO_HEADER_COMPONENT_COUNT,
	STUDIO_HEADER_COMPONENT_STRIDE_WORDS,
	STUDIO_HEADER_COMPONENT_TABLE_WORD_OFFSET,
	STUDIO_HEADER_FLAGS,
	STUDIO_HEADER_GAME_ORIGIN,
	STUDIO_HEADER_GAME_SLOT,
	STUDIO_HEADER_HOVER_OBJECT_HANDLE,
	STUDIO_HEADER_MAGIC,
	STUDIO_HEADER_OBJECT_COUNT,
	STUDIO_HEADER_OBJECT_STRIDE_WORDS,
	STUDIO_HEADER_OBJECT_TABLE_WORD_OFFSET,
	STUDIO_HEADER_OVERLAY_ORIGIN,
	STUDIO_HEADER_POINTER_X,
	STUDIO_HEADER_POINTER_Y,
	STUDIO_HEADER_REVISION,
	STUDIO_HEADER_SELECTED_COMPONENT_HANDLE,
	STUDIO_HEADER_SELECTED_OBJECT_HANDLE,
	STUDIO_HEADER_VERSION,
	STUDIO_HEADER_VIEW_HEIGHT,
	STUDIO_HEADER_VIEW_ORIGIN_X,
	STUDIO_HEADER_VIEW_ORIGIN_Y,
	STUDIO_HEADER_VIEW_WIDTH,
	STUDIO_OBJECT_COMPONENT_COUNT,
	STUDIO_OBJECT_DEFINITION_TOKEN_HI,
	STUDIO_OBJECT_DEFINITION_TOKEN_LO,
	STUDIO_OBJECT_FIRST_COMPONENT,
	STUDIO_OBJECT_FLAGS,
	STUDIO_OBJECT_HANDLE,
	STUDIO_OBJECT_PARENT_HANDLE,
	STUDIO_OBJECT_PICK_BOTTOM,
	STUDIO_OBJECT_PICK_LEFT,
	STUDIO_OBJECT_PICK_RIGHT,
	STUDIO_OBJECT_PICK_TOP,
	STUDIO_OBJECT_SPACE_TOKEN_HI,
	STUDIO_OBJECT_SPACE_TOKEN_LO,
	STUDIO_OBJECT_SX,
	STUDIO_OBJECT_SY,
	STUDIO_OBJECT_VISUAL_ORDER,
	STUDIO_OBJECT_X,
	STUDIO_OBJECT_Y,
	STUDIO_OBJECT_Z,
} from './protocol';

export type StudioObjectRecord = {
	handle: number;
	definitionTokenLo: number;
	definitionTokenHi: number;
	spaceTokenLo: number;
	spaceTokenHi: number;
	parentHandle: number;
	xWord: number;
	yWord: number;
	zWord: number;
	sxWord: number;
	syWord: number;
	pickLeftWord: number;
	pickTopWord: number;
	pickRightWord: number;
	pickBottomWord: number;
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	pickLeft: number;
	pickTop: number;
	pickRight: number;
	pickBottom: number;
	flags: number;
	firstComponent: number;
	componentCount: number;
	visualOrder: number;
	label: string;
};

export type StudioComponentRecord = {
	handle: number;
	ownerHandle: number;
	classWord: number;
	localIdKind: number;
	localIdLo: number;
	localIdHi: number;
	flags: number;
	pickLeftWord: number;
	pickTopWord: number;
	pickRightWord: number;
	pickBottomWord: number;
	pickLeft: number;
	pickTop: number;
	pickRight: number;
	pickBottom: number;
	visualOrder: number;
	label: string;
};

function createObjectRecord(): StudioObjectRecord {
	return {
		handle: 0,
		definitionTokenLo: 0,
		definitionTokenHi: 0,
		spaceTokenLo: 0,
		spaceTokenHi: 0,
		parentHandle: 0,
		xWord: 0,
		yWord: 0,
		zWord: 0,
		sxWord: 0,
		syWord: 0,
		pickLeftWord: 0,
		pickTopWord: 0,
		pickRightWord: 0,
		pickBottomWord: 0,
		x: 0,
		y: 0,
		z: 0,
		sx: 0,
		sy: 0,
		pickLeft: 0,
		pickTop: 0,
		pickRight: 0,
		pickBottom: 0,
		flags: 0,
		firstComponent: 0,
		componentCount: 0,
		visualOrder: 0,
		label: '',
	};
}

function createComponentRecord(): StudioComponentRecord {
	return {
		handle: 0,
		ownerHandle: 0,
		classWord: 0,
		localIdKind: 0,
		localIdLo: 0,
		localIdHi: 0,
		flags: 0,
		pickLeftWord: 0,
		pickTopWord: 0,
		pickRightWord: 0,
		pickBottomWord: 0,
		pickLeft: 0,
		pickTop: 0,
		pickRight: 0,
		pickBottom: 0,
		visualOrder: 0,
		label: '',
	};
}

export class StudioDescriptorSnapshot {
	public revision = 0;
	public flags = 0;
	public objectCount = 0;
	public componentCount = 0;
	public selectedObjectHandle = 0;
	public selectedComponentHandle = 0;
	public hoverObjectHandle = 0;
	public activeSpaceTokenLo = 0;
	public activeSpaceTokenHi = 0;
	public viewOriginX = 0;
	public viewOriginY = 0;
	public viewWidth = 0;
	public viewHeight = 0;
	public pointerXWord = 0;
	public pointerYWord = 0;
	public pointerX = 0;
	public pointerY = 0;
	public appliedCommandSequence = 0;
	public objectTableWordOffset = 0;
	public objectStrideWords = 0;
	public componentTableWordOffset = 0;
	public componentStrideWords = 0;
	public commandWordOffset = 0;
	public commandWordCount = 0;
	public gameSlot = 0;
	public boardSlot = 0;
	public overlayOrigin = 0;
	public gameOrigin = 0;
	public readonly objects = new ScratchBuffer<StudioObjectRecord>(createObjectRecord);
	public readonly components = new ScratchBuffer<StudioComponentRecord>(createComponentRecord);
}

export class StudioDescriptorModel {
	private activeSnapshot = new StudioDescriptorSnapshot();
	private standbySnapshot = new StudioDescriptorSnapshot();
	private published = false;

	public constructor(public readonly connection: StudioBoardConnection) {
	}

	public get ready(): boolean {
		return this.published;
	}

	public get snapshot(): StudioDescriptorSnapshot {
		return this.activeSnapshot;
	}

	public synchronize(): boolean {
		const connection = this.connection;
		connection.selectBoard();
		const firstRevision = connection.readBoardWord(STUDIO_HEADER_REVISION);
		if ((firstRevision & 1) !== 0) {
			connection.selectGame();
			return false;
		}
		if (this.published && firstRevision === this.activeSnapshot.revision) {
			connection.selectGame();
			return false;
		}
		const magic = connection.readBoardWord(STUDIO_HEADER_MAGIC);
		const version = connection.readBoardWord(STUDIO_HEADER_VERSION);
		if (magic !== STUDIO_DESCRIPTOR_MAGIC || version !== STUDIO_DESCRIPTOR_VERSION) {
			connection.selectGame();
			this.published = false;
			return false;
		}

		const target = this.standbySnapshot;
		target.revision = firstRevision;
		target.flags = connection.readBoardWord(STUDIO_HEADER_FLAGS);
		target.objectCount = connection.readBoardWord(STUDIO_HEADER_OBJECT_COUNT);
		target.componentCount = connection.readBoardWord(STUDIO_HEADER_COMPONENT_COUNT);
		target.selectedObjectHandle = connection.readBoardWord(STUDIO_HEADER_SELECTED_OBJECT_HANDLE);
		target.selectedComponentHandle = connection.readBoardWord(STUDIO_HEADER_SELECTED_COMPONENT_HANDLE);
		target.hoverObjectHandle = connection.readBoardWord(STUDIO_HEADER_HOVER_OBJECT_HANDLE);
		target.activeSpaceTokenLo = connection.readBoardWord(STUDIO_HEADER_ACTIVE_SPACE_TOKEN_LO);
		target.activeSpaceTokenHi = connection.readBoardWord(STUDIO_HEADER_ACTIVE_SPACE_TOKEN_HI);
		target.viewOriginX = connection.readBoardWord(STUDIO_HEADER_VIEW_ORIGIN_X);
		target.viewOriginY = connection.readBoardWord(STUDIO_HEADER_VIEW_ORIGIN_Y);
		target.viewWidth = connection.readBoardWord(STUDIO_HEADER_VIEW_WIDTH);
		target.viewHeight = connection.readBoardWord(STUDIO_HEADER_VIEW_HEIGHT);
		target.pointerXWord = connection.readBoardWord(STUDIO_HEADER_POINTER_X);
		target.pointerYWord = connection.readBoardWord(STUDIO_HEADER_POINTER_Y);
		target.pointerX = f32BitsToNumber(target.pointerXWord);
		target.pointerY = f32BitsToNumber(target.pointerYWord);
		target.appliedCommandSequence = connection.readBoardWord(STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE);
		target.objectTableWordOffset = connection.readBoardWord(STUDIO_HEADER_OBJECT_TABLE_WORD_OFFSET);
		target.objectStrideWords = connection.readBoardWord(STUDIO_HEADER_OBJECT_STRIDE_WORDS);
		target.componentTableWordOffset = connection.readBoardWord(STUDIO_HEADER_COMPONENT_TABLE_WORD_OFFSET);
		target.componentStrideWords = connection.readBoardWord(STUDIO_HEADER_COMPONENT_STRIDE_WORDS);
		target.commandWordOffset = connection.readBoardWord(STUDIO_HEADER_COMMAND_WORD_OFFSET);
		target.commandWordCount = connection.readBoardWord(STUDIO_HEADER_COMMAND_WORD_COUNT);
		target.gameSlot = connection.readBoardWord(STUDIO_HEADER_GAME_SLOT);
		target.boardSlot = connection.readBoardWord(STUDIO_HEADER_BOARD_SLOT);
		target.overlayOrigin = connection.readBoardWord(STUDIO_HEADER_OVERLAY_ORIGIN);
		target.gameOrigin = connection.readBoardWord(STUDIO_HEADER_GAME_ORIGIN);

		target.objects.clear();
		for (let index = 0; index < target.objectCount; index += 1) {
			const record = target.objects.get(index);
			const offset = target.objectTableWordOffset + index * target.objectStrideWords;
			const handle = connection.readBoardWord(offset + STUDIO_OBJECT_HANDLE);
			if (record.handle !== handle) {
				record.label = `O ${formatNumberAsHex(handle, 8)}`;
			}
			record.handle = handle;
			record.definitionTokenLo = connection.readBoardWord(offset + STUDIO_OBJECT_DEFINITION_TOKEN_LO);
			record.definitionTokenHi = connection.readBoardWord(offset + STUDIO_OBJECT_DEFINITION_TOKEN_HI);
			record.spaceTokenLo = connection.readBoardWord(offset + STUDIO_OBJECT_SPACE_TOKEN_LO);
			record.spaceTokenHi = connection.readBoardWord(offset + STUDIO_OBJECT_SPACE_TOKEN_HI);
			record.parentHandle = connection.readBoardWord(offset + STUDIO_OBJECT_PARENT_HANDLE);
			record.xWord = connection.readBoardWord(offset + STUDIO_OBJECT_X);
			record.yWord = connection.readBoardWord(offset + STUDIO_OBJECT_Y);
			record.zWord = connection.readBoardWord(offset + STUDIO_OBJECT_Z);
			record.sxWord = connection.readBoardWord(offset + STUDIO_OBJECT_SX);
			record.syWord = connection.readBoardWord(offset + STUDIO_OBJECT_SY);
			record.pickLeftWord = connection.readBoardWord(offset + STUDIO_OBJECT_PICK_LEFT);
			record.pickTopWord = connection.readBoardWord(offset + STUDIO_OBJECT_PICK_TOP);
			record.pickRightWord = connection.readBoardWord(offset + STUDIO_OBJECT_PICK_RIGHT);
			record.pickBottomWord = connection.readBoardWord(offset + STUDIO_OBJECT_PICK_BOTTOM);
			record.x = f32BitsToNumber(record.xWord);
			record.y = f32BitsToNumber(record.yWord);
			record.z = f32BitsToNumber(record.zWord);
			record.sx = f32BitsToNumber(record.sxWord);
			record.sy = f32BitsToNumber(record.syWord);
			// disable-next-line repeated_statement_sequence_pattern -- every raw ABI word crosses the central f32 datapath directly; Studio must not invent a batch decoder.
			record.pickLeft = f32BitsToNumber(record.pickLeftWord);
			record.pickTop = f32BitsToNumber(record.pickTopWord);
			record.pickRight = f32BitsToNumber(record.pickRightWord);
			record.pickBottom = f32BitsToNumber(record.pickBottomWord);
			record.flags = connection.readBoardWord(offset + STUDIO_OBJECT_FLAGS);
			record.firstComponent = connection.readBoardWord(offset + STUDIO_OBJECT_FIRST_COMPONENT);
			record.componentCount = connection.readBoardWord(offset + STUDIO_OBJECT_COMPONENT_COUNT);
			record.visualOrder = connection.readBoardWord(offset + STUDIO_OBJECT_VISUAL_ORDER);
		}

		target.components.clear();
		for (let index = 0; index < target.componentCount; index += 1) {
			const record = target.components.get(index);
			const offset = target.componentTableWordOffset + index * target.componentStrideWords;
			const handle = connection.readBoardWord(offset + STUDIO_COMPONENT_HANDLE);
			const classWord = connection.readBoardWord(offset + STUDIO_COMPONENT_CLASS_WORD);
			if (record.handle !== handle || record.classWord !== classWord) {
				record.label = `C${classWord} ${formatNumberAsHex(handle, 8)}`;
			}
			record.handle = handle;
			record.ownerHandle = connection.readBoardWord(offset + STUDIO_COMPONENT_OWNER_HANDLE);
			record.classWord = classWord;
			record.localIdKind = connection.readBoardWord(offset + STUDIO_COMPONENT_LOCAL_ID_KIND);
			record.localIdLo = connection.readBoardWord(offset + STUDIO_COMPONENT_LOCAL_ID_LO);
			record.localIdHi = connection.readBoardWord(offset + STUDIO_COMPONENT_LOCAL_ID_HI);
			record.flags = connection.readBoardWord(offset + STUDIO_COMPONENT_FLAGS);
			record.pickLeftWord = connection.readBoardWord(offset + STUDIO_COMPONENT_PICK_LEFT);
			record.pickTopWord = connection.readBoardWord(offset + STUDIO_COMPONENT_PICK_TOP);
			record.pickRightWord = connection.readBoardWord(offset + STUDIO_COMPONENT_PICK_RIGHT);
			record.pickBottomWord = connection.readBoardWord(offset + STUDIO_COMPONENT_PICK_BOTTOM);
			// disable-next-line repeated_statement_sequence_pattern -- every raw ABI word crosses the central f32 datapath directly; Studio must not invent a batch decoder.
			record.pickLeft = f32BitsToNumber(record.pickLeftWord);
			record.pickTop = f32BitsToNumber(record.pickTopWord);
			record.pickRight = f32BitsToNumber(record.pickRightWord);
			record.pickBottom = f32BitsToNumber(record.pickBottomWord);
			record.visualOrder = connection.readBoardWord(offset + STUDIO_COMPONENT_VISUAL_ORDER);
		}

		const secondRevision = connection.readBoardWord(STUDIO_HEADER_REVISION);
		connection.selectGame();
		if (firstRevision !== secondRevision || (secondRevision & 1) !== 0) {
			return false;
		}
		this.standbySnapshot = this.activeSnapshot;
		this.activeSnapshot = target;
		this.published = true;
		connection.setAppliedCommandSequence(target.appliedCommandSequence);
		return true;
	}

	public findObject(handle: number): StudioObjectRecord | null {
		const objects = this.activeSnapshot.objects;
		for (let index = 0; index < objects.size; index += 1) {
			const object = objects.peek(index);
			if (object.handle === handle) {
				return object;
			}
		}
		return null;
	}

	public findComponent(handle: number): StudioComponentRecord | null {
		const components = this.activeSnapshot.components;
		for (let index = 0; index < components.size; index += 1) {
			const component = components.peek(index);
			if (component.handle === handle) {
				return component;
			}
		}
		return null;
	}
}
