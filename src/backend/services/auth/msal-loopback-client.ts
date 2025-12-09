import http from "http";
import type { ILoopbackClient, ServerAuthorizationCodeResponse } from "@azure/msal-node";

export class CustomLoopbackClient implements ILoopbackClient {
  port: number = 0;
  private server!: http.Server;

  private constructor(port: number = 0) {
    this.port = port;
  }

  static async initialize(preferredPort?: number): Promise<CustomLoopbackClient> {
    const lb = new CustomLoopbackClient();
    if (!preferredPort) return lb;
    if (await lb.isPortAvailable(preferredPort)) lb.port = preferredPort;
    return lb;
  }

  async listenForAuthCode(successTemplate?: string, errorTemplate?: string): Promise<ServerAuthorizationCodeResponse> {
    if (this.server) throw new Error("Loopback server already exists.");
    
    const authCodeListener = new Promise<ServerAuthorizationCodeResponse>((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = req.url;
        
        if (!url) {
          res.end(errorTemplate || "Error occurred loading redirectUrl");
          reject(new Error("Loopback callback invoked without url"));
          return;
        } else if (url === "/") {
          res.end(successTemplate || "Auth code acquired. You can close this window.");
          return;
        }
        const authCodeResponse = CustomLoopbackClient.getDeserializedQueryString(url);
        if (authCodeResponse.code) {
          const redirectUri = await this.getRedirectUri();
          res.writeHead(302, { location: redirectUri });
          res.end();
        }
        resolve(authCodeResponse);
      });
      this.server.listen(this.port);
    });

    await new Promise<void>((resolve) => {
      let ticks = 0;
      const id = setInterval(() => {
        if (ticks > 50) throw new Error("Timed out waiting for auth code listener to be registered.");
        if (this.server.listening) { clearInterval(id); resolve(); }
        ticks++;
      }, 100);
    });

    return authCodeListener;
  }

  getRedirectUri(): string {
    if (!this.server) throw new Error("No loopback server exists yet.");
    const address = this.server.address();
    if (!address || typeof address === "string" || !address.port) {
      this.closeServer();
      throw new Error("Loopback server address is unexpected.");
    }
    const port = address.port;
    return `http://localhost:${port}`;
  }

  closeServer(): void {
    if (this.server) this.server.close();
  }

  isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer().listen(port, () => { server.close(); resolve(true); })
        .on("error", () => resolve(false));
    });
  }

  static getDeserializedQueryString(query: string): ServerAuthorizationCodeResponse {
    if (!query) return {};
    const parsed = this.parseQueryString(query) || query;
    return this.queryStringToObject(parsed);
  }

  static parseQueryString(queryString: string): string {
    const q2 = queryString.indexOf("/?");
    const q1 = queryString.indexOf("?");
    if (q2 > -1) return queryString.substring(q2 + 2);
    if (q1 > -1) return queryString.substring(q1 + 1);
    return "";
  }

  static queryStringToObject(query: string): ServerAuthorizationCodeResponse {
    const obj: { [key: string]: string } = {};
    const params = query.split("&");
    const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
    params.forEach((pair) => {
      if (pair.trim()) {
        const [key, value] = pair.split(/=(.+)/g, 2);
        if (key && value) obj[decode(key)] = decode(value);
      }
    });
    return obj as ServerAuthorizationCodeResponse;
  }
}

