import { AlertTriangle, RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { resetOnboarding } from "@/components/onboarding/OnboardingWizard";
import { ipcClient } from "@/services/ipc-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";

export function ResetAccountSetting() {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetAccount = useCallback(async () => {
    setIsResetting(true);
    try {
      await ipcClient.llm.clearConfig();
      await ipcClient.githubToken.clear();

      const servers = await ipcClient.mcp.listServers();
      for (const server of servers) {
        if (!server.builtin && server.id) {
          await ipcClient.mcp.removeServerAsync(server.id);
        }
      }

      await ipcClient.settings.clearCustomPrompts();
      await ipcClient.youtube.disconnect();
      await ipcClient.auth.microsoft.logout();
      await ipcClient.userSettings.update({ toolApprovalMode: "ask" });
      resetOnboarding();

      toast.success(
        "Account reset successfully. All services have been logged out, custom prompts cleared, and tool approval mode set to 'Ask'. Restarting app...",
      );

      setTimeout(async () => {
        try {
          await ipcClient.app.restart();
        } catch (error) {
          console.error("Failed to restart app:", error);
          toast.error("Failed to restart app. Please restart manually.");
        }
      }, 1000);

      setIsResetDialogOpen(false);
    } catch (error) {
      console.error("Failed to reset account", error);
      toast.error("Failed to reset account. Some services may still be connected.");
    } finally {
      setIsResetting(false);
    }
  }, []);

  return (
    <>
      <Card className="w-full gap-4 border-white/10 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Reset Account
          </CardTitle>
          <CardDescription>
            Log out of all services and clear all configurations. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Button
            onClick={() => setIsResetDialogOpen(true)}
            variant="destructive"
            className="w-full"
          >
            <RotateCcw className="h-4 w-4" />
            Reset Account to Default
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Log you out of YouTube</li>
                <li>Log you out of Microsoft services</li>
                <li>Clear your GitHub token</li>
                <li>Remove all MCP server configurations</li>
                <li>Clear your LLM API keys</li>
                <li>Clear your custom prompts</li>
                <li>Reset the tool approval mode to "Ask"</li>
                <li>Reset the onboarding wizard</li>
              </ul>
              <p className="mt-3 font-semibold">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetAccount}
              disabled={isResetting}
              className="bg-destructive text-primary hover:bg-destructive/90"
            >
              {isResetting ? "Resetting..." : "Reset Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
