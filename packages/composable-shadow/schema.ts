import { canonicalJson, sha256 } from '../core/evidence';
import { profileSchema, type Profile } from './contracts';
export * from './contracts';
export const hashObject = (value: unknown): string => sha256(canonicalJson(value));
export const profileHash = (profile: Profile): string => hashObject(profileSchema.parse(profile));
