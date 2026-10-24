// Gera ../shapes.js com as 115 formas de avatar do bonk.io (SVGs em data URL).
//
// Uso:
//   node tools/extract-shapes.js                      baixa https://bonk.io/GameResources.js
//   node tools/extract-shapes.js caminho/GameResources.js   usa um arquivo já salvo
//
// O arquivo é lido como texto: as SVGs são extraídas com uma expressão regular,
// sem executar nenhum código do jogo. Requer Node 18+ (fetch embutido).

const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://bonk.io/GameResources.js";
const OUTPUT = path.join(__dirname, "..", "shapes.js");
const EXPECTED_SHAPES = 115;

async function readSource(arg) {
	if (arg) {
		console.log(`Lendo ${arg}`);
		return fs.readFileSync(arg, "utf8");
	}
	console.log(`Baixando ${SOURCE_URL}`);
	const res = await fetch(SOURCE_URL);
	if (!res.ok) {
		throw new Error(`falha ao baixar (${res.status} ${res.statusText})`);
	}
	return res.text();
}

async function main() {
	const source = await readSource(process.argv[2]);
	const pattern = /GameResources\.svgStrings\.push\("(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"\)/g;
	const shapes = [null, ...Array.from(source.matchAll(pattern), m => m[1])];
	const count = shapes.length - 1;
	if (count != EXPECTED_SHAPES) {
		throw new Error(`encontradas ${count} formas, esperadas ${EXPECTED_SHAPES}; o formato do arquivo mudou?`);
	}
	fs.writeFileSync(OUTPUT, "// Gerado por tools/extract-shapes.js a partir do GameResources.js do bonk.io\n" +
		"// (índice = id da camada; 0 é null). Não versionado: a arte pertence ao jogo.\n" +
		"const BONK_SHAPES = " + JSON.stringify(shapes) + ";\n");
	console.log(`${count} formas salvas em ${OUTPUT}`);
}

main().catch(err => {
	console.error("Erro: " + err.message);
	process.exit(1);
});
