import { registerOrganization } from "../../src/services/auth.service";

/**
 * Creates an Organization + seeded Admin Role + first User directly through
 * the service layer — the same function platform.service.ts's Super-Admin-
 * gated org creation calls, just invoked directly so tests don't need a
 * Super Admin session just to stand up a fixture org.
 */
export interface TestOrgAdmin {
  id: string;
  organizationId: string;
  email: string;
}

export async function createTestOrgAndAdmin(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Promise<TestOrgAdmin> {
  const user = await registerOrganization(input);
  return {
    id: user._id.toString(),
    organizationId: user.organizationId.toString(),
    email: user.email,
  };
}
