import { OrganizationHub } from "@/components/organization-hub";

export default async function AlbumDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrganizationHub mode="albums" initialResourceId={id} />;
}
