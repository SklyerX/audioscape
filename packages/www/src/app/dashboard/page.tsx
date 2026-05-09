import CreateAPIKey from "@/components/create-api-key";
import { buttonVariants } from "@/components/ui/button";
import {
  Ghost,
  Clock,
  Calendar,
  Activity,
  LinkIcon,
  MoveUpRight,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";

type APIKey = {
  id: number;
  name: string;
  lastUsedAt: string | null;
  webhookUrl: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function fmt(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function KeyStatus({ k }: { k: APIKey }) {
  if (k.revokedAt)
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
        Revoked
      </span>
    );
  if (k.expiresAt && new Date(k.expiresAt) < new Date())
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400 border border-zinc-500/20">
        Expired
      </span>
    );
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
      Active
    </span>
  );
}

function APIKeyCard({ k }: { k: APIKey }) {
  return (
    <Link
      href={`/dashboard/${k.id}`}
      className="block rounded-lg border bg-card px-5 py-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium truncate">{k.name}</p>
        <KeyStatus k={k} />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} />
          <span>Created {fmt(k.createdAt)}</span>
        </div>
        {k.expiresAt ? (
          <div className="flex items-center gap-1.5">
            <Clock size={13} />
            <span>
              {new Date(k.expiresAt) < new Date() ? "Expired" : "Expires"}{" "}
              {fmt(k.expiresAt)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Clock size={13} />
            <span>Never expires</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Activity size={13} />
          <span>
            {k.lastUsedAt ? `Last used ${fmt(k.lastUsedAt)}` : "Never used"}
          </span>
        </div>
        {k.webhookUrl && (
          <div className="flex items-center gap-1.5 min-w-0">
            <LinkIcon size={13} className="shrink-0" />
            <span className="truncate">{k.webhookUrl}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export default async function Dashboard() {
  const hdrs = await headers();
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/all`,
    {
      method: "GET",
      headers: { cookie: hdrs.get("cookie") ?? "" },
    },
  );

  if (!res.ok) return <>Something went wrong while fetching API keys</>;

  const keys = await res.json();

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <div>
          <h3 className="text-3xl font-semibold">Audioscape Dashboard</h3>
          <p className="text-muted-foreground">View all your API keys</p>
        </div>
        <CreateAPIKey />
      </div>

      {keys.data.length === 0 ? (
        <div className="w-full h-80 border-2 border-dashed rounded-md flex flex-col items-center justify-center">
          <Ghost className="size-6" />
          <h3 className="text-xl mt-4">Looks like a ghost town</h3>
          <p className="text-muted-foreground mt-px">
            Create an API key to get started!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.data.map((key: APIKey) => (
            <APIKeyCard key={key.id} k={key} />
          ))}
        </div>
      )}
    </div>
  );
}
