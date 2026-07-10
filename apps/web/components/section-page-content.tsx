import { Button } from "@ou-image/ui";
import {
  Activity,
  Album,
  ArrowRight,
  FileImage,
  FolderCog,
  Heart,
  KeyRound,
  Settings,
  Tags,
  Trash2,
  Users
} from "lucide-react";
import Link from "next/link";
import { AppShell } from "./app-shell";

const iconMap = {
  overview: Activity,
  library: FileImage,
  albums: Album,
  tags: Tags,
  favorites: Heart,
  trash: Trash2,
  storage: FolderCog,
  analytics: Activity,
  team: Users,
  tokens: KeyRound,
  audit: Activity,
  settings: Settings
};

export function SectionPageContent({
  section,
  content
}: {
  section: string;
  content: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
  };
}) {
  const Icon = iconMap[section as keyof typeof iconMap] ?? FileImage;

  return (
    <AppShell activeKey={section}>
      <main className="workspace-page">
        <div className="page-heading">
          <div>
            <h1>{content.title}</h1>
            <p>{content.description}</p>
          </div>
          {section !== "storage" && (
            <Button asChild>
              <Link href="/">
                前往上传
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </Button>
          )}
        </div>

        <section className="module-empty">
          <div className="module-empty__icon">
            <Icon aria-hidden="true" size={30} strokeWidth={1.7} />
          </div>
          <h2>{content.emptyTitle}</h2>
          <p>{content.emptyDescription}</p>
          {section === "storage" ? (
            <Button asChild variant="secondary">
              <Link href="/settings">
                <FolderCog aria-hidden="true" size={17} />
                查看设置中心
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href="/">打开上传工作台</Link>
            </Button>
          )}
        </section>
      </main>
    </AppShell>
  );
}
