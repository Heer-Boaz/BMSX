import { randomBytes, timingSafeEqual } from 'node:crypto';

export class HttpError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

/** Local workspace authority belongs to one listening process, never the static LAN product. */
export class WorkspaceHttpSession {
	#token = randomBytes(32).toString('base64url');
	#authorization = Buffer.from(`Bearer ${this.#token}`);

	constructor(host) {
		this.enabled = host === '127.0.0.1' || host === '::1' || host === 'localhost';
	}

	admitOrigin(req) {
		if (!this.enabled) throw new HttpError(403, 'Workspace access requires a loopback-bound server.');
		const port = req.socket.localPort;
		const host = req.headers.host;
		if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}` && host !== `[::1]:${port}`
			&& !(port === 80 && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]'))) {
			throw new HttpError(403, 'Workspace Host is not a local server address.');
		}
		if (req.headers.origin !== undefined && req.headers.origin !== new URL(`http://${host}`).origin) {
			throw new HttpError(403, 'Cross-origin workspace access is forbidden.');
		}
		const site = req.headers['sec-fetch-site'];
		if (site !== undefined && site !== 'same-origin') throw new HttpError(403, 'Cross-site workspace access is forbidden.');
	}

	bootstrap(req, res) {
		this.admitOrigin(req);
		if (req.headers['x-bmsx-client'] !== 'studio') throw new HttpError(403, 'Workspace bootstrap requires the Studio client header.');
		if (req.method !== 'GET') throw new HttpError(405, 'Workspace bootstrap requires GET.');
		res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
			.end(JSON.stringify({ workspaceToken: this.#token }));
	}

	authorize(req) {
		this.admitOrigin(req);
		const authorization = Buffer.from(req.headers.authorization ?? '');
		if (authorization.length !== this.#authorization.length || !timingSafeEqual(authorization, this.#authorization)) {
			throw new HttpError(401, 'Workspace session is missing or expired.');
		}
	}
}
