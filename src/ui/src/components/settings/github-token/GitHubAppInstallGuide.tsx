import { ExternalLink } from "lucide-react";
import { Button } from "../../ui/button";

interface GitHubAppInstallGuideProps {
  appInstallUrl: string;
}

export function GitHubAppInstallGuide({
  appInstallUrl,
}: GitHubAppInstallGuideProps) {
  const handleInstallApp = () => {
    window.open(appInstallUrl, "_blank");
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-md bg-accent/30 border border-accent/40">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-accent-foreground mb-1">
          GitHub App Authorization Required
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          To create issues in a repository, you must install our GitHub App and
          grant it access.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={handleInstallApp}>
        Install App
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}
