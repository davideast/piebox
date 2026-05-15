import { getModel } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";

export function resolveModel(modelStr?: string): Model<any> {
  const modelToUse = modelStr || "google/gemini-3-flash-preview";
  const [provider, name] = modelToUse.split("/");
  if (!name) {
    throw new Error(`Invalid model format: ${modelStr}. Expected provider/model (e.g. google/gemini-3-flash-preview)`);
  }
  return getModel(provider as any, name);
}
