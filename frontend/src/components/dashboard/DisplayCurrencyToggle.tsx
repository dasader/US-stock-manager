import type { Currency } from "../../types";

interface Props {
  value: Currency;
  onChange: (c: Currency) => void;
}

export function DisplayCurrencyToggle({ value, onChange }: Props) {
  const currencies: Currency[] = ["KRW", "USD"];
  return (
    <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
      {currencies.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`px-3 py-1 text-sm ${
            value === c
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
