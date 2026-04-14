import { useEffect, useState } from "react";
import type { Currency } from "../types";

const STORAGE_KEY = "display_currency";

export function useDisplayCurrency(): [Currency, (c: Currency) => void] {
  const [currency, setCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "USD" ? "USD" : "KRW";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, currency);
  }, [currency]);

  return [currency, setCurrency];
}
