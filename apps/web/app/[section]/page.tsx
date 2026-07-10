import { navigationItems, sectionContent } from "@ou-image/shared";
import { notFound } from "next/navigation";
import { SectionPageContent } from "@/components/section-page-content";

export function generateStaticParams() {
  return navigationItems
    .filter((item) => item.href !== "/")
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
