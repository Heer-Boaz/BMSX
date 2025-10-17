import type { BmsxConsoleApi, BmsxConsoleCartridge } from 'bmsx/console';
import { BmsxConsoleButton } from 'bmsx/console';
import { clamp } from 'bmsx/utils/utils';

const SAVE_VERSION: number = 1;
const STORAGE_NAMESPACE: string = 'fu_char_mgr_v1';

type Mode = 'track' | 'status' | 'edit';

type BaseStats = {
	str: number;
	agi: number;
	int: number;
	wil: number;
	def: number;
	res: number;
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
	base: BaseStats;
	smask: number;
};

type StatModifier = BaseStats;

type StatusDefinition = {
	id: number;
	name: string;
	modifier: StatModifier;
};

type ActionFlags = {
	attack: boolean;
	defend: boolean;
	technique: boolean;
	spell: boolean;
	item: boolean;
	other: boolean;
};

const COLOR_BACKGROUND = 0;
const COLOR_PANEL = 4;
const COLOR_PANEL_BORDER = 14;
const COLOR_TEXT = 15;
const COLOR_TEXT_DIM = 9;
const COLOR_HEADER = 11;
const COLOR_HIGHLIGHT = 13;
const COLOR_BUFF = 7;
const COLOR_DEBUFF = 6;

const STATUS_DEFINITIONS: StatusDefinition[] = [
	createStatus(0, 'HASTE', createModifier(0, 2, 0, 0, 0, 0)),
	createStatus(1, 'WEAKEN', createModifier(-2, 0, 0, 0, 0, 0)),
	createStatus(2, 'SHIELD', createModifier(0, 0, 0, 0, 0, 2)),
	createStatus(3, 'EXPOSED', createModifier(0, 0, 0, 0, -2, 0)),
	createStatus(4, 'FOCUS', createModifier(0, 0, 2, 1, 0, 0)),
	createStatus(5, 'POISON', createModifier(0, 0, 0, 0, 0, 0)),
];

const SAVE_SLOT_VERSION = 0;
const SAVE_SLOT_HPMAX = 1;
const SAVE_SLOT_MPMAX = 2;
const SAVE_SLOT_IPMAX = 3;
const SAVE_SLOT_HP = 4;
const SAVE_SLOT_MP = 5;
const SAVE_SLOT_IP = 6;
const SAVE_SLOT_STR = 7;
const SAVE_SLOT_AGI = 8;
const SAVE_SLOT_INT = 9;
const SAVE_SLOT_WIL = 10;
const SAVE_SLOT_DEF = 11;
const SAVE_SLOT_RES = 12;
const SAVE_SLOT_STATUS = 13;

function createModifier(str: number, agi: number, int: number, wil: number, def: number, res: number): StatModifier {
	return { str, agi, int, wil, def, res };
}

function createStatus(id: number, name: string, modifier: StatModifier): StatusDefinition {
	return { id, name, modifier };
}

function cloneStats(stats: BaseStats): BaseStats {
	return { str: stats.str, agi: stats.agi, int: stats.int, wil: stats.wil, def: stats.def, res: stats.res };
}

function addStats(target: BaseStats, modifier: StatModifier): BaseStats {
	return {
		str: target.str + modifier.str,
		agi: target.agi + modifier.agi,
		int: target.int + modifier.int,
		wil: target.wil + modifier.wil,
		def: target.def + modifier.def,
		res: target.res + modifier.res,
	};
}

class CharacterManagerCart implements BmsxConsoleCartridge {
	public readonly meta = {
		title: 'BMSX Console Demo',
		version: '0.1.0',
		persistentId: STORAGE_NAMESPACE,
	};

	private mode: Mode = 'track';
	private selection: number = 1;
	private character: Character = this.createCharacter();

	public init(api: BmsxConsoleApi): void {
		this.character = this.createCharacter();
		this.load(api);
	}

	public update(api: BmsxConsoleApi, _deltaSeconds: number): void {
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
	}

	public draw(api: BmsxConsoleApi): void {
		api.cls(COLOR_BACKGROUND);
		this.drawHeader(api);
		this.drawPools(api);
		this.drawStats(api);
		this.drawStatuses(api);
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
			base: { str: 10, agi: 8, int: 8, wil: 8, def: 2, res: 2 },
			smask: 0,
		};
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
		if (delta !== 0) {
			if (this.selection === 1) {
				this.character.hp = clamp(this.character.hp + delta, 0, this.character.hpmax);
			} else if (this.selection === 2) {
				this.character.mp = clamp(this.character.mp + delta, 0, this.character.mpmax);
			} else {
				this.character.ip = clamp(this.character.ip + delta, 0, this.character.ipmax);
			}
			this.save(api);
		}
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
			const def = STATUS_DEFINITIONS[this.selection - 1];
			this.toggleStatus(def.id);
			this.save(api);
		}
	}

	private handleEditInput(api: BmsxConsoleApi): void {
		const maxIndex = 9;
		if (api.btnp(BmsxConsoleButton.Up)) {
			this.selection = clamp(this.selection - 1, 1, maxIndex);
		}
		if (api.btnp(BmsxConsoleButton.Down)) {
			this.selection = clamp(this.selection + 1, 1, maxIndex);
		}
		let delta = 0;
		if (api.btnp(BmsxConsoleButton.Left)) delta -= 1;
		if (api.btnp(BmsxConsoleButton.Right)) delta += 1;
		if (delta !== 0) {
			if (this.selection === 1) this.character.base.str += delta;
			else if (this.selection === 2) this.character.base.agi += delta;
			else if (this.selection === 3) this.character.base.int += delta;
			else if (this.selection === 4) this.character.base.wil += delta;
			else if (this.selection === 5) this.character.base.def += delta;
			else if (this.selection === 6) this.character.base.res += delta;
			else if (this.selection === 7) this.character.hpmax = Math.max(1, this.character.hpmax + delta);
			else if (this.selection === 8) this.character.mpmax = Math.max(0, this.character.mpmax + delta);
			else this.character.ipmax = Math.max(0, this.character.ipmax + delta);
			this.clampAll();
			this.save(api);
		}
	}

	private drawHeader(api: BmsxConsoleApi): void {
		api.rectfill(2, 2, 126, 20, COLOR_PANEL);
		api.rect(2, 2, 126, 20, COLOR_PANEL_BORDER);
		api.print('FABULA ULTIMA CHARACTER HELPER', 6, 4, COLOR_HEADER);
		const modeLabel = this.mode === 'track' ? 'MODE: TRACK' : this.mode === 'status' ? 'MODE: STATUS' : 'MODE: EDIT';
		api.print(modeLabel, 6, 12, COLOR_TEXT);
		api.print('X SWITCH MODE   O TOGGLE STATUS', 6, 18, COLOR_TEXT_DIM);
	}

	private drawPools(api: BmsxConsoleApi): void {
		const startX = 4;
		const startY = 26;
		const endX = 60;
		const endY = 118;
		api.rectfill(startX, startY, endX, endY, COLOR_PANEL);
		api.rect(startX, startY, endX, endY, COLOR_PANEL_BORDER);
		api.print('POOLS', startX + 2, startY + 2, COLOR_HEADER);
		const labels = ['HP', 'MP', 'IP'];
		const values = [
			`${this.character.hp}/${this.character.hpmax}`,
			`${this.character.mp}/${this.character.mpmax}`,
			`${this.character.ip}/${this.character.ipmax}`,
		];
		let lineY = startY + 12;
		for (let i = 0; i < labels.length; i++) {
			const active = this.mode === 'track' && this.selection === i + 1;
			const color = active ? COLOR_HIGHLIGHT : COLOR_TEXT;
			api.print(`${labels[i]}: ${values[i]}`, startX + 2, lineY, color);
			lineY += 10;
		}
		this.drawActionBar(api, startX + 2, startY + 48);
		if (this.character.hp <= 0) {
			api.print('STATUS: KO (NO ACTIONS)', startX + 2, startY + 76, COLOR_DEBUFF);
		}
	}

	private drawActionBar(api: BmsxConsoleApi, originX: number, originY: number): void {
		const flags = this.actionFlags();
		const entries: Array<{ label: string; enabled: boolean; }> = [
			{ label: 'ATTACK', enabled: flags.attack },
			{ label: 'TECH', enabled: flags.technique },
			{ label: 'SPELL', enabled: flags.spell },
			{ label: 'ITEM', enabled: flags.item },
			{ label: 'DEFEND', enabled: flags.defend },
			{ label: 'OTHER', enabled: flags.other },
		];
		api.print('ACTIONS', originX, originY, COLOR_HEADER);
		let x = originX;
		const barY = originY + 8;
		for (const entry of entries) {
			const color = entry.enabled ? COLOR_TEXT : COLOR_TEXT_DIM;
			api.rectfill(x - 2, barY, x + 18, barY + 10, COLOR_PANEL_BORDER);
			api.rect(x - 2, barY, x + 18, barY + 10, COLOR_PANEL_BORDER);
			api.print(entry.label, x, barY + 2, color);
			x += 24;
		}
	}

	private drawStatuses(api: BmsxConsoleApi): void {
		const startX = 66;
		const startY = 26;
		const endX = 124;
		const endY = 118;
		api.rectfill(startX, startY, endX, endY, COLOR_PANEL);
		api.rect(startX, startY, endX, endY, COLOR_PANEL_BORDER);
		api.print('STATUSES', startX + 2, startY + 2, COLOR_HEADER);
		let lineY = startY + 12;
		for (let index = 0; index < STATUS_DEFINITIONS.length; index++) {
			const def = STATUS_DEFINITIONS[index];
			const active = this.hasStatus(def.id);
			const selected = this.mode === 'status' && this.selection === index + 1;
			const color = selected ? COLOR_HIGHLIGHT : active ? COLOR_TEXT : COLOR_TEXT_DIM;
			const mark = active ? '[X] ' : '[ ] ';
			api.print(`${mark}${def.name}`, startX + 2, lineY, color);
			lineY += 10;
		}
	}

	private drawStats(api: BmsxConsoleApi): void {
		const startX = 34;
		const startY = 26;
		const endX = 94;
		const endY = 74;
		api.rectfill(startX, startY, endX, endY, COLOR_PANEL);
		api.rect(startX, startY, endX, endY, COLOR_PANEL_BORDER);
		api.print('STATS', startX + 2, startY + 2, COLOR_HEADER);
		const base = this.character.base;
		const effective = this.effectiveStats();
		const keys: Array<keyof BaseStats> = ['str', 'agi', 'int', 'wil', 'def', 'res'];
		const names = ['STR', 'AGI', 'INT', 'WIL', 'DEF', 'RES'];
		let lineY = startY + 12;
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const baseValue = base[key];
			const effValue = effective[key];
			const delta = effValue - baseValue;
			let color = COLOR_TEXT;
			if (delta > 0) color = COLOR_BUFF;
			else if (delta < 0) color = COLOR_DEBUFF;
			if (this.mode === 'edit' && this.selection === i + 1) color = COLOR_HIGHLIGHT;
			let label = `${names[i]}: ${effValue}`;
			if (delta !== 0) {
				const sign = delta > 0 ? '+' : '';
				label += ` (${sign}${delta})`;
			}
			api.print(label, startX + 2, lineY, color);
			lineY += 10;
		}
		if (this.mode === 'edit') {
			this.drawPoolMaxRows(api, startX + 2, lineY);
		}
	}

	private drawPoolMaxRows(api: BmsxConsoleApi, originX: number, originY: number): void {
		const labels = ['HPMAX', 'MPMAX', 'IPMAX'];
		const values = [this.character.hpmax, this.character.mpmax, this.character.ipmax];
		for (let i = 0; i < labels.length; i++) {
			const index = 7 + i;
			const color = this.selection === index ? COLOR_HIGHLIGHT : COLOR_TEXT;
			api.print(`${labels[i]}: ${values[i]}`, originX, originY, color);
			originY += 10;
		}
	}

	private actionFlags(): ActionFlags {
		const knockedOut = this.character.hp <= 0;
		const hasMp = this.character.mp > 0;
		const hasIp = this.character.ip > 0;
		return {
			attack: !knockedOut,
			defend: !knockedOut,
			technique: !knockedOut,
			spell: !knockedOut && hasMp,
			item: !knockedOut && hasIp,
			other: !knockedOut,
		};
	}

	private effectiveStats(): BaseStats {
		let result = cloneStats(this.character.base);
		for (const def of STATUS_DEFINITIONS) {
			if (this.hasStatus(def.id)) {
				result = addStats(result, def.modifier);
			}
		}
		return result;
	}

	private hasStatus(id: number): boolean {
		const mask = 1 << id;
		return (this.character.smask & mask) !== 0;
	}

	private toggleStatus(id: number): void {
		const mask = 1 << id;
		this.character.smask ^= mask;
	}

	private clampAll(): void {
		this.character.hp = clamp(this.character.hp, 0, this.character.hpmax);
		this.character.mp = clamp(this.character.mp, 0, this.character.mpmax);
		this.character.ip = clamp(this.character.ip, 0, this.character.ipmax);
		this.character.base.str = Math.max(0, Math.floor(this.character.base.str));
		this.character.base.agi = Math.max(0, Math.floor(this.character.base.agi));
		this.character.base.int = Math.max(0, Math.floor(this.character.base.int));
		this.character.base.wil = Math.max(0, Math.floor(this.character.base.wil));
		this.character.base.def = Math.max(0, Math.floor(this.character.base.def));
		this.character.base.res = Math.max(0, Math.floor(this.character.base.res));
	}

	private advanceMode(): void {
		if (this.mode === 'track') this.mode = 'status';
		else if (this.mode === 'status') this.mode = 'edit';
		else this.mode = 'track';
	}

	private save(api: BmsxConsoleApi): void {
		api.cartdata(STORAGE_NAMESPACE);
		api.dset(SAVE_SLOT_VERSION, SAVE_VERSION);
		api.dset(SAVE_SLOT_HPMAX, this.character.hpmax);
		api.dset(SAVE_SLOT_MPMAX, this.character.mpmax);
		api.dset(SAVE_SLOT_IPMAX, this.character.ipmax);
		api.dset(SAVE_SLOT_HP, this.character.hp);
		api.dset(SAVE_SLOT_MP, this.character.mp);
		api.dset(SAVE_SLOT_IP, this.character.ip);
		api.dset(SAVE_SLOT_STR, this.character.base.str);
		api.dset(SAVE_SLOT_AGI, this.character.base.agi);
		api.dset(SAVE_SLOT_INT, this.character.base.int);
		api.dset(SAVE_SLOT_WIL, this.character.base.wil);
		api.dset(SAVE_SLOT_DEF, this.character.base.def);
		api.dset(SAVE_SLOT_RES, this.character.base.res);
		api.dset(SAVE_SLOT_STATUS, this.character.smask);
	}

	private load(api: BmsxConsoleApi): void {
		api.cartdata(STORAGE_NAMESPACE);
		const version = Math.floor(api.dget(SAVE_SLOT_VERSION));
		if (version !== SAVE_VERSION) {
			this.clampAll();
			return;
		}
		this.character.hpmax = Math.max(1, Math.floor(api.dget(SAVE_SLOT_HPMAX)));
		this.character.mpmax = Math.max(0, Math.floor(api.dget(SAVE_SLOT_MPMAX)));
		this.character.ipmax = Math.max(0, Math.floor(api.dget(SAVE_SLOT_IPMAX)));
		this.character.hp = clamp(Math.floor(api.dget(SAVE_SLOT_HP)), 0, this.character.hpmax);
		this.character.mp = clamp(Math.floor(api.dget(SAVE_SLOT_MP)), 0, this.character.mpmax);
		this.character.ip = clamp(Math.floor(api.dget(SAVE_SLOT_IP)), 0, this.character.ipmax);
		this.character.base.str = Math.max(0, Math.floor(api.dget(SAVE_SLOT_STR)));
		this.character.base.agi = Math.max(0, Math.floor(api.dget(SAVE_SLOT_AGI)));
		this.character.base.int = Math.max(0, Math.floor(api.dget(SAVE_SLOT_INT)));
		this.character.base.wil = Math.max(0, Math.floor(api.dget(SAVE_SLOT_WIL)));
		this.character.base.def = Math.max(0, Math.floor(api.dget(SAVE_SLOT_DEF)));
		this.character.base.res = Math.max(0, Math.floor(api.dget(SAVE_SLOT_RES)));
		this.character.smask = Math.max(0, Math.floor(api.dget(SAVE_SLOT_STATUS)));
		this.clampAll();
	}
}

export const consoleCartridge: BmsxConsoleCartridge = new CharacterManagerCart();
