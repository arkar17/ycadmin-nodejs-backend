declare global {
  namespace Express {
    interface Request {
      validated?: {
        body: unknown;
        params: unknown;
        query: unknown;
      };
      auth?: {
        userId: number;
        displayName: string;
        roles: string[];
        permissions: string[];
        isSystemAdmin: boolean;
        transport: 'bearer' | 'browser-cookie';
      };
    }
  }
}

export {};
