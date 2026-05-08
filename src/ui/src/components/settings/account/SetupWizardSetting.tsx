import { Wand2 } from "lucide-react";
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

export function SetupWizardSetting() {
  const [isWizardDialogOpen, setIsWizardDialogOpen] = useState(false);

  const handleOpenWizardConfirm = useCallback(async () => {
    setIsWizardDialogOpen(false);
    try {
      resetOnboarding();
      toast.success("Onboarding wizard will open on next restart. Restarting app...");

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

  return (
    <>
      <Card className="w-full gap-4 border-white/10 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Setup Wizard
          </CardTitle>
          <CardDescription>
            Re-run the initial setup wizard to configure your services again.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Button onClick={() => setIsWizardDialogOpen(true)} className="w-full">
            Open Wizard
          </Button>
        </CardContent>
      </Card>

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
    </>
  );
}
