export const DEFAULT_CITY: string;

export function foldText(value: unknown): string;

export function isPlaceQuery(text: string): boolean;

export function looksLikePhoneNumber(text: string): boolean;

export function buildPhoneSearchQuery(text: string, city?: string): string;

export function isValidPhone(digits: string): boolean;

export function formatPhoneBR(digits: string): string;

export function extractPhones(text: string): { digits: string; formatted: string; raw: string }[];

export function decodeHtmlEntities(value: unknown): string;

export function stripTags(value: unknown): string;

export function parseDuckDuckGoResults(
  html: string,
): { title: string; url: string; snippet: string }[];

export function hostOf(url: string): string;

export interface PhoneCandidate {
  digits: string;
  formatted: string;
  title: string;
  source: string;
  votes: number;
  confidence: 'alta' | 'média' | 'baixa';
  candidates: { digits: string; formatted: string; title: string }[];
}

export function pickPhoneCandidate(
  results: { title: string; url: string; snippet: string }[],
  query?: string,
): PhoneCandidate | null;
