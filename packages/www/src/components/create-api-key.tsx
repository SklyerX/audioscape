"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";
import { createAPIKey } from "@/actions/create-api-key";
import { Copy, Check } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function SecretField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="flex-1 font-mono text-xs break-all">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export default function CreateAPIKey() {
  const [open, setOpen] = useState<boolean>(false);

  const [name, setName] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const [data, setData] = useState<Record<string, string> | null>(null);

  const handleCreation = async () => {
    if (name.length < 1 || name.length > 50)
      return toast.error("Invalid name length", {
        description: "Name must be between 1 and 50 characters",
      });

    if (!expiry)
      return toast.error("No expiry", {
        description: "You must select an expiry length",
      });

    const regex =
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

    if (webhookUrl && !regex.test(webhookUrl))
      return toast.error("Invalid url", {
        description:
          "Webhook URL must be in proper format: https://mysite.com/something",
      });

    toast.info("Creating api key", {
      id: "api-create",
    });

    try {
      const data = await createAPIKey(name, expiry, webhookUrl);
      toast.success("API Key created", {
        id: "api-create",
      });

      setData(data);
    } catch (err) {
      toast.error("Something went wrong while creating API key", {
        id: "api-create",
        description:
          err instanceof Error
            ? String(err.cause ?? err.message)
            : "Please try again later.",
      });
    }
  };

  const wipe = () => {
    setName("");
    setExpiry("");
    setWebhookUrl("");
    setData(null);

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      {/* @ts-ignore: Shadcn freaks out over asChild not existing but also freaks out if it finds a button in the trigger */}
      <DialogTrigger asChild>
        <Button>Create key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an API Key</DialogTitle>
        </DialogHeader>
        {!data ? (
          <div className="space-y-4">
            <div>
              <Label>
                Name <span className="text-red-400">*</span>
              </Label>
              <Input
                className="h-9 mt-1"
                value={name}
                maxLength={50}
                onChange={({ target }) => setName(target.value)}
              />
            </div>
            <div>
              <Label>
                Expiry <span className="text-red-400">*</span>
              </Label>
              <Select onValueChange={(value) => setExpiry(value as string)}>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue placeholder="Expires in ..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="24h">24 Hours</SelectItem>
                    <SelectItem value="1w">1 Week</SelectItem>
                    <SelectItem value="1m">1 Month</SelectItem>
                    <SelectItem value="6m">6 Months</SelectItem>
                    <SelectItem value="1y">1 Year</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Webhook URL</Label>
              <Input
                className="h-9 mt-1"
                value={webhookUrl || ""}
                onChange={({ target }) => setWebhookUrl(target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-400 text-sm">
              <p className="font-medium mb-0.5">Save these now</p>
              <p className="text-amber-400/80">
                You won&apos;t be able to see these again after closing.
              </p>
            </div>
            <SecretField label="API Key" value={data.display_key} />
            <SecretField label="Webhook Secret" value={data.webhook_secret} />
          </div>
        )}
        <DialogFooter>
          {!data ? (
            <>
              <Button variant="secondary" onClick={wipe} className="cursor-pointer">
                Cancel
              </Button>
              <Button onClick={handleCreation} className="cursor-pointer">
                Create
              </Button>
            </>
          ) : (
            <Button onClick={wipe} className="cursor-pointer">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
