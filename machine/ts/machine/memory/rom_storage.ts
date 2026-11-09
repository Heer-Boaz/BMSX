/** The region identity survives replacement; both views address its current bytes. */
export class RomStorage {
	public bytes: Uint8Array;
	public view: DataView;

	public constructor(bytes: Uint8Array) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	public install(bytes: Uint8Array): void {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
}
