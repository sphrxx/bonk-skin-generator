// Testa o bonk-extra-layers.user.js contra a classe Skin original do jogo, com um Supabase falso.
// Uso: node tools/test-extra-layers.js caminho/para/alpha2s-desofuscado.js
// (o código do jogo não é distribuído aqui; gere a versão desofuscada com o bonk-deobfuscator)

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const crypto = require("crypto");

const gamePath = process.argv[2];
if (!gamePath) {
	console.error("Uso: node tools/test-extra-layers.js caminho/para/alpha2s-desofuscado.js");
	process.exit(1);
}
const game = fs.readFileSync(gamePath, "utf8");
const start = game.indexOf("class Skin {");
const end = game.indexOf("\n\ttoString() {", start);
assert(start >= 0 && end > start, "classe Skin não encontrada no arquivo do jogo");
// Só constructor, makeSafe e fromObject, que é o que a rede usa
const skinSource = game.slice(start, end) + "\n}";
const makeSkinClass = () => new Function(skinSource + "\nreturn Skin;")();

// Supabase falso: só o que o script usa (insert ignorando duplicata e select por key)
const db = new Map();
let gets = 0;
global.window = global;
global.fetch = async (url, options = {}) => {
	if (options.method == "POST") {
		const row = JSON.parse(options.body);
		if (!db.has(row.key)) {
			db.set(row.key, row.extras);
		}
		return { ok: true, status: 201 };
	}
	gets++;
	const key = new URL(url).searchParams.get("key").replace("eq.", "");
	return { ok: true, json: async () => db.has(key) ? [{ extras: JSON.parse(JSON.stringify(db.get(key))) }] : [] };
};
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

const layer = n => ({ id: (n % 115) + 1, scale: 0.25 + n / 100, angle: n * 37 - 500, x: n % 10, y: n / 3, flipX: n % 2 == 0, flipY: false, color: n * 4000 });
const big = Array.from({ length: 30 }, (_, n) => layer(n));
const norm = a => ((a % 360) + 540) % 360 - 180;
const sameLook = (a, b) => assert(Math.abs(norm(a - b)) < 0.001, `ângulos ${a} e ${b} não ficam iguais na tela`);

(async () => {
	// Jogador sem o script: classe criada antes do script rodar, nunca é modificada
	const VanillaSkin = makeSkinClass();
	new VanillaSkin();

	new Function(fs.readFileSync(path.join(__dirname, "..", "bonk-extra-layers.user.js"), "utf8"))();
	const Skin = makeSkinClass();
	const mine = new Skin();
	assert.strictEqual(Object.getOwnPropertyDescriptor(Object.prototype, "layers"), undefined, "setter temporário não foi removido");
	mine.layers = big.map(l => ({ ...l }));
	mine.bc = 123;

	// Na sala: formato original, 16 camadas de baixo, mesma aparência
	const wire = JSON.parse(JSON.stringify({ avatar: mine })).avatar;
	assert.deepStrictEqual(Object.keys(wire), ["layers", "bc"]);
	assert.strictEqual(wire.layers.length, 16);
	wire.layers.forEach((l, i) => {
		const orig = big[14 + i];
		assert.deepStrictEqual({ ...l, angle: 0 }, { ...orig, angle: 0 });
		sameLook(l.angle, orig.angle);
		assert(Math.abs(l.angle) <= 9999, "ângulo fora do limite do jogo");
	});
	assert.strictEqual(mine.layers.length, 30, "a skin local continua inteira");
	await flush();
	assert.strictEqual(db.size, 1, "camadas extras enviadas ao Supabase");

	// O SHA-256 do script bate com o do Node: recalcula a chave por fora
	const [[key, extras]] = db;
	const normBase = wire.layers.map(l => ({ ...l, angle: Math.round(norm(l.angle) * 1000) / 1000 }));
	const pack = l => [l.id, l.scale, l.angle, l.x, l.y, l.flipX, l.flipY, l.color];
	const digest = crypto.createHash("sha256").update(JSON.stringify([123, normBase.map(pack), extras.map(pack)])).digest();
	const expectedKey = normBase.map((_, i) => (digest[i] % 53).toString(16).padStart(2, "0")).join("");
	assert.strictEqual(key, expectedKey, "SHA-256 do script difere do Node");

	// Quem tem o script recebe as 30 camadas
	const received = new Skin();
	received.fromObject(wire);
	await flush();
	assert.strictEqual(received.layers.length, 30);
	assert.deepStrictEqual(received.layers.slice(0, 14), big.slice(0, 14));
	received.layers.slice(14).forEach((l, i) => sameLook(l.angle, big[14 + i].angle));

	// Quem não tem vê as 16 de baixo
	const vanilla = new VanillaSkin();
	vanilla.fromObject(wire);
	assert.strictEqual(vanilla.layers.length, 16);

	// Linha adulterada no banco é ignorada
	db.set(key, extras.map(l => ({ ...l, color: 0xff0000 })));
	new Function(fs.readFileSync(path.join(__dirname, "..", "bonk-extra-layers.user.js"), "utf8"))(); // cache novo
	const ForgedSkin = makeSkinClass();
	const victim = new ForgedSkin();
	victim.fromObject(wire);
	await flush();
	assert.strictEqual(victim.layers.length, 16, "camadas que não conferem com o hash não podem entrar");

	// Skin normal de 16 camadas não gera busca; skin pequena sai sem mudanças
	gets = 0;
	const plain = new Skin();
	plain.fromObject({ layers: big.slice(0, 16).map(l => ({ ...l, angle: norm(l.angle) })), bc: 1 });
	await flush();
	assert.strictEqual(gets, 0);
	const small = new Skin();
	small.layers = big.slice(0, 5);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(small)), { layers: big.slice(0, 5), bc: 4492031 });

	console.log("ok");
})().catch(err => {
	console.error(err);
	process.exit(1);
});
