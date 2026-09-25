import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

// External-protocol fault injection, not an alternative production account path.
// The real CLI owns request dispatch/poll/cancel/logout. Only its returned test
// issuer URL and the specified notification ordering are rewritten here.
const [issuer, mode, trace, authUrl, ...args] = process.argv.slice(2);
const child = spawn('codex', args, { env: { ...process.env, CODEX_APP_SERVER_LOGIN_ISSUER: issuer }, stdio: ['pipe', 'pipe', 'inherit'] });
child.on('exit', code => { process.exitCode = code; });
if (args[0] === '--version') {
	child.stdout.pipe(process.stdout); child.stdin.end();
} else {
	process.stdin.pipe(child.stdin);
	createInterface({ input: process.stdin }).on('line', line => appendFileSync(trace, `${line}\n`));
	createInterface({ input: child.stdout }).on('line', line => {
		const message = JSON.parse(line);
		if (message.result?.type === 'chatgpt') {
			// As with the device URL below, the local issuer's origin is not admitted by
			// production. Only the issuer origin/path is restored; the CLI's own loopback
			// callback, PKCE challenge and state are left exactly as it produced them.
			message.result.authUrl = authUrl
				|| `https://auth.openai.com/oauth/authorize${new URL(message.result.authUrl).search}`;
			process.stdout.write(JSON.stringify(message) + '\n');
		} else if (message.result?.type === 'chatgptDeviceCode') {
			if (mode !== 'unadmitted-url') message.result.verificationUrl = 'https://auth.openai.com/codex/device';
			if (mode === 'early-completion') process.stdout.write(JSON.stringify({ method: 'account/login/completed', params: {
				loginId: message.result.loginId, success: false, error: 'Fixture polling failure',
			} }) + '\n' + JSON.stringify(message) + '\n');
			else process.stdout.write(JSON.stringify(message) + '\n');
		} else process.stdout.write(line + '\n');
	});
}
