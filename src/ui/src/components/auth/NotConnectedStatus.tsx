import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface NoConnectionCardProps {
  onConnect: () => void;
}

export const NotConnectedStatus = ({ onConnect }: NoConnectionCardProps) => {
  return (
    <Card className="w-full text-center bg-black/20 backdrop-blur-sm border-white/10">
      <CardContent className="py-12">
        <div className="text-5xl mb-4 opacity-70">📹</div>
        <h3 className="mb-2 text-lg font-medium">No platform connected</h3>
        <p className="text-white/60 mb-8 text-sm">
          Connect a video hosting platform to get started
        </p>
        <Button size="lg" onClick={onConnect}>
          Connect Platform
        </Button>
      </CardContent>
    </Card>
  );
};
