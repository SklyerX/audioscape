import { buttonVariants } from "@/components/ui/button";
import {
  ChevronLeft,
  Calendar,
  Clock,
  Activity,
  Link as LinkIcon,
  Webhook,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import KeyActions from "@/components/key-actions";
import UsageChart from "@/components/usage-chart";
import WebhookDeliveries from "@/components/webhook-deliveries";
import TestWebhook from "@/components/test-webhook";

type DailyUsage = {
  date: string;
  total: number;
  paths: Record<string, number>;
};

type KeyData = {
  id: string;
  name: string;
  webhookUrl: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  usage: DailyUsage[];
};

type Delivery = {
  id: string;
  webhookUrl: string;
  status: "success" | "failed" | "timeout";
  statusCode: number | null;
  errorMessage: string | null;
  duration: number | null;
  requestPayload: unknown;
  requestHeaders: unknown;
  createdAt: string;
};

function fmt(iso: string | null, fallback = "—") {
  if (!iso) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <p className="font-mono text-xs break-all">{value}</p>
      </div>
    </div>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookie = (await headers()).get("cookie") ?? "";

  const [keyRes, deliveriesRes] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/view/${id}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/users/keys/deliveries/${id}`,
      { headers: { cookie }, signal: AbortSignal.timeout(10_000) },
    ),
  ]);

  if (!keyRes.ok)
    return (
      <div className="container max-w-3xl mx-auto mt-10">
        <Link
          href="/dashboard"
          className={buttonVariants({
            variant: "outline",
            size: "sm",
            class: "mb-5",
          })}
        >
          <ChevronLeft className="size-4" /> Back
        </Link>
        <p className="text-muted-foreground">
          Failed to load key — {keyRes.status} {keyRes.statusText}
        </p>
      </div>
    );

  const { data }: { data: KeyData } = await keyRes.json();
  const deliveries: Delivery[] = deliveriesRes.ok
    ? (await deliveriesRes.json()).data
    : [];

  const isRevoked = !!data.revokedAt;
  const isExpired = !!data.expiresAt && new Date(data.expiresAt) < new Date();

  return (
    <div className="container max-w-4xl mx-auto mt-10 space-y-6">
      <Link
        href="/dashboard"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <ChevronLeft className="size-4" /> Back
      </Link>

      <div className="rounded-lg border bg-card px-6 py-5 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl font-semibold truncate">{data.name}</h1>
            {isRevoked && (
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                Revoked
              </span>
            )}
            {!isRevoked && isExpired && (
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400 border border-zinc-500/20">
                Expired
              </span>
            )}
            {!isRevoked && !isExpired && (
              <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                Active
              </span>
            )}
          </div>
          <KeyActions
            id={data.id}
            name={data.name}
            webhookUrl={data.webhookUrl}
            revoked={isRevoked}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-6 items-start">
          <UsageChart usage={data.usage} />

          <div className="space-y-4 min-w-[200px]">
            <MetaRow
              icon={Calendar}
              label="Created"
              value={fmt(data.createdAt)}
            />
            <MetaRow
              icon={Clock}
              label={isExpired ? "Expired" : "Expires"}
              value={data.expiresAt ? fmt(data.expiresAt) : "Never"}
            />
            <MetaRow
              icon={Activity}
              label="Last used"
              value={fmt(data.lastUsedAt, "Never")}
            />
            {data.revokedAt && (
              <MetaRow
                icon={Clock}
                label="Revoked"
                value={fmt(data.revokedAt)}
              />
            )}
            {data.webhookUrl && (
              <div className="border-t pt-4">
                <MetaRow
                  icon={LinkIcon}
                  label="Webhook URL"
                  value={data.webhookUrl}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {data.webhookUrl && (
        <>
          <TestWebhook id={id} />
          <div className="rounded-lg border bg-card px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <Webhook size={16} className="text-muted-foreground" />
              <h2 className="font-medium">Webhook Requests</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                Last 50
              </span>
            </div>
            <WebhookDeliveries deliveries={deliveries} />
          </div>
        </>
      )}
    </div>
  );
}
