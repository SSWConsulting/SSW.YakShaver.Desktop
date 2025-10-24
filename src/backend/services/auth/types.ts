export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
}

export interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  channelName?: string;
}

export interface AuthResult {
  success: boolean;
  userInfo?: UserInfo;
  error?: string;
}

export enum AuthStatus {
  NOT_AUTHENTICATED = "not_authenticated",
  AUTHENTICATING = "authenticating",
  AUTHENTICATED = "authenticated",
  ERROR = "error",
}

export interface AuthState {
  status: AuthStatus;
  userInfo?: UserInfo;
  error?: string;
}

export interface VideoUploadResult {
  success: boolean;
  data?: {
    title: string;
    description: string;
    url: string;
  };
  error?: string;
}

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
}
