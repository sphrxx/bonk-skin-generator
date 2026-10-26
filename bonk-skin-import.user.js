// ==UserScript==
// @name         bonk.io Skin Import
// @namespace    bonktestes
// @version      1.1
// @description  Importa uma string de skin (do Gerador de Skins) direto no editor de skin do bonk.io
// @match        https://bonk.io/gameframe-release.html*
// @match        https://bonkisback.io/gameframe-release.html*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Como funciona: ao abrir o editor, o jogo faz editSkin.fromString(skin.toString()), e
// fromString chama decodeURIComponent na string. Interceptamos UMA dessas chamadas e
// devolvemos a skin importada. O editor abre com ela, e o Save do próprio jogo salva.

(function() {
	"use strict";

	const SKIN_HEADER = "CgcDYQ"; // base64 de 0A 07 03 61, o cabeçalho fixo de Skin.toString()
	const originalDecode = window.decodeURIComponent;
	let pendingBase64 = null;
	let pendingTimeout = null;

	window.decodeURIComponent = function(value) {
		const result = originalDecode.apply(this, arguments);
		if (pendingBase64 && typeof value == "string" && result.startsWith(SKIN_HEADER)) {
			const imported = pendingBase64;
			pendingBase64 = null;
			clearTimeout(pendingTimeout);
			return imported;
		}
		return result;
	};

	// Leitura mínima da string, só para validar e informar o usuário antes de importar
	function inspectSkin(string) {
		const base64 = originalDecode(string.trim());
		if (!base64.startsWith(SKIN_HEADER)) {
			throw new Error("não parece uma string de skin do bonk");
		}
		const bin = atob(base64);
		const view = new DataView(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer);
		const layerCount = (view.getUint8(7) - 1) / 2;
		// Acima de 16, só aparece para os outros com o bonk-extra-layers.user.js
		if (!Number.isInteger(layerCount) || layerCount < 0 || layerCount > 64) {
			throw new Error(`número de camadas inválido (${layerCount})`);
		}
		// cabeçalho (9) + 1ª camada (31) + demais (28 cada) + bc (4)
		const expected = 9 + (layerCount ? 31 + (layerCount - 1) * 28 : 0) + 4;
		if (bin.length < expected) {
			throw new Error(`string truncada (${bin.length} bytes, esperado ${expected})`);
		}
		return { base64, layerCount };
	}

	function importSkin() {
		const input = window.prompt("Cole a string da skin.\nEla vai abrir no editor, no slot selecionado. Confira e clique em Save para salvar.");
		if (!input) {
			return;
		}
		let info;
		try {
			info = inspectSkin(input);
		} catch (err) {
			window.alert("String inválida: " + err.message);
			return;
		}
		pendingBase64 = info.base64;
		// Se o editor não abrir por algum motivo, não deixa o gancho armado
		pendingTimeout = setTimeout(() => { pendingBase64 = null; }, 3000);
		document.getElementById("skinmanager_edit").click();
	}

	function addButton() {
		const editButton = document.getElementById("skinmanager_edit");
		if (!editButton || document.getElementById("skinmanager_import")) {
			return;
		}
		const button = document.createElement("div");
		button.id = "skinmanager_import";
		button.className = editButton.className;
		button.textContent = "Importar";
		button.title = "Importar string de skin no slot selecionado";
		Object.assign(button.style, {
			width: "100px",
			height: "30px",
			lineHeight: "30px",
			position: "absolute",
			left: "300px",
			bottom: "-40px"
		});
		button.addEventListener("click", importSkin);
		editButton.parentNode.appendChild(button);
	}

	if (document.readyState == "loading") {
		document.addEventListener("DOMContentLoaded", addButton);
	} else {
		addButton();
	}
})();
