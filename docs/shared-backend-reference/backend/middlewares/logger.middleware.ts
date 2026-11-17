import { Request, Response, NextFunction } from "express";
import { Member } from "@prisma/client";
import logger from "../helpers/logger";

const loggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const member = req.user as Member | undefined;
    const durationMs = Date.now() - startedAt;

    logger.info("HTTP request", {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      memberId: member?.id ?? null,
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });
  });

  next();
};

export default loggerMiddleware;
