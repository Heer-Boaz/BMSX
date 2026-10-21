import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { decodeSignedQ16_16 } from '../../../../machine/ts/common/fixed_point';
import { highSignedHalfword, lowSignedHalfword, toSignedWord } from '../../../../machine/ts/machine/common/numeric';
import * as gte from '../../../../machine/ts/machine/devices/gx/gte';
import type { GteCommandSnapshot, RuntimeGteHistory } from '../../../runtime/gte_history';
import type { InspectedProperty } from '../../ui/property_inspector/model';

export type GteDebugView = 'auto' | 'input' | 'projected' | 'color';
export type GteDebugPoint = { x: number; y: number; label: string; value: string };
const COMMAND_NAMES: Readonly<Record<number, string>> = {
	0x01: 'RTPS', 0x06: 'NCLIP', 0x0c: 'OP', 0x10: 'DPCS', 0x11: 'INTPL', 0x12: 'MVMVA',
	0x13: 'NCDS', 0x14: 'CDP', 0x16: 'NCDT', 0x1b: 'NCCS', 0x1c: 'CC', 0x1e: 'NCS',
	0x20: 'NCT', 0x28: 'SQR', 0x29: 'DCPL', 0x2a: 'DPCT', 0x2d: 'AVSZ3', 0x2e: 'AVSZ4',
	0x30: 'RTPT', 0x3d: 'GPF', 0x3e: 'GPL', 0x3f: 'NCCT',
};
const FLAGS: readonly [number, string][] = [
	[gte.GX_GTE_FLAG_ERROR, 'ERROR'], [gte.GX_GTE_FLAG_MAC1_POS, 'MAC1+'], [gte.GX_GTE_FLAG_MAC2_POS, 'MAC2+'],
	[gte.GX_GTE_FLAG_MAC3_POS, 'MAC3+'], [gte.GX_GTE_FLAG_MAC1_NEG, 'MAC1-'], [gte.GX_GTE_FLAG_MAC2_NEG, 'MAC2-'],
	[gte.GX_GTE_FLAG_MAC3_NEG, 'MAC3-'], [gte.GX_GTE_FLAG_IR1_SAT, 'IR1 saturation'], [gte.GX_GTE_FLAG_IR2_SAT, 'IR2 saturation'],
	[gte.GX_GTE_FLAG_IR3_SAT, 'IR3 saturation'], [gte.GX_GTE_FLAG_COLOR_R_SAT, 'R saturation'],
	[gte.GX_GTE_FLAG_COLOR_G_SAT, 'G saturation'], [gte.GX_GTE_FLAG_COLOR_B_SAT, 'B saturation'],
	[gte.GX_GTE_FLAG_SZ_OTZ_SAT, 'SZ/OTZ saturation'], [gte.GX_GTE_FLAG_DIV_OVERFLOW, 'Divide overflow'],
	[gte.GX_GTE_FLAG_MAC0_POS, 'MAC0+'], [gte.GX_GTE_FLAG_MAC0_NEG, 'MAC0-'],
	[gte.GX_GTE_FLAG_SX2_SAT, 'SX saturation'], [gte.GX_GTE_FLAG_SY2_SAT, 'SY saturation'], [gte.GX_GTE_FLAG_IR0_SAT, 'IR0 saturation'],
];
export function gteCommandName(word: number): string {
	return COMMAND_NAMES[word & 0x3f] ?? `FN ${formatNumberAsHex(word & 0x3f, 2)}`;
}

/** Incremental sequence projection; no borrowed ring object survives this call. */
export class GteCommandProjection {
	public readonly rows: number[] = [];
	private generation = -1;
	private scanned = 0;
	private query = '';
	private filter = '';
	public update(history: RuntimeGteHistory, filter: string): boolean {
		const query = filter === this.filter ? this.query : filter.toLowerCase();
		this.filter = filter;
		let changed = false;
		if (this.generation !== history.generation || this.query !== query) {
			this.generation = history.generation; this.query = query; this.scanned = history.firstSequence;
			this.rows.length = 0; changed = true;
		}
		let removed = 0;
		while (removed < this.rows.length && this.rows[removed] < history.firstSequence) removed++;
		if (removed > 0) { this.rows.splice(0, removed); changed = true; }
		this.scanned = Math.max(this.scanned, history.firstSequence);
		for (; this.scanned < history.endSequence; this.scanned++) {
			if (query !== '' && !gteCommandName(history.at(this.scanned).commandWord).toLowerCase().includes(query)) continue;
			this.rows.push(this.scanned); changed = true;
		}
		return changed;
	}
}

/** Decoded display facts from one owned command, never reconstructed GTE arithmetic. */
export class GteDebugPresentation {
	public readonly points: GteDebugPoint[] = [];
	public readonly colors: { word: number; argb: number; label: string; value: string }[] = [];
	public readonly properties: InspectedProperty[] = [];
	public heading = '';
	public explanation = '';
	public summary = '';
	public flags = '';
	public view: Exclude<GteDebugView, 'auto'> = 'projected';
	private revision = -1;
	private requested: GteDebugView = 'auto';
	private record: GteCommandSnapshot | undefined;
	private readonly pointStorage: GteDebugPoint[] = Array.from({ length: 3 }, () => ({ x: 0, y: 0, label: '', value: '' }));
	private readonly colorStorage = Array.from({ length: 3 }, () => ({ word: 0, argb: 0, label: '', value: '' }));
	private readonly flagNames: string[] = [];
	public reset(): void {
		this.record = undefined; this.revision = -1;
		this.points.length = 0; this.colors.length = 0; this.properties.length = 0;
		this.heading = ''; this.explanation = ''; this.summary = ''; this.flags = '';
	}
	public update(record: GteCommandSnapshot, revision: number, requested: GteDebugView): boolean {
		if (this.record === record && this.revision === revision && this.requested === requested) return false;
		this.record = record; this.revision = revision; this.requested = requested;
		this.points.length = 0; this.colors.length = 0;
		if (record.sequence < 0) { this.heading = ''; this.summary = ''; this.flags = ''; this.explanation = ''; return true; }
		const fn = record.commandWord & 0x3f, projection = fn === gte.GX_GTE_FN_RTPS || fn === gte.GX_GTE_FN_RTPT;
		const tripleColor = fn === 0x16 || fn === 0x20 || fn === 0x2a || fn === 0x3f;
		const normalInput = fn === 0x13 || fn === 0x16 || fn === 0x1b || fn === 0x1e || fn === 0x20 || fn === 0x3f;
		const color = fn === 0x10 || fn === 0x11 || fn === 0x13 || fn === 0x14 || fn === 0x16 || fn === 0x1b
			|| fn === 0x1c || fn === 0x1e || fn === 0x20 || fn === 0x29 || fn === 0x2a || fn === 0x3d || fn === 0x3e || fn === 0x3f;
		this.view = requested === 'auto' ? color ? 'color' : projection || fn === 0x06 ? 'projected' : 'input' : requested;
		this.heading = `${gteCommandName(record.commandWord)} / ${this.view === 'input' ? 'INPUT XY' : this.view === 'color' ? 'OUTPUT RGB' : 'SXY / Y DOWN'}`;
		this.summary = `#${record.sequence} T${record.timeline} | tick ${record.completedTick} | cycle ${record.cycles}`;
		const flag = record.afterControl[31], flags = this.flagNames;
		flags.length = 0;
		for (const [mask, label] of FLAGS) if ((flag & mask) !== 0) flags.push(label);
		this.flags = `FLAG ${formatNumberAsHex(flag, 8)}${flags.length === 0 ? ' | clear' : ` | ${flags.join(', ')}`}`;
		this.explanation = '';
		if (this.view === 'input' && (projection || normalInput)) {
			const count = fn === 0x30 || tripleColor ? 3 : 1;
			for (let index = 0; index < count; index++) {
				const xy = record.beforeData[index * 2], x = lowSignedHalfword(xy), y = highSignedHalfword(xy), z = lowSignedHalfword(record.beforeData[index * 2 + 1]);
				const point = this.pointStorage[index];
				point.x = x; point.y = y; point.label = `V${index}`; point.value = `V${index} = (${x}, ${y}, ${z})`;
				this.points.push(point);
			}
			this.explanation = normalInput ? 'Normals / XY plane / Z in rows.' : 'Positions / XY plane / Z in rows.';
		} else if (this.view === 'projected' && (projection || fn === 0x06)) {
			const data = fn === 0x06 ? record.beforeData : record.afterData, first = fn === 0x01 ? 2 : 0;
			for (let index = first; index < 3; index++) {
				const word = data[12 + index], x = lowSignedHalfword(word), y = highSignedHalfword(word);
				const point = this.pointStorage[this.points.length];
				point.x = x; point.y = y; point.label = fn === 0x01 ? 'V0' : `V${index}`;
				point.value = `SXY${index} = (${x}, ${y})${projection ? ` | SZ${index + 1}=${data[17 + index] & 0xffff}` : ''}`;
				this.points.push(point);
			}
			this.explanation = fn === 0x06 ? `Signed doubled area: ${toSignedWord(record.afterData[24])}` : 'Projected coordinates / not scanout.';
		} else if (this.view === 'color' && color) {
			for (let index = tripleColor ? 0 : 2; index < 3; index++) {
				const word = record.afterData[20 + index];
				const color = this.colorStorage[this.colors.length];
				color.word = word; color.argb = (0xff000000 | (word & 255) << 16 | (word & 0xff00) | word >>> 16 & 255) >>> 0;
				color.label = `RGB${index}`; color.value = `${color.label} ${formatNumberAsHex(word, 8)} | (${word & 255}, ${word >>> 8 & 255}, ${word >>> 16 & 255})`;
				this.colors.push(color);
			}
			this.explanation = `IR0 in: ${lowSignedHalfword(record.beforeData[8])} / out: ${lowSignedHalfword(record.afterData[8])}`;
		} else this.explanation = 'No operands in this view. See Details.';
		return true;
	}
	/** Raw register formatting is demand-driven, never part of live following. */
	public details(record: GteCommandSnapshot): readonly InspectedProperty[] {
		this.properties.length = 0;
		const flag = record.afterControl[31];
		this.properties.push({ label: 'Captured command', value: `${gteCommandName(record.commandWord)} ${formatNumberAsHex(record.commandWord, 8)}`,
			description: `${this.summary}\nNominal command cost: ${record.nominalCycles} cycles; not elapsed frame time. SF=${record.commandWord >>> 19 & 1}, LM=${record.commandWord >>> 10 & 1}.`, warning: false },
			{ label: 'Result FLAG', value: this.flags, description: 'Per-command output; subsequent commands may replace FLAG. ERROR does not summarize every saturation bit.', warning: flag !== 0 },
			{ label: 'Projection controls at issue', value: `OFX=${decodeSignedQ16_16(record.beforeControl[24])}, OFY=${decodeSignedQ16_16(record.beforeControl[25])}, H=${record.beforeControl[26] & 0xffff}`,
				description: 'H consumes the unsigned low halfword. GTE has no framebuffer mapping. Three inputs are an ordered triple, not proof of a submitted GPU primitive. NCLIP computes area; software chooses culling and clipping.', warning: false });
		for (const [label, before, after] of [['D', record.beforeData, record.afterData], ['C', record.beforeControl, record.afterControl]] as const) {
			for (let index = 0; index < 32; index++) this.properties.push({ label: `${label}[${index}]${before[index] !== after[index] ? ' changed' : ''}`,
				value: `${formatNumberAsHex(before[index], 8)} -> ${formatNumberAsHex(after[index], 8)}`,
				description: 'Raw retained register word before and after this command; not an MMIO alias read.', warning: false });
		}
		return this.properties;
	}
}
