"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, RefreshCw, ShieldOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";
import { revokeKey, rotateSecret, updateKey } from "@/actions/key-actions";
import { Copy, Check } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

type Props = {
  id: string;
  name: string;
  webhookUrl: string | null;
  revoked: boolean;
};

export default function KeyActions({ id, name, webhookUrl, revoked }: Props) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [editName, setEditName] = useState(name);
  const [editWebhook, setEditWebhook] = useState(webhookUrl ?? "");
  const [editExpiry, setEditExpiry] = useState<string>("");

  const [revokeConfirm, setRevokeConfirm] = useState("");
  const [rotateOpen, setRotateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const handleRotate = () => {
    startTransition(async () => {
      try {
        const secret = await rotateSecret(id);
        setNewSecret(secret);
      } catch {
        toast.error("Failed to rotate secret");
        setRotateOpen(false);
      }
    });
  };

  const handleRevoke = () => {
    startTransition(async () => {
      try {
        await revokeKey(id);
        toast.success("API key revoked");
        setRevokeOpen(false);
        router.refresh();
      } catch {
        toast.error("Failed to revoke key");
      }
    });
  };

  const handleUpdate = () => {
    startTransition(async () => {
      try {
        const payload: Record<string, string> = {};
        if (editName !== name) payload.name = editName;
        if (editWebhook !== (webhookUrl ?? ""))
          payload.webhookUrl = editWebhook;
        if (editExpiry) payload.expiresAt = editExpiry;

        if (Object.keys(payload).length === 0) {
          setEditOpen(false);
          return;
        }

        await updateKey(id, payload);
        toast.success("Key updated");
        setEditOpen(false);
        router.refresh();
      } catch {
        toast.error("Failed to update key");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 cursor-pointer">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-full" align="end">
          <DropdownMenuItem
            onClick={() => setTimeout(() => setEditOpen(true), 0)}
          >
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTimeout(() => setRotateOpen(true), 0)}
          >
            <RefreshCw className="size-4" />
            Rotate secret
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={revoked}
            onClick={() => setTimeout(() => setRevokeOpen(true), 0)}
          >
            <ShieldOff className="size-4" />
            Revoke
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                Name <span className="text-red-400">*</span>
              </Label>
              <Input
                className="h-9 mt-1"
                value={editName}
                maxLength={50}
                onChange={({ target }) => setEditName(target.value)}
              />
            </div>
            <div>
              <Label>Webhook URL</Label>
              <Input
                className="h-9 mt-1"
                value={editWebhook}
                placeholder="https://mysite.com/webhook"
                onChange={({ target }) => setEditWebhook(target.value)}
              />
            </div>
            <div>
              <Label>Extend Expiry</Label>
              <Select onValueChange={setEditExpiry}>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue placeholder="Keep current expiry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="24h">24 Hours from now</SelectItem>
                    <SelectItem value="1w">1 Week from now</SelectItem>
                    <SelectItem value="1m">1 Month from now</SelectItem>
                    <SelectItem value="6m">6 Months from now</SelectItem>
                    <SelectItem value="1y">1 Year from now</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setEditOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={pending}
              className="cursor-pointer"
            >
              {pending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeOpen}
        onOpenChange={(o) => {
          setRevokeOpen(o);
          if (!o) setRevokeConfirm("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-400 text-sm">
              <p className="font-medium mb-0.5">This cannot be undone</p>
              <p className="text-red-400/80">
                Revoking this key will immediately invalidate it. Any
                applications using it will stop working.
              </p>
            </div>
            <div>
              <Label>
                Type <span className="font-mono text-foreground">{name}</span>{" "}
                to confirm
              </Label>
              <Input
                className="h-9 mt-1"
                value={revokeConfirm}
                placeholder={name}
                onChange={({ target }) => setRevokeConfirm(target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => {
                setRevokeOpen(false);
                setRevokeConfirm("");
              }}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeConfirm !== name || pending}
              onClick={handleRevoke}
              className="cursor-pointer"
            >
              {pending ? "Revoking..." : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rotateOpen}
        onOpenChange={(o) => {
          setRotateOpen(o);
          if (!o) setNewSecret(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate Webhook Secret</DialogTitle>
          </DialogHeader>
          {!newSecret ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-400 text-sm">
                <p className="font-medium mb-0.5">
                  Old secret will stop working
                </p>
                <p className="text-amber-400/80">
                  Any endpoints verifying the current webhook signature will
                  need to be updated with the new secret.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-green-400 text-sm">
                <p className="font-medium mb-0.5">Secret rotated</p>
                <p className="text-green-400/80">
                  Copy your new webhook secret now — you won&apos;t be able to
                  see it again.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">
                  New Webhook Secret
                </Label>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                  <code className="flex-1 font-mono text-xs break-all">
                    {newSecret}
                  </code>
                  <CopyButton value={newSecret} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {!newSecret ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setRotateOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRotate}
                  disabled={pending}
                  className="cursor-pointer"
                >
                  {pending ? "Rotating..." : "Rotate secret"}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setRotateOpen(false);
                  setNewSecret(null);
                }}
                className="cursor-pointer"
              >
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
