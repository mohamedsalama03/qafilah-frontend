export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Supplied only after a human-readable backend source/document review. */
export interface ContractEvidence {
  source: string;
}

export interface SafeErrorDetails {
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  formErrors?: readonly string[];
  conflictMessage?: string;
}

/** This is a transport contract, not an invented Laravel response envelope. */
export interface EndpointContract<Input, Output> {
  evidence: ContractEvidence;
  method: HttpMethod;
  path: (input: Input) => string;
  decode: (payload: unknown) => Output;
  body?: (input: Input) => unknown;
  /** Explicit reviewed multipart boundary: browser generates Content-Type and boundary. */
  multipartBody?: (input: Input) => FormData;
  /** Exact successful HTTP status when mandated by the published contract. */
  successStatus?: number;
  decodeError?: (payload: unknown, status: number) => SafeErrorDetails;
}

export interface CsrfContract {
  evidence: ContractEvidence;
  headerName: string;
  /** Read/refresh only the CSRF token specified by the reviewed contract, never session secrets. */
  getToken: (signal: AbortSignal) => Promise<string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientOptions {
  apiOrigin: string;
  mode?: "production" | "development" | "test";
  csrf?: CsrfContract;
  requestId?: { evidence: ContractEvidence; headerName: string };
  /** A reviewed body field can remain readable when CORS exposes no response headers. */
  requestIdFromBody?: {
    evidence: ContractEvidence;
    decode: (payload: unknown) => string | undefined;
  };
  retryAfter?: { evidence: ContractEvidence; headerName: string };
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
