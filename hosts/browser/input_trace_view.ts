import { BROWSER_INPUT_TRACE_TOUCH_IDS, type BrowserInputTraceBuffer } from './input_trace_buffer';

/** Diagnostic presentation is outside the player's gesture surface. */
export class BrowserInputTraceView {
	private readonly panel: HTMLDetailsElement;
	private readonly summary: HTMLElement;
	private readonly output: HTMLPreElement;
	private readonly metadata: string;
	private revision = -1;
	private status = 'Trace actief';
	private downloadUrl = '';
	private modelButtons = 0;
	private commonButtons = -1;
	private readonly freezeButton: HTMLButtonElement;

	constructor(document: Document, private readonly buffer: BrowserInputTraceBuffer) {
		this.metadata = `BMSX native inputtrace v1\nPagina: ${document.location.pathname}\nBrowser: ${document.defaultView.navigator.userAgent}\nOpslag: laatste ${buffer.capacity} events; maximaal ${BROWSER_INPUT_TRACE_TOUCH_IDS} touch-IDs per set\n`;
		const style = document.createElement('style');
		style.textContent = '#bmsx-input-trace{position:fixed;z-index:10000;top:env(safe-area-inset-top,0px);left:50%;transform:translateX(-50%);width:min(300px,calc(100vw - 24px));box-sizing:border-box;background:#141b25ed;color:#fff;border:1px solid #77838e;border-radius:8px;padding:6px 8px;font:12px/1.4 monospace;text-align:left;touch-action:manipulation;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}#bmsx-input-trace[open]{width:min(760px,calc(100vw - 24px))}#bmsx-input-trace summary{cursor:pointer}#bmsx-input-trace button,#bmsx-input-trace a{display:inline-block;margin:6px 6px 4px 0;padding:8px;color:#fff;background:#273647;border:1px solid #77838e;border-radius:4px;font:inherit;text-decoration:none;touch-action:manipulation}#bmsx-input-trace pre{max-height:55vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font:10px/1.4 monospace;user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}';
		document.head.appendChild(style);
		this.panel = document.createElement('details');
		this.panel.id = 'bmsx-input-trace';
		this.summary = document.createElement('summary');
		this.output = document.createElement('pre');
		this.output.id = 'bmsx-input-trace-events';
		const download = document.createElement('a');
		download.textContent = 'Download trace';
		download.download = 'bmsx-input-trace.txt';
		download.href = '#';
		download.addEventListener('click', () => {
			this.buffer.freeze();
			this.refresh(true);
			if (this.downloadUrl !== '') URL.revokeObjectURL(this.downloadUrl);
			this.downloadUrl = URL.createObjectURL(new Blob([this.text()], { type: 'text/plain;charset=utf-8' }));
			download.href = this.downloadUrl;
		});
		const select = document.createElement('button');
		select.textContent = 'Selecteer tekst';
		select.addEventListener('click', () => {
			this.buffer.freeze();
			this.refresh(true);
			const range = document.createRange();
			range.selectNodeContents(this.output);
			const selection = document.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		});
		const clear = document.createElement('button');
		clear.textContent = 'Wis trace';
		clear.addEventListener('click', () => { this.buffer.clear(); this.refresh(); });
		this.freezeButton = document.createElement('button');
		this.freezeButton.addEventListener('click', () => {
			if (this.buffer.frozen) this.buffer.resume();
			else this.buffer.freeze();
			this.refresh(true);
		});
		this.panel.append(this.summary, this.freezeButton, download, select, clear, this.output);
		document.body.appendChild(this.panel);
		this.panel.addEventListener('toggle', () => this.refresh(true));
		this.refresh(true);
		document.defaultView.setInterval(() => this.refresh(), 500);
	}

	setButtons(model: number, common: number): void {
		this.modelButtons = model;
		this.commonButtons = common;
	}

	setStatus(status: string): void {
		this.status = status;
		this.refresh(true);
	}

	contains(target: EventTarget): boolean {
		return target instanceof Node && this.panel.contains(target);
	}

	/** Formatting and string allocation happen on view refresh/export, not on native delivery. */
	text(): string {
		const lines = [this.metadata, `Status: ${this.status}; opname: ${this.buffer.frozen ? 'bevroren' : 'actief'}; bewaard: ${this.buffer.count}/${this.buffer.total}; overschreven: ${this.buffer.overwritten}; fouten: ${this.buffer.errorCount}`,
			`Knoppen: model=0x${this.modelButtons.toString(16)} common=${this.commonButtons < 0 ? 'niet verbonden' : `0x${this.commonButtons.toString(16)}`}`];
		if (this.buffer.lastError !== '') lines.push(`Laatste fout (blijft bewaard): ${this.buffer.lastError}`);
		for (let index = 0; index < this.buffer.count; index += 1) {
			const row = this.buffer.get(index);
			let line = `${row.sequence} ${row.time.toFixed(1)} ${row.phase} ${row.kind}`;
			if (row.pointerId !== -1) {
				line += ` id=${row.pointerId} type=${row.pointerType} primary=${+row.primary} xy=${row.x.toFixed(1)},${row.y.toFixed(1)} buttons=${row.nativeButtons} pressure=${row.pressure} trusted=${+row.trusted} cancelable=${+row.cancelable} prevented=${+row.prevented} target=${row.target}`;
			}
			if (row.phase === 'route' || row.phase === 'reset') {
				line += ` route=${row.route} model=0x${row.before.toString(16)}->0x${row.after.toString(16)} common=${row.commonBefore < 0 ? '-' : `0x${row.commonBefore.toString(16)}`}->${row.commonAfter < 0 ? '-' : `0x${row.commonAfter.toString(16)}`} completed=${+row.completed}`;
			}
			if (row.phase === 'native' && row.pointerType !== 'touch-snapshot') line += ` model-entry=0x${row.before.toString(16)}`;
			if (row.pointerType === 'touch-snapshot') {
				line += ` full=[${row.touchIds.subarray(0, Math.min(row.touchCount, BROWSER_INPUT_TRACE_TOUCH_IDS)).join(',')}](${row.touchCount}) changed=[${row.changedTouchIds.subarray(0, Math.min(row.changedTouchCount, BROWSER_INPUT_TRACE_TOUCH_IDS)).join(',')}](${row.changedTouchCount}) trusted=${+row.trusted} cancelable=${+row.cancelable} prevented=${+row.prevented} target=${row.target}`;
			}
			if (row.message !== '') line += ` ${row.message}`;
			lines.push(line);
		}
		return lines.join('\n');
	}

	private refresh(force = false): void {
		if (!force && this.revision === this.buffer.revision) return;
		this.revision = this.buffer.revision;
		this.summary.textContent = `Inputtrace: ${this.status} · ${this.buffer.frozen ? 'bevroren' : `${this.buffer.total} events`} · ${this.buffer.errorCount} fouten · model 0x${this.modelButtons.toString(16)} / common ${this.commonButtons < 0 ? '-' : `0x${this.commonButtons.toString(16)}`}`;
		this.freezeButton.textContent = this.buffer.frozen ? 'Hervat opname' : 'Bevries opname';
		if (this.panel.open) this.output.textContent = this.text();
	}
}
