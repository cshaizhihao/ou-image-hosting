import { navigationItems, sectionContent } from "@ou-image/shared";
import { notFound } from "next/navigation";
import { SectionPageContent } from "@/components/section-page-content";

export function generateStaticParams() {
  const dedicatedSections = new Set([
    "overview",
    "library",
    "albums",
    "tags",
    "favorites",
    "trash",
    "storage",
    "analytics",
    "team",
    "users",
    "tokens",
    "audit",
    "settings",
    "system"
  ]);
  return navigationItems
    .filter((item) => item.href !== "/" && !dedicatedSections.has(item.key))
    .map((item) => ({ section: item.key }));
}

export default async function SectionPage({
  params
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!(section in sectionContent)) {
    notFound();
  }

  const content = sectionContent[section as keyof typeof sectionContent];
  return <SectionPageContent section={section} content={content} />;
}
