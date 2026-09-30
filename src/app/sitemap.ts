import type { MetadataRoute } from "next";

// 이미지는 env 없이 빌드되므로 APP_URL은 요청 시점에 읽는다
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ["", "/pricing", "/terms", "/privacy", "/refund"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly" }));
}
