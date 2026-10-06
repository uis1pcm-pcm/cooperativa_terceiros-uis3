const NON_DIGIT_REGEX = /\D+/g;

function extractDigits(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const asString = String(value);
  return asString.replace(NON_DIGIT_REGEX, "").slice(0, 14);
}

function formatFromDigits(digits: string): string {
  const safeDigits = digits.slice(0, 14);
  if (!safeDigits) return "";

  const part1 = safeDigits.slice(0, 2);
  const part2 = safeDigits.slice(2, 5);
  const part3 = safeDigits.slice(5, 8);
  const part4 = safeDigits.slice(8, 12);
  const part5 = safeDigits.slice(12, 14);

  let formatted = part1;
  if (part2) formatted += `.${part2}`;
  if (part3) formatted += `.${part3}`;
  if (part4) formatted += `/${part4}`;
  if (part5) formatted += `-${part5}`;
  return formatted;
}

export function maskCnpjInput(rawValue: string): string {
  const digits = extractDigits(rawValue);
  if (!digits) return "";
  return formatFromDigits(digits);
}

export function normalizeCnpj(value: unknown): string {
  const digits = extractDigits(value);
  if (!digits) {
    return typeof value === "string" ? value.trim() : "";
  }
  if (digits.length === 14) {
    return formatFromDigits(digits);
  }
  return typeof value === "string" ? value.trim() : digits;
}

export function isValidCnpj(value: unknown): boolean {
  return extractDigits(value).length === 14;
}

