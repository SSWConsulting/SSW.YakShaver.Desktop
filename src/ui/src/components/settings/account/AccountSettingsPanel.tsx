import { AlertTriangle, RotateCcw, Wand2 } from "lucide-react";
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

interface AccountSettingsPanelProps {
  isActive: boolean;
}

export function AccountSettingsPanel({ isActive }: AccountSettingsPanelProps) {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false);

  const handleOpenWizard = useCallback(() => {
    setIsWizardDialogOpen(true);
  }, []);

  const handleOpenWizardConfirm = useCallback(async () => {
    setIsWizardDialogOpen(false);
    try {
      resetOnboarding();
      toast.success("Onboarding wizard will open on next restart. Restarting app...");

      // Restart the app after a short delay to allow the toast to show
      setTimeout(async () => {
        try {
          await ipcClient.app.restart();
        } catch (error) {
          console.error("Failed to restart app:", error);
          toast.error("Failed to restart app. Please restart manually.");
        }
      }, 1000);
    } catch (error) {
      console.error("Failed to reset onboarding", error);
      toast.error("Failed to open wizard");
    }
  }, []);

  const handleResetAccount = useCallback(async () => {
    setIsResetting(true);
    try {
      // Clear LLM configuration
      await ipcClient.llm.clearConfig();

      // Clear GitHub token
      await ipcClient.githubToken.clear();

      // Clear MCP servers (get all servers and remove them one by one)
      const servers = await ipcClient.mcp.listServers();
      for (const server of servers) {
        if (!server.builtin && server.id) {
          await ipcClient.mcp.removeServerAsync(server.id);
        }
      }

      // Clear custom prompts (keep only the default prompt)
      await ipcClient.settings.clearCustomPrompts();

      // Disconnect YouTube if connected
      await ipcClient.youtube.disconnect();

      // Disconnect Microsoft if connected
      await ipcClient.auth.microsoft.logout();

      // Reset tool approval mode to "Ask" (default/safe mode)
      await ipcClient.userSettings.update({ toolApprovalMode: "ask" });

      // Reset onboarding
      resetOnboarding();

      toast.success(
        "Account reset successfully. All services have been logged out, custom prompts cleared, and tool approval mode set to 'Ask'. Restarting app...",
      );

      // Restart the app after a short delay to allow the toast to show
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

  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Account Management</h2>
        <p className="text-sm text-white/70">
          Manage your YakShaver account settings and preferences.
        </p>
      </div>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Setup Wizard
            </CardTitle>
            <CardDescription>
              Re-run the initial setup wizard to configure your services again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleOpenWizard} className="w-full">
              Open Wizard
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Reset Account
            </CardTitle>
            <CardDescription>
              Log out of all services and clear all configurations. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
      </div>

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

      <AlertDialog open={isWizardDialogOpen} onOpenChange={setIsWizardDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open Wizard?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will restart the app.
              <p className="mt-3 font-semibold">Do you want to continue?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenWizardConfirm}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
