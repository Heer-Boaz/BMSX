import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname } from 'node:os';

export class HttpError extends Error {
	constructor(status, message) { super(message); this.status = status; }
}

/** Same-origin workspace authority belongs to one development server, including its trusted LAN clients. */
export class WorkspaceHttpSession {
	#token = randomBytes(32).toString('base64url');
	#authorization = Buffer.from(`Bearer ${this.#token}`);
	#hostnames;

	constructor(host) {
		const machine = hostname().toLowerCase();
		this.#hostnames = new Set(['localhost', host.toLowerCase(), machine, `${machine}.local`]);
	}

	admitOrigin(req) {
		const port = req.socket.localPort;
		const host = req.headers.host;
		const origin = new URL(`http://${host}`);
		const name = origin.hostname;
		// Literal addresses support LAN/WSL forwarding without admitting arbitrary DNS names.
		if ((!this.#hostnames.has(name) && isIP(name[0] === '[' ? name.slice(1, -1) : name) === 0)
			|| (host !== `${name}:${port}` && !(port === 80 && host === name))) {
			throw new HttpError(403, 'Workspace Host is not an admitted server address.');
		}
		if (req.headers.origin !== undefined && req.headers.origin !== origin.origin) {
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
