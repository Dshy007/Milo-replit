import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: string;
    tenantId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;
    }
  }
}

export {};
