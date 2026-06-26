import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UploadStatus, type VideoUploadResult } from "../../types";
import { UploadResult } from "./UploadResult";

// #676: the uploaded video URL must be a clickable link (not plain text) that
// opens externally. The app's BrowserWindow setWindowOpenHandler routes any
// http(s) target="_blank" anchor through shell.openExternal, so asserting the
// URL renders as an anchor with href + target="_blank" proves the AC.

const successResult: VideoUploadResult = {
  success: true,
  origin: "upload",
  data: {
    videoId: "Ql9Voo74sCg",
    url: "https://www.youtube.com/watch?v=Ql9Voo74sCg",
    title: "My recording",
    description: "A description",
    duration: 24,
  },
};

describe("UploadResult (#676)", () => {
  it("renders the uploaded video URL as a clickable link that opens in the browser", () => {
    render(<UploadResult result={successResult} status={UploadStatus.SUCCESS} />);

    const link = screen.getByRole("link", {
      name: "https://www.youtube.com/watch?v=Ql9Voo74sCg",
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=Ql9Voo74sCg");
    // target="_blank" is what the main process intercepts to open the default browser.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("does not render a link while the upload is still in progress (no URL yet)", () => {
    render(<UploadResult result={successResult} status={UploadStatus.UPLOADING} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/uploading to youtube/i)).toBeInTheDocument();
  });
});
