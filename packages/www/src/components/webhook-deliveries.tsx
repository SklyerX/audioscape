"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Clock, ChevronRight } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";

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

function StatusIcon({ status }: { status: Delivery["status"] }) {
  if (status === "success")
    return <CheckCircle2 size={14} className="text-green-400 shrink-0" />;
  if (status === "timeout")
    return <Clock size={14} className="text-amber-400 shrink-0" />;
  return <XCircle size={14} className="text-red-400 shrink-0" />;
}

function StatusBadge({ status }: { status: Delivery["status"] }) {
  const styles = {
    success: "bg-green-500/15 text-green-400 border-green-500/20",
    failed: "bg-red-500/15 text-red-400 border-red-500/20",
    timeout: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <pre className="rounded-md bg-muted/50 border p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export default function WebhookDeliveries({
  deliveries,
}: {
  deliveries: Delivery[];
}) {
  const [selected, setSelected] = useState<Delivery | null>(null);

  if (deliveries.length === 0)
    return (
      <div className="h-40 flex flex-col items-center justify-center text-sm text-muted-foreground border rounded-md border-dashed gap-1">
        <p>No webhook requests recorded yet</p>
        <p className="text-xs">
          Requests will appear here once your endpoint receives events
        </p>
      </div>
    );

  return (
    <>
      <div className="divide-y rounded-md border overflow-hidden">
        {deliveries.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelected(d)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
          >
            <StatusIcon status={d.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={d.status} />
                {d.statusCode && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {d.statusCode}
                  </span>
                )}
                {d.duration != null && (
                  <span className="text-xs text-muted-foreground">
                    {d.duration}ms
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmt(d.createdAt)}
              </p>
            </div>
            <ChevronRight size={14} className="text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>

      <Drawer open={!!selected} onOpenChange={(o) => !o && setSelected(null)} direction="right">
        <DrawerContent>
          <DrawerHeader className="border-b pb-4">
            <div className="flex items-center gap-3">
              {selected && <StatusIcon status={selected.status} />}
              <DrawerTitle className="text-base">
                Webhook Delivery
              </DrawerTitle>
              {selected && <StatusBadge status={selected.status} />}
            </div>
            {selected && (
              <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                <span>{fmt(selected.createdAt)}</span>
                {selected.statusCode && <span>HTTP {selected.statusCode}</span>}
                {selected.duration != null && (
                  <span>{selected.duration}ms</span>
                )}
                {selected.errorMessage && (
                  <span className="text-red-400">{selected.errorMessage}</span>
                )}
              </div>
            )}
          </DrawerHeader>

          {selected && (
            <div className="p-6 space-y-5 overflow-y-auto max-h-[60vh]">
              <JsonBlock label="Request Headers" value={selected.requestHeaders} />
              <JsonBlock label="Request Payload" value={selected.requestPayload} />
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
