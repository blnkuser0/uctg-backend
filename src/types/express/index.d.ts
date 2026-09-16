import { Permission } from "../../constants/permissions";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: {
        id: string;
        email: string;
        name: string;
      };
      orgId?: string;
      roleName?: string;
      permissions?: Permission[];
    }
  }
}

export {};
