import pino from "pino";
import { isProd } from "../config.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  base: { service: "impactdna-backend" },
  redact: ["req.headers.authorization", "password", "*.password", "*.privateKey"],
});
