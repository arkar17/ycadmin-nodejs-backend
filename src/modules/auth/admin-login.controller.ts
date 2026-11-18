import type { Request, Response } from 'express';

import { adminBrowserAuthConfig, type AdminBrowserAuthConfig } from '../../config/admin-browser-auth.js';
import { sendData } from '../../shared/api-response.js';
import type { AdminLoginInput } from './admin-login.schema.js';
import type { AdminLoginService } from './admin-login.service.js';
import {
  clearBrowserAuthCookie,
  hasBrowserOriginMetadata,
  requireAllowedBrowserOrigin,
  setBrowserAuthCookie,
} from './browser-auth.js';

export class AdminLoginController {
  public constructor(
    private readonly service: AdminLoginService,
    private readonly browserAuth: AdminBrowserAuthConfig = adminBrowserAuthConfig,
  ) {}

  public readonly login = async (request: Request, response: Response) => {
    const input = request.validated?.body as AdminLoginInput;
    if (this.browserAuth.enabled && hasBrowserOriginMetadata(request)) {
      requireAllowedBrowserOrigin(request, this.browserAuth);
      const result = await this.service.login(input, this.browserAuth.maxAgeSeconds);
      setBrowserAuthCookie(response, result.accessToken, this.browserAuth);
      return sendData(response, {
        authentication: 'browser-cookie' as const,
        expiresAt: result.expiresAt,
        user: result.user,
      });
    }
    return sendData(response, await this.service.login(input));
  };

  public readonly logout = async (request: Request, response: Response) => {
    if (this.browserAuth.enabled) requireAllowedBrowserOrigin(request, this.browserAuth);
    clearBrowserAuthCookie(response, this.browserAuth);
    return response.status(204).send();
  };
}
