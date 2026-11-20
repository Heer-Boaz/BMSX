const task = new MessageChannel();
let resumeFrame: () => void;
task.port1.onmessage = () => resumeFrame();

function postFrameTask(resolve: () => void): void {
	resumeFrame = resolve;
	task.port2.postMessage(null);
}

/** Serial virtual frames yield to browser I/O without the nested-timer clamp. */
export function yieldBrowserTask(): Promise<void> {
	return new Promise<void>(postFrameTask);
}
