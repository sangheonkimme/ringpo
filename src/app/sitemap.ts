import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/pricing", "/terms", "/privacy", "/refund"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly" }));
}
