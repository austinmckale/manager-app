import { Role } from "@prisma/client";

export type AuthContext = {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  email: string;
};

export async function requireAuth(): Promise<AuthContext> {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000001",
    role: Role.OWNER,
    fullName: "Admin Demo",
    email: "admin@demo.local",
  };
}
