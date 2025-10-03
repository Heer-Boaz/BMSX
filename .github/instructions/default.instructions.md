---
applyTo: '**/*.*'
---
* Building the game engine requires:
   ```bash
   npx tsc --build ./src/bmsx
   ```
   Building the testrom requires:
   ```bash
   npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname testrom --force
   ```
   Building any other rompack (game) requires:
   ```
   npx tsx scripts/rompacker/rompacker.ts --nodeploy -romname <romname> --force
   ```
* **What would Unreal Engine 5 or Unity do?**: Consider how these engines handle similar systems and features, and try to apply those principles here.
* **Breaking changes are good!**: Don't keep current API; Breaking changes are good. Don't add any legacy shims.
* Indent using tabs, tab display size=4.
* Prevent inline CSS in TypeScript-code. Prefer to update `gamebase.css` instead.
* `WorldObject`s require a state machine to `tick()` and manage their states and transitions. Don't code like this:
	```
		override paint(): void {
		const now = performance.now();
		const t = now - this.createdAt;
		// TODO: PRETTY UGLY TO NOT USE A (SIMPLE) STATE MACHINE FOR THIS
		if (t >= this.ms) { this.markForDisposal(); return; } // time's up
		const vp = $.view.viewportSize;
		const centerX = vp.x / 2;
		const topY = 12;
		const alpha = t < 200 ? t / 200 : (t > this.ms - 300 ? (this.ms - t) / 300 : 1);
		const padX = 8, padY = 4;
		const font = this.font ?? $.view.default_font;
		const textWidth = font.textWidth(this.text) + 2 * padX;
		const rect = { area: { start: { x: centerX - textWidth / 2 - padX, y: topY - padY, z: this.z }, end: { x: centerX + textWidth / 2 + padX, y: topY + 10 + padY, z: this.z } }, color: { r: 0, g: 0, b: 0, a: 0.85 * alpha } };
		$.view.fillRectangle(rect);
		TextWriter.drawText(centerX - textWidth / 2, topY, this.text, this.z, undefined, { r: 255, g: 255, b: 255, a: Math.max(0, Math.min(1, alpha)) });
	}
	```
* **No try-catch-no-op**: Don't use try-catch blocks that do nothing, except when absolutely necessary. So, don't do this:
	```
	    try {
      e.dataTransfer?.setData('text/hudpanel', panel.id);
      e.dataTransfer?.setData('text/plain', panel.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      const r = panel.getBoundingClientRect();
      dragState.panelId = panel.id;
      dragState.panelHeight = r.height;
      dragState.panelWidth = r.width;
      // Hide the original panel visually (but keep layout slot) so drag continues reliably
      (panel as any).__prevOpacity = panel.style.opacity;
      panel.style.opacity = '0';
      // Optional: provide a minimal drag image to avoid default ghost
      if (e.dataTransfer && typeof document !== 'undefined') {
        const ghost = document.createElement('canvas');
        ghost.width = 1; ghost.height = 1;
        try { e.dataTransfer.setDragImage(ghost, 0, 0); } catch { /* noop */ }
      }
    } catch { /* noop */ }
	```
	because it introduces potential bugs and makes the code harder to understand.
	However, it can be useful in situations where you have to check whether the browser supports a specific feature, like:
	```
	/**
	* Create a GPU backend for the given canvas, preferring WebGPU if available,
	* otherwise falling back to WebGL2. The GameView stays backend-agnostic and
	* only receives the backend interface and the native context for helpers.
	*/
	export async function createBackendForCanvasAsync(canvas: HTMLCanvasElement): Promise<BackendCreateResult> {
		// Try WebGPU first
		if (WEBGPU_RENDERER_SUPPORT) {
			try {
				const nav: any = navigator;
				if (nav?.gpu && typeof canvas.getContext === 'function') {
					const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
					if (context) {
						const adapter: GPUAdapter | null = await nav.gpu.requestAdapter();
						if (adapter) {
							const device: GPUDevice = await adapter.requestDevice();
							// Configure the canvas context for presentation
							const preferredFormat: GPUTextureFormat = (nav.gpu.getPreferredCanvasFormat && nav.gpu.getPreferredCanvasFormat()) || 'bgra8unorm';
							try {
								context.configure({ device, format: preferredFormat, alphaMode: 'premultiplied' });
							} catch (e) {
								console.error('Failed to configure WebGPU canvas context:', e);
								throw e;
							}
							const backend = new WebGPUBackend(device, context);
							return { backend, nativeCtx: context };
						}
					}
				}
			} catch(e) {
				console.info(`WebGPU initialization failed: ${e}`);
			}
		}

		// Fallback to WebGL2
		const gl = canvas.getContext('webgl2', { alpha: true, antialias: false }) as WebGL2RenderingContext | null;
		if (!gl) throw new Error('Failed to acquire WebGL2 context, cannot start the game :-(');
		const backend = new WebGLBackend(gl);
		console.info(WEBGPU_RENDERER_SUPPORT ? 'Browser doesn\'t support WebGPU, fallback to WebGL2-backend' : 'Forced using WebGL2-backend as the game engine doesn\'t support WebGPU yet');
		return { backend, nativeCtx: gl };
	}
	```
* **File Naming Conventions**: Use PascalCase for class names and lowercase for file names.
* **Don't introduce `as any` or `<any>` casts**. Prefer using more specific types or generics instead of `any`.
* **Don't introduce `as unknown` casts**. Prefer using more specific types or generics instead of `unknown`.
* **Avoid unnecessary type assertions**: Don't introduce typeguards like:
  ```
  const anyO: any = o as any;
  if (typeof anyO.activate === 'function') anyO.activate(spawnPos);
  else o.onspawn?.(spawnPos);
  // Activation (BeginPlay): if the object exposes activate, call it first
  const activatable = o as { activate?: (pos?: Vector) => void };
  if (typeof activatable.activate === 'function') activatable.activate(spawnPos);
  // Gameplay-aware spawn hook (legacy/back-compat)
  if (typeof o.onspawn === 'function') o.onspawn(spawnPos);
  ```
  or:
  ```
  typeof foo === 'function'
  ```
* `require` may only be used at the top of script-code. All other code must use `import`.
* Use the annotations provided in the codebase to maintain consistency, these include:
	- `@attach_components`: Indicates that the decorated class should have `Component`s automatically attached.
	- `@build_fsm`: Indicates that the decorated function should build a finite state machine (FSM) for the associated class. Note that, when using this decorator, the instances of the class will be automatically assigned the FSM, as long as no arguments are passed to the decorator.
	- `@assign_fsm`: Indicates that the decorated class should be assigned an existing FSM with the given ID.
	- `@onsave`: Indicates that the decorated function should be called when the object is saved.
	- `@onload`: Indicates that the decorated function should be called when the object is loaded.
	- `@insavegame`: Indicates that the decorated class is included in the serialized game state.
	- `@excludefromsavegame`: Indicates that the decorated class is excluded from the serialized game state.
	- `@excludepropfromsavegame`: Indicates that the decorated class-property is excluded from the serialized game state.
  - When introducing new features, consider how they can be serialized and deserialized as part of the game state. Also consider that many objects/properties should be *excluded* from serialization.
* Don't use dependency injection. We have a global object `$` for a reason.
* When coding utilities, first check the existing utilities under `src/bmsx/utils` before implementing new ones.
* **Performance**:
  - Consider the performance implications of generated code, especially in critical areas of the application, noting that the engine is supposed to perform well on lower-end hardware such as iPhone 10/11/12.
  - Use scratch buffers and object pooling to minimize memory allocations and improve performance.
  - Use in-place algorithms and data structures to reduce memory overhead and improve cache locality.
  - Prevent unnecessary allocations by reusing existing objects and buffers.
