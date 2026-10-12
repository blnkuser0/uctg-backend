import { Permission } from "../../constants/permissions";
import { ShiftType } from "../../constants/shift";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: {
        id: string;
        email: string;
        name: string;
        shiftType: ShiftType;
      };
      orgId?: string;
      permissions?: Permission[];
      isSuperAdmin?: boolean;
    }
  }
}

export {};
