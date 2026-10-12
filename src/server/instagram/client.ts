import { getEnv } from "@/server/env";
import { createGraphClient, type GraphClient } from "./graph";

let override: GraphClient | null = null;
let instance: GraphClient | null = null;

export function getGraphClient(): GraphClient {
  if (override) return override;
  instance ??= createGraphClient({ version: getEnv().IG_GRAPH_API_VERSION });
  return instance;
}

export function setGraphClientForTesting(client: GraphClient | null): void {
  override = client;
}
