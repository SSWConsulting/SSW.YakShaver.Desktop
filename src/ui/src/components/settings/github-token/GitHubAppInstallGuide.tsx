import { ExternalLink } from "lucide-react";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";

interface GitHubAppInstallGuideProps {
  appInstallUrl: string;
}

export function GitHubAppInstallGuide({ appInstallUrl }: GitHubAppInstallGuideProps) {
  const handleInstallApp = () => {
    window.open(appInstallUrl, "_blank");
  };

  return (
    <Card className="p-3 bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium mb-1">GitHub App Authorization</p>
          <p className="text-xs text-muted-foreground">
            Install the GitHub App to create issues in repositories
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleInstallApp}
          className="gap-2 flex-shrink-0"
        >
          Install App
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </Card>
  );
}
