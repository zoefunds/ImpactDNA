import jwt from "jsonwebtoken";
import { config, githubCallbackUrl } from "../config.js";

/**
 * GitHub OAuth linking. Replaces free-text username entry: a user can
 * only link the GitHub account they can actually authenticate as, which
 * closes the "typed someone else's username" gap that the on-chain
 * verify_developer call alone doesn't prevent (it re-fetches the
 * *claimed* username's public profile, not proof of control over it).
 */

const STATE_ISSUER = "impactdna-github-oauth";

export function githubConfigured(): boolean {
  return Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
}

export function signOAuthState(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: "10m",
    issuer: STATE_ISSUER,
  });
}

export function verifyOAuthState(state: string): string {
  const payload = jwt.verify(state, config.JWT_SECRET, { issuer: STATE_ISSUER }) as jwt.JwtPayload;
  return String(payload.sub);
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: githubCallbackUrl,
    scope: "read:user",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface GithubProfile {
  id: number;
  login: string;
}

export async function exchangeCodeForProfile(code: string): Promise<GithubProfile> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: githubCallbackUrl,
    }),
  });
  if (!tokenRes.ok) throw new Error("GitHub token exchange failed");
  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) throw new Error(tokenBody.error ?? "No access token returned by GitHub");

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenBody.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ImpactDNA",
    },
  });
  if (!userRes.ok) throw new Error("Failed to fetch GitHub profile");
  const profile = (await userRes.json()) as { id: number; login: string };
  return { id: profile.id, login: profile.login.toLowerCase() };
}
