import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  walletAddress: string;
  role: "developer" | "curator" | "admin";
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, walletAddress: user.walletAddress, role: user.role },
    config.JWT_SECRET,
    {
      expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
      issuer: "impactdna",
    },
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { issuer: "impactdna" }) as jwt.JwtPayload;
    req.user = {
      id: String(payload.sub),
      walletAddress: String(payload.walletAddress),
      role: (payload.role as AuthUser["role"]) ?? "developer",
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Array<AuthUser["role"]>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
