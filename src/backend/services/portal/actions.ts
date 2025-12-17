import { promises as fs } from "node:fs";
import https from "node:https";
import { basename } from "node:path";
import { z } from "zod";
import { config } from "../../config/env";
import { MicrosoftAuthService } from "../auth/microsoft-auth";

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

export const ScreenshotUploadResponseSchema = z.object({
  url: z.string().url(),
});

export type ScreenshotUploadResponse = z.infer<typeof ScreenshotUploadResponseSchema>;

export async function SendWorkItemDetailsToPortal(
  payload: WorkItemDto,
): Promise<{ success: true } | { success: false; error: string }> {
  const ms = MicrosoftAuthService.getInstance();
  const result = await ms.getToken();

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

/**
 * Uploads a screenshot to the portal's Azure Blob Storage and returns the public URL.
 * Requires the user to be authenticated with Microsoft.
 */
export async function UploadScreenshotToPortal(
  screenshotPath: string,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const ms = MicrosoftAuthService.getInstance();

  // Check if user is authenticated
  if (!(await ms.isAuthenticated())) {
    return { success: false, error: "User is not authenticated with Microsoft" };
  }

  const result = await ms.getToken();

  // Parse the portal API URL
  const apiUrl = config.portalApi();
  if (!apiUrl) {
    return { success: false, error: "Portal API url is not configured." };
  }

  try {
    // Read the file
    const fileBuffer = await fs.readFile(screenshotPath);
    const fileName = basename(screenshotPath);

    const url = new URL(apiUrl);
    const hostname = url.hostname;
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    const path = `${url.pathname.replace(/\/$/, "")}/desktopapp/upload-screenshot`;

    // Create multipart form data boundary
    const boundary = `----FormBoundary${Date.now()}`;
    const contentType = screenshotPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

    // Build multipart body
    const bodyParts: Buffer[] = [];

    // File field
    bodyParts.push(Buffer.from(`--${boundary}\r\n`));
    bodyParts.push(
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
    );
    bodyParts.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
    bodyParts.push(fileBuffer);
    bodyParts.push(Buffer.from("\r\n"));

    // End boundary
    bodyParts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(bodyParts);

    const responseData = await new Promise<string>((resolve, reject) => {
      const options = {
        hostname: hostname,
        port: port,
        path: path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${result.accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        rejectUnauthorized: !apiUrl.includes("localhost"),
      };

      const req = https.request(options, (res) => {
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
          reject(
            new Error(`Portal screenshot upload failed (${res.statusCode ?? "N/A"}): ${reason}`),
          );
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });

    // Parse the response to get the URL
    const parsed = JSON.parse(responseData);
    const validatedResponse = ScreenshotUploadResponseSchema.parse(parsed);

    return { success: true, url: validatedResponse.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}
