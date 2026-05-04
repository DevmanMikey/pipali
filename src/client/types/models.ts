// Chat model types for LLM provider configuration

export type ChatModelTier = 'flagship' | 'balanced' | 'lite';
export type ChatModelCostTier = '$' | '$$' | '$$$';

export type ChatModelInfo = {
    id: number;
    name: string;
    friendlyName: string | null;
    modelType: string;
    visionEnabled?: boolean;
    inputCostPerMillion: number | null;
    outputCostPerMillion: number | null;
    tier: ChatModelTier | null;
    tagline: string | null;
    costTier: ChatModelCostTier | null;
    recommended: boolean;
};
