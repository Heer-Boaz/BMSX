import { execFile } from 'node:child_process';

/**
 * Hand a URL to the desktop's own browser, the way a CLI does. The argument vector is
 * passed to the handler directly, never through a shell, so the URL is data and not a
 * command line. Failure is reported to the caller, which already shows the address.
 */
export function openUrlInBrowser(url: string, onFailure: (error: Error) => void): void {
	const [command, args] = process.platform === 'win32'
		? ['cmd.exe', ['/c', 'start', '', url]]
		: process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
	execFile(command, args as string[], { windowsHide: true, timeout: 10000 }, error => {
		if (error) onFailure(error);
	});
}
