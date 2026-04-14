import type { Currency } from "../../types";

export function CurrencyBadge({ currency }: { currency: Currency }) {
  const styles =
    currency === "KRW"
      ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"
      : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded ${styles}`}>
      {currency}
    </span>
  );
}
