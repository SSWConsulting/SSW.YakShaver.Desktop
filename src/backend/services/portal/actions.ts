import https from "node:https";
import type { AccountInfo } from "@azure/msal-node";
import { MicrosoftAuthService } from "../auth/microsoft-auth";
import { config } from "../../config/env";
import { z } from "zod";

export const WorkItemDtoSchema = z.object({
  projectName: z.string(),
  title: z.string(),
  description: z.string(),
  workItemUrl: z.string().url().nullable(),
  imageUrl: z.string().url().nullable(),
  imageFigure: z.string().nullable(),
  uploadedVideoProvider: z.string().nullable(),
  uploadedVideoEmbedUrl: z.string().url().nullable(),
  uploadedVideoUrl: z.string().url().nullable(),
});

export type WorkItemDto = z.infer<typeof WorkItemDtoSchema>;

export async function SendWorkItemDetailsToPortal(
  payload: WorkItemDto,
): Promise<{ success: true } | { success: false; error: string }> {
  const ms = MicrosoftAuthService.getInstance();
  const tokenRequest = {
    account: null as unknown as AccountInfo,
    scopes: config.azure()?.scopes || [],
  };
  const result = await ms.getToken(tokenRequest);

  // Parse the portal API URL
  const apiUrl = config.portalApi();
  if (!apiUrl) {
    throw new Error("Portal API url is not configured.");
  }
  const url = new URL(apiUrl);
  const hostname = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  const path = `${url.pathname.replace(/\/$/, "")}/desktopapp/post-task-record`; // Ensure no double slashes

  const body = JSON.stringify(payload);

  try {
    await new Promise<void>((resolve, reject) => {
      const options = {
        hostname: hostname,
        port: port,
        path: path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${result.accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        rejectUnauthorized: false, // Allow self-signed certificates for development
      };

      const req = https.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
            return;
          }

          const reason = responseData || res.statusMessage || "Unknown error";
          reject(new Error(`Portal API call failed (${res.statusCode ?? "N/A"}): ${reason}`));
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });

    return { success: true } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}
