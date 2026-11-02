const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { expo } = require('../app.config.js');

test('Expo app config references only assets present in the independent project', () => {
  const projectRoot = path.resolve(__dirname, '..');
  for (const asset of [
    expo.icon,
    expo.android.adaptiveIcon.foregroundImage,
    expo.web.favicon,
  ]) {
    assert.ok(existsSync(path.join(projectRoot, asset)), `Missing app asset: ${asset}`);
  }
  assert.equal(expo.android.package, 'com.jefferson.nexusassistente');
});

test('o app não embute mais chave de IA', () => {
  // A voz é a do próprio aparelho e a pesquisa é do módulo nativo: nenhuma
  // credencial de modelo de linguagem entra no APK.
  assert.equal(expo.extra.geminiApiKey, undefined);
  assert.equal(expo.extra.geminiModel, undefined);
  assert.equal(
    Object.keys(expo.extra).some((key) => /gemini|openai|apiKey/i.test(key)),
    false,
    'o app.config.js não pode carregar chave de IA',
  );
});
