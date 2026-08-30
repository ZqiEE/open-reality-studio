export function hasHelpFlag(
  args: readonly string[],
  optionsWithValues: ReadonlySet<string>,
): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return true;
    if (arg && optionsWithValues.has(arg)) index += 1;
  }
  return false;
}
