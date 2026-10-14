// Loopback OAuth for a Desktop-app client: opens the browser, catches the code on 127.0.0.1, returns the refresh token.
// Protected by `state` (rejects forged callbacks) and PKCE (a stolen code is useless without the verifier).

import http from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { AddressInfo } from "node:net";
import { google } from "googleapis";

export const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics.edit",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.publish",
];

const TIMEOUT_MS = 5 * 60_000;

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {});
}

export type CallbackResult = { status: number; body: string; done?: { code: string } | { error: string } };

/** Pure handler for one loopback request. Only a request with the right state can finish the flow. */
export function handleCallback(rawUrl: string | undefined, base: string, state: string): CallbackResult {
  const u = new URL(rawUrl ?? "/", base);
  const code = u.searchParams.get("code");
  const error = u.searchParams.get("error");
  if (!code && !error) return { status: 404, body: "Not found" };
  if (u.searchParams.get("state") !== state) return { status: 400, body: "Invalid state; ignored." };
  if (error) return { status: 400, body: `Sign-in failed: ${error}`, done: { error: `Google sign-in failed: ${error}` } };
  return { status: 200, body: "Signed in. You can close this tab.", done: { code: code! } };
}

export async function signIn(clientId: string, clientSecret: string, timeoutMs = TIMEOUT_MS, open = openBrowser): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirect);
  const state = randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as any,
  });
  console.log(`\nOpening Google sign-in. If the browser doesn't open, visit:\n${url}\n`);
  open(url);
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Sign-in timed out"));
    }, timeoutMs);
    server.on("request", (req, res) => {
      const r = handleCallback(req.url, redirect, state);
      res.writeHead(r.status, { "Content-Type": "text/plain" }).end(r.body);
      if (!r.done) return;
      clearTimeout(timer);
      server.close();
      "code" in r.done ? resolve(r.done.code) : reject(new Error(r.done.error));
    });
  });
  const { tokens } = await oauth.getToken({ code, codeVerifier });
  if (!tokens.refresh_token)
    throw new Error("Google returned no refresh token. Remove the app's access at myaccount.google.com/permissions and run init again.");
  return tokens.refresh_token;
}
