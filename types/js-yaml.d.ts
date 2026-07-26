declare module 'js-yaml' {
  export function load(input: string): unknown;
  export function dump(
    input: unknown,
    options?: { noRefs?: boolean; sortKeys?: boolean; lineWidth?: number }
  ): string;
}
