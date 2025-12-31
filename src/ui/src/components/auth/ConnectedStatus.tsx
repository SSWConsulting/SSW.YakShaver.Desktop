import { FaYoutube } from "react-icons/fa";
import { PlatformConnectionCard } from "@/components/auth/PlatformConnectionCard";
import type { UserInfo } from "../../types";

interface ConnectedStatusProps {
  userInfo: UserInfo;
  platform: string;
  onSwitch: () => void;
}

export const ConnectedStatus = ({ userInfo, platform, onSwitch }: ConnectedStatusProps) => {
  const { channelName } = userInfo;

  return (
    <PlatformConnectionCard
      icon={<FaYoutube className="w-10 h-10 text-ssw-red text-2xl" />}
      title={platform}
      subtitle={channelName ?? undefined}
      label="Connected to"
      badgeText="Active"
      onAction={onSwitch}
      actionLabel="Switch Platform"
      buttonVariant="outline"
      buttonSize="lg"
      compact
    />
  );
};
