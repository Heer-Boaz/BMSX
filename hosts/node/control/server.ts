import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import type { HostControlRequest } from '../../common/control/protocol';

/** One controller connection; JSON lines and request IDs, separate from process logs. */
export class HostControlServer {
	private readonly server: Server;
	private client: Socket | undefined;

	public constructor(
		private readonly execute: (request: HostControlRequest) => Promise<unknown>,
		private readonly disconnect: () => void,
		private readonly quit: () => void,
	) {
		this.server = createServer(client => { void this.accept(client); });
	}

	public async listen(port: number): Promise<number> {
		await new Promise<void>((resolve, reject) => {
			this.server.once('error', reject);
			this.server.listen(port, '127.0.0.1', () => {
				this.server.off('error', reject);
				resolve();
			});
		});
		const address = this.server.address() as AddressInfo;
		return address.port;
	}

	private async accept(client: Socket): Promise<void> {
		if (this.client) {
			client.end(JSON.stringify({ error: 'A controller is already connected.' }) + '\n');
			return;
		}
		this.client = client;
		client.setNoDelay(true);
		const lines = createInterface({ input: client, crlfDelay: Infinity });
		client.on('error', () => { lines.close(); });
		client.once('close', () => {
			lines.close();
			this.disconnect();
			this.client = undefined;
		});
		try {
			for await (const line of lines) {
				let request: HostControlRequest;
				try {
					request = JSON.parse(line);
					const result = await this.execute(request);
					if (client.destroyed) break;
					await new Promise<void>((resolve, reject) => {
						client.write(JSON.stringify({ id: request.id, result }) + '\n', error => error ? reject(error) : resolve());
					});
					if (request.execute === 'quit') this.quit();
				} catch (error) {
					if (client.destroyed) break;
					client.write(JSON.stringify({ id: request?.id, error: String(error) }) + '\n');
				}
			}
		} finally {
			client.destroy();
		}
	}

	public async close(): Promise<void> {
		this.client?.destroy();
		await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
	}
}
