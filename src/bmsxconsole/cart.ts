import type { BmsxConsoleApi, BmsxConsoleCartridge } from 'bmsx/console';
import { BmsxConsoleButton } from 'bmsx/console';
import { BitmapId } from './resourceids';
import { clamp } from 'bmsx/utils/utils';

const SAVE_VERSION = 2;
const STORAGE_NAMESPACE = 'fu_char_mgr_v2';

const DIE_STEPS: number[] = [6, 8, 10, 12];

type Mode = 'track' | 'status' | 'edit';

type BaseDice = {
	dex: number;
	ins: number;
	mig: number;
	wlp: number;
};

type CharacterPools = {
	hp: number;
	hpmax: number;
	mp: number;
	mpmax: number;
	ip: number;
	ipmax: number;
};

type Character = CharacterPools & {
	name: string;
	base: BaseDice;
	smask: number;
};

type StatusDefinition = {
	id: number;
	name: string;
};

type StatusReductions = {
	dex: number;
	ins: number;
	mig: number;
	wlp: number;
};

type CurrentDice = BaseDice;

type Defenses = {
	def: number;
	mdef: number;
};

type ActionFlags = {
	attack: boolean;
	equipment: boolean;
	guard: boolean;
	hinder: boolean;
	inventory: boolean;
	objective: boolean;
	spell: boolean;
	study: boolean;
	skill: boolean;
	other: boolean;
};

const COLOR_BACKGROUND = 0;
const COLOR_PANEL_BORDER = 14;
const COLOR_PANEL_FILL = 4;
const COLOR_TEXT = 15;
const COLOR_TEXT_DIM = 9;
const COLOR_HEADER = 11;
const COLOR_HIGHLIGHT = 13;
const COLOR_WARNING = 8;
type DemoBounds = { x: number; y: number; width: number; height: number };

type DemoBall = {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	color: number;
	colliderId: string;
};

type CharacterManagerCartState = {
	mode: Mode;
	selection: number;
	character: Character;
	demoBalls: DemoBall[];
};

const DEMO_BOUNDS: DemoBounds = { x: 68, y: 108, width: 56, height: 18 };
const WALL_IDS = ['console_wall_left', 'console_wall_right', 'console_wall_top', 'console_wall_bottom'] as const;
const DEMO_RESTITUTION = 0.95;
const DEMO_LABEL_COLOR = 12;

const STATUS_DEFINITIONS: StatusDefinition[] = [
	{ id: 0, name: 'DAZED' },
	{ id: 1, name: 'ENRAGED' },
	{ id: 2, name: 'POISONED' },
	{ id: 3, name: 'SHAKEN' },
	{ id: 4, name: 'SLOW' },
	{ id: 5, name: 'WEAK' },
];

const SAVE_SLOT_VERSION = 0;
const SAVE_SLOT_BASE_DEX = 1;
const SAVE_SLOT_BASE_INS = 2;
const SAVE_SLOT_BASE_MIG = 3;
const SAVE_SLOT_BASE_WLP = 4;
const SAVE_SLOT_HPMAX = 5;
const SAVE_SLOT_MPMAX = 6;
const SAVE_SLOT_IPMAX = 7;
const SAVE_SLOT_HP = 8;
const SAVE_SLOT_MP = 9;
const SAVE_SLOT_IP = 10;
const SAVE_SLOT_STATUS = 11;

function dieToNumber(value: string | number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== 'string') return 0;
	let cursor = value.trim();
	if (!cursor) return 0;
	const first = cursor.charAt(0);
	if (first === 'd' || first === 'D') {
		cursor = cursor.slice(1);
	}
	const direct = Number(cursor);
	if (Number.isFinite(direct)) return direct;
	const match = cursor.match(/\d+/);
	if (!match) return 0;
	return Number(match[0]);
}

function dieIndex(value: string | number): number {
	const numeric = dieToNumber(value);
	for (let i = 0; i < DIE_STEPS.length; i++) {
		if (DIE_STEPS[i] === numeric) return i + 1;
	}
	return 1;
}

function stepDie(value: string | number, delta: number): number {
	const currentIndex = dieIndex(value);
	const nextIndex = clamp(currentIndex + delta, 1, DIE_STEPS.length);
	return DIE_STEPS[nextIndex - 1];
}

function dieString(value: number): string {
	return `d${value}`;
}

function colorForAvailability(ok: boolean): number {
	return ok ? COLOR_TEXT : COLOR_TEXT_DIM;
}

class CharacterManagerCart implements BmsxConsoleCartridge {
	public readonly meta = {
		title: 'Manga Ultima Helper',
		version: '0.2.0',
		persistentId: STORAGE_NAMESPACE,
	};

	private mode: Mode = 'track';
	private selection = 1;
	private character: Character = this.createCharacter();
	private demoBalls: DemoBall[] = [];

	public init(api: BmsxConsoleApi): void {
		this.character = this.createCharacter();
		this.load(api);
		this.initializeDemo(api);
	}

	public update(api: BmsxConsoleApi, deltaSeconds: number): void {
		if (api.btnp(BmsxConsoleButton.ActionX)) {
			this.advanceMode();
			this.selection = 1;
		}
		if (this.mode === 'track') {
			this.handleTrackInput(api);
		} else if (this.mode === 'status') {
			this.handleStatusInput(api);
		} else {
			this.handleEditInput(api);
		}
		this.updateDemoBalls(api, deltaSeconds);
	}

	public draw(api: BmsxConsoleApi): void {
		api.cls(COLOR_BACKGROUND);
		this.drawHeader(api);
		this.drawPoolsAndActions(api);
		this.drawStatsAndStatuses(api);
		this.drawBallDemo(api);
	}

	public captureState(_api: BmsxConsoleApi): CharacterManagerCartState {
		return {
			mode: this.mode,
			selection: this.selection,
			character: this.cloneCharacterState(this.character),
			demoBalls: this.demoBalls.map(ball => ({ ...ball })),
		};
	}

	public restoreState(api: BmsxConsoleApi, state: unknown): void {
		if (!state || typeof state !== 'object') {
			return;
		}
		const snapshot = state as Partial<CharacterManagerCartState>;
		if (!snapshot.character || !snapshot.demoBalls) {
			return;
		}
		if (snapshot.mode === 'track' || snapshot.mode === 'status' || snapshot.mode === 'edit') {
			this.mode = snapshot.mode;
		}
		if (typeof snapshot.selection === 'number' && Number.isFinite(snapshot.selection)) {
			this.selection = clamp(Math.floor(snapshot.selection), 1, 7);
		}
		this.character = this.cloneCharacterState(snapshot.character as Character);
		this.clampAll();
		this.demoBalls = (snapshot.demoBalls as DemoBall[]).map(ball => ({ ...ball }));
		for (const ball of this.demoBalls) {
			api.sprite_set_position(ball.colliderId, ball.x, ball.y);
			api.sprite_set_velocity(ball.colliderId, ball.vx, ball.vy);
		}
	}

	private createCharacter(): Character {
		return {
			name: 'HERO',
			hp: 20,
			hpmax: 20,
			mp: 10,
			mpmax: 10,
			ip: 3,
			ipmax: 3,
			base: { dex: 8, ins: 8, mig: 8, wlp: 8 },
			smask: 0,
		};
	}

	private cloneCharacterState(source: Character): Character {
		return {
			name: source.name,
			hp: source.hp,
			hpmax: source.hpmax,
			mp: source.mp,
			mpmax: source.mpmax,
			ip: source.ip,
			ipmax: source.ipmax,
			base: { ...source.base },
			smask: source.smask,
		};
	}

	private initializeDemo(api: BmsxConsoleApi): void {
		api.collider_clear();
		const radius = 3;
		api.define_sprite(1, BitmapId.ball, {
			width: 6,
			height: 6,
			originX: 3,
			originY: 3,
			// collider: { kind: 'circle', radius },
			physics: { mass: 1, restitution: DEMO_RESTITUTION, gravityScale: 0, isStatic: false },
		});
		const bounds = DEMO_BOUNDS;
		const wallSpecs = [
			{ id: WALL_IDS[0], kind: 'box' as const, width: 1, height: bounds.height, x: bounds.x - 0.5, y: bounds.y + bounds.height / 2 },
			{ id: WALL_IDS[1], kind: 'box' as const, width: 1, height: bounds.height, x: bounds.x + bounds.width + 0.5, y: bounds.y + bounds.height / 2 },
			{ id: WALL_IDS[2], kind: 'box' as const, width: bounds.width, height: 1, x: bounds.x + bounds.width / 2, y: bounds.y - 0.5 },
			{ id: WALL_IDS[3], kind: 'box' as const, width: bounds.width, height: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 0.5 },
		];
		for (const wall of wallSpecs) {
			api.collider_create(wall.id, { kind: 'box', width: wall.width, height: wall.height, isTrigger: false });
			api.collider_set_position(wall.id, wall.x, wall.y);
		}
		const initial = [
			{ id: 0, colliderId: 'console_ball_0', x: bounds.x + radius + 6, y: bounds.y + radius + 3, vx: 48, vy: 28, radius, color: COLOR_HEADER },
			{ id: 1, colliderId: 'console_ball_1', x: bounds.x + bounds.width - radius - 6, y: bounds.y + radius + 8, vx: -36, vy: -30, radius, color: COLOR_HIGHLIGHT },
		];
		this.demoBalls = initial.map(ball => ({ ...ball }));
		for (const ball of this.demoBalls) {
			api.sprite_set_position(ball.colliderId, ball.x, ball.y);
			api.sprite_set_velocity(ball.colliderId, ball.vx, ball.vy);
		}
	}

	private updateDemoBalls(api: BmsxConsoleApi, deltaSeconds: number): void {
		if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
		if (deltaSeconds === 0) {
			for (const ball of this.demoBalls) {
				api.sprite_set_position(ball.colliderId, ball.x, ball.y);
				api.sprite_set_velocity(ball.colliderId, ball.vx, ball.vy);
			}
		}
		for (const ball of this.demoBalls) {
			const center = api.sprite_center(ball.colliderId);
			if (!center) continue;
			ball.x = center.x;
			ball.y = center.y;
		}
	}

	private handleTrackInput(api: BmsxConsoleApi): void {
		if (api.btnp(BmsxConsoleButton.Up)) {
			this.selection = clamp(this.selection - 1, 1, 3);
		}
		if (api.btnp(BmsxConsoleButton.Down)) {
			this.selection = clamp(this.selection + 1, 1, 3);
		}
		let delta = 0;
		if (api.btnp(BmsxConsoleButton.Left)) delta -= 1;
		if (api.btnp(BmsxConsoleButton.Right)) delta += 1;
		if (delta === 0) return;
		if (this.selection === 1) {
			this.character.hp = clamp(this.character.hp + delta, 0, this.character.hpmax);
		} else if (this.selection === 2) {
			this.character.mp = clamp(this.character.mp + delta, 0, this.character.mpmax);
		} else {
			this.character.ip = clamp(this.character.ip + delta, 0, this.character.ipmax);
		}
		this.save(api);
	}

	private handleStatusInput(api: BmsxConsoleApi): void {
		const maxIndex = STATUS_DEFINITIONS.length;
		if (api.btnp(BmsxConsoleButton.Up)) {
			this.selection = clamp(this.selection - 1, 1, maxIndex);
		}
		if (api.btnp(BmsxConsoleButton.Down)) {
			this.selection = clamp(this.selection + 1, 1, maxIndex);
		}
		if (api.btnp(BmsxConsoleButton.ActionO)) {
			const status = STATUS_DEFINITIONS[this.selection - 1];
			this.toggleStatus(status.id);
			this.save(api);
		}
	}

	private handleEditInput(api: BmsxConsoleApi): void {
		const maxIndex = 7;
		if (api.btnp(BmsxConsoleButton.Up)) {
			this.selection = clamp(this.selection - 1, 1, maxIndex);
		}
		if (api.btnp(BmsxConsoleButton.Down)) {
			this.selection = clamp(this.selection + 1, 1, maxIndex);
		}
		let delta = 0;
		if (api.btnp(BmsxConsoleButton.Left)) delta -= 1;
		if (api.btnp(BmsxConsoleButton.Right)) delta += 1;
		if (delta === 0) return;
		if (this.selection === 1) this.character.base.dex = stepDie(this.character.base.dex, delta);
		else if (this.selection === 2) this.character.base.ins = stepDie(this.character.base.ins, delta);
		else if (this.selection === 3) this.character.base.mig = stepDie(this.character.base.mig, delta);
		else if (this.selection === 4) this.character.base.wlp = stepDie(this.character.base.wlp, delta);
		else if (this.selection === 5) {
			this.character.hpmax = Math.max(1, this.character.hpmax + delta);
			this.character.hp = clamp(this.character.hp, 0, this.character.hpmax);
		} else if (this.selection === 6) {
			this.character.mpmax = Math.max(0, this.character.mpmax + delta);
			this.character.mp = clamp(this.character.mp, 0, this.character.mpmax);
		} else {
			this.character.ipmax = Math.max(0, this.character.ipmax + delta);
			this.character.ip = clamp(this.character.ip, 0, this.character.ipmax);
		}
		this.clampAll();
		this.save(api);
	}

	private drawHeader(api: BmsxConsoleApi): void {
		api.rectfill(2, 2, 126, 12, COLOR_PANEL_FILL);
		api.rect(2, 2, 126, 12, COLOR_PANEL_BORDER);
		api.print('MANGA ULTIMA!!', 4, 4, COLOR_HEADER);
		const modeLabel = this.mode === 'track' ? 'MODE: TRACK' : this.mode === 'status' ? 'MODE: STATUS' : 'MODE: EDIT';
		api.print(modeLabel, 4, 10, COLOR_TEXT);
		api.print('X=MODE  O=STATUS', 86, 10, COLOR_TEXT_DIM);
	}

	private drawPoolsAndActions(api: BmsxConsoleApi): void {
		// Pools box
		api.rect(2, 14, 62, 46, COLOR_PANEL_BORDER);
		api.print('POOLS', 6, 16, COLOR_HEADER);
		let y = 24;
		const labels = ['HP', 'MP', 'IP'];
		const values = [
			`${this.character.hp}/${this.character.hpmax}`,
			`${this.character.mp}/${this.character.mpmax}`,
			`${this.character.ip}/${this.character.ipmax}`,
		];
		for (let i = 0; i < labels.length; i++) {
			const active = this.mode === 'track' && this.selection === i + 1;
			const color = active ? COLOR_HIGHLIGHT : COLOR_TEXT;
			api.print(`${labels[i]}: ${values[i]}`, 6, y, color);
			y += 8;
		}

		// Actions box
		api.rect(2, 48, 62, 126, COLOR_PANEL_BORDER);
		api.print('ACTIONS', 6, 50, COLOR_HEADER);
		const flags = this.actionFlags();
		const entries: Array<[string, boolean]> = [
			['ATTACK', flags.attack],
			['EQUIPMENT', flags.equipment],
			['GUARD', flags.guard],
			['HINDER', flags.hinder],
			['INVENTORY', flags.inventory],
			['OBJECTIVE', flags.objective],
			['SPELL', flags.spell],
			['STUDY', flags.study],
			['SKILL', flags.skill],
			['OTHER', flags.other],
		];
		y = 58;
		for (const entry of entries) {
			api.print(entry[0], 6, y, colorForAvailability(entry[1]));
			y += 7;
		}
		if (this.character.hp <= 0) {
			api.print('STATUS: KO', 6, 120, COLOR_WARNING);
		}
	}

	private drawStatsAndStatuses(api: BmsxConsoleApi): void {
		api.rect(66, 14, 126, 66, COLOR_PANEL_BORDER);
		api.print('STATS', 70, 16, COLOR_HEADER);
		const current = this.currentDice();
		const base = this.character.base;
		const names = ['DEX', 'INS', 'MIG', 'WLP'];
		const baseValues = [base.dex, base.ins, base.mig, base.wlp];
		const currentValues = [current.dex, current.ins, current.mig, current.wlp];
		let y = 24;
		for (let i = 0; i < names.length; i++) {
			const isSelected = this.mode === 'edit' && this.selection === i + 1;
			const reduced = currentValues[i] < baseValues[i];
			const color = isSelected ? COLOR_HIGHLIGHT : reduced ? COLOR_WARNING : COLOR_TEXT;
			api.print(`${names[i]}: ${dieString(currentValues[i])} (${dieString(baseValues[i])})`, 70, y, color);
			y += 8;
		}
		const defense = this.defenses();
		api.print(`D: ${defense.def}`, 70, 56, COLOR_TEXT);
		api.print(`MD: ${defense.mdef}`, 96, 56, COLOR_TEXT);

		const statusBottom = 106;
		api.rect(66, 68, 126, statusBottom, COLOR_PANEL_BORDER);
		api.print('STATUSES', 70, 70, COLOR_HEADER);
		y = 76;
		const spacing = 6;
		for (let i = 0; i < STATUS_DEFINITIONS.length; i++) {
			const status = STATUS_DEFINITIONS[i];
			const active = this.hasStatus(status.id);
			const selected = this.mode === 'status' && this.selection === i + 1;
			const color = selected ? COLOR_HIGHLIGHT : active ? COLOR_TEXT : COLOR_TEXT_DIM;
			const mark = active ? '[X] ' : '[ ] ';
			api.print(`${mark}${status.name}`, 70, y, color);
			y += spacing;
		}

		if (this.mode === 'edit') {
			const labels = ['HPMAX', 'MPMAX', 'IPMAX'];
			const values = [this.character.hpmax, this.character.mpmax, this.character.ipmax];
			y = 40;
			for (let i = 0; i < labels.length; i++) {
				const index = 5 + i;
				const color = this.selection === index ? COLOR_HIGHLIGHT : COLOR_TEXT;
				api.print(`${labels[i]}: ${values[i]}`, 70, y, color);
				y += 8;
			}
		}
	}

	private drawBallDemo(api: BmsxConsoleApi): void {
		const bounds = DEMO_BOUNDS;
		api.rectfill(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, COLOR_PANEL_FILL);
		api.rect(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, COLOR_PANEL_BORDER);
		api.print('bounce demo', bounds.x, bounds.y - 7, DEMO_LABEL_COLOR);
		for (const ball of this.demoBalls) {
			api.rectfill(ball.x - ball.radius, ball.y - ball.radius, ball.x + ball.radius, ball.y + ball.radius, ball.color);
			api.spr(1, ball.x, ball.y, { scale: 1, layer: 'ui', id: ball.colliderId });
		}
	}

	private currentDice(): CurrentDice {
		const reductions = this.statusReductions();
		const base = this.character.base;
		return {
			dex: DIE_STEPS[clamp(dieIndex(base.dex) - reductions.dex, 1, DIE_STEPS.length) - 1],
			ins: DIE_STEPS[clamp(dieIndex(base.ins) - reductions.ins, 1, DIE_STEPS.length) - 1],
			mig: DIE_STEPS[clamp(dieIndex(base.mig) - reductions.mig, 1, DIE_STEPS.length) - 1],
			wlp: DIE_STEPS[clamp(dieIndex(base.wlp) - reductions.wlp, 1, DIE_STEPS.length) - 1],
		};
	}

	private statusReductions(): StatusReductions {
		const reductions: StatusReductions = { dex: 0, ins: 0, mig: 0, wlp: 0 };
		if (this.hasStatus(0)) reductions.ins += 1; // dazed
		if (this.hasStatus(1)) { reductions.dex += 1; reductions.ins += 1; } // enraged
		if (this.hasStatus(2)) { reductions.mig += 1; reductions.wlp += 1; } // poisoned
		if (this.hasStatus(3)) reductions.wlp += 1; // shaken
		if (this.hasStatus(4)) reductions.dex += 1; // slow
		if (this.hasStatus(5)) reductions.mig += 1; // weak
		return reductions;
	}

	private defenses(): Defenses {
		const current = this.currentDice();
		const def = dieToNumber(current.dex);
		const mdef = dieToNumber(current.ins);
		return { def, mdef };
	}

	private actionFlags(): ActionFlags {
		const knockedOut = this.character.hp <= 0;
		const hasMp = this.character.mp > 0;
		const hasIp = this.character.ip > 0;
		return {
			attack: !knockedOut,
			equipment: !knockedOut,
			guard: !knockedOut,
			hinder: !knockedOut,
			inventory: !knockedOut && hasIp,
			objective: !knockedOut,
			spell: !knockedOut && hasMp,
			study: !knockedOut,
			skill: !knockedOut,
			other: !knockedOut,
		};
	}

	private hasStatus(id: number): boolean {
		return (this.character.smask & (1 << id)) !== 0;
	}

	private toggleStatus(id: number): void {
		this.character.smask ^= 1 << id;
	}

	private advanceMode(): void {
		if (this.mode === 'track') this.mode = 'status';
		else if (this.mode === 'status') this.mode = 'edit';
		else this.mode = 'track';
	}

	private clampAll(): void {
		this.character.hp = clamp(this.character.hp, 0, this.character.hpmax);
		this.character.mp = clamp(this.character.mp, 0, this.character.mpmax);
		this.character.ip = clamp(this.character.ip, 0, this.character.ipmax);
		this.character.base.dex = DIE_STEPS[clamp(dieIndex(this.character.base.dex), 1, DIE_STEPS.length) - 1];
		this.character.base.ins = DIE_STEPS[clamp(dieIndex(this.character.base.ins), 1, DIE_STEPS.length) - 1];
		this.character.base.mig = DIE_STEPS[clamp(dieIndex(this.character.base.mig), 1, DIE_STEPS.length) - 1];
		this.character.base.wlp = DIE_STEPS[clamp(dieIndex(this.character.base.wlp), 1, DIE_STEPS.length) - 1];
	}

	private save(api: BmsxConsoleApi): void {
		api.cartdata(STORAGE_NAMESPACE);
		api.dset(SAVE_SLOT_VERSION, SAVE_VERSION);
		api.dset(SAVE_SLOT_BASE_DEX, this.character.base.dex);
		api.dset(SAVE_SLOT_BASE_INS, this.character.base.ins);
		api.dset(SAVE_SLOT_BASE_MIG, this.character.base.mig);
		api.dset(SAVE_SLOT_BASE_WLP, this.character.base.wlp);
		api.dset(SAVE_SLOT_HPMAX, this.character.hpmax);
		api.dset(SAVE_SLOT_MPMAX, this.character.mpmax);
		api.dset(SAVE_SLOT_IPMAX, this.character.ipmax);
		api.dset(SAVE_SLOT_HP, this.character.hp);
		api.dset(SAVE_SLOT_MP, this.character.mp);
		api.dset(SAVE_SLOT_IP, this.character.ip);
		api.dset(SAVE_SLOT_STATUS, this.character.smask);
	}

	private load(api: BmsxConsoleApi): void {
		api.cartdata(STORAGE_NAMESPACE);
		const version = Math.floor(api.dget(SAVE_SLOT_VERSION));
		if (version === SAVE_VERSION) {
			this.character.base.dex = dieToNumber(api.dget(SAVE_SLOT_BASE_DEX));
			this.character.base.ins = dieToNumber(api.dget(SAVE_SLOT_BASE_INS));
			this.character.base.mig = dieToNumber(api.dget(SAVE_SLOT_BASE_MIG));
			this.character.base.wlp = dieToNumber(api.dget(SAVE_SLOT_BASE_WLP));
			this.character.hpmax = Math.max(1, Math.floor(api.dget(SAVE_SLOT_HPMAX)));
			this.character.mpmax = Math.max(0, Math.floor(api.dget(SAVE_SLOT_MPMAX)));
			this.character.ipmax = Math.max(0, Math.floor(api.dget(SAVE_SLOT_IPMAX)));
			this.character.hp = clamp(Math.floor(api.dget(SAVE_SLOT_HP)), 0, this.character.hpmax);
			this.character.mp = clamp(Math.floor(api.dget(SAVE_SLOT_MP)), 0, this.character.mpmax);
			this.character.ip = clamp(Math.floor(api.dget(SAVE_SLOT_IP)), 0, this.character.ipmax);
			this.character.smask = Math.max(0, Math.floor(api.dget(SAVE_SLOT_STATUS)));
		}
		this.clampAll();
	}
}

export const consoleCartridge: BmsxConsoleCartridge = new CharacterManagerCart();
