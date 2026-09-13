import { z } from "zod";
import { hasAsciiControlCharacters } from "../api/control-characters";

const storeUuidSchema = z.uuid().brand<"StoreUuid">();
const principalIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/\s/.test(value) && !hasAsciiControlCharacters(value))
  .brand<"PrincipalId">();

export type StoreUuid = z.infer<typeof storeUuidSchema>;
export type PrincipalId = z.infer<typeof principalIdSchema>;

/** Shape validation is not membership verification; values must come from backend authority. */
export const parseStoreUuid = (value: unknown): StoreUuid => storeUuidSchema.parse(value);
export const parsePrincipalId = (value: unknown): PrincipalId => principalIdSchema.parse(value);

export interface QueryScope {
  readonly principalId: PrincipalId;
  readonly storeUuid: StoreUuid;
  readonly revision: number;
}

export const merchantKeys = {
  all: ["merchant"] as const,
  principal: (principalId: PrincipalId) => ["merchant", principalId] as const,
};

export const storeKeys = {
  scope: (scope: QueryScope) =>
    ["merchant", scope.principalId, "store", scope.storeUuid, scope.revision] as const,
  resource: (
    scope: QueryScope,
    resource: string,
    parameters?: Readonly<Record<string, unknown>>,
  ) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(resource))
      throw new Error("A query resource requires a bounded name.");
    return [...storeKeys.scope(scope), resource, ...(parameters ? [parameters] : [])] as const;
  },
};
