import type { Currency } from "../types";

export type Market = "KRX" | "US";

const KRX_PATTERN = /^\d{6}$/;

export function detectMarket(ticker: string): Market {
  const t = ticker.trim().toUpperCase();
  if (t === "GOLD" || KRX_PATTERN.test(t)) return "KRX";
  return "US";
}

export function validateTickerForCurrency(
  ticker: string,
  currency: Currency
): string | null {
  const market = detectMarket(ticker);
  const expected = currency === "KRW" ? "KRX" : "US";
  if (market !== expected) {
    return `${currency} 계정에는 ${expected} 시장 종목만 입력할 수 있습니다`;
  }
  return null;
}
