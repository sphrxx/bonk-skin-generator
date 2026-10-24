// Codec de skins do bonk.io, reproduzindo Skin.toString()/fromString() do alpha2s.js
// (ver FORMATO_SKIN.md). Funciona no navegador e no Node 16+ (usa btoa/atob globais).

const MAX_LAYERS = 16;
const MAX_SHAPE_ID = 115;
const DEFAULT_BC = 4492031;

function encodeSkin(skin) {
	const layers = skin.layers || [];
	if (layers.length > MAX_LAYERS) {
		throw new Error(`Skin tem ${layers.length} camadas; o jogo aceita no máximo ${MAX_LAYERS}`);
	}
	const view = new DataView(new ArrayBuffer(16 + layers.length * 32));
	let i = 0;
	const byte = v => view.setUint8(i++, v);
	const short = v => { view.setInt16(i, v); i += 2; };
	const int = v => { view.setInt32(i, v); i += 4; };
	const float = v => { view.setFloat32(i, v); i += 4; };

	byte(10); byte(7); byte(3); byte(97);
	short(2);
	byte(9);
	byte(layers.length * 2 + 1);
	byte(1);
	layers.forEach((layer, n) => {
		byte(10);
		if (n == 0) {
			byte(7); byte(5); byte(97); byte(108);
		} else {
			byte(5);
		}
		short(1);
		short(layer.id);
		float(layer.scale);
		float(layer.angle);
		float(layer.x);
		float(layer.y);
		byte(layer.flipX ? 1 : 0);
		byte(layer.flipY ? 1 : 0);
		int(layer.color);
	});
	int(skin.bc);

	let bin = "";
	for (let j = 0; j < i; j++) {
		bin += String.fromCharCode(view.getUint8(j));
	}
	return encodeURIComponent(btoa(bin));
}

function decodeSkin(string) {
	const bin = atob(decodeURIComponent(string));
	const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
	const view = new DataView(bytes.buffer);
	let i = 0;
	const byte = () => view.getUint8(i++);
	const short = () => { const v = view.getInt16(i); i += 2; return v; };
	const int = () => { const v = view.getInt32(i); i += 4; return v; };
	const float = () => { const v = view.getFloat32(i); i += 4; return v; };

	const parseLayer = () => {
		if (byte() != 10) {
			return null;
		}
		if (byte() == 7) {
			byte(); byte(); byte();
		}
		short();
		return {
			id: short(),
			scale: float(),
			angle: float(),
			x: float(),
			y: float(),
			flipX: byte() != 0,
			flipY: byte() != 0,
			color: int()
		};
	};

	const skin = { layers: [], bc: DEFAULT_BC };
	byte(); byte(); byte(); byte();
	const hasBgColor = short();
	byte();
	const layerCount = (byte() - 1) / 2;
	// Camadas com índice explícito (formato antigo), até o marcador 1
	let version = byte();
	while (version != 1) {
		let layerId = 0;
		if (version == 3) {
			layerId = byte() - 48;
		} else if (version == 5) {
			const a = byte();
			const b = byte();
			layerId = (a - 48) * 10 + (b - 48);
		}
		skin.layers[layerId] = parseLayer();
		version = byte();
	}
	for (let n = 0; n < layerCount; n++) {
		skin.layers[n] = parseLayer();
	}
	if (hasBgColor >= 2) {
		skin.bc = int();
	}
	skin.layers = skin.layers.filter(Boolean);
	return skin;
}

function validateSkin(skin) {
	const errors = [];
	if (!(skin.bc >= 0 && skin.bc <= 0xffffff)) errors.push("bc fora de 0..0xFFFFFF");
	if (skin.layers.length > MAX_LAYERS) errors.push(`mais de ${MAX_LAYERS} camadas`);
	skin.layers.forEach((l, n) => {
		if (!(Number.isInteger(l.id) && l.id >= 1 && l.id <= MAX_SHAPE_ID)) errors.push(`camada ${n}: id inválido`);
		if (!(l.scale >= -10 && l.scale <= 10)) errors.push(`camada ${n}: scale fora de -10..10`);
		if (!(l.angle >= -9999 && l.angle <= 9999)) errors.push(`camada ${n}: angle fora de -9999..9999`);
		if (!(Math.abs(l.x) <= 9999 && Math.abs(l.y) <= 9999)) errors.push(`camada ${n}: x/y fora de ±9999`);
		if (!(l.color >= 0 && l.color <= 0xffffff)) errors.push(`camada ${n}: color fora de 0..0xFFFFFF`);
		if (typeof l.flipX != "boolean" || typeof l.flipY != "boolean") errors.push(`camada ${n}: flipX/flipY devem ser boolean`);
	});
	return errors;
}

if (typeof module != "undefined") {
	module.exports = { encodeSkin, decodeSkin, validateSkin, MAX_LAYERS, MAX_SHAPE_ID };
}
