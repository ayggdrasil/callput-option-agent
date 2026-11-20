export interface OpenInputFieldError {
  field: string;
  expected: string;
}

export class OpenInputError extends Error {
  readonly fieldErrors: OpenInputFieldError[];
  constructor(field: string, expected: string) {
    super("invalid_open_input");
    this.fieldErrors = [{ field, expected }];
  }
}

/** Decimal strings preserve the user's exact precision. JSON numbers are
 * accepted only when their ordinary decimal representation is unambiguous. */
export function normalizeAccountOpenInput(input: any, decimals: number) {
  const suppliedSize = input.size ?? "0.0001";
  const size = typeof suppliedSize === "number" ? String(suppliedSize) : suppliedSize;
  if (
    typeof size !== "string" ||
    !/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(size) ||
    (size.split(".")[1]?.length ?? 0) > decimals ||
    !/[1-9]/.test(size) ||
    (typeof suppliedSize === "number" &&
      (!Number.isFinite(suppliedSize) || suppliedSize >= Number.MAX_SAFE_INTEGER))
  ) {
    throw new OpenInputError("size",
      `Positive decimal quantity in underlying units, with at most ${decimals} decimal places. Use "0.02" or 0.02. Use a decimal string for very small or high precision quantities.`);
  }
  const ratio = input.min_fill_ratio ?? 0.78;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0.5 || ratio > 1) {
    throw new OpenInputError("min_fill_ratio",
      "JSON number from 0.5 through 1 inclusive, for example 0.78.");
  }
  return {
    ...input,
    ...(input.size !== undefined ? { size } : {}),
  };
}
