/**
 * testScale.ts — масштаб прогона тяжёлых тестов.
 *
 * По умолчанию тесты гоняют «лёгкую» выборку сидов: баги генерации и геометрии
 * ловятся на десятке миров так же, как на сотне, а вот время и память растут
 * линейно. Полный прогон — по запросу, одним из способов (работают и на Windows):
 *
 *   npm run test:world-gen -- --full      флаг после `--`
 *   npm run test:world:full               все мировые тесты разом
 *   SEEDS=200 npm run test:world-gen      точное число сидов (в bash/zsh/PowerShell: $env:SEEDS=200)
 */
declare const process: { argv: string[]; env: Record<string, string | undefined> };

/** Полный прогон запрошен (флаг --full или FULL=1). */
export const FULL: boolean = process.argv.includes("--full") || process.env.FULL === "1";

/**
 * Сколько сидов/повторов гонять: явный `envName` (по умолчанию SEEDS) главнее всего,
 * иначе `full` при --full, иначе `light`.
 */
export function scaled(light: number, full: number, envName = "SEEDS"): number {
  const fromEnv = Number(process.env[envName]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return FULL ? full : light;
}
