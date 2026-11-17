import { ErrorRequestHandler } from "express";
import { Member } from "@prisma/client";
import { errorResponse } from "../../helpers/response";
import logger from "../../helpers/logger";

export const errorHandler: ErrorRequestHandler = (err, req, res, next): any => {
  logger.error("Unhandled request error", {
    method: req.method,
    url: req.originalUrl || req.url,
    memberId: (req.user as Member | undefined)?.id ?? null,
    statusCode: err.statusCode ?? 500,
    message: err.message,
    details: err.details ?? null,
    stack: err.stack,
  });

  return errorResponse(
    res,
    err.message,
    err.error,
    err.statusCode,
    err.details
  );
};
