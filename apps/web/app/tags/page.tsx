import { OrganizationHub } from "@/components/organization-hub";

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const query = await searchParams;
  return <OrganizationHub mode="tags" initialResourceId={query.tag ?? ""} />;
}
