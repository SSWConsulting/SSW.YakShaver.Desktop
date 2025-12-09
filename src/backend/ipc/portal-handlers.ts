import { ipcMain } from "electron";
import { IPC_CHANNELS } from "./channels";
import { MicrosoftAuthService } from "../services/auth/microsoft-auth";
import https from "https";
import { config } from "../config/env";

export function registerPortalHandlers() {
  ipcMain.handle(IPC_CHANNELS.PORTAL_GET_MY_SHAVES, async () => {
    try {
      const ms = MicrosoftAuthService.getInstance();
      const tokenRequest = {
        account: null as unknown as any,
        scopes: config.azure()?.scopes || [],
      };
      const result = await ms.getToken(tokenRequest);
      
      // Parse the portal API URL
      const apiUrl = config.portalApi();
      console.log("Portal API URL:", apiUrl);
      const url = new URL(apiUrl);
      const hostname = url.hostname;
      const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
      const path = url.pathname.replace(/\/$/, '') + '/me/shaves'; // Ensure no double slashes
      
      // Make API call to get user's shaves using HTTPS module for SSL certificate handling
      const data = await new Promise((resolve, reject) => {
        const options = {
          hostname: hostname,
          port: port,
          path: path,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${result.accessToken}`,
            'Content-Type': 'application/json',
          },
          rejectUnauthorized: false // Allow self-signed certificates for development
        };

        const req = https.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedData = JSON.parse(responseData);
                resolve(parsedData);
              } catch (e) {
                reject(new Error('Failed to parse JSON response'));
              }
            } else {
              reject(new Error(`API call failed: ${res.statusCode} ${res.statusMessage}`));
            }
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });
      
      return { success: true, data };
    } catch (error) {
      console.error("Portal API error:", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}