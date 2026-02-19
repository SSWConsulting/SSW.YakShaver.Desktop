import type { InteractionRequest } from "@shared/types/user-interaction";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { ipcClient } from "../../services/ipc-client";

interface InteractionContextType {
  currentRequest: InteractionRequest | null;
  submitResponse: (data: unknown) => Promise<void>;
}

const InteractionContext = createContext<InteractionContextType | null>(null);

export const useInteraction = () => {
  const context = useContext(InteractionContext);
  if (!context) {
    throw new Error("useInteraction must be used within an InteractionProvider");
  }
  return context;
};

import { ApprovalDialog } from "../workflow/ApprovalDialog";
import { PromptSelectionDialog } from "../workflow/PromptSelectionDialog";

export const InteractionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentRequest, setCurrentRequest] = useState<InteractionRequest | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    // Listen for requests from backend
    const unsubscribe = ipcClient.userInteraction.onRequest((req: unknown) => {
      const request = req as InteractionRequest;
      setCurrentRequest(request);
      setSubmitError(null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const submitResponse = async (data: unknown) => {
    if (!currentRequest) {
      console.warn("Attempted to submit response without active request");
      return;
    }

    try {
      await ipcClient.userInteraction.sendResponse({
        requestId: currentRequest.requestId,
        data,
      });
      // Clear current request after successful submission
      setCurrentRequest(null);
      setSubmitError(null);
    } catch (error) {
      console.error("Failed to submit interaction response:", error);
      setSubmitError(String(error));
    }
  };

  return (
    <InteractionContext.Provider value={{ currentRequest, submitResponse }}>
      {children}
      {currentRequest?.type === "tool_approval" && (
        <ApprovalDialog request={currentRequest} onSubmit={submitResponse} error={submitError} />
      )}
      {currentRequest?.type === "project_selection" && (
        <PromptSelectionDialog
          request={currentRequest}
          onSubmit={submitResponse}
          error={submitError}
        />
      )}
    </InteractionContext.Provider>
  );
};
