import Link from "next/link";
import { Book } from "lucide-react";
import { GithubIcon } from "./icons";
import { Button, buttonVariants } from "./ui/button";

export default function Navbar() {
  return (
    <div className="border-b px-10 py-6 flex items-center justify-between">
      <div className="space-x-12 flex items-center">
        <Link href="/" className="text-2xl font-semibold">
          🎧 Audioscape
        </Link>
        <div>
          <Link
            href="/docs"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <Book className="size-4" />
            Docs
          </Link>
        </div>
      </div>
      <div className="space-x-7 flex items-center">
        <Link href="https://github.com/sklyerx/audioscape">
          <GithubIcon />
        </Link>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "default", class: "px-4" })}
        >
          Get started
        </Link>
      </div>
    </div>
  );
}
