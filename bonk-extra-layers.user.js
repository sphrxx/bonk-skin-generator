// ==UserScript==
// @name         bonk.io Extra Layers
// @namespace    bonktestes
// @version      2.0
// @description  Mostra e envia skins com mais de 16 camadas (até 64) no bonk.io
// @match        https://bonk.io/gameframe-release.html*
// @match        https://bonkisback.io/gameframe-release.html*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

// O servidor do bonk só aceita avatar com até 16 camadas e sem campos extras. Então:
// - na sala vão as 16 camadas de baixo, e o resto vai para uma tabela no Supabase;
// - a chave da tabela fica escondida nos ângulos das 16 camadas: cada uma gira 360°·k, o que não
//   muda nada na tela. Os k saem do SHA-256 da skin inteira, então quem recebe confere se o que
//   veio do Supabase é mesmo daquela skin. Ninguém consegue pôr camadas na skin de outra pessoa.
//
// A classe Skin fica presa dentro do alpha2s.js, então pegamos o protótipo dela no construtor
// (this.layers = []) com um setter temporário em Object.prototype.

(function() {
	"use strict";

	const SUPABASE_URL = "https://acglzxbmuewubdjirktj.supabase.co/rest/v1/skin_extras";
	const SUPABASE_KEY = "sb_publishable_-VmTcuF4cLHpIDm2wtOQiQ_Lci5TFMK"; // chave pública; a tabela só permite ler e inserir
	const VANILLA_MAX = 16;
	const MAX_LAYERS = 64;
	const K_MAX = 26; // |ângulo| fica abaixo de 180 + 360·26 = 9540, dentro do limite de ±9999 do jogo
	const RETRY_DELAYS = [0, 3000, 8000]; // quem entra na sala pode buscar antes do upload terminar

	const uploaded = new Set();
	const lookups = new Map();

	// Ângulo em [-180, 180), arredondado a 0,001° para quem recebe recuperar exatamente o mesmo valor
	function normAngle(angle) {
		let n = ((angle % 360) + 540) % 360 - 180;
		n = Math.round(n * 1000) / 1000;
		return n >= 180 ? n - 360 : n;
	}

	const pack = l => [l.id, l.scale, l.angle, l.x, l.y, l.flipX, l.flipY, l.color];
	const pick = l => ({ id: l.id, scale: l.scale, angle: l.angle, x: l.x, y: l.y, flipX: l.flipX, flipY: l.flipY, color: l.color });

	// Os 16 deslocamentos k (um por camada da base) para essa skin
	function turnsFor(base, bc, extras) {
		const hash = sha256(JSON.stringify([bc, base.map(pack), extras.map(pack)]));
		return base.map((_, i) => ((hash[i >> 2] >>> (24 - 8 * (i & 3))) & 255) % (2 * K_MAX + 1) - K_MAX);
	}

	const keyFor = turns => turns.map(k => (k + K_MAX).toString(16).padStart(2, "0")).join("");

	function upload(key, extras) {
		if (uploaded.has(key)) {
			return;
		}
		uploaded.add(key);
		fetch(SUPABASE_URL + "?on_conflict=key", {
			method: "POST",
			headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
			body: JSON.stringify({ key, extras })
		}).then(res => {
			if (!res.ok) {
				uploaded.delete(key);
				console.warn("[ExtraLayers] falha ao enviar camadas extras:", res.status);
			}
		}, err => {
			uploaded.delete(key);
			console.warn("[ExtraLayers] falha ao enviar camadas extras:", err);
		});
	}

	async function fetchExtras(key) {
		for (const delay of RETRY_DELAYS) {
			await new Promise(resolve => setTimeout(resolve, delay));
			try {
				const res = await fetch(`${SUPABASE_URL}?select=extras&key=eq.${key}`, { headers: { apikey: SUPABASE_KEY } });
				const rows = res.ok ? await res.json() : [];
				if (rows.length) {
					return rows[0].extras;
				}
			} catch (err) {
				console.warn("[ExtraLayers] falha ao buscar camadas extras:", err);
			}
		}
		return null;
	}

	async function loadExtras(skin) {
		const base = skin.layers;
		if (base.length != VANILLA_MAX) {
			return;
		}
		const turns = base.map(l => Math.round((l.angle - normAngle(l.angle)) / 360));
		// Skin normal (sem o script) tem quase sempre k = 0 em tudo; não vale a busca
		if (turns.every(k => k == 0) || turns.some(k => Math.abs(k) > K_MAX)) {
			return;
		}
		const key = keyFor(turns);
		if (!lookups.has(key)) {
			lookups.set(key, fetchExtras(key));
		}
		const extras = await lookups.get(key);
		if (!Array.isArray(extras) || skin.layers !== base) {
			return;
		}
		const normBase = base.map(l => ({ ...pick(l), angle: normAngle(l.angle) }));
		if (keyFor(turnsFor(normBase, skin.bc, extras)) != key) {
			console.warn("[ExtraLayers] camadas extras não conferem com a skin; ignorando");
			return;
		}
		skin.layers = extras.filter(l => l && typeof l == "object").slice(0, MAX_LAYERS - VANILLA_MAX).concat(base);
		skin.makeSafe();
		console.log(`[ExtraLayers] skin com ${skin.layers.length} camadas carregada`);
	}

	function patchSkin(proto) {
		const originalFromObject = proto.fromObject;
		proto.fromObject = function(obj) {
			originalFromObject.call(this, obj);
			loadExtras(this);
		};
		// layers[0] é a de cima: na sala vão as 16 de baixo (o que quem não tem o script vê)
		Object.defineProperty(proto, "toJSON", {
			configurable: true,
			writable: true,
			value: function() {
				const layers = this.layers.slice(-MAX_LAYERS);
				if (layers.length <= VANILLA_MAX) {
					return { ...this, layers };
				}
				const extras = layers.slice(0, -VANILLA_MAX).map(pick);
				const base = layers.slice(-VANILLA_MAX).map(l => ({ ...pick(l), angle: normAngle(l.angle) }));
				const turns = turnsFor(base, this.bc, extras);
				upload(keyFor(turns), extras);
				return { ...this, layers: base.map((l, i) => ({ ...l, angle: l.angle + 360 * turns[i] })) };
			}
		});
		console.log("[ExtraLayers] ativo");
	}

	Object.defineProperty(Object.prototype, "layers", {
		configurable: true,
		get() {
			return undefined;
		},
		set(value) {
			if (Object(this) !== this) {
				return;
			}
			// Comportamento normal da atribuição: vira propriedade própria do objeto
			Object.defineProperty(this, "layers", { value, writable: true, enumerable: true, configurable: true });
			const proto = Object.getPrototypeOf(this);
			if (proto && typeof proto.fromObject == "function" && typeof proto.makeSafe == "function") {
				delete Object.prototype.layers;
				patchSkin(proto);
			}
		}
	});

	// SHA-256 síncrono (o toJSON não pode esperar o crypto.subtle). Devolve 8 palavras de 32 bits.
	const rotr = (x, n) => (x >>> n) | (x << (32 - n));
	const H0 = [];
	const K = [];
	for (let n = 2; K.length < 64; n++) {
		let prime = true;
		for (let d = 2; d * d <= n; d++) {
			if (n % d == 0) {
				prime = false;
				break;
			}
		}
		if (prime) {
			if (H0.length < 8) {
				H0.push((Math.sqrt(n) % 1) * 2 ** 32 | 0);
			}
			K.push((Math.cbrt(n) % 1) * 2 ** 32 | 0);
		}
	}
	function sha256(text) {
		const bytes = new TextEncoder().encode(text);
		const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
		padded.set(bytes);
		padded[bytes.length] = 0x80;
		const view = new DataView(padded.buffer);
		view.setUint32(padded.length - 4, bytes.length * 8);
		const h = H0.slice();
		const w = new Array(64);
		for (let off = 0; off < padded.length; off += 64) {
			for (let i = 0; i < 16; i++) {
				w[i] = view.getUint32(off + i * 4) | 0;
			}
			for (let i = 16; i < 64; i++) {
				const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
				const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
				w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
			}
			let [a, b, c, d, e, f, g, hh] = h;
			for (let i = 0; i < 64; i++) {
				const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
				const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
				hh = g; g = f; f = e; e = (d + t1) | 0;
				d = c; c = b; b = a; a = (t1 + t2) | 0;
			}
			[a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
		}
		return h;
	}
})();
