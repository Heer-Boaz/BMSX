import type { LuaFunctionValue } from '../../lua/value';
import type { CartManifest, MachineManifest, asset_id, Viewport } from '../../rompack/format';
import type { MachineSaveState, MachineState } from '../machine';
import type { Memory } from '../memory/memory';
import type { LuaEntrySnapshot } from '../firmware/js_bridge';
import type { RuntimeStorageState } from '../firmware/cart_storage';
import type { FrameSchedulerStateSnapshot } from '../scheduler/frame';
import type { CpuRuntimeState } from '../cpu/cpu';
import type { SpriteParallaxRig } from '../../render/shared/submissions';

export type { LuaEntrySnapshot };

export type ResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: asset_id;
	readOnly?: boolean;
};

export type LuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export type LuaHoverScope = 'global' | 'path';

export type LuaHoverValueState = 'value' | 'not_defined';

export type LuaDefinitionRange = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

export type LuaDefinitionLocation = {
	path: string;
	range: LuaDefinitionRange;
};

export type LuaSymbolKind =
	| 'variable'
	| 'constant'
	| 'function'
	| 'table_field'
	| 'parameter'
	| 'assignment';

export type LuaSymbolEntry = {
	name: string;
	path: string;
	kind: LuaSymbolKind;
	location: LuaDefinitionLocation;
};

export type LuaBuiltinDescriptor = {
	name: string;
	params: string[];
	signature: string;
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string)[];
	description?: string;
};

export type LuaHoverRequest = {
	expression: string;
	path: string;
	row: number;
	column: number;
};

export type LuaMemberCompletionRequest = {
	objectName?: string;
	prefix?: string;
	path: string;
	expression?: string;
	operator: '.' | ':';
};

export type LuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string;
	parameters: string[];
};

export type SymbolKind =
	| 'function'
	| 'table'
	| 'constant';

export type SymbolEntry = {
	name: string;
	kind: SymbolKind;
	valueType: string;
	origin: string;
	module?: string;
};

export type LuaHoverResult = {
	expression: string;
	lines: string[];
	valueType: string;
	scope: LuaHoverScope;
	state: LuaHoverValueState;
	isFunction: boolean;
	isLocalFunction: boolean;
	isBuiltin: boolean;
	definition?: LuaDefinitionLocation;
};

export type RuntimeOptions = {
	playerIndex: number;
	viewport: Viewport;
	memory: Memory;
	activeMachineManifest: MachineManifest;
	cartManifest: CartManifest | null;
	cartProjectRootPath: string | null;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	vdpWorkUnitsPerSec?: number;
	geoWorkUnitsPerSec?: number;
};

export type GameViewState = {
	viewportSize: {
		x: number;
		y: number;
	};
	crt_postprocessing_enabled: boolean;
	enable_noise: boolean;
	enable_colorbleed: boolean;
	enable_scanlines: boolean;
	enable_blur: boolean;
	enable_glow: boolean;
	enable_fringing: boolean;
	enable_aperture: boolean;
};

export type RuntimeRenderCameraState = {
	view: number[];
	proj: number[];
	eye: [number, number, number];
};

export type RuntimeAmbientLightState = {
	id: string;
	color: [number, number, number];
	intensity: number;
};

export type RuntimeDirectionalLightState = {
	id: string;
	color: [number, number, number];
	intensity: number;
	orientation: [number, number, number];
};

export type RuntimePointLightState = {
	id: string;
	color: [number, number, number];
	intensity: number;
	pos: [number, number, number];
	range: number;
};

export type RuntimeRenderState = {
	camera: RuntimeRenderCameraState | null;
	ambientLights: RuntimeAmbientLightState[];
	directionalLights: RuntimeDirectionalLightState[];
	pointLights: RuntimePointLightState[];
	spriteParallaxRig: SpriteParallaxRig;
};

export type RuntimeMachineState = {
	machine: MachineState;
	frameScheduler: FrameSchedulerStateSnapshot;
	vblank: {
		cyclesIntoFrame: number;
	};
};

export type RuntimeSaveMachineState = {
	machine: MachineSaveState;
	frameScheduler: FrameSchedulerStateSnapshot;
	vblank: {
		cyclesIntoFrame: number;
	};
};

export type RuntimeResumeSnapshot = {
	luaRuntimeFailed: boolean;
	luaPath: string;
	storageState: RuntimeStorageState;
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaRandomSeed?: number;
	luaProgramCounter?: number;
	gameViewState: GameViewState;
	renderState: RuntimeRenderState;
	machineState: RuntimeMachineState;
};

export type RuntimeSaveState = {
	storageState: RuntimeStorageState;
	machineState: RuntimeSaveMachineState;
	cpuState: CpuRuntimeState;
	gameViewState: GameViewState;
	renderState: RuntimeRenderState;
	engineProgramActive: boolean;
	luaInitialized: boolean;
	luaRuntimeFailed: boolean;
	randomSeed: number;
	pendingEntryCall: boolean;
};

export type LuaMarshalContext = {
	moduleId: string;
	path: string[];
};

export type LuaFunctionRedirectRecord = {
	key: string;
	moduleId: string;
	path: ReadonlyArray<string>;
	current: LuaFunctionValue;
	redirect: LuaFunctionValue;
};
