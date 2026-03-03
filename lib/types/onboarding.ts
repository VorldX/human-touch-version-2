export type OAuthProviderInput = "GOOGLE" | "LINKEDIN" | "X";
export type AppThemeInput = "APEX" | "VEDA" | "NEXUS";
export type LlmCredentialModeInput = "BYOK" | "PLATFORM_MANAGED";
export type ServicePlanInput = "STARTER" | "GROWTH" | "ENTERPRISE";

export interface OnboardingIdentityInput {
  username: string;
  email: string;
  aadhaarId: string;
}

export interface OnboardingOAuthInput {
  provider: OAuthProviderInput;
  providerAccountId: string;
  accessToken: string;
}

export interface BrainLinkInput {
  provider: string;
  model: string;
  apiKey?: string;
  computeType: "Cloud" | "Local" | "Container";
}

export interface OnboardingOrganizationInput {
  name: string;
  description: string;
  theme: AppThemeInput;
}

export interface OnboardingFinancialInput {
  monthlyBudgetUsd: number;
  monthlyBtuCap: number;
}

export interface OnboardingPayload {
  identity: OnboardingIdentityInput;
  oauthAccounts: OnboardingOAuthInput[];
  organization: OnboardingOrganizationInput;
  orchestration: {
    credentialMode: LlmCredentialModeInput;
    servicePlan: ServicePlanInput;
    serviceMarkupPct?: number;
    organizationApiKey?: string;
    primary: BrainLinkInput;
    fallback: BrainLinkInput;
  };
  financial: OnboardingFinancialInput;
}

export interface OnboardingResult {
  ok: boolean;
  message?: string;
  org?: {
    id: string;
    name: string;
    role: string;
    theme: AppThemeInput;
  };
}
