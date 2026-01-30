import { promises as fs } from "node:fs";
import https from "node:https";
import { basename } from "node:path";
import FormData from "form-data";
import { z } from "zod";
import { config } from "../../config/env";
import { MicrosoftAuthService } from "../auth/microsoft-auth";

/**
 * Makes an HTTP request to the portal API using Node.js https module
 * This provides better SSL certificate handling for localhost development
 */
async function makePortalRequest(
  endpoint: string,
  options: { body?: string | Buffer; headers?: Record<string, string> },
  accessToken: string,
): Promise<string> {
  const apiUrl = config.portalApiUrl();
  if (!apiUrl) {
    throw new Error("Portal API url is not configured.");
  }

  const url = new URL(apiUrl);
  const hostname = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
  const path = `${url.pathname.replace(/\/$/, "")}${endpoint}`;

  return new Promise<string>((resolve, reject) => {
    const requestOptions = {
      hostname: hostname,
      port: port,
      path: path,
      method: "POST",
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      rejectUnauthorized: !apiUrl.includes("localhost"),
    };

    const req = https.request(requestOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
          return;
        }

        const reason = data || res.statusMessage || "Unknown error";
        reject(new Error(`Portal API call failed (${res.statusCode ?? "N/A"}): ${reason}`));
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export const WorkItemDtoSchema = z.object({
  projectName: z.string(),
  title: z.string(),
  description: z.string(),
  workItemUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  imageFigure: z.string().nullable(),
  uploadedVideoProvider: z.string().nullable(),
  uploadedVideoEmbedUrl: z.string().nullable(),
  uploadedVideoUrl: z.string().nullable(),
});
export type WorkItemDto = z.infer<typeof WorkItemDtoSchema>;

/**
 * Sends work item details to the portal API.
 * Requires the user to be authenticated with Microsoft.
 */
export async function SendWorkItemDetailsToPortal(
  payload: WorkItemDto,
): Promise<{ success: true } | { success: false; error: string }> {
  const ms = MicrosoftAuthService.getInstance();
  const result = await ms.getToken();

  const body = JSON.stringify(payload);

  try {
    await makePortalRequest(
      "/desktopapp/post-task-record",
      {
        headers: {
          "Content-Type": "application/json",
        },
        body: body,
      },
      result.accessToken,
    );

    return { success: true } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}

export const ScreenshotUploadResponseSchema = z.object({
  url: z.string().url(),
});
export type ScreenshotUploadResponse = z.infer<typeof ScreenshotUploadResponseSchema>;

/**
 * Uploads a screenshot to the portal's Azure Blob Storage and returns the public URL.
 * Requires the user to be authenticated with Microsoft.
 */
export async function UploadScreenshotToPortal(
  screenshotPath: string,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const ms = MicrosoftAuthService.getInstance();
  if (!(await ms.isAuthenticated())) {
    return { success: false, error: "User is not authenticated with Microsoft" };
  }
  const result = await ms.getToken();

  // Parse the portal API URL
  const apiUrl = config.portalApiUrl();
  if (!apiUrl) {
    return { success: false, error: "Portal API url is not configured." };
  }

  try {
    // Read the file
    const fileBuffer = await fs.readFile(screenshotPath);
    const fileName = basename(screenshotPath);
    const contentType = screenshotPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

    // Create FormData using the form-data library
    const form = new FormData();
    form.append("file", fileBuffer, {
      filename: fileName,
      contentType: contentType,
    });

    // Get the buffer and headers from FormData
    const body = form.getBuffer();
    const formHeaders = form.getHeaders();

    const responseData = await makePortalRequest(
      "/desktopapp/upload-screenshot",
      {
        headers: {
          ...formHeaders,
          "Content-Length": body.length.toString(),
        },
        body: body,
      },
      result.accessToken,
    );

    const parsed = JSON.parse(responseData);
    const validatedResponse = ScreenshotUploadResponseSchema.parse(parsed);

    return { success: true, url: validatedResponse.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
