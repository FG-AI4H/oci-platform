import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Section,
  UserIcon,
  GlobeIcon,
  FlowIcon,
} from '@oci/ui';
import { auth } from '../../auth';
import { requireAdmin } from '../../lib/groups';

export const metadata = {
  title: 'Admin — OCI Platform',
  robots: { index: false, follow: false },
};

export default async function AdminIndexPage() {
  const session = await auth();
  requireAdmin(session);

  return (
    <Container>
      <Section spacing="md">
        <header className="mb-6 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            Operator workflow
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Admin</h1>
          <p className="max-w-2xl text-[var(--color-muted-foreground)]">
            Operator surfaces for managing platform principals, federation peers, and platform
            parameters. Admin-only.
          </p>
        </header>

        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <li>
            <AdminTile
              href="/admin/users"
              title="User & group management"
              description="Browse Cognito users, view group membership, grant or revoke roles."
              icon={<UserIcon size={20} />}
            />
          </li>
          <li>
            <AdminTile
              href="/admin/settings"
              title="Platform settings"
              description="Site-wide parameters. Currently: maintenance banner. Tool registry (#214) + license defaults (#235) land here next."
              icon={<FlowIcon size={20} />}
            />
          </li>
          <li>
            <AdminTile
              href="/catalog/remotes"
              title="Federation peers"
              description="Remote catalogue mirrors harvested into this platform. Soft-deprecated path: this tile will move to /admin/federation."
              icon={<GlobeIcon size={20} />}
            />
          </li>
        </ul>
      </Section>
    </Container>
  );
}

function AdminTile({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      <Card interactive="hover" className="h-full">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
            >
              {icon}
            </span>
            <div className="space-y-1">
              <CardTitle className="group-hover:text-[var(--color-primary)] transition-colors">
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-muted-foreground)]">
          Open →
        </CardContent>
      </Card>
    </Link>
  );
}
