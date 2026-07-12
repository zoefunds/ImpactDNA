import { Router } from "express";
import { contractRead, contractConfigured, contractAddress } from "../lib/genlayer.js";
import { wrap } from "../middleware/errors.js";

/**
 * Public read endpoints — proxied contract views with caching so the
 * frontend never talks to StudioNet directly (rate-limit protection).
 */
export const platformRouter = Router();

platformRouter.get(
  "/info",
  wrap(async (_req, res) => {
    if (!contractConfigured()) {
      res.json({ configured: false, message: "Contract not deployed yet" });
      return;
    }
    const info = await contractRead("get_platform_info", [], 120);
    res.json({ configured: true, address: contractAddress(), info });
  }),
);

platformRouter.get(
  "/stats",
  wrap(async (_req, res) => {
    res.json(await contractRead("get_stats", [], 120));
  }),
);

platformRouter.get(
  "/contributions",
  wrap(async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const status = typeof req.query.status === "string" ? req.query.status : "";
    res.json(await contractRead("list_contributions", [offset, limit, status], 90));
  }),
);

platformRouter.get(
  "/contributions/:id",
  wrap(async (req, res) => {
    res.json(await contractRead("get_contribution", [String(req.params.id)], 60));
  }),
);

platformRouter.get(
  "/developers",
  wrap(async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    res.json(await contractRead("list_developers", [offset, limit], 120));
  }),
);

platformRouter.get(
  "/developers/:username",
  wrap(async (req, res) => {
    res.json(await contractRead("get_developer", [String(req.params.username)], 90));
  }),
);

platformRouter.get(
  "/leaderboard",
  wrap(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    res.json(await contractRead("get_leaderboard", [limit], 180));
  }),
);

platformRouter.get(
  "/epochs",
  wrap(async (_req, res) => {
    res.json(await contractRead("list_epochs", [], 120));
  }),
);

platformRouter.get(
  "/epochs/:id",
  wrap(async (req, res) => {
    res.json(await contractRead("get_epoch", [String(req.params.id)], 120));
  }),
);

platformRouter.get(
  "/grants",
  wrap(async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
    res.json(await contractRead("list_grants", [offset, limit], 120));
  }),
);

platformRouter.get(
  "/appeals",
  wrap(async (_req, res) => {
    res.json(await contractRead("list_appeals", [], 120));
  }),
);

platformRouter.get(
  "/audit",
  wrap(async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    res.json(await contractRead("get_audit_log", [offset, limit], 120));
  }),
);
