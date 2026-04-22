export type OpenRouterModelDef = { id: string; label: string; desc: string; cost: string };

export const OPENROUTER_MODELS: OpenRouterModelDef[] = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", desc: "Fast, smart, balanced", cost: "~$0.003/1k tokens" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4", desc: "Most capable reasoning", cost: "~$0.015/1k tokens" },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", desc: "Extended thinking", cost: "~$0.003/1k tokens" },
  { id: "anthropic/claude-opus-4.5", label: "Claude Opus 4.5", desc: "Top-tier Anthropic", cost: "~$0.015/1k tokens" },
  { id: "openai/gpt-4.1", label: "GPT-4.1", desc: "OpenAI latest flagship", cost: "~$0.005/1k tokens" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini", desc: "Fast, cheap OpenAI", cost: "~$0.0004/1k tokens" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Google's best", cost: "~$0.007/1k tokens" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Google, very fast", cost: "~$0.0001/1k tokens" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", desc: "Meta open-source", cost: "~$0.0002/1k tokens" },
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    label: "Hermes 3 Llama 3.1 405B (Free)",
    desc: "Nous Research · OpenRouter free tier",
    cost: "Free",
  },
];
