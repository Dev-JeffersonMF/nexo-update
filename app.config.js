const appJson = require('./app.json');

/*
 * A voz do Nexus é a do próprio aparelho e a pesquisa na internet é feita pelo
 * módulo nativo (Wikipédia e busca leve).
 *
 * Não há chave de IA dentro do app: a conversa não é enviada para nenhum
 * servidor de modelo. Por isso este arquivo não embute credencial nenhuma — e
 * o `.env` da pasta raiz deixou de ser lido no build.
 */

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
    },
  },
};
