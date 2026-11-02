export type LocalCommandResult =
  | { kind: 'reply'; text: string }
  | { kind: 'open-link'; url: string; confirmation: string }
  | { kind: 'search'; query: string };

export interface LocalCommandOptions {
  /** Nome do usuário, para a saudação sair pessoal ("Bom dia, Jefferson"). */
  name?: string;
}

export function resolveLocalCommand(
  input: string,
  now?: Date,
  options?: LocalCommandOptions,
): LocalCommandResult | undefined;
