import { UserRole } from "../../models/User.model";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
      };
    }
  }
}

export {};
