import type { Currency } from "../types";

export function formatCurrency(amount: number, currency: Currency): string {
  if (currency === "KRW") {
    return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
  }
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function currencySymbol(currency: Currency): string {
  return currency === "KRW" ? "₩" : "$";
}
