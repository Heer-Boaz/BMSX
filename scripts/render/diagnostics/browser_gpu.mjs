// Loaded only by the isolated GPU diagnostic page, before the ordinary player.
// Native objects and arguments are passed through unchanged; nothing repairs or
// substitutes device state. No diagnostic observer enters the production bundle.
const panel = document.createElement('section');
panel.id = 'gpu-diagnostics';
panel.innerHTML = `<div><strong>BMSX iOS-diagnose v1 · multitouch-fix</strong></div>
<nav aria-label="Renderer"><a data-renderer="auto">Auto</a> · <a data-renderer="webgpu">WebGPU</a> · <a data-renderer="webgl2">WebGL2</a></nav>
<div id="gpu-status">Renderer: nog niet gestart</div>
<div id="gpu-progress"></div>
<details><summary id="gpu-summary">0 fouten — details</summary><pre id="gpu-messages"></pre></details>`;
const style = document.createElement('style');
style.textContent = `#gpu-diagnostics{position:fixed;z-index:10000;top:env(safe-area-inset-top,0px);left:50%;transform:translateX(-50%);width:min(620px,calc(100vw - 20px));box-sizing:border-box;background:#101827ed;color:#fff;padding:6px 10px;border:1px solid #708099;border-radius:5px;font:12px/1.4 monospace;text-align:left;user-select:text;-webkit-user-select:text;touch-action:manipulation}#gpu-diagnostics a{display:inline-block;color:#8bd8ff;padding:3px 8px}#gpu-diagnostics a[aria-current]{color:#fff;background:#384c68}#gpu-diagnostics pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:35vh;overflow:auto;margin:4px 0;font:11px/1.3 monospace}#gpu-diagnostics summary{cursor:pointer}#gpu-diagnostics[data-error=true]{border-color:#ff6363}`;
document.head.appendChild(style);
document.body.appendChild(panel);
const status = panel.querySelector('#gpu-status');
const progress = panel.querySelector('#gpu-progress');
const summary = panel.querySelector('#gpu-summary');
const messages = panel.querySelector('#gpu-messages');
const details = panel.querySelector('details');
const requested = new URL(location.href).searchParams.get('renderer') || 'auto';
for (const link of panel.querySelectorAll('[data-renderer]')) {
	const url = new URL(location.href);
	url.searchParams.set('renderer', link.dataset.renderer);
	link.href = url.href;
	if (link.dataset.renderer === requested) link.setAttribute('aria-current', 'page');
}
// Renderer-switch taps must not also unlock/start the game on the boot overlay.
panel.addEventListener('touchend', event => event.stopPropagation());
panel.addEventListener('pointerdown', event => event.stopPropagation());

const errors = new Map();
let errorCount = 0;
let shaderCount = 0;
let pipelineCount = 0;
let submitCount = 0;
let diagnosticsChanged = true;
const notes = [navigator.userAgent, `Gevraagd: ${requested}; WebGPU API: ${!!navigator.gpu}`];

function report(message) {
	errorCount++;
	errors.set(message, (errors.get(message) || 0) + 1);
	diagnosticsChanged = true;
	panel.dataset.error = 'true';
	details.open = true;
}

window.addEventListener('error', event => report(`JavaScript: ${event.message}`));
window.addEventListener('unhandledrejection', event => report(`Promise: ${event.reason}`));
const consoleError = console.error;
console.error = function (...values) {
	report(values.map(String).join(' '));
	consoleError.apply(this, values);
};

const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (kind, options) {
	const context = getContext.call(this, kind, options);
	if (this.id === 'gamescreen' && context && (kind === 'webgpu' || kind === 'webgl2')) {
		status.textContent = `Renderer: ${kind === 'webgpu' ? 'WebGPU' : 'WebGL2'} (gevraagd: ${requested})`;
		if (kind === 'webgl2') {
			this.addEventListener('webglcontextlost', event => report(`WebGL context lost: ${event.statusMessage}`));
			this.addEventListener('webglcontextrestored', () => { notes.push('WebGL context restored'); diagnosticsChanged = true; });
			notes.push(context.getParameter(context.VERSION), context.getParameter(context.RENDERER));
		}
		diagnosticsChanged = true;
	}
	return context;
};

if (navigator.gpu) {
	const requestDevice = GPUAdapter.prototype.requestDevice;
	GPUAdapter.prototype.requestDevice = async function (descriptor) {
		const device = await requestDevice.call(this, descriptor);
		notes.push(`Adapter: ${this.info.vendor} / ${this.info.architecture} / ${this.info.device}`);
		diagnosticsChanged = true;
		device.addEventListener('uncapturederror', event => report(`GPU: ${event.error.message}`));
		device.lost.then(info => report(`GPU device lost (${info.reason}): ${info.message}`));
		return device;
	};
	const createShaderModule = GPUDevice.prototype.createShaderModule;
	GPUDevice.prototype.createShaderModule = function (descriptor) {
		const module = createShaderModule.call(this, descriptor);
		shaderCount++;
		module.getCompilationInfo().then(info => {
			for (const message of info.messages) {
				if (message.type === 'error') report(`Shader ${descriptor.label || '(zonder label)'} ${message.lineNum}:${message.linePos}: ${message.message}`);
			}
		});
		return module;
	};
	const createRenderPipeline = GPUDevice.prototype.createRenderPipeline;
	GPUDevice.prototype.createRenderPipeline = function (descriptor) {
		this.pushErrorScope('validation');
		const pipeline = createRenderPipeline.call(this, descriptor);
		pipelineCount++;
		this.popErrorScope().then(error => {
			if (error) report(`Pipeline ${descriptor.label || '(zonder label)'}: ${error.message}`);
		});
		return pipeline;
	};
	const submit = GPUQueue.prototype.submit;
	GPUQueue.prototype.submit = function (commandBuffers) {
		submitCount++;
		return submit.call(this, commandBuffers);
	};
}

// At most one DOM update per second; no per-frame logs, readbacks or error scopes.
setInterval(() => {
	progress.textContent = `Boot: ${document.body.classList.contains('game-started') ? 'gestart' : 'wacht'} · shaders ${shaderCount} · pipelines ${pipelineCount} · submits ${submitCount}`;
	if (diagnosticsChanged) {
		summary.textContent = `${errorCount} fouten — details`;
		messages.textContent = notes.join('\n') + '\n' + [...errors].map(([message, count]) => `${count}× ${message}`).join('\n');
		diagnosticsChanged = false;
	}
}, 1000);
