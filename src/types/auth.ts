export type Role =
  | "service-request"
  | "admin-request"
  | "user-request"
  | "unidentified-request";

export const REQUEST_ROLES = {
  SERVICE: "service-request",
  ADMIN: "admin-request",
  USER: "user-request",
  UNIDENTIFIED: "unidentified-request",
} as const satisfies Record<string, Role>;

export type AuthSummary = {
  userId: string | null;
  role: Role;
  accessToken?: string | null;
};
