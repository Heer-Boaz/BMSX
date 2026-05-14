export function isIOSAudioTarget(): boolean {
	if (typeof navigator === 'undefined') {
		return false;
	}
	const platform = navigator.platform;
	switch (platform) {
		case 'iPhone':
		case 'iPad':
		case 'iPod':
			return true;
		case 'MacIntel':
			if (navigator.maxTouchPoints > 1) {
				return true;
			}
			break;
	}
	const userAgent = navigator.userAgent;
	return userAgent.indexOf('iPhone') >= 0 || userAgent.indexOf('iPad') >= 0 || userAgent.indexOf('iPod') >= 0;
}
