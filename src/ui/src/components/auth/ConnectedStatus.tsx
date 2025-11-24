import { User } from "lucide-react";
import { FaYoutube } from "react-icons/fa";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { UserInfo } from "../../types";

interface ConnectedStatusProps {
  userInfo: UserInfo;
  platform: string;
  onSwitch: () => void;
}

const getInitials = (name: string | null | undefined): string | null => {
  if (!name || typeof name !== "string") return null;

  const trimmed = name.trim();
  if (trimmed.length === 0) return null;

  const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
  const first = words[0][0].toUpperCase();
  const last = words.length > 1 ? words[words.length - 1][0].toUpperCase() : "";

  return `${first}${last}`;
};

export const ConnectedStatus = ({ userInfo, platform, onSwitch }: ConnectedStatusProps) => {
  const { name, email, avatar, channelName } = userInfo;
  const initials = getInitials(name);

  return (
    <Card className="w-full bg-black/20 backdrop-blur-sm border-white/10">
      <CardContent>
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="w-12 h-12 bg-white/10">
            <AvatarImage src={avatar} alt={name} />
            <AvatarFallback className="bg-white/10 text-lg font-semibold text-white">
              {initials || <User className="size-4" />}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h3 className="mb-1 text-base font-medium text-white">{name}</h3>
            <p className="mb-1 text-xs text-white/60">{email}</p>
            {channelName && <p className="text-xs text-white/60 italic">{channelName}</p>}
          </div>
        </div>

        <div className="flex justify-between items-center p-4 bg-white/5 rounded-md border border-white/10">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase font-medium">Connected to</span>
            <div className="flex items-center gap-2">
              <FaYoutube className="w-4 h-4 text-ssw-red" />
              <span className="text-sm font-medium">{platform}</span>
            </div>
          </div>

          <Badge variant="success">Active</Badge>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        <Button variant="outline" onClick={onSwitch} className="w-full">
          Switch Platform
        </Button>
      </CardFooter>
    </Card>
  );
};
