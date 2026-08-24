import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';

const dependencyKind = z.enum([
  'python-runtime',
  'pytorch',
  'numpy',
  'custom-package',
  'cuda-runtime'
]);

export const inferenceDependencyDeclarationSchema = z.object({
  kind: dependencyKind,
  name: z.string().trim().min(1).max(256),
  expectedVersion: z.string().trim().min(1).max(256).optional(),
  required: z.boolean().default(true)
}).strict();

export interface ObservedInferenceDependency {
  kind: z.infer<typeof dependencyKind>;
  name: string;
  version: string;
}

export interface InferenceProvenanceManifest {
  schemaVersion: 1;
  dependencies: ObservedInferenceDependency[];
  digest: string;
}

/** Collects only the explicit allowlist; it never performs pip-freeze or an environment walk. */
export function collectInferenceProvenance(input: {
  declarations: unknown[];
  resolve: (kind: ObservedInferenceDependency['kind'], name: string) => string | null;
}): InferenceProvenanceManifest {
  const declarations = input.declarations.map((value) =>
    inferenceDependencyDeclarationSchema.parse(value)
  );
  const identities = new Set<string>();
  const dependencies: ObservedInferenceDependency[] = [];
  for (const declaration of declarations) {
    const identity = `${declaration.kind}:${declaration.name}`;
    if (identities.has(identity)) throw new Error('inference_dependency_duplicate');
    identities.add(identity);
    const version = input.resolve(declaration.kind, declaration.name);
    if (!version) {
      if (declaration.required) throw new Error(`inference_dependency_missing:${identity}`);
      continue;
    }
    if (declaration.expectedVersion && declaration.expectedVersion !== version) {
      throw new Error(`inference_dependency_version_mismatch:${identity}`);
    }
    dependencies.push({ kind: declaration.kind, name: declaration.name, version });
  }
  dependencies.sort((left, right) =>
    `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`)
  );
  const payload = { schemaVersion: 1 as const, dependencies };
  return { ...payload, digest: sha256(canonicalJson(payload)) };
}
